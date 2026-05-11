import asyncio
import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import smtplib
import socket
import sqlite3
import struct
import threading
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path
from typing import Any

import rclpy
from builtin_interfaces.msg import Duration
from control_msgs.action import FollowJointTrajectory
from diagnostic_msgs.msg import DiagnosticArray
from fastapi import Depends, FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from rclpy.executors import ExternalShutdownException
from rclpy.action import ActionClient
from geometry_msgs.msg import PoseStamped, Twist, TwistStamped
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import JointState
from std_msgs.msg import Bool, Float32, Float64, Int32, String
from tf2_msgs.msg import TFMessage
from trajectory_msgs.msg import JointTrajectoryPoint
from rosidl_runtime_py.convert import message_to_ordereddict
from rosidl_runtime_py.utilities import get_message

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # PostgreSQL support is optional for local tooling.
    psycopg = None
    dict_row = None

try:
    from abb_egm_msgs.msg import EGMState
    from abb_robot_msgs.msg import SystemState
except ImportError:  # Local tooling can import this file without the built ABB workspace.
    EGMState = None
    SystemState = None


DEFAULT_TOPICS = [
    {"name": "/joint_states", "type": "sensor_msgs/msg/JointState", "label": "Joint States"},
    {"name": "/tf", "type": "tf2_msgs/msg/TFMessage", "label": "TF"},
    {"name": "/diagnostics", "type": "diagnostic_msgs/msg/DiagnosticArray", "label": "Diagnostics"},
]

HMI_JOINT_NAMES = ["joint_1", "joint_2", "joint_3", "joint_4", "joint_5", "joint_6"]
HMI_JOINT_MAX_VELOCITY_RAD_S = [1.58, 1.58, 1.58, 3.14, 3.14, 3.14]
HMI_HOME_POSITIONS_RAD = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
HMI_JOG_DURATION_SEC = 0.65
HMI_MAX_SPEED_PERCENT = 30.0
HMI_MIN_SPEED_PERCENT = 2.0
HMI_TCP_MAX_LINEAR_M_S = 0.25
HMI_TCP_MAX_ANGULAR_RAD_S = 0.6
HMI_AUTH_USERNAME = os.getenv("SMAN_HMI_USERNAME", "Default User")
HMI_AUTH_PASSWORD = os.getenv("SMAN_HMI_PASSWORD", "robotics")
HMI_AUTH_COOKIE = "sman_hmi_session"
HMI_AUTH_SECRET = os.getenv("SMAN_HMI_SESSION_SECRET", "sman-hmi-local-session-secret")
HMI_AUTH_COOKIE_SECURE = os.getenv("SMAN_HMI_COOKIE_SECURE", "0").lower() in {"1", "true", "yes"}

MESSAGE_TYPES = {
    "sensor_msgs/msg/JointState": JointState,
    "tf2_msgs/msg/TFMessage": TFMessage,
    "diagnostic_msgs/msg/DiagnosticArray": DiagnosticArray,
    "geometry_msgs/msg/PoseStamped": PoseStamped,
    "geometry_msgs/msg/Twist": Twist,
    "geometry_msgs/msg/TwistStamped": TwistStamped,
    "std_msgs/msg/String": String,
    "std_msgs/msg/Bool": Bool,
    "std_msgs/msg/Float32": Float32,
    "std_msgs/msg/Float64": Float64,
    "std_msgs/msg/Int32": Int32,
}

DYNAMIC_MESSAGE_TYPES: dict[str, Any] = {}

if EGMState is not None:
    MESSAGE_TYPES["abb_egm_msgs/msg/EGMState"] = EGMState
if SystemState is not None:
    MESSAGE_TYPES["abb_robot_msgs/msg/SystemState"] = SystemState


def resolve_message_class(msg_type: str) -> Any:
    if msg_type in MESSAGE_TYPES:
        return MESSAGE_TYPES[msg_type]
    if msg_type not in DYNAMIC_MESSAGE_TYPES:
        DYNAMIC_MESSAGE_TYPES[msg_type] = get_message(msg_type)
    return DYNAMIC_MESSAGE_TYPES[msg_type]


@dataclass(frozen=True)
class TopicConfig:
    name: str
    type: str
    label: str


def ros_time_to_float(stamp: Any) -> float | None:
    if not hasattr(stamp, "sec") or not hasattr(stamp, "nanosec"):
        return None
    return float(stamp.sec) + float(stamp.nanosec) / 1_000_000_000.0


