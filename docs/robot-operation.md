# Betrieb mit dem echten Roboter

ROS2, EGM, Bridge, MoveIt/RViz und Fehlersuche für den Betrieb am ABB GoFa. [Zurück zur README](../README.md)

## Gleichzeitiger Betrieb mit EGM und ABB-Steuerung

Für den echten Roboterbetrieb ist das Standard-Setup so ausgelegt, dass alles gleichzeitig laufen kann:

```text
GoFa HMI / Dashboard
  -> FastAPI / ROS2 Action Client
  -> /gofa_arm_controller/follow_joint_trajectory
  -> ros2_control / ABB-Treiber
  -> EGM
  -> ABB-Steuerung
  -> Roboter
```

Wichtig: Das Dashboard belegt den EGM-UDP-Port `6511` standardmäßig nicht selbst. Dadurch kann der ABB-Treiber beziehungsweise `ros2_control` den EGM-Port verwenden, während Dashboard und HMI parallel über ROS2-Daten und ROS2-Actions arbeiten.

Der Compose-Default ist deshalb:

```text
EGM_ENABLE=0
```

Damit laufen parallel:

- `/` als normales Dashboard
- `/hmi` als GoFa HMI
- MoveIt / `ros2_control`
- ABB-Steuerung über EGM
- Live-Anzeige über `/joint_states` und automatisch entdeckte ROS2-Topics

Nur für reine Dashboard-Tests ohne MoveIt/ABB-Treiber kann der direkte EGM-UDP-Listener wieder aktiviert werden:

```bash
EGM_ENABLE=1 docker compose up -d --build --force-recreate
```

## ROS2-Kommunikation

Der Container nutzt `network_mode: host`, damit DDS/ROS2 die Topics vom Host oder Roboter-Netz sehen kann. Wichtig ist, dass `ROS_DOMAIN_ID` zum restlichen ROS2-System passt:

```bash
ROS_DOMAIN_ID=0 docker compose up -d --build --force-recreate
```

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

## Dashboard-Bridge für ROS-Topics

Wenn das Dashboard unter `http://localhost:8080` läuft, kann ein lokales ROS2-Terminal die ROS-Topics an die Web-App weiterleiten:

```bash
cd ~/SMAN
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash
./tools/ros_joint_state_dashboard_bridge.py
```

Die Bridge entdeckt standardmäßig alle importierbaren ROS-Topics und sendet sie an:

```text
http://127.0.0.1:8080/api/ingest
```

Wenn die Bridge im Hintergrund laufen soll:

```bash
cd ~/SMAN
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash
export ROS_LOG_DIR=/tmp/ros-log
export SMAN_BRIDGE_DISCOVER_TOPICS=1
export SMAN_BRIDGE_DENYLIST=/parameter_events,/rosout
setsid ./tools/ros_joint_state_dashboard_bridge.py </dev/null >/tmp/sman-ros-topic-bridge.log 2>&1 &
```

Prüfen:

```bash
ps -ef | rg 'ros_joint_state_dashboard_bridge|sman_dashboard_ros_topic_bridge'
tail -f /tmp/sman-ros-topic-bridge.log
```

Nützliche Optionen:

```bash
# Nur vorkonfigurierte Topics weiterleiten, keine Auto-Discovery:
export SMAN_BRIDGE_DISCOVER_TOPICS=0

# Bestimmte Topics auslassen:
export SMAN_BRIDGE_DENYLIST=/parameter_events,/rosout,/tf

# Sendeintervall pro Topic begrenzen, z.B. 10 Hz:
export SMAN_DASHBOARD_MIN_INTERVAL=0.1
```

## Test mit lokalem ROS2-Publisher

In einem ROS2-Terminal kann man testweise Joint States senden:

```bash
ros2 topic pub /joint_states sensor_msgs/msg/JointState "{name: ['joint_1','joint_2','joint_3','joint_4','joint_5','joint_6'], position: [0.1, -0.2, 0.4, 1.0, -0.7, 0.2]}"
```

Wenn echte ABB-GoFa-Topics andere Namen oder Typen verwenden, die Einträge in `ROS_TOPICS` entsprechend anpassen.

## Morgen-Checkliste: Wieder mit dem Roboter verbinden

Wenn der Rechner neu gestartet wurde oder das Netzwerkkabel neu eingesteckt wurde, zuerst immer die GoFa-IP auf dem Kabelinterface sauber setzen. In den bisherigen Setups war das Roboternetz:

```text
Roboter / RWS / EGM: 192.168.125.1
PC auf Kabelinterface: 192.168.125.99/24
Interface: enx806d97057607
```

### 1. Netzwerk wiederherstellen

In einem Terminal:

```bash
cd ~/SMAN

sudo ip addr flush dev enx806d97057607
sudo ip link set enx806d97057607 up
sudo ip addr add 192.168.125.99/24 dev enx806d97057607
sudo ip route replace 192.168.125.0/24 dev enx806d97057607 src 192.168.125.99
```

Dann prüfen:

```bash
ip addr show enx806d97057607
ip route get 192.168.125.1
ping -c 3 192.168.125.1
```

Wichtig bei `ip route get`:

```text
192.168.125.1 dev enx806d97057607 src 192.168.125.99
```

### 2. Dashboard ohne direkten EGM-Zugriff starten

Damit MoveIt den echten Roboter über EGM steuern kann, darf das Dashboard den UDP-Port `6511` nicht selbst belegen. Das ist inzwischen der Compose-Default:

