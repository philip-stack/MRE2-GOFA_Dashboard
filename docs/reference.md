# Technische Referenz

HMI-Befehle, Topics, Message-Typen, EGM-Telemetrie, API-Endpunkte und Assets. [Zurück zur README](../README.md)

## GoFa HMI

Die HMI-Oberfläche ist für Tablet-Bedienung ausgelegt und gleichzeitig als Basis für Unity/Meta Quest 3 vorbereitet:

- große Kacheln für Roboter, Speed Control, HRC Safety, User Dashboard, Maintenance und Status
- optionaler transparenter Modus für MR/WebView-Overlays
- achsweises Hold-to-jog für `J1` bis `J6`
- umschaltbarer Linear-Modus für TCP-Jog: Vor/Zurück, Links/Rechts, Z+/Z- sowie Roll/Pitch/Yaw
- mobile Handy-Ansicht mit Joystick-Steuerung und Zielauswahl für `J1` bis `J6`, `TCP XY`, `Z`, Roll, Pitch und Yaw
- Stop-Buttons in den Bedienpanels
- Home-Funktion über `Home anfahren`
- Live-Achspositionen und Speed-Gauges

Die echten Bewegungsbefehle laufen serverseitig über den ROS2 Action-Server:

```text
/gofa_arm_controller/follow_joint_trajectory
```

Der Linear-/TCP-Modus publiziert `geometry_msgs/msg/TwistStamped` für MoveIt Servo. Standardmäßig wird auf folgendes Topic gesendet:

```text
/servo_node/delta_twist_cmds
```

Das Topic und der Frame lassen sich über die Umgebung anpassen:

```text
SMAN_HMI_TCP_TWIST_TOPIC=/servo_node/delta_twist_cmds
SMAN_HMI_TCP_TWIST_FRAME=base_link
```

Wichtige HMI-Endpunkte:

```text
GET  /api/hmi/state
POST /api/hmi/jog/start
POST /api/hmi/jog/heartbeat
POST /api/hmi/tcp/start
POST /api/hmi/tcp/heartbeat
POST /api/hmi/jog/stop
POST /api/hmi/home
```

Die HMI begrenzt die Achs-Geschwindigkeitsauswahl standardmäßig auf `2%` bis `30%`. Die Weboberfläche sendet nur Bedienwünsche; die serverseitige HMI-Logik berechnet daraus kleine `FollowJointTrajectory`-Ziele oder publiziert im Linear-Modus kleine TCP-Twist-Kommandos.

## Topics konfigurieren

Die abonnierten Topics stehen in `docker-compose.yml` unter `ROS_TOPICS`. Standard:

```json
[
  {"name": "/joint_states", "type": "sensor_msgs/msg/JointState", "label": "Joint States"},
  {"name": "/tf", "type": "tf2_msgs/msg/TFMessage", "label": "TF"},
  {"name": "/diagnostics", "type": "diagnostic_msgs/msg/DiagnosticArray", "label": "Diagnostics"}
]
```

Unterstützte Message-Typen:

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

## EGM-Telemetrie

Die angepasste ABB-Hardware-Interface-Konfiguration kann EGM-Daten als ROS2-Topics publizieren:

```text
/egm/state
/egm/feedback_joint_states
/egm/planned_joint_states
/egm/feedback_pose
/egm/planned_pose
/egm/raw_input
```

Das Dashboard bevorzugt echte Feedback-Daten:

- Joint-Anzeige und Digital Twin nutzen `/egm/feedback_joint_states`, wenn vorhanden, sonst `/joint_states`.
- TCP-Anzeige nutzt `/egm/feedback_pose`, wenn frisch, sonst eine einfache Joint-basierte Schätzung.
- Leere EGM-Rohpakete wie `channels: []` löschen die Controller-State-Anzeige nicht.
- Joint-Namen werden im UI als `Joint 1` bis `Joint 6` angezeigt; die originalen ROS-Namen bleiben im Payload als `raw_names` erhalten.

## History-API

Wichtige API-Endpunkte:

```text
GET  /api/snapshot
GET  /api/history/summary?window=1h|24h|7d|30d|90d
GET  /api/history/series?window=1h|24h|7d|30d|90d
POST /api/ingest
```

## Digital Twin

Der Digital Twin lädt lokal die Visual-Meshes des ROS-Industrial Pakets `abb_crb15000_support` für den ABB GoFa CRB 15000-5/0.95:

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

Die App verwendet die Joint-Kette aus `crb15000_5_95_macro.xacro` und koppelt sie an `/joint_states`. Wenn die Mesh-Dateien nicht geladen werden können, bleibt automatisch das vereinfachte prozedurale Modell aktiv.

## Sprache und Theme

Dashboard und HMI teilen sich zwei kleine Skripte:

- `frontend/i18n.js`: Wörterbuch Deutsch → Englisch. Deutsch ist die Quellsprache, die deutschen Texte sind die Schlüssel. Statische Texte und Attribute werden direkt übersetzt, dynamische Texte in `app.js` und `hmi.js` laufen über `t()`. Die Wahl wird im Browser gespeichert; `?lang=en` startet direkt auf Englisch. Texte aus dem Backend (Event-Titel, Mail-Betreffe) werden nicht übersetzt.
- `frontend/theme.js`: setzt `data-theme` auf `<html>` vor dem ersten Rendern und merkt sich Hell/Dunkel im Browser. Die Farben kommen aus CSS-Variablen in `styles.css` und `hmi.css`; Canvas-Diagramme, TCP-Karte und Digital Twin lesen ihre Farben beim Wechsel neu ein.
