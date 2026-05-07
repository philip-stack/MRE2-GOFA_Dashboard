const connectionPill = document.getElementById("connectionPill");
const readyValue = document.getElementById("readyValue");
const motionValue = document.getElementById("motionValue");
const rateValue = document.getElementById("rateValue");
const egmValue = document.getElementById("egmValue");
const axisBank = document.getElementById("axisBank");
const speedRange = document.getElementById("speedRange");
const speedValue = document.getElementById("speedValue");
const speedPresets = document.getElementById("speedPresets");
const stopButton = document.getElementById("stopButton");
const homeButton = document.getElementById("homeButton");
const jointReadout = document.getElementById("jointReadout");
const commandState = document.getElementById("commandState");
const lastUpdateValue = document.getElementById("lastUpdateValue");
const themeButton = document.getElementById("themeButton");
const healthValue = document.getElementById("healthValue");
const maxVelocityValue = document.getElementById("maxVelocityValue");
const eventsValue = document.getElementById("eventsValue");
const topicList = document.getElementById("topicList");
const speedGauges = document.getElementById("speedGauges");
const tcpVelocityRange = document.getElementById("tcpVelocityRange");
const tcpVelocityValue = document.getElementById("tcpVelocityValue");
const payloadRange = document.getElementById("payloadRange");
const payloadValue = document.getElementById("payloadValue");

const state = {
  socket: null,
  jointPositions: null,
  previousJointPositions: null,
  previousJointAt: null,
  jointVelocities: Array(6).fill(0),
  jointTimes: [],
  topics: new Map(),
  activeJog: null,
  jogTimer: null,
  reconnectTimer: null,
  lastJointAt: null,
  egm: null,
};

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function setConnection(online, label) {
  connectionPill.classList.toggle("online", online);
  connectionPill.classList.toggle("offline", !online);
  connectionPill.querySelector("strong").textContent = label;
}

function currentSpeed() {
  return Number(speedRange.value) || 5;
}

function setSpeed(value) {
  speedRange.value = String(value);
  speedValue.textContent = `${value}%`;
  speedPresets.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.speed) === Number(value));
  });
}

function renderAxes() {
  axisBank.innerHTML = "";
  for (let index = 0; index < 6; index += 1) {
    const row = document.createElement("article");
    row.className = "axis-row";
    row.innerHTML = `
      <div>
        <strong>J${index + 1}</strong>
        <small id="axisValue${index}">- deg</small>
      </div>
      <button class="jog-button" type="button" data-axis="${index}" data-direction="-1">-</button>
      <button class="jog-button" type="button" data-axis="${index}" data-direction="1">+</button>
    `;
    axisBank.appendChild(row);
  }
}

function renderSpeedGauges() {
  speedGauges.innerHTML = "";
  for (let index = 0; index < 6; index += 1) {
    const gauge = document.createElement("article");
    gauge.className = "axis-gauge";
    gauge.innerHTML = `
      <strong>Axis ${index + 1}</strong>
      <div class="gauge-arc" id="speedGaugeArc${index}">0%</div>
      <span id="speedGaugeValue${index}">0.00 rad/s</span>
    `;
    speedGauges.appendChild(gauge);
  }
}

function updateSpeedGauges() {
  const maxVelocity = [1.58, 1.58, 1.58, 3.14, 3.14, 3.14];
  state.jointVelocities.forEach((velocity, index) => {
    const percent = Math.min(100, Math.round((Math.abs(velocity) / maxVelocity[index]) * 100));
    const arc = document.getElementById(`speedGaugeArc${index}`);
    const value = document.getElementById(`speedGaugeValue${index}`);
    if (arc) {
      arc.style.setProperty("--value", `${Math.round(percent * 2.7)}deg`);
      arc.textContent = `${velocity >= 0 ? "" : "-"}${percent}%`;
    }
    if (value) value.textContent = `${formatNumber(velocity, 2)} rad/s`;
  });
}

