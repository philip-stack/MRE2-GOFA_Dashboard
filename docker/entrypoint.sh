#!/usr/bin/env bash
set -e

# Source the base ROS environment first so rclpy, message packages, and CLI tools
# are available to the FastAPI process.
source /opt/ros/jazzy/setup.bash

if [ -f /app/ros2_ws/install/setup.bash ]; then
  # The built workspace contains project-specific ABB/GoFa messages discovered
  # dynamically by the dashboard.
  source /app/ros2_ws/install/setup.bash
fi

if [ -n "${SMAN_HOST_INTERFACE:-}" ] && [ -n "${SMAN_EXTRA_HOST_IP:-}" ] && command -v ip >/dev/null 2>&1; then
  # Some robot networks require an extra host address for DDS/EGM visibility;
  # tolerate failure so local dashboard startup is not blocked.
  if ! ip -4 addr show dev "${SMAN_HOST_INTERFACE}" | grep -q "${SMAN_EXTRA_HOST_IP%%/*}"; then
    ip addr add "${SMAN_EXTRA_HOST_IP}" dev "${SMAN_HOST_INTERFACE}" || true
  fi
fi

exec "$@"
