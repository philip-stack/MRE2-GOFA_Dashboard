FROM ros:jazzy-ros-base

SHELL ["/bin/bash", "-c"]

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  build-essential \
  cmake \
  git \
  libboost-all-dev \
  libpoco-dev \
  libprotobuf-dev \
  protobuf-compiler \
  python3-colcon-common-extensions \
  python3-pip \
  python3-rosdep \
  python3-vcstool \
  ros-jazzy-ament-cmake \
  ros-jazzy-control-msgs \
  ros-jazzy-controller-manager \
  ros-jazzy-diagnostic-msgs \
  ros-jazzy-geometry-msgs \
  ros-jazzy-hardware-interface \
  ros-jazzy-joint-state-broadcaster \
  ros-jazzy-joint-state-publisher \
  ros-jazzy-joint-state-publisher-gui \
  ros-jazzy-joint-trajectory-controller \
  ros-jazzy-moveit \
  ros-jazzy-moveit-configs-utils \
  ros-jazzy-pluginlib \
  ros-jazzy-rclcpp \
  ros-jazzy-rclcpp-lifecycle \
  ros-jazzy-rclpy \
  ros-jazzy-rmw-fastrtps-cpp \
  ros-jazzy-robot-state-publisher \
  ros-jazzy-ros2-control \
  ros-jazzy-ros2-controllers \
  ros-jazzy-ros-testing \
  ros-jazzy-rosidl-default-generators \
  ros-jazzy-rosidl-default-runtime \
  ros-jazzy-rviz2 \
  ros-jazzy-sensor-msgs \
  ros-jazzy-std-msgs \
  ros-jazzy-tf2-msgs \
  ros-jazzy-tf2-ros \
  ros-jazzy-trajectory-msgs \
  ros-jazzy-urdf \
  ros-jazzy-xacro \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /app/backend/requirements.txt

COPY backend /app/backend
COPY frontend /app/frontend
COPY tools /app/tools
COPY ros2_ws/src /app/ros2_ws/src
COPY ABB /app/ros2_ws/src/ABB
COPY docker/entrypoint.sh /entrypoint.sh

RUN source /opt/ros/jazzy/setup.bash \
  && cd /app/ros2_ws \
  && colcon build --symlink-install \
  && chmod +x /entrypoint.sh /app/tools/ros_joint_state_dashboard_bridge.py

ENV PYTHONUNBUFFERED=1
ENV ROS_DOMAIN_ID=0
ENV RMW_IMPLEMENTATION=rmw_fastrtps_cpp

EXPOSE 8080
EXPOSE 6511/udp

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080"]
