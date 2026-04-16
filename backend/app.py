import asyncio
import json
import os
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


class RosTopicBridge(Node):
    def __init__(self, topics: list[TopicConfig], queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
        super().__init__("sman_gofa_web_bridge")
        self._queue = queue
        self._loop = loop
        self._last_seen: dict[str, float] = {}
        self._latest_payloads: dict[str, dict[str, Any]] = {}
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
            self._last_seen[topic.name] = now
            payload = {
                "kind": "topic",
                "topic": topic.name,
                "type": topic.type,
                "label": topic.label,
                "received_at": now,
                "data": serialize_message(message, topic.type),
            }
            self._latest_payloads[topic.name] = payload
            self._loop.call_soon_threadsafe(self._queue.put_nowait, payload)

        return callback

    def status_payload(self) -> dict[str, Any]:
        now = time.time()
        return {
            "kind": "status",
            "ros_ok": rclpy.ok(),
            "topics": [
                {
                    "name": topic,
                    "last_seen": last_seen,
                    "age_sec": round(now - last_seen, 3),
                }
                for topic, last_seen in self._last_seen.items()
            ],
            "time": now,
        }

    def snapshot_payload(self) -> dict[str, Any]:
        return {
            "kind": "snapshot",
            "topics": list(self._latest_payloads.values()),
            "status": self.status_payload(),
        }


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
            except RuntimeError:
                await self.disconnect(client)


app = FastAPI(title="SMAN ABB GoFa ROS2 Dashboard")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TOPICS = read_topics()
EVENT_QUEUE: asyncio.Queue = asyncio.Queue(maxsize=1000)
CONNECTIONS = ConnectionManager()
ROS_NODE: RosTopicBridge | None = None
ROS_THREAD: threading.Thread | None = None


def spin_ros(loop: asyncio.AbstractEventLoop) -> None:
    global ROS_NODE
    rclpy.init()
    ROS_NODE = RosTopicBridge(TOPICS, EVENT_QUEUE, loop)
    rclpy.spin(ROS_NODE)


async def broadcaster() -> None:
    while True:
        payload = await EVENT_QUEUE.get()
        await CONNECTIONS.broadcast(payload)


async def status_loop() -> None:
    while True:
        if ROS_NODE is not None:
            await CONNECTIONS.broadcast(ROS_NODE.status_payload())
        await asyncio.sleep(1)


@app.on_event("startup")
async def startup() -> None:
    global ROS_THREAD
    loop = asyncio.get_running_loop()
    ROS_THREAD = threading.Thread(target=spin_ros, args=(loop,), daemon=True)
    ROS_THREAD.start()
    asyncio.create_task(broadcaster())
    asyncio.create_task(status_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    if ROS_NODE is not None:
        ROS_NODE.destroy_node()
    if rclpy.ok():
        rclpy.shutdown()


@app.get("/api/topics")
async def topics() -> list[dict[str, str]]:
    return [topic.__dict__ for topic in TOPICS]


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
        if ROS_NODE is not None:
            await websocket.send_json(ROS_NODE.snapshot_payload())
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await CONNECTIONS.disconnect(websocket)


app.mount("/assets", StaticFiles(directory="/app/frontend"), name="assets")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse("/app/frontend/index.html")
