import math
import socket
import struct
import threading
import time
from dataclasses import dataclass
from typing import Any

import rclpy
from control_msgs.action import FollowJointTrajectory
from rclpy.action.server import ActionServer, CancelResponse, GoalResponse, ServerGoalHandle
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from rclpy.node import Node
from sensor_msgs.msg import JointState


JOINT_NAMES = ["joint_1", "joint_2", "joint_3", "joint_4", "joint_5", "joint_6"]


def read_varint(buffer: bytes, index: int) -> tuple[int, int]:
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


def protobuf_fields(buffer: bytes) -> list[tuple[int, int, Any]]:
    fields: list[tuple[int, int, Any]] = []
    index = 0
    while index < len(buffer):
        key, index = read_varint(buffer, index)
        field_number = key >> 3
        wire_type = key & 0x07
        if wire_type == 0:
            value, index = read_varint(buffer, index)
        elif wire_type == 1:
            value = buffer[index : index + 8]
            index += 8
        elif wire_type == 2:
            length, index = read_varint(buffer, index)
            value = buffer[index : index + length]
            index += length
        elif wire_type == 5:
            value = buffer[index : index + 4]
            index += 4
        else:
            raise ValueError(f"Unsupported protobuf wire type: {wire_type}")
        fields.append((field_number, wire_type, value))
    return fields


def decode_packed_doubles(value: bytes) -> list[float]:
    if len(value) % 8 != 0:
        return []
    return list(struct.unpack(f"<{len(value) // 8}d", value))


def parse_egm_feedback_degrees(packet: bytes) -> list[float] | None:
    for field_number, wire_type, value in protobuf_fields(packet):
        if field_number != 2 or wire_type != 2:
            continue
        for feedback_field, feedback_wire_type, feedback_value in protobuf_fields(value):
            if feedback_field != 1 or feedback_wire_type != 2:
                continue
            joints: list[float] = []
            for joint_field, joint_wire_type, joint_value in protobuf_fields(feedback_value):
                if joint_field != 1:
                    continue
                if joint_wire_type == 1:
                    joints.append(struct.unpack("<d", joint_value)[0])
                elif joint_wire_type == 2:
                    joints.extend(decode_packed_doubles(joint_value))
            if len(joints) >= 6:
                return joints[:6]
    return None


def encode_varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def field_varint(field_number: int, value: int) -> bytes:
    return encode_varint((field_number << 3) | 0) + encode_varint(value)


def field_fixed64(field_number: int, value: float) -> bytes:
    return encode_varint((field_number << 3) | 1) + struct.pack("<d", float(value))


def field_message(field_number: int, payload: bytes) -> bytes:
    return encode_varint((field_number << 3) | 2) + encode_varint(len(payload)) + payload


def build_egm_sensor_command(seqno: int, joint_degrees: list[float]) -> bytes:
    # EGMHeader.MessageType.MSGTYPE_CORRECTION == 3 for position guidance.
    header = (
        field_varint(1, seqno & 0xFFFFFFFF)
        + field_varint(2, int(time.monotonic() * 1000) & 0xFFFFFFFF)
        + field_varint(3, 3)
    )
    joints = b"".join(field_fixed64(1, value) for value in joint_degrees[:6])
    planned = field_message(1, joints)
    return field_message(1, header) + field_message(2, planned)


def interpolate(points, start_time: float, now: float, fallback: list[float]) -> list[float]:
    if not points:
        return fallback

    elapsed = now - start_time
    first_time = points[0].time_from_start.sec + points[0].time_from_start.nanosec * 1e-9
    if elapsed <= first_time:
        return list(points[0].positions[:6])

    for previous, current in zip(points, points[1:]):
        t0 = previous.time_from_start.sec + previous.time_from_start.nanosec * 1e-9
        t1 = current.time_from_start.sec + current.time_from_start.nanosec * 1e-9
        if elapsed <= t1:
            if t1 <= t0:
                return list(current.positions[:6])
            alpha = max(0.0, min(1.0, (elapsed - t0) / (t1 - t0)))
            return [
                float(a) + (float(b) - float(a)) * alpha
                for a, b in zip(previous.positions[:6], current.positions[:6])
            ]

    return list(points[-1].positions[:6])


