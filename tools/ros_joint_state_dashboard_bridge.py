#!/usr/bin/env python3
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import JointState
from rosidl_runtime_py.convert import message_to_ordereddict
from rosidl_runtime_py.utilities import get_message


@dataclass(frozen=True)
class TopicConfig:
    name: str
    type: str
    label: str


def stamp_to_float(stamp):
    return float(stamp.sec) + float(stamp.nanosec) / 1_000_000_000.0


def finite_values(values):
    return [float(value) if math.isfinite(float(value)) else None for value in values]


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


def csv_env(name, default=""):
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def env_flag(name, default="0"):
    return os.getenv(name, default).lower() not in {"0", "false", "no", "off"}


def read_seed_topics():
    raw = os.getenv("SMAN_BRIDGE_TOPICS") or os.getenv("ROS_TOPICS")
    if not raw:
        return [
            TopicConfig("/joint_states", "sensor_msgs/msg/JointState", "Joint States"),
        ]
    parsed = json.loads(raw)
    return [
        TopicConfig(
            name=item["name"],
            type=item["type"],
            label=item.get("label", item["name"]),
        )
        for item in parsed
    ]


def display_joint_names(names):
    result = []
    for index, name in enumerate(names):
        match = re.search(r"(?:joint[_\s-]*)(\d+)$", str(name), re.IGNORECASE)
        number = int(match.group(1)) if match else index + 1
        result.append(f"Joint {number}")
    return result


def serialize_message(message, msg_type):
    if msg_type == "sensor_msgs/msg/JointState":
        raw_names = list(message.name)
        return {
            "header_stamp": stamp_to_float(message.header.stamp),
            "names": display_joint_names(raw_names),
            "raw_names": raw_names,
            "positions": finite_values(message.position),
            "velocities": finite_values(message.velocity),
            "efforts": finite_values(message.effort),
        }
    return dict(message_to_ordereddict(message))


class DashboardRosTopicBridge(Node):
    def __init__(self):
        super().__init__("sman_dashboard_ros_topic_bridge")
        self.dashboard_url = os.getenv("SMAN_DASHBOARD_INGEST", "http://127.0.0.1:8080/api/ingest")
        self.min_interval = float(os.getenv("SMAN_DASHBOARD_MIN_INTERVAL", "0.04"))
        self.discover_topics = env_flag("SMAN_BRIDGE_DISCOVER_TOPICS", "1")
        self.discovery_interval = float(os.getenv("SMAN_BRIDGE_DISCOVER_INTERVAL", "2.0"))
        self.denylist = set(csv_env("SMAN_BRIDGE_DENYLIST", "/parameter_events,/rosout"))
        self.last_sent = {}
        self.sent_count = {}
        self._forwarding_subscriptions = []
        self.subscribed_topics = set()

        for topic in read_seed_topics():
            self.subscribe_topic(topic)
        if self.discover_topics:
            self.create_timer(self.discovery_interval, self.discover_and_subscribe)
        self.get_logger().info(f"Forwarding ROS topics to {self.dashboard_url}")

    def subscribe_topic(self, topic):
        if topic.name in self.denylist or topic.name in self.subscribed_topics or not rclpy.ok():
            return
        try:
            msg_class = JointState if topic.type == "sensor_msgs/msg/JointState" else get_message(topic.type)
        except (AttributeError, ModuleNotFoundError, TypeError, ValueError) as exc:
            self.get_logger().warn(f"Skipping {topic.name}: cannot import {topic.type}: {exc}")
            return

        try:
            subscription = self.create_subscription(
                msg_class,
                topic.name,
                self.callback_for(topic),
                qos_profile_sensor_data,
            )
        except Exception as exc:
            if rclpy.ok():
                self.get_logger().warn(f"Skipping {topic.name}: cannot subscribe to {topic.type}: {exc}")
            return

        self._forwarding_subscriptions.append(subscription)
        self.subscribed_topics.add(topic.name)
        self.get_logger().info(f"Forwarding {topic.name} ({topic.type})")

    def discover_and_subscribe(self):
        if not rclpy.ok():
            return
        for name, types in self.get_topic_names_and_types():
            if name in self.denylist or name in self.subscribed_topics or not types:
                continue
            self.subscribe_topic(TopicConfig(name=name, type=types[0], label=name))

    def callback_for(self, topic):
        def callback(message):
            self.forward_message(topic, message)

        return callback

    def forward_message(self, topic, message):
        now = time.time()
        if now - self.last_sent.get(topic.name, 0.0) < self.min_interval:
            return
        self.last_sent[topic.name] = now

        payload = {
            "kind": "topic",
            "topic": topic.name,
            "type": topic.type,
            "label": topic.label,
            "received_at": now,
            "source": f"host-ros2:{topic.name}",
            "data": serialize_message(message, topic.type),
        }
        data = json.dumps(json_safe(payload), allow_nan=False).encode("utf-8")
        request = urllib.request.Request(
            self.dashboard_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=0.2) as response:
                response.read()
            self.sent_count[topic.name] = self.sent_count.get(topic.name, 0) + 1
            count = self.sent_count[topic.name]
            if count == 1 or count % 100 == 0:
                self.get_logger().info(f"Forwarded {count} {topic.name} samples")
        except (urllib.error.URLError, TimeoutError) as exc:
            self.get_logger().warn(f"Dashboard ingest failed: {exc}", throttle_duration_sec=2.0)


def main():
    rclpy.init()
    node = DashboardRosTopicBridge()
    try:
        rclpy.spin(node)
    except (ExternalShutdownException, KeyboardInterrupt):
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