function renderJoints() {
  const positions = state.jointPositions || [];
  jointReadout.innerHTML = "";
  for (let index = 0; index < 6; index += 1) {
    const rad = positions[index];
    const deg = Number.isFinite(rad) ? (rad * 180) / Math.PI : NaN;
    const axisValue = document.getElementById(`axisValue${index}`);
    if (axisValue) axisValue.textContent = `${formatNumber(deg, 1)} deg`;

    const item = document.createElement("div");
    item.innerHTML = `<span>J${index + 1}</span><strong>${formatNumber(deg, 1)} deg</strong>`;
    jointReadout.appendChild(item);
  }
}

function updateRate(receivedAt) {
  state.jointTimes.push(receivedAt);
  state.jointTimes = state.jointTimes.filter((time) => receivedAt - time <= 5);
  if (state.jointTimes.length < 2) {
    rateValue.textContent = "0.0 Hz";
    return;
  }
  const duration = state.jointTimes.at(-1) - state.jointTimes[0];
  const rate = duration > 0 ? (state.jointTimes.length - 1) / duration : 0;
  rateValue.textContent = `${rate.toFixed(1)} Hz`;
}

function handlePayload(payload) {
  if (payload.kind === "snapshot") {
    payload.topics?.forEach(handlePayload);
    if (payload.status) handlePayload(payload.status);
    return;
  }

  if (payload.kind === "status") {
    const topics = payload.topics || [];
    topicList.innerHTML = "";
    topics.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((topic) => {
      const item = document.createElement("div");
      item.innerHTML = `<strong>${topic.name}</strong><span>${formatNumber(topic.age_sec, 1)} s</span>`;
      topicList.appendChild(item);
    });
    return;
  }

  if (payload.kind !== "topic") return;
  state.topics.set(payload.topic, payload);
  lastUpdateValue.textContent = new Date().toLocaleTimeString("de-DE");

  if (payload.topic === "/joint_states") {
    const nextPositions = payload.data?.positions || null;
    const velocities = payload.data?.velocities || [];
    if (Array.isArray(velocities) && velocities.length >= 6) {
      state.jointVelocities = velocities.slice(0, 6).map((value) => Number(value) || 0);
    } else if (state.previousJointPositions && Array.isArray(nextPositions)) {
      const dt = Math.max(0.001, payload.received_at - state.previousJointAt);
      state.jointVelocities = nextPositions.slice(0, 6).map((value, index) => {
        const previous = state.previousJointPositions[index];
        return Number.isFinite(value) && Number.isFinite(previous) ? (value - previous) / dt : 0;
      });
    }
    state.previousJointPositions = Array.isArray(nextPositions) ? nextPositions.slice(0, 6) : null;
    state.previousJointAt = payload.received_at;
    state.jointPositions = nextPositions;
    state.lastJointAt = payload.received_at;
    setConnection(true, "Online");
    readyValue.textContent = "bereit";
    updateRate(payload.received_at);
    renderJoints();
    updateSpeedGauges();
  }

  if (payload.topic === "/egm/state") {
    state.egm = payload.data;
    egmValue.textContent = payload.data?.mci_state_label || payload.data?.motor_state_label || "aktiv";
  }
}

function connectSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

  state.socket.addEventListener("open", () => {
    setConnection(true, "Online");
  });

  state.socket.addEventListener("message", (event) => {
    try {
      handlePayload(JSON.parse(event.data));
    } catch (error) {
      commandState.textContent = `WS Fehler: ${error.message}`;
    }
  });

  state.socket.addEventListener("close", () => {
    setConnection(false, "Offline");
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = window.setTimeout(connectSocket, 1200);
  });
}

async function postJson(url, payload = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || response.statusText);
  return data;
}

async function sendJog(endpoint = "/api/hmi/jog/start") {
  if (!state.activeJog) return;
  const payload = {
    axis: state.activeJog.axis,
    direction: state.activeJog.direction,
    speed_percent: currentSpeed(),
  };
  const data = await postJson(endpoint, payload);
  motionValue.textContent = `J${data.axis} ${payload.direction > 0 ? "+" : "-"}`;
  commandState.textContent = `Jog J${data.axis} bei ${data.speed_percent}%`;
}

function clearJogButtons() {
  document.querySelectorAll(".jog-button.active").forEach((button) => button.classList.remove("active"));
}