@dataclass
class ActiveTrajectory:
    goal_handle: ServerGoalHandle
    points: Any
    start_time: float


class GoFaEgmTrajectoryServer(Node):
    def __init__(self) -> None:
        super().__init__("gofa_egm_trajectory_server")
        self.declare_parameter("host", "0.0.0.0")
        self.declare_parameter("port", 6511)
        self.declare_parameter("armed", False)
        self.declare_parameter("max_step_deg", 0.35)
        self.declare_parameter("goal_tolerance_rad", 0.02)

        self.host = self.get_parameter("host").value
        self.port = int(self.get_parameter("port").value)
        self.armed = bool(self.get_parameter("armed").value)
        self.max_step_deg = float(self.get_parameter("max_step_deg").value)
        self.goal_tolerance_rad = float(self.get_parameter("goal_tolerance_rad").value)

        self._lock = threading.Lock()
        self._seqno = 0
        self._robot_addr = None
        self._current_rad = [0.0] * 6
        self._target_rad = [0.0] * 6
        self._active: ActiveTrajectory | None = None
        self._stop = False
        self._last_packet_log = 0.0

        self._joint_pub = self.create_publisher(JointState, "joint_states", 20)
        self._action_server = ActionServer(
            self,
            FollowJointTrajectory,
            "/gofa_arm_controller/follow_joint_trajectory",
            execute_callback=self.execute_callback,
            goal_callback=self.goal_callback,
            cancel_callback=self.cancel_callback,
            callback_group=ReentrantCallbackGroup(),
        )

        self._thread = threading.Thread(target=self.egm_loop, daemon=True)
        self._thread.start()

        mode = "ARMED" if self.armed else "DISARMED"
        self.get_logger().warn(
            f"GoFa EGM server listening on {self.host}:{self.port} ({mode}). "
            "Use armed:=true only with the robot supervised and speed override low."
        )

    def destroy_node(self):
        self._stop = True
        super().destroy_node()

    def goal_callback(self, goal_request):
        if list(goal_request.trajectory.joint_names) != JOINT_NAMES:
            self.get_logger().error(
                f"Rejected trajectory joints {goal_request.trajectory.joint_names}; expected {JOINT_NAMES}"
            )
            return GoalResponse.REJECT
        if not goal_request.trajectory.points:
            self.get_logger().error("Rejected empty trajectory")
            return GoalResponse.REJECT
        self.get_logger().warn(
            f"Accepted trajectory goal with {len(goal_request.trajectory.points)} points; armed={self.armed}"
        )
        return GoalResponse.ACCEPT

    def cancel_callback(self, goal_handle):
        with self._lock:
            if self._active and self._active.goal_handle == goal_handle:
                self._active = None
                self._target_rad = list(self._current_rad)
        return CancelResponse.ACCEPT

    def execute_callback(self, goal_handle):
        result = FollowJointTrajectory.Result()
        if not self.armed:
            self.get_logger().error("Execution rejected because EGM server is disarmed")
            result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
            result.error_string = "EGM server is disarmed. Relaunch with armed:=true for real motion."
            goal_handle.abort()
            return result

        with self._lock:
            has_egm = self._robot_addr is not None
        if not has_egm:
            self.get_logger().error("Execution rejected because no EGM packets have been received yet")
            result.error_code = FollowJointTrajectory.Result.INVALID_GOAL
            result.error_string = "No EGM feedback packets received. Start RAPID EGMRunJoint first."
            goal_handle.abort()
            return result

        last_point = goal_handle.request.trajectory.points[-1]
        expected_duration = last_point.time_from_start.sec + last_point.time_from_start.nanosec * 1e-9
        with self._lock:
            self._active = ActiveTrajectory(
                goal_handle=goal_handle,
                points=goal_handle.request.trajectory.points,
                start_time=time.monotonic(),
            )
            self._target_rad = list(self._current_rad)

        self.get_logger().warn(
            f"Executing trajectory for {expected_duration:.2f}s from current EGM feedback"
        )

        deadline = time.monotonic() + expected_duration + 3.0
        feedback = FollowJointTrajectory.Feedback()
        feedback.joint_names = JOINT_NAMES

        while rclpy.ok() and time.monotonic() < deadline:
            if goal_handle.is_cancel_requested:
                goal_handle.canceled()
                result.error_code = FollowJointTrajectory.Result.SUCCESSFUL
                return result

            with self._lock:
                current = list(self._current_rad)
                target = list(self._target_rad)
                active = self._active

            feedback.actual.positions = current
            feedback.desired.positions = target
            feedback.error.positions = [target_value - current_value for target_value, current_value in zip(target, current)]
            goal_handle.publish_feedback(feedback)

            if active is None or active.goal_handle != goal_handle:
                goal_handle.canceled()
                result.error_code = FollowJointTrajectory.Result.SUCCESSFUL
                return result

            if time.monotonic() >= active.start_time + expected_duration:
                error = max(abs(a - b) for a, b in zip(current, last_point.positions[:6]))
                if error <= self.goal_tolerance_rad:
                    with self._lock:
                        self._active = None
                    self.get_logger().warn("Trajectory execution succeeded")
                    goal_handle.succeed()
                    result.error_code = FollowJointTrajectory.Result.SUCCESSFUL
                    return result

            time.sleep(0.05)

        with self._lock:
            self._active = None
        result.error_code = FollowJointTrajectory.Result.GOAL_TOLERANCE_VIOLATED
        result.error_string = "Timed out waiting for EGM feedback to reach the final target."
        self.get_logger().error(result.error_string)
        goal_handle.abort()
        return result

    def publish_joint_state(self) -> None:
        msg = JointState()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.name = JOINT_NAMES
        msg.position = list(self._current_rad)
        self._joint_pub.publish(msg)

    def limited_target(self, desired_rad: list[float]) -> list[float]:
        max_step_rad = math.radians(self.max_step_deg)
        next_target = []
        for current, desired in zip(self._target_rad, desired_rad):
            delta = max(-max_step_rad, min(max_step_rad, desired - current))
            next_target.append(current + delta)
        return next_target

    def egm_loop(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.host, self.port))
        sock.settimeout(0.2)

        while not self._stop and rclpy.ok():
            try:
                packet, address = sock.recvfrom(8192)
            except socket.timeout:
                continue
            except OSError as exc:
                self.get_logger().error(f"EGM socket error: {exc}")
                return

            feedback_degrees = parse_egm_feedback_degrees(packet)
            if feedback_degrees is None:
                continue

            feedback_rad = [math.radians(value) for value in feedback_degrees[:6]]
            now = time.monotonic()

            with self._lock:
                self._robot_addr = address
                self._current_rad = feedback_rad
                if self._target_rad == [0.0] * 6:
                    self._target_rad = list(feedback_rad)

                if self.armed and self._active is not None:
                    desired = interpolate(
                        self._active.points,
                        self._active.start_time,
                        now,
                        self._target_rad,
                    )
                    self._target_rad = self.limited_target(desired)
                else:
                    self._target_rad = list(feedback_rad)

                command_degrees = [math.degrees(value) for value in self._target_rad]
                self._seqno += 1
                should_log_packet = now - self._last_packet_log > 2.0
                if should_log_packet:
                    self._last_packet_log = now

            self.publish_joint_state()
            if should_log_packet:
                mode = "tracking trajectory" if self.armed and self._active is not None else "holding current"
                self.get_logger().info(
                    f"EGM feedback from {address[0]}:{address[1]} q0={feedback_degrees[0]:.3f} deg; {mode}"
                )
            command = build_egm_sensor_command(self._seqno, command_degrees)
            try:
                sock.sendto(command, address)
            except OSError as exc:
                self.get_logger().error(f"Failed to send EGM command: {exc}")


def main(args=None):
    rclpy.init(args=args)
    node = GoFaEgmTrajectoryServer()
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    try:
        executor.spin()
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
