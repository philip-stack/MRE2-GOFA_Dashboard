# SMAN ABB GoFa ROS2 Dashboard

Web-Dashboard fuer ROS2-Daten eines ABB GoFa Roboters. Die App laeuft in Docker, liest ROS2-Topics im Container und streamt die Daten per WebSocket in den Browser.

## Start mit Docker

```bash
cd ~/SMAN
docker compose up -d --build --force-recreate
```

Dann im Browser oeffnen:

```text
http://localhost:8080
```

Der Container enthaelt Backend, Frontend, ROS2-Workspace und Dashboard-Assets im Image. Nach Codeaenderungen an `backend/`, `frontend/`, `tools/`, `ABB/` oder `ros2_ws/src/` immer neu bauen:

```bash
docker compose build sman-gofa-dashboard
docker compose up -d --force-recreate sman-gofa-dashboard
```

Laufende Logs:

```bash
docker compose logs -f sman-gofa-dashboard
```

Persistente Dashboard-Daten liegen auf dem Host unter:

```text
data/sman_dashboard.sqlite3
```

Die Datei `.env` wird von Docker Compose fuer lokale Zugangsdaten gelesen, aber nicht ins Image kopiert.

## Demo-Modus ohne Roboter

Wenn der Roboter nicht erreichbar ist, kann das Dashboard mit Demo-Daten getestet werden:

```text
http://localhost:8080/?demo=1
```

Alternativ im Dashboard oben rechts den Button `Demo` verwenden.

## ROS2-Kommunikation

Der Container nutzt `network_mode: host`, damit DDS/ROS2 die Topics vom Host oder Roboter-Netz sehen kann. Wichtig ist, dass `ROS_DOMAIN_ID` zum restlichen ROS2-System passt:

```bash
ROS_DOMAIN_ID=0 docker compose up -d --build --force-recreate
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

Dann pruefen:

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

Damit MoveIt den echten Roboter ueber EGM steuern kann, darf das Dashboard den UDP-Port `6511` nicht selbst belegen:

```bash
cd ~/SMAN
EGM_ENABLE=0 docker compose up -d --build --force-recreate
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

Danach pruefen:

```bash
ros2 control list_controllers
```

Erwartet:

```text
joint_trajectory_controller active
joint_state_broadcaster active
```

### 4. Dashboard live mit ROS `/joint_states` versorgen

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
Forwarding /joint_states to http://127.0.0.1:8080/api/ingest
Forwarded 1 /joint_states samples
Forwarded 100 /joint_states samples
```

Diese Bridge muss waehrend des Betriebs offen bleiben. Wenn sie mit `Ctrl+C` beendet wird, hat das Dashboard keine Live-Daten mehr.

### 5. Was gleichzeitig geht

Diese Kombination funktioniert gleichzeitig:

- MoveIt / ABB-Treiber steuert den echten Roboter ueber EGM
- Dashboard zeigt live ueber ROS `/joint_states`

Nicht gleichzeitig auf demselben Port gedacht ist:

- Dashboard mit `EGM_ENABLE=1`
- MoveIt / ABB-Treiber mit echtem EGM

Darum fuer den echten Roboterbetrieb immer:

```text
EGM_ENABLE=0
```

### 6. Wenn `Not connected to robot...` erscheint

Dann bekommt `ros2_control_node` keine EGM-Pakete vom Roboter. Pruefen:

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

Dann zuerst pruefen, ob die Bridge laeuft und wirklich Samples schickt.

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

Die Terminals 2 und 3 bleiben normalerweise waehrend des Betriebs offen.

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

## Mail-Benachrichtigungen

Das Dashboard kann kritische Alarme sofort als Mail senden und im Maintenance-Tab eine Testmail ausloesen.
Die Empfaenger werden im Dashboard gespeichert; SMTP-Zugangsdaten bleiben in `.env`/Docker-Umgebung.

### Option A: Gmail SMTP

Geeignet fuer schnelle Tests mit einem eigenen Gmail-Konto. In Google muss die 2-Schritt-Bestaetigung aktiv sein, danach ein App-Passwort erstellen.

```bash
cp .env.example .env
```

In `.env` setzen:

```text
SMAN_SMTP_HOST=smtp.gmail.com
SMAN_SMTP_PORT=587
SMAN_SMTP_SECURITY=starttls
SMAN_SMTP_USER=dein.name@gmail.com
SMAN_SMTP_PASSWORD=dein-app-passwort
SMAN_MAIL_FROM=dein.name@gmail.com
SMAN_MAIL_RECIPIENTS=deine.empfaengeradresse@example.com
```

### Option B: Brevo SMTP

Geeignet fuer kostenlose Transactional-Mails mit eigenem/verifiziertem Absender.

```text
SMAN_SMTP_HOST=smtp-relay.brevo.com
SMAN_SMTP_PORT=587
SMAN_SMTP_SECURITY=starttls
SMAN_SMTP_USER=dein-brevo-smtp-login
SMAN_SMTP_PASSWORD=dein-brevo-smtp-key
SMAN_MAIL_FROM=verifizierter-absender@example.com
SMAN_MAIL_RECIPIENTS=deine.empfaengeradresse@example.com
```

Danach Dashboard neu erstellen/starten:

```bash
docker compose up -d --build --force-recreate
```

Im Dashboard:

```text
Maintenance -> Benachrichtigungen -> Empfaenger setzen -> Speichern -> Testmail
```