async function stopJog(reason = "operator") {
  state.activeJog = null;
  window.clearInterval(state.jogTimer);
  state.jogTimer = null;
  clearJogButtons();
  motionValue.textContent = "Idle";
  try {
    await postJson("/api/hmi/jog/stop", { reason });
    commandState.textContent = "Stop gesendet";
  } catch (error) {
    commandState.textContent = `Stop Fehler: ${error.message}`;
  }
}

function startJog(button) {
  const axis = Number(button.dataset.axis);
  const direction = Number(button.dataset.direction);
  if (!Number.isInteger(axis) || ![-1, 1].includes(direction)) return;
  state.activeJog = { axis, direction };
  clearJogButtons();
  button.classList.add("active");
  sendJog().catch((error) => {
    commandState.textContent = `Jog Fehler: ${error.message}`;
    stopJog("error");
  });
  window.clearInterval(state.jogTimer);
  state.jogTimer = window.setInterval(() => {
    sendJog("/api/hmi/jog/heartbeat").catch((error) => {
      commandState.textContent = `Jog Fehler: ${error.message}`;
      stopJog("error");
    });
  }, 320);
}

function installControls() {
  axisBank.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".jog-button");
    if (!button) return;
    button.setPointerCapture?.(event.pointerId);
    startJog(button);
  });

  axisBank.addEventListener("pointerup", () => stopJog("release"));
  axisBank.addEventListener("pointercancel", () => stopJog("cancel"));
  axisBank.addEventListener("pointerleave", () => {
    if (state.activeJog) stopJog("leave");
  });

  stopButton.addEventListener("click", () => stopJog("stop-button"));
  document.querySelectorAll("[data-stop]").forEach((button) => {
    button.addEventListener("click", () => stopJog(`${button.dataset.stop}-stop`));
  });

  homeButton.addEventListener("click", async () => {
    if (!window.confirm("Home langsam anfahren?")) return;
    try {
      const data = await postJson("/api/hmi/home", { speed_percent: currentSpeed() });
      motionValue.textContent = "Home";
      commandState.textContent = `Home gesendet: ${data.speed_percent}%, ${data.duration_sec.toFixed(1)} s`;
    } catch (error) {
      commandState.textContent = `Home Fehler: ${error.message}`;
    }
  });

  speedRange.addEventListener("input", () => setSpeed(currentSpeed()));
  tcpVelocityRange.addEventListener("input", () => {
    tcpVelocityValue.textContent = `${tcpVelocityRange.value} mm/s`;
  });
  payloadRange.addEventListener("input", () => {
    payloadValue.textContent = `${Number(payloadRange.value).toFixed(1)} kg`;
  });
  speedPresets.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-speed]");
    if (button) setSpeed(Number(button.dataset.speed));
  });

  document.querySelectorAll(".tile[data-panel]").forEach((tile) => {
    tile.addEventListener("click", () => {
      document.querySelectorAll(".tile").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
      tile.classList.add("active");
      document.getElementById(tile.dataset.panel)?.classList.add("active");
    });
  });

  themeButton.addEventListener("click", () => {
    document.body.classList.toggle("transparent");
    const enabled = document.body.classList.contains("transparent");
    themeButton.textContent = enabled ? "Solid" : "Transparent";
    window.localStorage.setItem("sman-hmi-transparent", enabled ? "1" : "0");
  });
}

async function loadMaintenanceSummary() {
  try {
    const response = await fetch("/api/history/summary?window=24h");
    const data = await response.json();
    healthValue.textContent = `${data.health_score ?? "-"} / 100`;
    maxVelocityValue.textContent = `${formatNumber(data.max_velocity_rad_s, 2)} rad/s`;
    eventsValue.textContent = String(data.events?.length ?? 0);
  } catch (error) {
    healthValue.textContent = "-";
  }
}

function initTheme() {
  const params = new URLSearchParams(window.location.search);
  const transparent = params.get("theme") === "transparent" || window.localStorage.getItem("sman-hmi-transparent") === "1";
  document.body.classList.toggle("transparent", transparent);
  themeButton.textContent = transparent ? "Solid" : "Transparent";
}

renderAxes();
renderSpeedGauges();
renderJoints();
updateSpeedGauges();
setSpeed(5);
initTheme();
installControls();
connectSocket();
loadMaintenanceSummary();
window.setInterval(loadMaintenanceSummary, 15000);
