#!/usr/bin/env bash
set -e

source /opt/ros/jazzy/setup.bash

if [ -f /app/ros2_ws/install/setup.bash ]; then
  source /app/ros2_ws/install/setup.bash
fi

exec "$@"
