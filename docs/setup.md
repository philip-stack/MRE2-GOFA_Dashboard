# Setup und Betrieb der App

Installation, Start und Konfiguration von Dashboard, HMI, Datenbank und Mail. [Zurück zur README](../README.md)

## Start mit Docker

```bash
cd ~/SMAN
docker compose up -d --build --force-recreate
```

Dann im Browser öffnen:

```text
http://localhost:8080
```

GoFa HMI öffnen:

```text
http://localhost:8080/hmi
```

Optional verschlüsselt über den Nginx-Reverse-Proxy:

```text
https://localhost:8443/hmi
```

Der Container enthält Backend, Frontend, ROS2-Workspace und Dashboard-Assets im Image. Der Dockerfile ist in Build-Stages aufgeteilt:

- `ros-runtime-base`: ROS2- und Systempakete
- `python-deps`: Python/FastAPI-Abhängigkeiten
- `ros-workspace`: teurer `colcon build` für `ABB/` und `ros2_ws/src/`
- `dashboard`: schlanke Runtime-Schicht mit `backend/`, `frontend/`, `tools/` und EntryPoint

Dadurch bleibt der ROS-/colcon-Layer bei reinen Dashboard-, HMI- oder Graph-Änderungen gecacht. Änderungen an `backend/`, `frontend/` oder `tools/` bauen nur die finale App-Schicht neu:

```bash
docker compose build sman-gofa-dashboard
docker compose up -d --force-recreate sman-gofa-dashboard
```

Der teure ROS-Workspace wird nur neu gebaut, wenn sich `ABB/`, `ros2_ws/src/`, `backend/requirements.txt` oder die ROS/Systempakete im `Dockerfile` ändern.

Laufende Logs:

```bash
docker compose logs -f sman-gofa-dashboard
```

Persistente Dashboard-Daten liegen jetzt im Docker-Service `sman-dashboard-db` (PostgreSQL) im Volume `sman-dashboard-db`.
Der Dashboard-Container verbindet sich standardmäßig über:

```text
postgresql://sman:sman@127.0.0.1:55433/sman
```

Falls `SMAN_DATABASE_URL` nicht gesetzt ist, nutzt das Backend als Fallback weiterhin SQLite unter `data/sman_dashboard.sqlite3`.

Die Datei `.env` wird von Docker Compose für lokale Zugangsdaten gelesen, aber nicht ins Image kopiert.

### Windows Docker Desktop

Unter Docker Desktop für Windows funktioniert `network_mode: host` nicht wie unter Linux. Für den Windows-Start ist deshalb die zusätzliche Compose-Datei `docker-compose.windows.yml` vorbereitet. Sie veröffentlicht das Dashboard auf `127.0.0.1:8080`, verbindet den Dashboard-Container über `host.docker.internal` mit PostgreSQL und routet den HTTPS-Proxy ebenfalls über den Windows-Host.

Start ohne HTTPS:

```powershell
docker compose -f docker-compose.yml -f docker-compose.windows.yml up -d --build --force-recreate
```

Danach im Browser öffnen:

```text
http://127.0.0.1:8080
```

Für das HMI über HTTPS zuerst ein lokales Zertifikat erzeugen. Wenn `openssl` unter Windows nicht installiert ist, kann das direkt über Docker passieren:

```powershell
New-Item -ItemType Directory -Force -Path certs
docker run --rm -v "${PWD}/certs:/certs" alpine:3.20 sh -lc "apk add --no-cache openssl && openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes -keyout /certs/sman-local.key -out /certs/sman-local.crt -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'"
```

Dann den HTTPS-Proxy starten:

```powershell
docker compose -f docker-compose.yml -f docker-compose.windows.yml --profile https up -d --build --force-recreate
```

Das HMI liegt dann unter:

```text
https://127.0.0.1:8443/hmi
```

Bei einem Self-Signed-Zertifikat zeigt der Browser eine Warnung. Für lokale Tests kann die Ausnahme bestätigt werden.

## HTTPS für das HMI

Für HTTPS ist ein optionaler Nginx-Reverse-Proxy vorbereitet. Das kostet lokal nichts:

- Self-Signed-Zertifikat: kostenlos, Browser zeigt aber eine Warnung, bis das Zertifikat vertraut wird.
- Let's Encrypt: kostenlos, braucht aber normalerweise einen erreichbaren DNS-Namen beziehungsweise eine passende DNS-Challenge.
- Gekauftes Zertifikat: nur nötig, wenn eure Infrastruktur das verlangt.

Lokales Testzertifikat erzeugen:

```bash
cd ~/SMAN
./docker/create-local-cert.sh certs localhost
```

HTTPS-Proxy starten:

```bash
docker compose --profile https up -d --build --force-recreate
```

Danach das HMI verschlüsselt öffnen:

```text
https://localhost:8443/hmi
```

Im Compose-Setup bindet FastAPI standardmäßig nur an `127.0.0.1:8080`; von außen soll dann der HTTPS-Port genutzt werden. Falls du das alte Verhalten für reine Labortests brauchst:

```text
SMAN_HTTP_HOST=0.0.0.0
```

Das HMI selbst ist im Compose-Setup zusätzlich auf HTTPS festgelegt. Ein direkter Aufruf von `http://localhost:8080/hmi` wird auf `https://localhost:8443/hmi` umgeleitet; direkte HMI-API-Aufrufe über HTTP werden blockiert. Falls ein anderer öffentlicher HTTPS-Name verwendet wird:

```text
SMAN_PUBLIC_HTTPS_URL=https://sman.local:8443
```

Für Zugriff von einem Tablet oder aus dem Roboternetz in `.env` den Hostnamen oder die IP setzen und ein passendes Zertifikat verwenden:

```text
SMAN_SERVER_NAME=sman.local
SMAN_HTTPS_PORT=8443
SMAN_TLS_CERT_FILE=sman-local.crt
SMAN_TLS_KEY_FILE=sman-local.key
```

Die Zertifikate liegen lokal im ignorierten Ordner `certs/` und werden nur in den Nginx-Container gemountet. Der Nginx-Proxy setzt `X-Forwarded-Proto: https`; dadurch markiert das Backend das HMI-Session-Cookie bei HTTPS automatisch als `Secure`.

## Datenbank und History

Der Compose-Stack startet standardmäßig:

- `sman-dashboard-db`: PostgreSQL auf `127.0.0.1:55433`
- `sman-gofa-dashboard`: FastAPI, Frontend und ROS2-Workspace

Wichtige API-Endpunkte:

```text
GET  /api/snapshot
GET  /api/history/summary?window=1h|24h|7d|30d|90d
GET  /api/history/series?window=1h|24h|7d|30d|90d
POST /api/ingest
```

Die Graphen im Dashboard können zwischen `Live`, `Letzte Stunde`, `24h`, `7 Tage` und `30 Tage` umgeschaltet werden. Im Live-Modus werden WebSocket-Daten direkt angezeigt; in den historischen Fenstern werden aggregierte Daten aus PostgreSQL geladen.

Hinweis: Achsmomente/Effort werden nur angezeigt, wenn der Roboter oder ein ROS2-Topic echte numerische Effort-Werte publiziert. Wenn die ABB-Schnittstelle leere Arrays oder `NaN` liefert, blendet das Dashboard Momentwerte aus.

## Mail-Benachrichtigungen

Das Dashboard kann kritische Alarme sofort als Mail senden und im Maintenance-Tab eine Testmail auslösen.
Die Empfänger werden im Dashboard gespeichert; SMTP-Zugangsdaten bleiben in `.env`/Docker-Umgebung. Im Maintenance-Tab lassen sich Empfänger hinzufügen und über das Zahnrad-Popup einzeln abonnieren oder deaktivieren. Kritische Alarmmails verwenden den Betreff `ABB GoFa Alarm: ...`.

### Option A: Gmail SMTP

Geeignet für schnelle Tests mit einem eigenen Gmail-Konto. In Google muss die 2-Schritt-Bestätigung aktiv sein, danach ein App-Passwort erstellen.

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
SMAN_MAIL_RECIPIENTS=deine.adresse@example.com
```

### Option B: Brevo SMTP

Geeignet für kostenlose Transactional-Mails mit eigenem/verifiziertem Absender.

```text
SMAN_SMTP_HOST=smtp-relay.brevo.com
SMAN_SMTP_PORT=587
SMAN_SMTP_SECURITY=starttls
SMAN_SMTP_USER=dein-brevo-smtp-login
SMAN_SMTP_PASSWORD=dein-brevo-smtp-key
SMAN_MAIL_FROM=verifizierter-absender@example.com
SMAN_MAIL_RECIPIENTS=deine.adresse@example.com
```

Danach Dashboard neu erstellen/starten:

```bash
docker compose up -d --build --force-recreate
```

Im Dashboard:

```text
Maintenance -> Benachrichtigungen -> Empfänger setzen -> Speichern -> Testmail
```

Empfänger aus `SMAN_MAIL_RECIPIENTS` werden beim Start in die Datenbank übernommen. Danach ist die PostgreSQL-Tabelle `mail_recipients` maßgeblich; aktive Empfänger werden nur berücksichtigt, wenn `Mails abonnieren` eingeschaltet ist und der jeweilige Empfänger im Popup abonniert bleibt.
