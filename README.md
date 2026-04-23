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

## ROS2-Overlay vorbereiten

Vor jedem ROS2-Launch muss das ROS2-Jazzy-Setup und danach das lokale Workspace-Overlay geladen werden:

```bash
cd ~/SMAN
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash
```

Schneller Check, ob die ABB-Pakete gefunden werden:

```bash
ros2 pkg prefix abb_bringup
ros2 pkg prefix abb_crb15000_moveit
```

Falls RViz/MoveIt-Visualisierungstools fehlen, installieren:

```bash
sudo apt-get install -y ros-jazzy-rviz-visual-tools
```

## Dashboard-Bridge fuer Joint States

Wenn das Dashboard unter `http://localhost:8080` laeuft, kann ein lokales ROS2-Terminal `/joint_states` an die Web-App weiterleiten:

```bash
cd ~/SMAN
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash
./tools/ros_joint_state_dashboard_bridge.py
```

Die Bridge sendet standardmaessig an:

```text
http://127.0.0.1:8080/api/ingest
```

## MoveIt und RViz

### Demo ohne Roboter

Der Demo-Launch startet eine vollstaendige MoveIt/RViz-Umgebung mit Fake-Hardware. Hier sollte der 6D-Gizmo am Endeffektor sichtbar sein:

```bash
cd ~/SMAN
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash
ros2 launch abb_crb15000_moveit demo.launch.py
```

In RViz oben das Tool `Interact` auswaehlen. Im MotionPlanning-Panel die Planning Group `manipulator` verwenden, dann den Gizmo am `tool0`/Endeffektor verschieben und `Plan` oder `Plan & Execute` nutzen.

### Complete-Launch ohne Roboter

Wenn der echte ABB-GoFa gerade nicht verbunden ist, den Complete-Launch mit Fake-Hardware starten:

```bash
cd ~/SMAN
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash
ros2 launch abb_bringup crb15000_complete.launch.py use_fake_hardware:=true
```

Das ist der richtige Modus fuer Offline-Tests mit MoveIt-Gizmo, RViz und Dashboard.

### Complete-Launch mit echtem Roboter

Mit Roboter/RWS-Verbindung laeuft der Complete-Launch standardmaessig gegen die echte Hardware:

```bash
cd ~/SMAN
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash
ros2 launch abb_bringup crb15000_complete.launch.py
```

Explizit mit IP und Port:

```bash
ros2 launch abb_bringup crb15000_complete.launch.py use_fake_hardware:=false rws_ip:=192.168.125.1 rws_port:=443
```

### Wichtige Checks

Launch-Argumente anzeigen:

```bash
ros2 launch abb_bringup crb15000_complete.launch.py --show-args
```

Laufende ROS2-Topics pruefen:

```bash
ros2 topic list --no-daemon
```

Wichtige Prozesse pruefen:

```bash
ps -ef | rg 'rviz2|move_group|ros2_control_node|robot_state_publisher'
```

Wenn der Gizmo im `demo.launch.py` sichtbar ist, aber im `crb15000_complete.launch.py` nicht, dann ist der Complete-Launch wahrscheinlich ohne erreichbaren Roboter in Real-Hardware-Modus gestartet. In diesem Fall `use_fake_hardware:=true` verwenden.

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
