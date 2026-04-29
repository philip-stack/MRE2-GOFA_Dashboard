#!/usr/bin/env bash
set -e

source /opt/ros/jazzy/setup.bash

if [ -f /app/ros2_ws/install/setup.bash ]; then
  source /app/ros2_ws/install/setup.bash
fi

if [ -n "${SMAN_HOST_INTERFACE:-}" ] && [ -n "${SMAN_EXTRA_HOST_IP:-}" ] && command -v ip >/dev/null 2>&1; then
  if ! ip -4 addr show dev "${SMAN_HOST_INTERFACE}" | grep -q "${SMAN_EXTRA_HOST_IP%%/*}"; then
    ip addr add "${SMAN_EXTRA_HOST_IP}" dev "${SMAN_HOST_INTERFACE}" || true
  fi
fi

exec "$@"
