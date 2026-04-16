FROM ros:humble-ros-core

SHELL ["/bin/bash", "-c"]

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-pip \
  ros-humble-sensor-msgs \
  ros-humble-geometry-msgs \
  ros-humble-diagnostic-msgs \
  ros-humble-tf2-msgs \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip3 install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY frontend /app/frontend

ENV PYTHONUNBUFFERED=1
ENV ROS_DOMAIN_ID=0
ENV RMW_IMPLEMENTATION=rmw_fastrtps_cpp

EXPOSE 8080

CMD source /opt/ros/humble/setup.bash \
  && uvicorn backend.app:app --host 0.0.0.0 --port 8080