def json_safe(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    return value


def read_topics() -> list[TopicConfig]:
    raw = os.getenv("ROS_TOPICS")
    if not raw:
        return [TopicConfig(**topic) for topic in DEFAULT_TOPICS]

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("ROS_TOPICS muss gueltiges JSON sein.") from exc

    topics: list[TopicConfig] = []
    for item in parsed:
        try:
            resolve_message_class(item.get("type"))
        except (AttributeError, ModuleNotFoundError, TypeError, ValueError) as exc:
            supported = ", ".join(sorted(MESSAGE_TYPES))
            raise RuntimeError(
                f"Nicht importierbarer ROS2 Message-Type: {item.get('type')}. "
                f"Explizit unterstuetzt: {supported}"
            ) from exc
        topics.append(
            TopicConfig(
                name=item["name"],
                type=item["type"],
                label=item.get("label", item["name"]),
            )
        )
    return topics


def display_joint_names(names: list[str]) -> list[str]:
    result = []
    for index, name in enumerate(names):
        match = re.search(r"(?:joint[_\s-]*)(\d+)$", str(name), re.IGNORECASE)
        number = int(match.group(1)) if match else index + 1
        result.append(f"Joint {number}")
    return result


def serialize_message(message: Any, msg_type: str) -> dict[str, Any]:
    if msg_type == "sensor_msgs/msg/JointState":
        raw_names = list(message.name)
        return {
            "header_stamp": ros_time_to_float(message.header.stamp),
            "names": display_joint_names(raw_names),
            "raw_names": raw_names,
            "positions": list(message.position),
            "velocities": list(message.velocity),
            "efforts": list(message.effort),
        }

    if msg_type == "tf2_msgs/msg/TFMessage":
        return {
            "transforms": [
                {
                    "parent": transform.header.frame_id,
                    "child": transform.child_frame_id,
                    "stamp": ros_time_to_float(transform.header.stamp),
                    "translation": {
                        "x": transform.transform.translation.x,
                        "y": transform.transform.translation.y,
                        "z": transform.transform.translation.z,
                    },
                    "rotation": {
                        "x": transform.transform.rotation.x,
                        "y": transform.transform.rotation.y,
                        "z": transform.transform.rotation.z,
                        "w": transform.transform.rotation.w,
                    },
                }
                for transform in message.transforms
            ]
        }

    if msg_type == "diagnostic_msgs/msg/DiagnosticArray":
        return {
            "header_stamp": ros_time_to_float(message.header.stamp),
            "status": [
                {
                    "name": item.name,
                    "hardware_id": item.hardware_id,
                    "level": int(item.level),
                    "message": item.message,
                    "values": {value.key: value.value for value in item.values},
                }
                for item in message.status
            ],
        }

    if msg_type == "abb_egm_msgs/msg/EGMState":
        channels = []
        for channel in message.egm_channels:
            channels.append(
                {
                    "name": channel.name,
                    "active": bool(channel.active),
                    "egm_convergence_met": bool(channel.egm_convergence_met),
                    "egm_client_state": int(channel.egm_client_state),
                    "motor_state": int(channel.motor_state),
                    "rapid_execution_state": int(channel.rapid_execution_state),
                    "utilization_rate": float(channel.utilization_rate),
                }
            )
        return {
            "header_stamp": ros_time_to_float(message.header.stamp),
            "egm_channels": channels,
        }

    if msg_type == "abb_robot_msgs/msg/SystemState":
        return {
            "header_stamp": ros_time_to_float(message.header.stamp),
            "motors_on": bool(message.motors_on),
            "auto_mode": bool(message.auto_mode),
            "rapid_running": bool(message.rapid_running),
            "rapid_tasks": [
                {
                    "name": task.name,
                    "type": task.type,
                    "state": task.state,
                    "motion_task": bool(task.motion_task),
                }
                for task in message.rapid_tasks
            ],
            "mechanical_units": [
                {
                    "name": unit.name,
                    "activated": bool(unit.activated),
                }
                for unit in message.mechanical_units
            ],
        }

    if msg_type == "geometry_msgs/msg/PoseStamped":
        return {
            "frame_id": message.header.frame_id,
            "header_stamp": ros_time_to_float(message.header.stamp),
            "position": {
                "x": message.pose.position.x,
                "y": message.pose.position.y,
                "z": message.pose.position.z,
            },
            "orientation": {
                "x": message.pose.orientation.x,
                "y": message.pose.orientation.y,
                "z": message.pose.orientation.z,
                "w": message.pose.orientation.w,
            },
        }

    if msg_type == "geometry_msgs/msg/Twist":
        return {
            "linear": {"x": message.linear.x, "y": message.linear.y, "z": message.linear.z},
            "angular": {"x": message.angular.x, "y": message.angular.y, "z": message.angular.z},
        }

    if hasattr(message, "data"):
        return {"data": message.data}

    return dict(message_to_ordereddict(message))


def _read_varint(buffer: bytes, index: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while index < len(buffer):
        byte = buffer[index]
        index += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, index
        shift += 7
    raise ValueError("Incomplete protobuf varint")


def _protobuf_fields(buffer: bytes) -> list[tuple[int, int, Any]]:
    fields: list[tuple[int, int, Any]] = []
    index = 0
    while index < len(buffer):
        key, index = _read_varint(buffer, index)
        field_number = key >> 3
        wire_type = key & 0x07
        if wire_type == 0:
            value, index = _read_varint(buffer, index)
        elif wire_type == 1:
            value = buffer[index : index + 8]
            index += 8
        elif wire_type == 2:
            length, index = _read_varint(buffer, index)
            value = buffer[index : index + length]
            index += length
        elif wire_type == 5:
            value = buffer[index : index + 4]
            index += 4
        else:
            raise ValueError(f"Unsupported protobuf wire type: {wire_type}")
        fields.append((field_number, wire_type, value))
    return fields


def _decode_packed_doubles(value: bytes) -> list[float]:
    if len(value) % 8 != 0:
        return []
    return list(struct.unpack(f"<{len(value) // 8}d", value))


def _decode_double_list(message: bytes, field_number: int = 1) -> list[float]:
    values: list[float] = []
    for nested_field, nested_wire_type, nested_value in _protobuf_fields(message):
        if nested_field != field_number:
            continue
        if nested_wire_type == 1:
            values.append(struct.unpack("<d", nested_value)[0])
        elif nested_wire_type == 2:
            values.extend(_decode_packed_doubles(nested_value))
    return values


def _decode_cartesian(message: bytes) -> dict[str, float]:
    result: dict[str, float] = {}
    axes = {1: "x", 2: "y", 3: "z"}
    for field_number, wire_type, value in _protobuf_fields(message):
        if field_number in axes and wire_type == 1:
            result[axes[field_number]] = struct.unpack("<d", value)[0]
    return result


def _decode_pose(message: bytes) -> dict[str, Any]:
    pose: dict[str, Any] = {}
    for field_number, wire_type, value in _protobuf_fields(message):
        if wire_type != 2:
            continue
        if field_number == 1:
            pose["position_mm"] = _decode_cartesian(value)
        elif field_number == 2:
            quaternion = _decode_double_list(value)
            if len(quaternion) >= 4:
                pose["orientation_quaternion"] = {
                    "u0": quaternion[0],
                    "u1": quaternion[1],
                    "u2": quaternion[2],
                    "u3": quaternion[3],
                }
        elif field_number == 3:
            pose["orientation_euler_deg"] = _decode_cartesian(value)
    return pose


def _decode_planned_or_feedback(message: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for field_number, wire_type, value in _protobuf_fields(message):
        if wire_type != 2:
            continue
        if field_number == 1:
            joints = _decode_double_list(value)
            if joints:
                result["joints_deg"] = joints
                result["joints_rad"] = [math.radians(item) for item in joints]
        elif field_number == 2:
            pose = _decode_pose(value)
            if pose:
                result["cartesian"] = pose
        elif field_number == 3:
            external_joints = _decode_double_list(value)
            if external_joints:
                result["external_joints"] = external_joints
        elif field_number == 4:
            clock: dict[str, int] = {}
            for clock_field, clock_wire_type, clock_value in _protobuf_fields(value):
                if clock_wire_type == 0 and clock_field == 1:
                    clock["sec"] = int(clock_value)
                elif clock_wire_type == 0 and clock_field == 2:
                    clock["usec"] = int(clock_value)
            if clock:
                result["clock"] = clock
    return result


def _decode_single_state(message: bytes) -> int | None:
    for field_number, wire_type, value in _protobuf_fields(message):
        if field_number == 1 and wire_type == 0:
            return int(value)
    return None


def parse_egm_robot(packet: bytes) -> dict[str, Any] | None:
    """Decode the useful parts of an ABB EgmRobot protobuf packet.

    The app keeps a lightweight decoder here so the dashboard can run without
    generated ABB protobuf Python modules inside the container.
    """
    result: dict[str, Any] = {}
    for field_number, wire_type, value in _protobuf_fields(packet):
        if field_number == 1 and wire_type == 2:
            header: dict[str, int] = {}
            for header_field, header_wire_type, header_value in _protobuf_fields(value):
                if header_wire_type == 0 and header_field == 1:
                    header["seqno"] = int(header_value)
                elif header_wire_type == 0 and header_field == 2:
                    header["tm_ms"] = int(header_value)
                elif header_wire_type == 0 and header_field == 3:
                    header["message_type"] = int(header_value)
            result["header"] = header
        elif field_number == 2 and wire_type == 2:
            result["feedback"] = _decode_planned_or_feedback(value)
        elif field_number == 3 and wire_type == 2:
            result["planned"] = _decode_planned_or_feedback(value)
        elif field_number == 4 and wire_type == 2:
            result["motor_state"] = _decode_single_state(value)
        elif field_number == 5 and wire_type == 2:
            result["mci_state"] = _decode_single_state(value)
        elif field_number == 6 and wire_type == 0:
            result["mci_convergence_met"] = bool(value)
        elif field_number == 7 and wire_type == 2:
            result["test_signals"] = _decode_double_list(value, 1)
        elif field_number == 8 and wire_type == 2:
            result["rapid_exec_state"] = _decode_single_state(value)
        elif field_number == 9 and wire_type == 2:
            result["measured_force"] = _decode_double_list(value, 1)
        elif field_number == 10 and wire_type == 1:
            result["utilization_rate"] = struct.unpack("<d", value)[0]

    feedback_joints = result.get("feedback", {}).get("joints_rad")
    if not feedback_joints:
        return result if result else None
    return result


def parse_egm_joints(packet: bytes) -> list[float] | None:
    robot = parse_egm_robot(packet)
    joints = robot.get("feedback", {}).get("joints_rad") if robot else None
    if isinstance(joints, list) and len(joints) >= 6:
        return joints[:6]
    return None


def label_state(value: int | None, labels: dict[int, str]) -> str:
    if value is None:
        return "unknown"
    return labels.get(value, f"unknown:{value}")


class PayloadStore:
    def __init__(self, persistence: "DashboardPersistence | None" = None) -> None:
        self._lock = threading.Lock()
        self._last_seen: dict[str, float] = {}
        self._latest_payloads: dict[str, dict[str, Any]] = {}
        self._persistence = persistence

    def record(self, payload: dict[str, Any]) -> None:
        topic = payload.get("topic")
        received_at = payload.get("received_at")
        if not isinstance(topic, str) or not isinstance(received_at, (int, float)):
            return
        with self._lock:
            self._last_seen[topic] = float(received_at)
            self._latest_payloads[topic] = payload
        if self._persistence is not None:
            self._persistence.record_payload(payload)

    def status_payload(self) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            items = list(self._last_seen.items())
        payload = {
            "kind": "status",
            "ros_ok": rclpy.ok(),
            "topics": [
                {
                    "name": topic,
                    "last_seen": last_seen,
                    "age_sec": round(now - last_seen, 3),
                }
                for topic, last_seen in items
            ],
            "time": now,
        }
        if self._persistence is not None:
            self._persistence.observe_status(payload)
        return payload

    def snapshot_payload(self) -> dict[str, Any]:
        with self._lock:
            topics = list(self._latest_payloads.values())
        return {
            "kind": "snapshot",
            "topics": topics,
            "status": self.status_payload(),
        }

    def latest_joint_positions(self) -> list[float] | None:
        with self._lock:
            payload = self._latest_payloads.get("/joint_states")
        data = payload.get("data") if payload else None
        positions = data.get("positions") if isinstance(data, dict) else None
        if not isinstance(positions, list) or len(positions) < 6:
            return None
        try:
            return [float(value) for value in positions[:6]]
        except (TypeError, ValueError):
            return None


class DashboardPersistence:
    def __init__(self, data_dir: str) -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "sman_dashboard.sqlite3"
        self.database_url = os.getenv("SMAN_DATABASE_URL", "").strip()
        self.driver = "postgres" if self.database_url else "sqlite"
        self._lock = threading.Lock()
        self._last_positions: list[float] | None = None
        self._last_velocity_signs: list[int] | None = None
        self._last_joint_time: float | None = None
        self._last_event_times: dict[str, float] = {}
        self._init_db()

    def _connect(self) -> Any:
        if self.driver == "postgres":
            if psycopg is None or dict_row is None:
                raise RuntimeError("psycopg ist nicht installiert, SMAN_DATABASE_URL kann nicht genutzt werden.")
            return psycopg.connect(self.database_url, row_factory=dict_row)
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _sql(self, statement: str) -> str:
        if self.driver == "postgres":
            return statement.replace("?", "%s")
        return statement

    def _greatest(self, left: str, right: str) -> str:
        return f"GREATEST({left}, {right})" if self.driver == "postgres" else f"MAX({left}, {right})"

    def _window_seconds(self, window: str) -> int:
        seconds_by_window = {
            "live": 0,
            "1h": 3600,
            "24h": 86400,
            "7d": 7 * 86400,
            "30d": 30 * 86400,
            "90d": 90 * 86400,
        }
        return seconds_by_window.get(window, 86400)

    def _series_step(self, seconds: int) -> int:
        if seconds <= 3600:
            return 60
        if seconds <= 86400:
            return 900
        if seconds <= 7 * 86400:
            return 3600
        return 86400

    def _init_db(self) -> None:
        with self._connect() as db:
            if self.driver == "postgres":
                statements = [
                    """
                    CREATE TABLE IF NOT EXISTS telemetry_agg (
                        bucket BIGINT PRIMARY KEY,
                        samples INTEGER NOT NULL DEFAULT 0,
                        joint_distance DOUBLE PRECISION NOT NULL DEFAULT 0,
                        max_velocity DOUBLE PRECISION NOT NULL DEFAULT 0,
                        avg_velocity_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
                        direction_changes INTEGER NOT NULL DEFAULT 0,
                        near_limit_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
                        utilization_max DOUBLE PRECISION,
                        latency_sum_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
                        jitter_sum_ms DOUBLE PRECISION NOT NULL DEFAULT 0
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS axis_agg (
                        bucket BIGINT NOT NULL,
                        axis INTEGER NOT NULL,
                        distance DOUBLE PRECISION NOT NULL DEFAULT 0,
                        direction_changes INTEGER NOT NULL DEFAULT 0,
                        near_limit_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
                        max_velocity DOUBLE PRECISION NOT NULL DEFAULT 0,
                        PRIMARY KEY (bucket, axis)
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS joint_position_agg (
                        bucket BIGINT NOT NULL,
                        axis INTEGER NOT NULL,
                        samples INTEGER NOT NULL DEFAULT 0,
                        position_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
                        PRIMARY KEY (bucket, axis)
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS events (
                        id BIGSERIAL PRIMARY KEY,
                        created_at DOUBLE PRECISION NOT NULL,
                        severity TEXT NOT NULL,
                        type TEXT NOT NULL,
                        title TEXT NOT NULL,
                        detail TEXT NOT NULL,
                        payload TEXT NOT NULL DEFAULT '{}',
                        acknowledged_at DOUBLE PRECISION,
                        acknowledged_by TEXT,
                        comment TEXT
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS mail_queue (
                        id BIGSERIAL PRIMARY KEY,
                        created_at DOUBLE PRECISION NOT NULL,
                        status TEXT NOT NULL,
                        severity TEXT NOT NULL,
                        subject TEXT NOT NULL,
                        body TEXT NOT NULL,
                        recipients TEXT NOT NULL,
                        sent_at DOUBLE PRECISION,
                        error TEXT
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS mail_recipients (
                        id BIGSERIAL PRIMARY KEY,
                        email TEXT NOT NULL UNIQUE,
                        subscribed BOOLEAN NOT NULL DEFAULT TRUE,
                        created_at DOUBLE PRECISION NOT NULL,
                        updated_at DOUBLE PRECISION NOT NULL
                    )
                    """,
                    """
                    CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    )
                    """,
                ]
                for statement in statements:
                    db.execute(statement)
            else:
                db.executescript(
                    """
                CREATE TABLE IF NOT EXISTS telemetry_agg (
                    bucket INTEGER PRIMARY KEY,
                    samples INTEGER NOT NULL DEFAULT 0,
                    joint_distance REAL NOT NULL DEFAULT 0,
                    max_velocity REAL NOT NULL DEFAULT 0,
                    avg_velocity_sum REAL NOT NULL DEFAULT 0,
                    direction_changes INTEGER NOT NULL DEFAULT 0,
                    near_limit_seconds REAL NOT NULL DEFAULT 0,
                    utilization_max REAL,
                    latency_sum_ms REAL NOT NULL DEFAULT 0,
                    jitter_sum_ms REAL NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS axis_agg (
                    bucket INTEGER NOT NULL,
                    axis INTEGER NOT NULL,
                    distance REAL NOT NULL DEFAULT 0,
                    direction_changes INTEGER NOT NULL DEFAULT 0,
                    near_limit_seconds REAL NOT NULL DEFAULT 0,
                    max_velocity REAL NOT NULL DEFAULT 0,
                    PRIMARY KEY (bucket, axis)
                );

                CREATE TABLE IF NOT EXISTS joint_position_agg (
                    bucket INTEGER NOT NULL,
                    axis INTEGER NOT NULL,
                    samples INTEGER NOT NULL DEFAULT 0,
                    position_sum REAL NOT NULL DEFAULT 0,
                    PRIMARY KEY (bucket, axis)
                );

                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at REAL NOT NULL,
                    severity TEXT NOT NULL,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    payload TEXT NOT NULL DEFAULT '{}',
                    acknowledged_at REAL,
                    acknowledged_by TEXT,
                    comment TEXT
                );

                CREATE TABLE IF NOT EXISTS mail_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at REAL NOT NULL,
                    status TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    body TEXT NOT NULL,
                    recipients TEXT NOT NULL,
                    sent_at REAL,
                    error TEXT
                );

                CREATE TABLE IF NOT EXISTS mail_recipients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT NOT NULL UNIQUE,
                    subscribed INTEGER NOT NULL DEFAULT 1,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """
                )
            self._seed_setting(db, "mail_recipients", os.getenv("SMAN_MAIL_RECIPIENTS", ""))
            self._seed_setting(db, "mail_enabled", "1")
            self._seed_setting(db, "mail_immediate_critical", "1")
            self._seed_setting(db, "mail_daily_summary", "1")
            self._seed_setting(db, "mail_weekly_report", "1")
            self._migrate_mail_recipients(db)

    def _seed_setting(self, db: Any, key: str, value: str) -> None:
        if self.driver == "postgres":
            db.execute("INSERT INTO settings(key, value) VALUES (%s, %s) ON CONFLICT(key) DO NOTHING", (key, value))
        else:
            db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (key, value))

    def _setting(self, db: Any, key: str, default: str = "") -> str:
        row = db.execute(self._sql("SELECT value FROM settings WHERE key = ?"), (key,)).fetchone()
        return str(row["value"]) if row else default

    def _parse_recipients(self, recipients: str) -> list[str]:
        items = re.split(r"[,;\s]+", recipients.strip())
        result = []
        seen = set()
        for item in items:
            email = item.strip().lower()
            if not email or email in seen or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
                continue
            seen.add(email)
            result.append(email)
        return result

    def _upsert_mail_recipient(self, db: Any, email: str, subscribed: bool = True) -> None:
        now = time.time()
        if self.driver == "postgres":
            db.execute(
                """
                INSERT INTO mail_recipients(email, subscribed, created_at, updated_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT(email) DO UPDATE SET subscribed = excluded.subscribed, updated_at = excluded.updated_at
                """,
                (email, subscribed, now, now),
            )
            return
        db.execute(
            """
            INSERT INTO mail_recipients(email, subscribed, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET subscribed = excluded.subscribed, updated_at = excluded.updated_at
            """,
            (email, 1 if subscribed else 0, now, now),
        )

    def _migrate_mail_recipients(self, db: Any) -> None:
        if db.execute("SELECT COUNT(*) AS count FROM mail_recipients").fetchone()["count"]:
            return
        for email in self._parse_recipients(self._setting(db, "mail_recipients", "")):
            self._upsert_mail_recipient(db, email, True)

    def _mail_recipient_rows(self, db: Any) -> list[dict[str, Any]]:
        rows = db.execute(
            "SELECT id, email, subscribed, created_at, updated_at FROM mail_recipients ORDER BY email"
        ).fetchall()
        return [
            {
                "id": int(row["id"]),
                "email": row["email"],
                "subscribed": bool(row["subscribed"]),
                "created_at": float(row["created_at"]),
                "updated_at": float(row["updated_at"]),
            }
            for row in rows
        ]

    def _active_mail_recipients(self, db: Any) -> str:
        if self._setting(db, "mail_enabled", "1") != "1":
            return ""
        rows = db.execute("SELECT email FROM mail_recipients WHERE subscribed = TRUE ORDER BY email").fetchall()
        return ", ".join(row["email"] for row in rows)

    def _sync_legacy_recipients_setting(self, db: Any) -> None:
        recipients = self._active_mail_recipients(db)
        db.execute(
            self._sql("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
            ("mail_recipients", recipients),
        )

    def record_payload(self, payload: dict[str, Any]) -> None:
        topic = payload.get("topic")
        if topic == "/joint_states":
            self._record_joint_state(payload)
        elif topic == "/egm/state" or payload.get("type") == "abb_egm_msgs/msg/EGMState":
            self._record_egm_state(payload)

    def _record_joint_state(self, payload: dict[str, Any]) -> None:
        data = payload.get("data") or {}
        positions = [float(value) for value in data.get("positions", []) if isinstance(value, (int, float))]
        if len(positions) < 6:
            return

        received_at = float(payload.get("received_at", time.time()))
        header_stamp = data.get("header_stamp")
        bucket = int(received_at)
        dt = 0.0
        deltas = [0.0] * len(positions)
        velocities = [float(value) for value in data.get("velocities", []) if isinstance(value, (int, float))]

        with self._lock:
            if self._last_positions is not None and self._last_joint_time is not None:
                dt = max(0.0, min(2.0, received_at - self._last_joint_time))
                deltas = [abs(value - (self._last_positions[index] if index < len(self._last_positions) else value)) for index, value in enumerate(positions)]
                if not velocities and dt > 0:
                    velocities = [delta / dt for delta in deltas]

            if not velocities:
                velocities = [0.0] * len(positions)

            signs = [1 if value > 0.002 else -1 if value < -0.002 else 0 for value in velocities]
            if self._last_velocity_signs is None:
                direction_changes = 0
                axis_direction_changes = [0] * len(positions)
            else:
                axis_direction_changes = [
                    1 if sign != 0 and previous != 0 and sign != previous else 0
                    for sign, previous in zip(signs, self._last_velocity_signs)
                ]
                direction_changes = sum(axis_direction_changes)

            near_limit_seconds = dt if any(abs(value) > math.pi * 0.86 for value in positions) else 0.0
            axis_near_limit = [dt if abs(value) > math.pi * 0.86 else 0.0 for value in positions]
            max_velocity = max((abs(value) for value in velocities), default=0.0)
            avg_velocity = sum(abs(value) for value in velocities) / max(1, len(velocities))
            latency_ms = 0.0
            if isinstance(header_stamp, (int, float)) and header_stamp > 0:
                latency_ms = max(0.0, (received_at - float(header_stamp)) * 1000)

            self._last_positions = list(positions)
            self._last_velocity_signs = signs
            self._last_joint_time = received_at

        joint_distance = sum(deltas)
        with self._connect() as db:
            db.execute(
                self._sql(
                    f"""
                INSERT INTO telemetry_agg(bucket, samples, joint_distance, max_velocity, avg_velocity_sum,
                    direction_changes, near_limit_seconds, latency_sum_ms)
                VALUES (?, 1, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(bucket) DO UPDATE SET
                    samples = telemetry_agg.samples + 1,
                    joint_distance = telemetry_agg.joint_distance + excluded.joint_distance,
                    max_velocity = {self._greatest("telemetry_agg.max_velocity", "excluded.max_velocity")},
                    avg_velocity_sum = telemetry_agg.avg_velocity_sum + excluded.avg_velocity_sum,
                    direction_changes = telemetry_agg.direction_changes + excluded.direction_changes,
                    near_limit_seconds = telemetry_agg.near_limit_seconds + excluded.near_limit_seconds,
                    latency_sum_ms = telemetry_agg.latency_sum_ms + excluded.latency_sum_ms
                    """
                ),
                (bucket, joint_distance, max_velocity, avg_velocity, direction_changes, near_limit_seconds, latency_ms),
            )
            for index, delta in enumerate(deltas[:6]):
                axis_velocity = abs(velocities[index]) if index < len(velocities) else 0.0
                db.execute(
                    self._sql(
                        f"""
                    INSERT INTO axis_agg(bucket, axis, distance, direction_changes, near_limit_seconds, max_velocity)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(bucket, axis) DO UPDATE SET
                        distance = axis_agg.distance + excluded.distance,
                        direction_changes = axis_agg.direction_changes + excluded.direction_changes,
                        near_limit_seconds = axis_agg.near_limit_seconds + excluded.near_limit_seconds,
                        max_velocity = {self._greatest("axis_agg.max_velocity", "excluded.max_velocity")}
                    """
                    ),
                    (bucket, index + 1, delta, axis_direction_changes[index] if index < len(axis_direction_changes) else 0, axis_near_limit[index], axis_velocity),
                )
                db.execute(
                    self._sql(
                        """
                    INSERT INTO joint_position_agg(bucket, axis, samples, position_sum)
                    VALUES (?, ?, 1, ?)
                    ON CONFLICT(bucket, axis) DO UPDATE SET
                        samples = joint_position_agg.samples + 1,
                        position_sum = joint_position_agg.position_sum + excluded.position_sum
                    """
                    ),
                    (bucket, index + 1, positions[index]),
                )

        if max_velocity > 1.6:
            self.record_event(
                "velocity_spike",
                "warning",
                "Hohe Achsgeschwindigkeit",
                f"Maximal {max_velocity:.2f} rad/s gemessen.",
                {"max_velocity": max_velocity},
                cooldown_sec=300,
            )

    def _record_egm_state(self, payload: dict[str, Any]) -> None:
        data = payload.get("data") or {}
        utilization = data.get("utilization_rate")
        if utilization is None and data.get("egm_channels"):
            utilization = max(
                (channel.get("utilization_rate", 0) for channel in data.get("egm_channels", [])),
                default=None,
            )
        if isinstance(utilization, (int, float)):
            bucket = int(float(payload.get("received_at", time.time())))
            with self._connect() as db:
                db.execute(
                    self._sql(
                        f"""
                    INSERT INTO telemetry_agg(bucket, samples, utilization_max)
                    VALUES (?, 0, ?)
                    ON CONFLICT(bucket) DO UPDATE SET
                        utilization_max = {self._greatest("COALESCE(telemetry_agg.utilization_max, 0)", "excluded.utilization_max")}
                    """
                    ),
                    (bucket, float(utilization)),
                )
            if utilization > 100:
                self.record_event(
                    "egm_utilization_high",
                    "critical",
                    "EGM Utilization zu hoch",
                    f"EGM meldet {utilization:.1f} %. Bewegungsreferenzen pruefen.",
                    {"utilization_rate": utilization},
                    cooldown_sec=300,
                )

    def observe_status(self, payload: dict[str, Any]) -> None:
        joint_topic = next((topic for topic in payload.get("topics", []) if topic.get("name") == "/joint_states"), None)
        age = joint_topic.get("age_sec") if joint_topic else None
        if isinstance(age, (int, float)) and age > 3.0:
            self.record_event(
                "stream_stale",
                "critical",
                "Kein Live-Datenstrom",
                f"Seit {age:.1f} s keine aktuellen Joint-State-Daten empfangen.",
                {"age_sec": age},
                cooldown_sec=300,
            )

    def record_event(
        self,
        event_type: str,
        severity: str,
        title: str,
        detail: str,
        payload: dict[str, Any] | None = None,
        cooldown_sec: int = 60,
    ) -> None:
        now = time.time()
        key = f"{event_type}:{severity}"
        with self._lock:
            if now - self._last_event_times.get(key, 0) < cooldown_sec:
                return
            self._last_event_times[key] = now

        payload_json = json.dumps(payload or {}, separators=(",", ":"))
        with self._connect() as db:
            if self.driver == "postgres":
                cursor = db.execute(
                    "INSERT INTO events(created_at, severity, type, title, detail, payload) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                    (now, severity, event_type, title, detail, payload_json),
                )
                event_id = int(cursor.fetchone()["id"])
            else:
                cursor = db.execute(
                    "INSERT INTO events(created_at, severity, type, title, detail, payload) VALUES (?, ?, ?, ?, ?, ?)",
                    (now, severity, event_type, title, detail, payload_json),
                )
                event_id = int(cursor.lastrowid)
            if severity == "critical" and self._setting(db, "mail_immediate_critical", "1") == "1":
                self._queue_mail(db, f"ABB GoFa Alarm: {title}", f"{title}\n\n{detail}\n\nEvent #{event_id}", severity)

    def _queue_mail(self, db: Any, subject: str, body: str, severity: str, recipients_override: str | None = None) -> int:
        recipients = recipients_override if recipients_override is not None else self._active_mail_recipients(db)
        status = "queued" if recipients.strip() else "needs_recipients"
        if self.driver == "postgres":
            cursor = db.execute(
                "INSERT INTO mail_queue(created_at, status, severity, subject, body, recipients) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (time.time(), status, severity, subject, body, recipients),
            )
            return int(cursor.fetchone()["id"])
        cursor = db.execute(
            "INSERT INTO mail_queue(created_at, status, severity, subject, body, recipients) VALUES (?, ?, ?, ?, ?, ?)",
            (time.time(), status, severity, subject, body, recipients),
        )
        return int(cursor.lastrowid)

    def queue_test_mail(self, recipients: str = "") -> dict[str, Any]:
        with self._connect() as db:
            target = ", ".join(self._parse_recipients(recipients)) or self._active_mail_recipients(db)
            mail_id = self._queue_mail(
                db,
                "SMAN Testmail",
                "Diese Testmail wurde vom SMAN ABB GoFa Dashboard gesendet.\n\nWenn du sie bekommst, ist SMTP korrekt konfiguriert.",
                "info",
                recipients_override=target,
            )
            status = db.execute(self._sql("SELECT status FROM mail_queue WHERE id = ?"), (mail_id,)).fetchone()["status"]
            if status == "queued" and not os.getenv("SMAN_SMTP_HOST"):
                db.execute(self._sql("UPDATE mail_queue SET status = ?, error = ? WHERE id = ?"), ("smtp_missing", "SMAN_SMTP_HOST is not configured", mail_id))
        self.send_pending_mail()
        with self._connect() as db:
            row = db.execute(self._sql("SELECT status, error FROM mail_queue WHERE id = ?"), (mail_id,)).fetchone()
        return {"status": row["status"], "mail_id": mail_id, "error": row["error"]}

    def notification_settings(self) -> dict[str, Any]:
        with self._connect() as db:
            recipients = self._mail_recipient_rows(db)
            active_recipients = ", ".join(item["email"] for item in recipients if item["subscribed"])
            return {
                "recipients": active_recipients,
                "all_recipients": recipients,
                "mail_enabled": self._setting(db, "mail_enabled", "1") == "1",
                "immediate_critical": self._setting(db, "mail_immediate_critical", "1") == "1",
                "daily_summary": self._setting(db, "mail_daily_summary", "1") == "1",
                "weekly_report": self._setting(db, "mail_weekly_report", "1") == "1",
                "smtp_configured": bool(os.getenv("SMAN_SMTP_HOST")),
            }

    def update_notification_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        updates = {
            "mail_enabled": "1" if settings.get("mail_enabled", True) else "0",
            "mail_immediate_critical": "1" if settings.get("immediate_critical", True) else "0",
            "mail_daily_summary": "1" if settings.get("daily_summary", True) else "0",
            "mail_weekly_report": "1" if settings.get("weekly_report", True) else "0",
        }
        with self._connect() as db:
            for email in self._parse_recipients(str(settings.get("recipients", ""))):
                self._upsert_mail_recipient(db, email, True)
            for key, value in updates.items():
                db.execute(
                    self._sql("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
                    (key, value),
                )
            self._sync_legacy_recipients_setting(db)
        return self.notification_settings()

    def update_mail_recipient(self, payload: dict[str, Any]) -> dict[str, Any]:
        email = self._parse_recipients(str(payload.get("email", "")))
        if not email:
            raise ValueError("ungueltige Mail-Adresse")
        with self._connect() as db:
            self._upsert_mail_recipient(db, email[0], bool(payload.get("subscribed", True)))
            self._sync_legacy_recipients_setting(db)
        return self.notification_settings()

    def acknowledge_event(self, event_id: int, acknowledged_by: str = "dashboard", comment: str = "") -> dict[str, str]:
        with self._connect() as db:
            db.execute(
                self._sql(
                    """
                UPDATE events
                SET acknowledged_at = COALESCE(acknowledged_at, ?), acknowledged_by = ?, comment = ?
                WHERE id = ?
                """
                ),
                (time.time(), acknowledged_by, comment, event_id),
            )
        return {"status": "ok"}

    def summary(self, window: str = "24h") -> dict[str, Any]:
        seconds = self._window_seconds(window) or 86400
        since = int(time.time() - seconds)
        with self._connect() as db:
            row = db.execute(
                self._sql(
                    """
                SELECT
                    COALESCE(SUM(samples), 0) AS samples,
                    COALESCE(SUM(joint_distance), 0) AS joint_distance,
                    COALESCE(MAX(max_velocity), 0) AS max_velocity,
                    COALESCE(SUM(avg_velocity_sum), 0) AS avg_velocity_sum,
                    COALESCE(SUM(direction_changes), 0) AS direction_changes,
                    COALESCE(SUM(near_limit_seconds), 0) AS near_limit_seconds,
                    COALESCE(MAX(utilization_max), 0) AS utilization_max,
                    COALESCE(SUM(latency_sum_ms), 0) AS latency_sum_ms
                FROM telemetry_agg
                WHERE bucket >= ?
                """
                ),
                (since,),
            ).fetchone()
            axis_rows = db.execute(
                self._sql(
                    """
                SELECT axis, COALESCE(SUM(distance), 0) AS distance,
                    COALESCE(SUM(direction_changes), 0) AS direction_changes,
                    COALESCE(SUM(near_limit_seconds), 0) AS near_limit_seconds,
                    COALESCE(MAX(max_velocity), 0) AS max_velocity
                FROM axis_agg
                WHERE bucket >= ?
                GROUP BY axis
                ORDER BY axis
                """
                ),
                (since,),
            ).fetchall()
            events = db.execute(
                self._sql(
                    """
                SELECT id, created_at, severity, type, title, detail, acknowledged_at, acknowledged_by, comment
                FROM events
                WHERE created_at >= ?
                ORDER BY created_at DESC
                LIMIT 50
                """
                ),
                (time.time() - max(seconds, 86400),),
            ).fetchall()
            mail_rows = db.execute(
                "SELECT id, created_at, status, severity, subject, recipients, sent_at, error FROM mail_queue ORDER BY created_at DESC LIMIT 20"
            ).fetchall()

        samples = int(row["samples"])
        avg_velocity = float(row["avg_velocity_sum"]) / samples if samples else 0.0
        axis_metrics = []
        for axis_row in axis_rows:
            distance = float(axis_row["distance"])
            direction_changes = int(axis_row["direction_changes"])
            near_limit = float(axis_row["near_limit_seconds"])
            max_velocity = float(axis_row["max_velocity"])
            wear_score = min(100.0, distance * 4.5 + direction_changes * 0.12 + near_limit * 2.8 + max_velocity * 8)
            axis_metrics.append(
                {
                    "axis": int(axis_row["axis"]),
                    "distance_rad": distance,
                    "direction_changes": direction_changes,
                    "near_limit_seconds": near_limit,
                    "max_velocity_rad_s": max_velocity,
                    "wear_score": round(wear_score, 1),
                }
            )

        total_wear = max((item["wear_score"] for item in axis_metrics), default=0.0)
        quality_penalty = min(25.0, float(row["utilization_max"]) / 6)
        health_score = max(0, round(100 - total_wear * 0.35 - quality_penalty))
        return {
            "window": window,
            "samples": samples,
            "joint_distance_rad": float(row["joint_distance"]),
            "max_velocity_rad_s": float(row["max_velocity"]),
            "avg_velocity_rad_s": avg_velocity,
            "direction_changes": int(row["direction_changes"]),
            "near_limit_seconds": float(row["near_limit_seconds"]),
            "utilization_max": float(row["utilization_max"]),
            "latency_avg_ms": float(row["latency_sum_ms"]) / samples if samples else 0.0,
            "health_score": health_score,
            "axis": axis_metrics,
            "events": [dict(item) for item in events],
            "mail_queue": [dict(item) for item in mail_rows],
            "notification_settings": self.notification_settings(),
        }

    def series(self, window: str = "1h") -> dict[str, Any]:
        seconds = self._window_seconds(window)
        if seconds <= 0:
            return {"window": "live", "mode": "live", "points": [], "axis_positions": [], "axis_wear": []}

        now = int(time.time())
        since = now - seconds
        step = self._series_step(seconds)
        bucket_expr = f"FLOOR(bucket / {step}) * {step}" if self.driver == "postgres" else f"CAST(bucket / {step} AS INTEGER) * {step}"

        with self._connect() as db:
            telemetry_rows = db.execute(
                f"""
                SELECT {bucket_expr} AS t,
                    COALESCE(SUM(samples), 0) AS samples,
                    COALESCE(SUM(joint_distance), 0) AS joint_distance,
                    COALESCE(MAX(max_velocity), 0) AS max_velocity,
                    COALESCE(SUM(avg_velocity_sum), 0) AS avg_velocity_sum,
                    COALESCE(MAX(utilization_max), 0) AS utilization_max,
                    COALESCE(SUM(latency_sum_ms), 0) AS latency_sum_ms
                FROM telemetry_agg
                WHERE bucket >= {since}
                GROUP BY t
                ORDER BY t
                """
            ).fetchall()
            axis_rows = db.execute(
                f"""
                SELECT axis, COALESCE(SUM(distance), 0) AS distance,
                    COALESCE(SUM(direction_changes), 0) AS direction_changes,
                    COALESCE(SUM(near_limit_seconds), 0) AS near_limit_seconds,
                    COALESCE(MAX(max_velocity), 0) AS max_velocity
                FROM axis_agg
                WHERE bucket >= {since}
                GROUP BY axis
                ORDER BY axis
                """
            ).fetchall()
            position_rows = db.execute(
                f"""
                SELECT axis,
                    COALESCE(SUM(position_sum), 0) AS position_sum,
                    COALESCE(SUM(samples), 0) AS samples
                FROM joint_position_agg
                WHERE bucket >= {since}
                GROUP BY axis
                ORDER BY axis
                """
            ).fetchall()

        points = []
        for row in telemetry_rows:
            samples = int(row["samples"])
            avg_velocity = float(row["avg_velocity_sum"]) / samples if samples else 0.0
            utilization = float(row["utilization_max"] or 0.0)
            health_score = max(0, round(100 - min(40.0, float(row["joint_distance"]) * 2.5) - min(25.0, utilization / 6)))
            points.append(
                {
                    "time": float(row["t"]),
                    "samples": samples,
                    "sample_rate_hz": samples / step,
                    "joint_distance_rad": float(row["joint_distance"]),
                    "avg_velocity_rad_s": avg_velocity,
                    "max_velocity_rad_s": float(row["max_velocity"]),
                    "utilization_max": utilization,
                    "latency_avg_ms": float(row["latency_sum_ms"]) / samples if samples else 0.0,
                    "health_score": health_score,
                }
            )

        axis_wear = []
        for row in axis_rows:
            distance = float(row["distance"])
            direction_changes = int(row["direction_changes"])
            near_limit = float(row["near_limit_seconds"])
            max_velocity = float(row["max_velocity"])
            axis_wear.append(
                {
                    "axis": int(row["axis"]),
                    "wear_score": round(min(100.0, distance * 4.5 + direction_changes * 0.12 + near_limit * 2.8 + max_velocity * 8), 1),
                    "distance_rad": distance,
                }
            )

        axis_positions = [
            {
                "axis": int(row["axis"]),
                "position_rad": float(row["position_sum"]) / int(row["samples"]) if int(row["samples"]) else 0.0,
            }
            for row in position_rows
        ]

        return {
            "window": window,
            "mode": "history",
            "step_seconds": step,
            "since": since,
            "until": now,
            "points": points,
            "axis_positions": axis_positions,
            "axis_wear": axis_wear,
        }

    def send_pending_mail(self) -> None:
        smtp_host = os.getenv("SMAN_SMTP_HOST")
        if not smtp_host:
            return
        smtp_port = int(os.getenv("SMAN_SMTP_PORT", "587"))
        smtp_security = os.getenv("SMAN_SMTP_SECURITY", "starttls").lower()
        smtp_user = os.getenv("SMAN_SMTP_USER", "")
        smtp_password = os.getenv("SMAN_SMTP_PASSWORD", "")
        sender = os.getenv("SMAN_MAIL_FROM", smtp_user or "sman-dashboard@localhost")

        with self._connect() as db:
            rows = db.execute(
                "SELECT id, subject, body, recipients FROM mail_queue WHERE status = 'queued' ORDER BY created_at LIMIT 5"
            ).fetchall()

        for row in rows:
            recipients = [item.strip() for item in str(row["recipients"]).split(",") if item.strip()]
            if not recipients:
                continue
            message = EmailMessage()
            message["Subject"] = row["subject"]
            message["From"] = sender
            message["To"] = ", ".join(recipients)
            message["Date"] = formatdate(localtime=True)
            message["Message-ID"] = make_msgid(domain="sman-dashboard.local")
            message.set_content(row["body"])
            try:
                smtp_class = smtplib.SMTP_SSL if smtp_security == "ssl" else smtplib.SMTP
                with smtp_class(smtp_host, smtp_port, timeout=10) as smtp:
                    if smtp_security == "starttls":
                        smtp.starttls()
                    if smtp_user:
                        smtp.login(smtp_user, smtp_password)
                    smtp.send_message(message)
                status, error = "sent", None
            except Exception as exc:  # pragma: no cover - depends on external SMTP.
                status, error = "error", str(exc)
            with self._connect() as db:
                db.execute(
                    self._sql("UPDATE mail_queue SET status = ?, sent_at = ?, error = ? WHERE id = ?"),
                    (status, time.time() if status == "sent" else None, error, row["id"]),
                )


def enqueue_payload(queue: asyncio.Queue, payload: dict[str, Any]) -> None:
    try:
        queue.put_nowait(payload)
    except asyncio.QueueFull:
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
        queue.put_nowait(payload)


def csv_env(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def env_flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).lower() not in {"0", "false", "no", "off"}


class HmiMotionController:
    def __init__(self, node: Node, store: PayloadStore) -> None:
        self._node = node
        self._store = store
        self._client = ActionClient(node, FollowJointTrajectory, "/gofa_arm_controller/follow_joint_trajectory")
        self._tcp_twist_topic = os.getenv("SMAN_HMI_TCP_TWIST_TOPIC", "/servo_node/delta_twist_cmds")
        self._tcp_twist_frame = os.getenv("SMAN_HMI_TCP_TWIST_FRAME", "base_link")
        self._tcp_twist_publisher = node.create_publisher(TwistStamped, self._tcp_twist_topic, 10)
        self._lock = threading.Lock()
        self._active_goal_handle: Any = None
        self._last_command: dict[str, Any] = {"mode": "idle", "updated_at": time.time()}

    def state(self) -> dict[str, Any]:
        current = self._store.latest_joint_positions()
        with self._lock:
            command = dict(self._last_command)
        return {
            "available": True,
            "action": "/gofa_arm_controller/follow_joint_trajectory",
            "tcp_twist_topic": self._tcp_twist_topic,
            "tcp_twist_frame": self._tcp_twist_frame,
            "joints": HMI_JOINT_NAMES,
            "positions": current,
            "command": command,
            "limits": {
                "min_speed_percent": HMI_MIN_SPEED_PERCENT,
                "max_speed_percent": HMI_MAX_SPEED_PERCENT,
                "default_speed_percent": 5,
                "home_speed_percent": 5,
                "max_tcp_linear_m_s": HMI_TCP_MAX_LINEAR_M_S,
                "max_tcp_angular_rad_s": HMI_TCP_MAX_ANGULAR_RAD_S,
            },
        }

    def stop(self, reason: str = "operator") -> dict[str, str]:
        with self._lock:
            goal_handle = self._active_goal_handle
            self._active_goal_handle = None
            self._last_command = {"mode": "idle", "reason": reason, "updated_at": time.time()}
        if goal_handle is not None:
            try:
                goal_handle.cancel_goal_async()
            except Exception as exc:
                self._node.get_logger().warn(f"HMI cancel failed: {exc}")
        self._publish_tcp_twist(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        return {"status": "stopping", "reason": reason}

    def jog(self, axis: int, direction: int, speed_percent: float) -> dict[str, Any]:
        if axis < 0 or axis >= len(HMI_JOINT_NAMES):
            raise ValueError("axis must be between 0 and 5")
        if direction not in {-1, 1}:
            raise ValueError("direction must be -1 or 1")

        current = self._require_current_positions()
        speed = self._clamp_speed(speed_percent)
        delta = direction * HMI_JOINT_MAX_VELOCITY_RAD_S[axis] * (speed / 100.0) * HMI_JOG_DURATION_SEC
        target = list(current)
        target[axis] += delta
        self._send_goal(target, HMI_JOG_DURATION_SEC)
        with self._lock:
            self._last_command = {
                "mode": "jog",
                "axis": axis + 1,
                "direction": direction,
                "speed_percent": speed,
                "duration_sec": HMI_JOG_DURATION_SEC,
                "updated_at": time.time(),
            }
        return {"status": "sent", "axis": axis + 1, "speed_percent": speed, "target": target}

    def tcp_jog(self, axis: str, direction: int, linear_speed_mm_s: float, angular_speed_deg_s: float) -> dict[str, Any]:
        if axis not in {"x", "y", "z", "rx", "ry", "rz"}:
            raise ValueError("axis must be one of x, y, z, rx, ry, rz")
        if direction not in {-1, 1}:
            raise ValueError("direction must be -1 or 1")

        linear_speed = self._clamp_tcp_linear_speed(linear_speed_mm_s)
        angular_speed = self._clamp_tcp_angular_speed(angular_speed_deg_s)
        values = {"x": 0.0, "y": 0.0, "z": 0.0, "rx": 0.0, "ry": 0.0, "rz": 0.0}
        if axis in {"x", "y", "z"}:
            values[axis] = direction * linear_speed
        else:
            values[axis] = direction * angular_speed
        self._publish_tcp_twist(values["x"], values["y"], values["z"], values["rx"], values["ry"], values["rz"])
        with self._lock:
            self._last_command = {
                "mode": "tcp_jog",
                "axis": axis,
                "direction": direction,
                "linear_speed_mm_s": round(linear_speed * 1000.0, 1),
                "angular_speed_deg_s": round(math.degrees(angular_speed), 1),
                "twist_topic": self._tcp_twist_topic,
                "updated_at": time.time(),
            }
        return {
            "status": "sent",
            "axis": axis,
            "direction": direction,
            "linear_speed_mm_s": round(linear_speed * 1000.0, 1),
            "angular_speed_deg_s": round(math.degrees(angular_speed), 1),
            "twist_topic": self._tcp_twist_topic,
        }

    def home(self, speed_percent: float) -> dict[str, Any]:
        current = self._require_current_positions()
        speed = self._clamp_speed(speed_percent)
        slowest_axis_time = 0.0
        for index, (actual, target) in enumerate(zip(current, HMI_HOME_POSITIONS_RAD)):
            velocity = max(0.02, HMI_JOINT_MAX_VELOCITY_RAD_S[index] * (speed / 100.0))
            slowest_axis_time = max(slowest_axis_time, abs(target - actual) / velocity)
        duration = max(4.0, slowest_axis_time)
        self._send_goal(HMI_HOME_POSITIONS_RAD, duration)
        with self._lock:
            self._last_command = {
                "mode": "home",
                "speed_percent": speed,
                "duration_sec": duration,
                "updated_at": time.time(),
            }
        return {"status": "sent", "speed_percent": speed, "duration_sec": duration}

    def _clamp_speed(self, value: float) -> float:
        try:
            speed = float(value)
        except (TypeError, ValueError):
            speed = 5.0
        return max(HMI_MIN_SPEED_PERCENT, min(HMI_MAX_SPEED_PERCENT, speed))

    def _clamp_tcp_linear_speed(self, value: float) -> float:
        try:
            speed = float(value) / 1000.0
        except (TypeError, ValueError):
            speed = 0.05
        return max(0.005, min(HMI_TCP_MAX_LINEAR_M_S, speed))

    def _clamp_tcp_angular_speed(self, value: float) -> float:
        try:
            speed = math.radians(float(value))
        except (TypeError, ValueError):
            speed = math.radians(10.0)
        return max(math.radians(1.0), min(HMI_TCP_MAX_ANGULAR_RAD_S, speed))

    def _publish_tcp_twist(self, x: float, y: float, z: float, rx: float, ry: float, rz: float) -> None:
        stamped = TwistStamped()
        stamped.header.stamp = self._node.get_clock().now().to_msg()
        stamped.header.frame_id = self._tcp_twist_frame
        stamped.twist.linear.x = float(x)
        stamped.twist.linear.y = float(y)
        stamped.twist.linear.z = float(z)
        stamped.twist.angular.x = float(rx)
        stamped.twist.angular.y = float(ry)
        stamped.twist.angular.z = float(rz)
        self._tcp_twist_publisher.publish(stamped)

    def _require_current_positions(self) -> list[float]:
        positions = self._store.latest_joint_positions()
        if positions is None:
            raise RuntimeError("No current /joint_states positions available")
        return positions

    def _send_goal(self, target_positions: list[float], duration_sec: float) -> None:
        if not self._client.wait_for_server(timeout_sec=0.15):
            raise RuntimeError("FollowJointTrajectory action server is not available")

        goal = FollowJointTrajectory.Goal()
        goal.trajectory.joint_names = list(HMI_JOINT_NAMES)
        point = JointTrajectoryPoint()
        point.positions = [float(value) for value in target_positions[:6]]
        point.time_from_start = Duration(
            sec=int(duration_sec),
            nanosec=int((duration_sec % 1.0) * 1_000_000_000),
        )
        goal.trajectory.points = [point]

        future = self._client.send_goal_async(goal)

        def remember_goal(done_future: Any) -> None:
            try:
                goal_handle = done_future.result()
            except Exception as exc:
                self._node.get_logger().warn(f"HMI goal send failed: {exc}")
                return
            if not goal_handle.accepted:
                self._node.get_logger().warn("HMI trajectory goal was rejected")
                return
            with self._lock:
                self._active_goal_handle = goal_handle

        future.add_done_callback(remember_goal)


class RosTopicBridge(Node):
    def __init__(
        self,
        topics: list[TopicConfig],
        queue: asyncio.Queue,
        loop: asyncio.AbstractEventLoop,
        store: PayloadStore,
    ):
        super().__init__("sman_gofa_web_bridge")
        self._queue = queue
        self._loop = loop
        self._store = store
        self._forwarding_subscriptions: list[Any] = []
        self._subscribed_topics: set[str] = set()
        self._discover_topics = env_flag("ROS_DISCOVER_TOPICS", "0")
        self._denylist = set(csv_env("ROS_DISCOVER_DENYLIST", "/parameter_events,/rosout"))
        self.hmi_motion = HmiMotionController(self, store)

        for topic in topics:
            self._subscribe_topic(topic)

        if self._discover_topics:
            self.create_timer(float(os.getenv("ROS_DISCOVER_INTERVAL", "2.0")), self._discover_and_subscribe)
            self.get_logger().info("ROS topic discovery enabled")

    def _subscribe_topic(self, topic: TopicConfig) -> None:
        if topic.name in self._subscribed_topics or not rclpy.ok():
            return
        try:
            msg_class = resolve_message_class(topic.type)
        except (AttributeError, ModuleNotFoundError, TypeError, ValueError) as exc:
            self.get_logger().warn(f"Skipping {topic.name}: cannot import {topic.type}: {exc}")
            return
        try:
            subscription = self.create_subscription(
                msg_class,
                topic.name,
                self._callback_for(topic),
                qos_profile_sensor_data,
            )
        except Exception as exc:
            if rclpy.ok():
                self.get_logger().warn(f"Skipping {topic.name}: cannot subscribe to {topic.type}: {exc}")
            return
        self._forwarding_subscriptions.append(subscription)
        self._subscribed_topics.add(topic.name)
        self.get_logger().info(f"Subscribed to {topic.name} ({topic.type})")

    def _discover_and_subscribe(self) -> None:
        if not rclpy.ok():
            return
        for name, types in self.get_topic_names_and_types():
            if name in self._denylist or name in self._subscribed_topics or not types:
                continue
            self._subscribe_topic(TopicConfig(name=name, type=types[0], label=name))

    def _callback_for(self, topic: TopicConfig):
        def callback(message: Any) -> None:
            now = time.time()
            payload = {
                "kind": "topic",
                "topic": topic.name,
                "type": topic.type,
                "label": topic.label,
                "received_at": now,
                "data": serialize_message(message, topic.type),
            }
            safe_payload = json_safe(payload)
            self._store.record(safe_payload)
            self._loop.call_soon_threadsafe(enqueue_payload, self._queue, safe_payload)

        return callback

    def status_payload(self) -> dict[str, Any]:
        return self._store.status_payload()

    def snapshot_payload(self) -> dict[str, Any]:
        return self._store.snapshot_payload()


class ConnectionManager:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._clients.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        async with self._lock:
            clients = list(self._clients)
        for client in clients:
            try:
                await client.send_json(payload)
            except (RuntimeError, WebSocketDisconnect):
                await self.disconnect(client)


def egm_udp_listener(
    host: str,
    port: int,
    queue: asyncio.Queue,
    loop: asyncio.AbstractEventLoop,
    store: PayloadStore,
) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, port))
    sock.settimeout(1.0)
    print(f"Listening for ABB EGM UDP on {host}:{port}", flush=True)

    while True:
        try:
            packet, address = sock.recvfrom(8192)
        except socket.timeout:
            continue
        except OSError:
            return

        try:
            robot = parse_egm_robot(packet)
        except (ValueError, struct.error):
            continue
        if robot is None:
            continue

        positions = robot.get("feedback", {}).get("joints_rad")
        if positions is None:
            continue

        now = time.time()
        payload = {
            "kind": "topic",
            "topic": "/joint_states",
            "type": "sensor_msgs/msg/JointState",
            "label": "EGM Joint States",
            "received_at": now,
            "source": f"egm:{address[0]}:{address[1]}",
            "data": {
                "header_stamp": now,
                "names": ["joint_1", "joint_2", "joint_3", "joint_4", "joint_5", "joint_6"],
                "positions": positions,
                "velocities": [],
                "efforts": [],
            },
        }
        safe_payload = json_safe(payload)
        store.record(safe_payload)
        loop.call_soon_threadsafe(enqueue_payload, queue, safe_payload)

        egm_payload = {
            "kind": "topic",
            "topic": "/egm/state",
            "type": "abb/egm/RobotState",
            "label": "EGM State",
            "received_at": now,
            "source": f"egm:{address[0]}:{address[1]}",
            "data": {
                "header": robot.get("header", {}),
                "planned": robot.get("planned", {}),
                "feedback": {
                    key: value
                    for key, value in robot.get("feedback", {}).items()
                    if key != "joints_rad"
                },
                "motor_state": robot.get("motor_state"),
                "motor_state_label": label_state(robot.get("motor_state"), {0: "undefined", 1: "on", 2: "off"}),
                "mci_state": robot.get("mci_state"),
                "mci_state_label": label_state(robot.get("mci_state"), {0: "undefined", 1: "error", 2: "stopped", 3: "running"}),
                "mci_convergence_met": robot.get("mci_convergence_met"),
                "rapid_exec_state": robot.get("rapid_exec_state"),
                "rapid_exec_state_label": label_state(robot.get("rapid_exec_state"), {0: "undefined", 1: "stopped", 2: "running"}),
                "measured_force": robot.get("measured_force", []),
                "test_signals": robot.get("test_signals", []),
                "utilization_rate": robot.get("utilization_rate"),
            },
        }
        safe_egm_payload = json_safe(egm_payload)
        store.record(safe_egm_payload)
        loop.call_soon_threadsafe(enqueue_payload, queue, safe_egm_payload)


app = FastAPI(title="SMAN ABB GoFa ROS2 Dashboard")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def hmi_no_cache(request: Request, call_next: Any) -> Response:
    response = await call_next(request)
    if request.url.path == "/hmi" or request.url.path.startswith("/assets/hmi."):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

TOPICS = read_topics()
EGM_ENABLE = os.getenv("EGM_ENABLE", "1").lower() not in {"0", "false", "no"}
EGM_HOST = os.getenv("EGM_HOST", "0.0.0.0")
EGM_PORT = int(os.getenv("EGM_PORT", "6511"))
SMAN_DATA_DIR = os.getenv("SMAN_DATA_DIR", "/tmp/sman-dashboard")
EVENT_QUEUE: asyncio.Queue = asyncio.Queue(maxsize=1000)
CONNECTIONS = ConnectionManager()
PERSISTENCE = DashboardPersistence(SMAN_DATA_DIR)
STORE = PayloadStore(PERSISTENCE)
ROS_NODE: RosTopicBridge | None = None
ROS_THREAD: threading.Thread | None = None
EGM_THREAD: threading.Thread | None = None


def spin_ros(loop: asyncio.AbstractEventLoop) -> None:
    global ROS_NODE
    rclpy.init()
    ROS_NODE = RosTopicBridge(TOPICS, EVENT_QUEUE, loop, STORE)
    try:
        rclpy.spin(ROS_NODE)
    except ExternalShutdownException:
        pass


async def broadcaster() -> None:
    while True:
        payload = await EVENT_QUEUE.get()
        await CONNECTIONS.broadcast(payload)


async def status_loop() -> None:
    while True:
        await CONNECTIONS.broadcast(STORE.status_payload())
        await asyncio.sleep(1)


async def notification_loop() -> None:
    while True:
        await asyncio.to_thread(PERSISTENCE.send_pending_mail)
        await asyncio.sleep(30)


@app.on_event("startup")
async def startup() -> None:
    global ROS_THREAD, EGM_THREAD
    loop = asyncio.get_running_loop()
    ROS_THREAD = threading.Thread(target=spin_ros, args=(loop,), daemon=True)
    ROS_THREAD.start()
    if EGM_ENABLE:
        EGM_THREAD = threading.Thread(
            target=egm_udp_listener,
            args=(EGM_HOST, EGM_PORT, EVENT_QUEUE, loop, STORE),
            daemon=True,
        )
        EGM_THREAD.start()
    asyncio.create_task(broadcaster())
    asyncio.create_task(status_loop())
    asyncio.create_task(notification_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    if ROS_NODE is not None:
        try:
            ROS_NODE.destroy_node()
        except ValueError:
            pass
    if rclpy.ok():
        rclpy.shutdown()


@app.get("/api/topics")
async def topics() -> list[dict[str, str]]:
    return [topic.__dict__ for topic in TOPICS]


@app.post("/api/ingest")
async def ingest(payload: dict[str, Any]) -> dict[str, str]:
    payload.setdefault("kind", "topic")
    payload.setdefault("received_at", time.time())
    payload.setdefault("source", "host-bridge")
    safe_payload = json_safe(payload)
    STORE.record(safe_payload)
    enqueue_payload(EVENT_QUEUE, safe_payload)
    return {"status": "ok"}


@app.get("/api/ingest")
async def ingest_status() -> dict[str, str]:
    return {"status": "ready", "method": "POST"}


@app.get("/api/snapshot")
async def snapshot() -> dict[str, Any]:
    return STORE.snapshot_payload()


def hmi_motion_controller() -> HmiMotionController:
    if ROS_NODE is None:
        raise HTTPException(status_code=503, detail="ROS bridge is not ready")
    return ROS_NODE.hmi_motion


def hmi_auth_signature(payload: str) -> str:
    digest = hmac.new(HMI_AUTH_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def create_hmi_session(username: str) -> str:
    issued_at = str(int(time.time()))
    nonce = secrets.token_urlsafe(18)
    payload = base64.urlsafe_b64encode(f"{username}:{issued_at}:{nonce}".encode("utf-8")).decode("ascii").rstrip("=")
    return f"{payload}.{hmi_auth_signature(payload)}"


def valid_hmi_session(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    payload, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, hmi_auth_signature(payload)):
        return False
    try:
        padded = payload + "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return False
    username, _, _ = decoded.partition(":")
    return hmac.compare_digest(username, HMI_AUTH_USERNAME)


def require_hmi_auth(request: Request) -> None:
    if not valid_hmi_session(request.cookies.get(HMI_AUTH_COOKIE)):
        raise HTTPException(status_code=401, detail="HMI login required")


def set_hmi_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        HMI_AUTH_COOKIE,
        token,
        httponly=True,
        secure=HMI_AUTH_COOKIE_SECURE,
        samesite="strict",
        path="/",
    )


@app.get("/api/hmi/auth/status")
async def hmi_auth_status(request: Request) -> dict[str, Any]:
    authenticated = valid_hmi_session(request.cookies.get(HMI_AUTH_COOKIE))
    return {"authenticated": authenticated, "username": HMI_AUTH_USERNAME if authenticated else None}


@app.post("/api/hmi/auth/login")
async def hmi_auth_login(payload: dict[str, Any], response: Response) -> dict[str, Any]:
    username = str(payload.get("username", ""))
    password = str(payload.get("password", ""))
    if not hmac.compare_digest(username, HMI_AUTH_USERNAME) or not hmac.compare_digest(password, HMI_AUTH_PASSWORD):
        raise HTTPException(status_code=401, detail="Username oder Passwort ist falsch")
    set_hmi_auth_cookie(response, create_hmi_session(username))
    return {"authenticated": True, "username": username}


@app.post("/api/hmi/auth/logout")
async def hmi_auth_logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(HMI_AUTH_COOKIE, path="/", samesite="strict", secure=HMI_AUTH_COOKIE_SECURE)
    return {"authenticated": False}


@app.get("/api/hmi/state", dependencies=[Depends(require_hmi_auth)])
async def hmi_state() -> dict[str, Any]:
    return await asyncio.to_thread(hmi_motion_controller().state)


@app.post("/api/hmi/jog/start", dependencies=[Depends(require_hmi_auth)])
async def hmi_jog_start(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            hmi_motion_controller().jog,
            int(payload.get("axis", -1)),
            int(payload.get("direction", 0)),
            float(payload.get("speed_percent", 5)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/hmi/jog/heartbeat", dependencies=[Depends(require_hmi_auth)])
async def hmi_jog_heartbeat(payload: dict[str, Any]) -> dict[str, Any]:
    return await hmi_jog_start(payload)


@app.post("/api/hmi/tcp/start", dependencies=[Depends(require_hmi_auth)])
async def hmi_tcp_start(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            hmi_motion_controller().tcp_jog,
            str(payload.get("axis", "")),
            int(payload.get("direction", 0)),
            float(payload.get("linear_speed_mm_s", 50)),
            float(payload.get("angular_speed_deg_s", 10)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/hmi/tcp/heartbeat", dependencies=[Depends(require_hmi_auth)])
async def hmi_tcp_heartbeat(payload: dict[str, Any]) -> dict[str, Any]:
    return await hmi_tcp_start(payload)


@app.post("/api/hmi/jog/stop", dependencies=[Depends(require_hmi_auth)])
async def hmi_jog_stop(payload: dict[str, Any] | None = None) -> dict[str, str]:
    reason = str((payload or {}).get("reason", "operator"))
    return await asyncio.to_thread(hmi_motion_controller().stop, reason)


@app.post("/api/hmi/home", dependencies=[Depends(require_hmi_auth)])
async def hmi_home(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            hmi_motion_controller().home,
            float(payload.get("speed_percent", 5)),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/history/summary")
async def history_summary(window: str = "24h") -> dict[str, Any]:
    return await asyncio.to_thread(PERSISTENCE.summary, window)


@app.get("/api/history/series")
async def history_series(window: str = "1h") -> dict[str, Any]:
    return await asyncio.to_thread(PERSISTENCE.series, window)


@app.get("/api/settings/notifications")
async def notification_settings() -> dict[str, Any]:
    return await asyncio.to_thread(PERSISTENCE.notification_settings)


@app.post("/api/settings/notifications")
async def update_notification_settings(settings: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(PERSISTENCE.update_notification_settings, settings)


@app.post("/api/mail/recipients")
async def update_mail_recipient(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(PERSISTENCE.update_mail_recipient, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/mail/test")
async def send_test_mail(payload: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(PERSISTENCE.queue_test_mail, str(payload.get("recipients", "")))


@app.post("/api/events/{event_id}/ack")
async def acknowledge_event(event_id: int, payload: dict[str, Any]) -> dict[str, str]:
    return await asyncio.to_thread(
        PERSISTENCE.acknowledge_event,
        event_id,
        str(payload.get("acknowledged_by", "dashboard")),
        str(payload.get("comment", "")),
    )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await CONNECTIONS.connect(websocket)
    try:
        await websocket.send_json(
            {
                "kind": "hello",
                "topics": [topic.__dict__ for topic in TOPICS],
                "supported_types": sorted(MESSAGE_TYPES),
            }
        )
        await websocket.send_json(STORE.snapshot_payload())
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await CONNECTIONS.disconnect(websocket)


app.mount("/assets", StaticFiles(directory="/app/frontend"), name="assets")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse("/app/frontend/index.html")


@app.get("/hmi")
async def hmi() -> FileResponse:
    return FileResponse("/app/frontend/hmi.html")
