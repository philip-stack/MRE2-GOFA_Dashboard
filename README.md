# SMAN ABB GoFa ROS2 Dashboard

Web-Dashboard fuer ROS2-Daten eines ABB GoFa Roboters. Die App laeuft in Docker, liest ROS2-Topics im Container und streamt die Daten per WebSocket in den Browser.

## Start

```bash
docker compose up --build
```

Dann im Browser oeffnen:

```text
http://localhost:8080
```

## ROS2-Kommunikation

Der Container nutzt `network_mode: host`, damit DDS/ROS2 die Topics vom Host oder Roboter-Netz sehen kann. Wichtig ist, dass `ROS_DOMAIN_ID` zum restlichen ROS2-System passt:

```bash
ROS_DOMAIN_ID=0 docker compose up --build
```

## Topics konfigurieren

Die abonnierten Topics stehen in `docker-compose.yml` unter `ROS_TOPICS`. Standard:

```json
[
  {"name": "/joint_states", "type": "sensor_msgs/msg/JointState", "label": "Joint States"},
  {"name": "/tf", "type": "tf2_msgs/msg/TFMessage", "label": "TF"},
  {"name": "/diagnostics", "type": "diagnostic_msgs/msg/DiagnosticArray", "label": "Diagnostics"}
]
```

Unterstuetzte Message-Typen:

- `sensor_msgs/msg/JointState`
- `tf2_msgs/msg/TFMessage`
- `diagnostic_msgs/msg/DiagnosticArray`
- `geometry_msgs/msg/PoseStamped`
- `geometry_msgs/msg/Twist`
- `std_msgs/msg/String`
- `std_msgs/msg/Bool`
- `std_msgs/msg/Float32`
- `std_msgs/msg/Float64`
- `std_msgs/msg/Int32`

## Test mit lokalem ROS2-Publisher

In einem ROS2-Terminal kann man testweise Joint States senden:

```bash
ros2 topic pub /joint_states sensor_msgs/msg/JointState "{name: ['joint_1','joint_2','joint_3','joint_4','joint_5','joint_6'], position: [0.1, -0.2, 0.4, 1.0, -0.7, 0.2]}"
```

Wenn echte ABB-GoFa-Topics andere Namen oder Typen verwenden, die Eintraege in `ROS_TOPICS` entsprechend anpassen.

## Digital Twin

Der Digital Twin laedt lokal die Visual-Meshes des ROS-Industrial Pakets `abb_crb15000_support` fuer den ABB GoFa CRB 15000-5/0.95:

```text
frontend/robot/abb_crb15000_support/
```

Quelle der Assets: `ros-industrial/abb`, Branch `noetic-devel`, Paket `abb_crb15000_support`:

```text
https://github.com/ros-industrial/abb/tree/noetic-devel/abb_crb15000_support
```

Die Asset-Lizenz liegt lokal unter:

```text
frontend/robot/abb_crb15000_support/LICENSE
```

Die App verwendet die Joint-Kette aus `crb15000_5_95_macro.xacro` und koppelt sie an `/joint_states`. Wenn die Mesh-Dateien nicht geladen werden koennen, bleibt automatisch das vereinfachte prozedurale Modell aktiv.
