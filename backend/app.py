import asyncio
import json
import math
import os
import socket
import struct
import threading
import time
from dataclasses import dataclass
from typing import Any

import rclpy
from diagnostic_msgs.msg import DiagnosticArray
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from rclpy.executors import ExternalShutdownException
from geometry_msgs.msg import PoseStamped, Twist
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import Bool, Float32, Float64, Int32, String
from tf2_msgs.msg import TFMessage


DEFAULT_TOPICS = [
    {"name": "/joint_states", "type": "sensor_msgs/msg/JointState", "label": "Joint States"},
    {"name": "/tf", "type": "tf2_msgs/msg/TFMessage", "label": "TF"},
    {"name": "/diagnostics", "type": "diagnostic_msgs/msg/DiagnosticArray", "label": "Diagnostics"},
]

MESSAGE_TYPES = {
    "sensor_msgs/msg/JointState": JointState,
    "tf2_msgs/msg/TFMessage": TFMessage,
    "diagnostic_msgs/msg/DiagnosticArray": DiagnosticArray,
    "geometry_msgs/msg/PoseStamped": PoseStamped,
    "geometry_msgs/msg/Twist": Twist,
    "std_msgs/msg/String": String,
    "std_msgs/msg/Bool": Bool,
    "std_msgs/msg/Float32": Float32,
    "std_msgs/msg/Float64": Float64,
    "std_msgs/msg/Int32": Int32,
}


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
        if item.get("type") not in MESSAGE_TYPES:
            supported = ", ".join(sorted(MESSAGE_TYPES))
            raise RuntimeError(f"Nicht unterstuetzter ROS2 Message-Type: {item.get('type')}. Unterstuetzt: {supported}")
        topics.append(
            TopicConfig(
                name=item["name"],
                type=item["type"],
                label=item.get("label", item["name"]),
            )
        )
    return topics


def serialize_message(message: Any, msg_type: str) -> dict[str, Any]:
    if msg_type == "sensor_msgs/msg/JointState":
        return {
            "header_stamp": ros_time_to_float(message.header.stamp),
            "names": list(message.name),
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

    return {"repr": repr(message)}


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


def parse_egm_joints(packet: bytes) -> list[float] | None:
    """Extract feedback joint values from an ABB EGMRobot protobuf packet.

    ABB EGM uses protobuf on UDP. The first feedback joint block sits at:
    EGMRobot.feedBack(2).joints(1).joints(1), packed as float64 degrees.
    """
    for field_number, wire_type, value in _protobuf_fields(packet):
        if field_number != 2 or wire_type != 2:
            continue
        for feedback_field, feedback_wire_type, feedback_value in _protobuf_fields(value):
            if feedback_field != 1 or feedback_wire_type != 2:
                continue
            joint_values: list[float] = []
            for joint_field, joint_wire_type, joint_value in _protobuf_fields(feedback_value):
                if joint_field != 1:
                    continue
                if joint_wire_type == 1:
                    joint_values.append(struct.unpack("<d", joint_value)[0])
                elif joint_wire_type == 2:
                    joint_values.extend(_decode_packed_doubles(joint_value))
            if len(joint_values) >= 6:
                return [math.radians(value) for value in joint_values[:6]]
    return None


class PayloadStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last_seen: dict[str, float] = {}
        self._latest_payloads: dict[str, dict[str, Any]] = {}

    def record(self, payload: dict[str, Any]) -> None:
        topic = payload.get("topic")
        received_at = payload.get("received_at")
        if not isinstance(topic, str) or not isinstance(received_at, (int, float)):
            return
        with self._lock:
            self._last_seen[topic] = float(received_at)
            self._latest_payloads[topic] = payload

    def status_payload(self) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            items = list(self._last_seen.items())
        return {
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

    def snapshot_payload(self) -> dict[str, Any]:
        with self._lock:
            topics = list(self._latest_payloads.values())
        return {
            "kind": "snapshot",
            "topics": topics,
            "status": self.status_payload(),
        }


def enqueue_payload(queue: asyncio.Queue, payload: dict[str, Any]) -> None:
    try:
        queue.put_nowait(payload)
    except asyncio.QueueFull:
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            pass
        queue.put_nowait(payload)


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
        self._subscriptions = []

        for topic in topics:
            msg_class = MESSAGE_TYPES[topic.type]
            self._subscriptions.append(
                self.create_subscription(
                    msg_class,
                    topic.name,
                    self._callback_for(topic),
                    10,
                )
            )
            self.get_logger().info(f"Subscribed to {topic.name} ({topic.type})")

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
            positions = parse_egm_joints(packet)
        except (ValueError, struct.error):
            continue
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


app = FastAPI(title="SMAN ABB GoFa ROS2 Dashboard")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TOPICS = read_topics()
EGM_ENABLE = os.getenv("EGM_ENABLE", "1").lower() not in {"0", "false", "no"}
EGM_HOST = os.getenv("EGM_HOST", "0.0.0.0")
EGM_PORT = int(os.getenv("EGM_PORT", "6511"))
EVENT_QUEUE: asyncio.Queue = asyncio.Queue(maxsize=1000)
CONNECTIONS = ConnectionManager()
STORE = PayloadStore()
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