```bash
cd ~/SMAN
docker compose up -d --build --force-recreate
```

Dashboard im Browser:

```text
http://localhost:8080
```

Danach einmal hart neu laden:

```text
Ctrl + Shift + R
```

### 3. ABB / MoveIt / RViz mit echtem Roboter starten

In einem zweiten Terminal:

```bash
cd ~/SMAN
export ROS_LOG_DIR=/tmp
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash

ros2 launch abb_bringup crb15000_complete.launch.py
```

Im Log muss im Erfolgsfall erscheinen:

```text
[ABBSystemHardware]: Connected to robot
ros2_control hardware interface was successfully started!
```

Danach prüfen:

```bash
ros2 control list_controllers
```

Erwartet:

```text
joint_trajectory_controller active
joint_state_broadcaster active
```

### 4. Dashboard live mit ROS-Topics versorgen

In einem dritten Terminal:

```bash
cd ~/SMAN
export ROS_LOG_DIR=/tmp
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash

./tools/ros_joint_state_dashboard_bridge.py
```

Erwartet:

```text
Forwarding ROS topics to http://127.0.0.1:8080/api/ingest
Forwarding /joint_states (sensor_msgs/msg/JointState)
Forwarded 1 /joint_states samples
```

Diese Bridge muss während des Betriebs offen bleiben. Wenn sie mit `Ctrl+C` beendet wird, hat das Dashboard keine Live-Daten mehr.

### 5. Was gleichzeitig geht

Diese Kombination funktioniert gleichzeitig:

- MoveIt / ABB-Treiber steuert den echten Roboter über EGM
- Dashboard zeigt live über ROS `/joint_states`

Nicht gleichzeitig auf demselben Port gedacht ist:

- Dashboard mit `EGM_ENABLE=1`
- MoveIt / ABB-Treiber mit echtem EGM

Darum für den echten Roboterbetrieb immer:

```text
EGM_ENABLE=0
```

### 6. Wenn `Not connected to robot...` erscheint

Dann bekommt `ros2_control_node` keine EGM-Pakete vom Roboter. Prüfen:

```bash
sudo timeout 5 tcpdump -ni enx806d97057607 'host 192.168.125.1 and udp port 6511'
```

Gut ist:

```text
192.168.125.1.6511 > 192.168.125.99.6511
```

Wenn nichts kommt:

- EGM / RAPID auf der ABB-Seite nicht aktiv
- Roboter sendet an falsche IP
- Kabel / Port / Netzwerk nicht korrekt

### 7. Wenn Dashboard `Warte auf ROS2-Daten` zeigt

Dann zuerst prüfen, ob die Bridge läuft und wirklich Samples schickt.

Test des Dashboard-Ingests:

```bash
curl -X POST http://127.0.0.1:8080/api/ingest \
  -H 'Content-Type: application/json' \
  -d '{"kind":"topic","topic":"/joint_states","type":"sensor_msgs/msg/JointState","label":"Joint States","data":{"names":["joint_1"],"positions":[0.5],"velocities":[],"efforts":[]}}'
```

Antwort:

```json
{"status":"ok"}
```

Wenn das funktioniert, ist das Dashboard okay und das Problem liegt bei ROS / Bridge / Browser-Cache.

### 8. Empfohlene Terminal-Aufteilung

Am einfachsten immer mit drei Terminals arbeiten:

1. Netzwerk + Dashboard
2. ABB / MoveIt / RViz
3. Dashboard-Bridge

Die Terminals 2 und 3 bleiben normalerweise während des Betriebs offen.

## MoveIt und RViz

### Demo ohne Roboter

Der Demo-Launch startet eine vollständige MoveIt/RViz-Umgebung mit Fake-Hardware. Hier sollte der 6D-Gizmo am Endeffektor sichtbar sein:

```bash
cd ~/SMAN
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash
ros2 launch abb_crb15000_moveit demo.launch.py
```

In RViz oben das Tool `Interact` auswählen. Im MotionPlanning-Panel die Planning Group `manipulator` verwenden, dann den Gizmo am `tool0`/Endeffektor verschieben und `Plan` oder `Plan & Execute` nutzen.

### Complete-Launch ohne Roboter

Wenn der echte ABB-GoFa gerade nicht verbunden ist, den Complete-Launch mit Fake-Hardware starten:

```bash
cd ~/SMAN
source /opt/ros/jazzy/setup.bash
source ~/SMAN/ros2_ws/install/setup.bash
ros2 launch abb_bringup crb15000_complete.launch.py use_fake_hardware:=true
```

Das ist der richtige Modus für Offline-Tests mit MoveIt-Gizmo, RViz und Dashboard.

### Complete-Launch mit echtem Roboter

Mit Roboter/RWS-Verbindung läuft der Complete-Launch standardmäßig gegen die echte Hardware:

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

Laufende ROS2-Topics prüfen:

```bash
ros2 topic list --no-daemon
```

Wichtige Prozesse prüfen:

```bash
ps -ef | rg 'rviz2|move_group|ros2_control_node|robot_state_publisher'
```

Wenn der Gizmo im `demo.launch.py` sichtbar ist, aber im `crb15000_complete.launch.py` nicht, dann ist der Complete-Launch wahrscheinlich ohne erreichbaren Roboter in Real-Hardware-Modus gestartet. In diesem Fall `use_fake_hardware:=true` verwenden.
