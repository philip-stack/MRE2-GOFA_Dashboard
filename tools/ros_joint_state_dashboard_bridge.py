#!/usr/bin/env python3
import json
import math
import os
import time
import urllib.error
import urllib.request

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState


def stamp_to_float(stamp):
    return float(stamp.sec) + float(stamp.nanosec) / 1_000_000_000.0


def finite_values(values):
    return [float(value) if math.isfinite(float(value)) else None for value in values]


class DashboardJointStateBridge(Node):
    def __init__(self):
        super().__init__("sman_dashboard_joint_state_bridge")
        self.dashboard_url = os.getenv("SMAN_DASHBOARD_INGEST", "http://127.0.0.1:8080/api/ingest")
        self.min_interval = float(os.getenv("SMAN_DASHBOARD_MIN_INTERVAL", "0.04"))
        self.last_sent = 0.0
        self.sent_count = 0
        self.create_subscription(JointState, "/joint_states", self.on_joint_state, 10)
        self.get_logger().info(f"Forwarding /joint_states to {self.dashboard_url}")

    def on_joint_state(self, message):
        now = time.time()
        if now - self.last_sent < self.min_interval:
            return
        self.last_sent = now

        payload = {
            "kind": "topic",
            "topic": "/joint_states",
            "type": "sensor_msgs/msg/JointState",
            "label": "Joint States",
            "received_at": now,
            "source": "host-ros2:/joint_states",
            "data": {
                "header_stamp": stamp_to_float(message.header.stamp),
                "names": list(message.name),
                "positions": finite_values(message.position),
                "velocities": finite_values(message.velocity),
                "efforts": finite_values(message.effort),
            },
        }
        data = json.dumps(payload, allow_nan=False).encode("utf-8")
        request = urllib.request.Request(
            self.dashboard_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=0.2) as response:
                response.read()
            self.sent_count += 1
            if self.sent_count == 1 or self.sent_count % 100 == 0:
                self.get_logger().info(f"Forwarded {self.sent_count} /joint_states samples")
        except (urllib.error.URLError, TimeoutError) as exc:
            self.get_logger().warn(f"Dashboard ingest failed: {exc}", throttle_duration_sec=2.0)


def main():
    rclpy.init()
    node = DashboardJointStateBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
