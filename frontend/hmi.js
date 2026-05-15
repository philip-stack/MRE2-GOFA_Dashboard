const connectionPill = document.getElementById("connectionPill");
const readyValue = document.getElementById("readyValue");
const motionValue = document.getElementById("motionValue");
const rateValue = document.getElementById("rateValue");
const egmValue = document.getElementById("egmValue");
const axisBank = document.getElementById("axisBank");
const tcpJogBank = document.getElementById("tcpJogBank");
const jogModeSwitch = document.getElementById("jogModeSwitch");
const jogModeTitle = document.getElementById("jogModeTitle");
const speedRange = document.getElementById("speedRange");
const speedValue = document.getElementById("speedValue");
const speedPresets = document.getElementById("speedPresets");
const tcpLinearSpeedRange = document.getElementById("tcpLinearSpeedRange");
const tcpLinearSpeedValue = document.getElementById("tcpLinearSpeedValue");
const tcpAngularSpeedRange = document.getElementById("tcpAngularSpeedRange");
const tcpAngularSpeedValue = document.getElementById("tcpAngularSpeedValue");
const tcpJogSpeedField = document.getElementById("tcpJogSpeedField");
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
const loginScreen = document.getElementById("loginScreen");
const loginForm = document.getElementById("loginForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const logoutButton = document.getElementById("logoutButton");
const homeConfirmOverlay = document.getElementById("homeConfirmOverlay");
const homeConfirmCancel = document.getElementById("homeConfirmCancel");
const homeConfirmOk = document.getElementById("homeConfirmOk");
const hmiShell = document.querySelector(".hmi-shell");
const mobileJoystickPanel = document.getElementById("mobileJoystickPanel");
const mobileJoystick = document.getElementById("mobileJoystick");
const mobileJoystickKnob = document.getElementById("mobileJoystickKnob");
const mobileJoystickTarget = document.getElementById("mobileJoystickTarget");
const mobileJoystickStatus = document.getElementById("mobileJoystickStatus");
const ROBOT_STALE_AFTER_SEC = 2.5;
const CLIENT_SESSION_KEY = "sman-hmi-client-session";
const MOBILE_JOYSTICK_DEADZONE = 0.28;

const state = {
  socket: null,
  socketOnline: false,
  jointPositions: null,
  previousJointPositions: null,
  previousJointAt: null,
  jointVelocities: Array(6).fill(0),
  jointTimes: [],
  topics: new Map(),
  activeJog: null,
  activePointerId: null,
  jogMode: "axis",
  jogTimer: null,
  joystickPointerId: null,
  joystickCommand: null,
  reconnectTimer: null,
  lastJointAt: null,
  egm: null,
  authenticated: false,
  homeConfirmResolve: null,
};

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function setConnection(online, label) {
  connectionPill.classList.toggle("online", online);
  connectionPill.classList.toggle("offline", !online);
  connectionPill.querySelector("strong").textContent = label;
}

function setRobotFresh(isFresh, ageSec = null) {
  if (isFresh) {
    setConnection(true, "Roboter online");
    readyValue.textContent = "bereit";
    return;
  }

  setConnection(false, state.socketOnline ? "Offline" : "Dashboard offline");
  readyValue.textContent = "wartet";
  rateValue.textContent = "0.0 Hz";
  if (Number.isFinite(ageSec)) {
    lastUpdateValue.textContent = `Letzte Roboterdaten: ${formatNumber(ageSec, 1)} s`;
  }
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

function setJogMode(mode) {
  state.jogMode = mode === "tcp" ? "tcp" : "axis";
  axisBank.hidden = state.jogMode !== "axis";
  tcpJogBank.hidden = state.jogMode !== "tcp";
  tcpJogSpeedField.hidden = state.jogMode !== "tcp";
  jogModeTitle.textContent = state.jogMode === "tcp" ? "TCP linear bewegen" : "Achsen bewegen";
  jogModeSwitch.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.jogMode === state.jogMode);
  });
  window.requestAnimationFrame(fitHmiToViewport);
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
    const jointTopic = topics.find((topic) => topic.name === "/joint_states" || topic.name === "/egm/feedback_joint_states");
    const age = Number(jointTopic?.age_sec);
    setRobotFresh(Number.isFinite(age) && age <= ROBOT_STALE_AFTER_SEC, age);

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
    setRobotFresh(true);
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
    state.socketOnline = true;
    commandState.textContent = "Dashboard verbunden";
    setRobotFresh(false);
  });

  state.socket.addEventListener("message", (event) => {
    try {
      handlePayload(JSON.parse(event.data));
    } catch (error) {
      commandState.textContent = `WS Fehler: ${error.message}`;
    }
  });

  state.socket.addEventListener("close", () => {
    state.socketOnline = false;
    setRobotFresh(false);
    window.clearTimeout(state.reconnectTimer);
    if (!state.authenticated) return;
    state.reconnectTimer = window.setTimeout(connectSocket, 1200);
  });
}

async function postJson(url, payload = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin(data.detail || "Bitte erneut einloggen");
  }
  if (!response.ok) {
    const error = new Error(data.detail || response.statusText);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showLogin(message = "") {
  state.authenticated = false;
  document.documentElement.style.setProperty("--hmi-scale", "1");
  document.body.classList.add("auth-pending");
  document.body.classList.remove("authenticated");
  loginError.textContent = message;
  loginPassword.value = "";
  loginScreen.hidden = false;
  window.setTimeout(() => loginPassword.focus(), 0);
}

function showHmi(username = "Default User") {
  state.authenticated = true;
  document.body.classList.remove("auth-pending");
  document.body.classList.add("authenticated");
  loginError.textContent = "";
  loginPassword.value = "";
  commandState.textContent = `${username} angemeldet`;
  window.requestAnimationFrame(fitHmiToViewport);
}

function fitHmiToViewport() {
  if (!state.authenticated || !hmiShell) return;
  document.documentElement.style.setProperty("--hmi-scale", "1");
  if (window.matchMedia("(max-width: 760px)").matches) return;
  const naturalHeight = hmiShell.scrollHeight;
  const naturalWidth = hmiShell.scrollWidth;
  const scale = Math.min(
    1,
    (window.innerHeight - 1) / Math.max(1, naturalHeight),
    (window.innerWidth - 1) / Math.max(1, naturalWidth),
  );
  document.documentElement.style.setProperty("--hmi-scale", scale.toFixed(3));
}

function closeHomeConfirm(confirmed) {
  if (!state.homeConfirmResolve) return;
  const resolve = state.homeConfirmResolve;
  state.homeConfirmResolve = null;
  homeConfirmOverlay.hidden = true;
  resolve(confirmed);
}

function confirmHomeMove() {
  if (state.homeConfirmResolve) closeHomeConfirm(false);
  homeConfirmOverlay.hidden = false;
  homeConfirmCancel.focus();
  return new Promise((resolve) => {
    state.homeConfirmResolve = resolve;
  });
}

async function checkAuth() {
  const response = await fetch("/api/hmi/auth/status", { credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (data.authenticated && window.sessionStorage.getItem(CLIENT_SESSION_KEY) === "1") {
    showHmi(data.username);
    return true;
  }
  if (data.authenticated) {
    await fetch("/api/hmi/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  }
  showLogin();
  return false;
}

async function login(username, password) {
  const data = await postJson("/api/hmi/auth/login", { username, password });
  window.sessionStorage.setItem(CLIENT_SESSION_KEY, "1");
  showHmi(data.username);
}

async function logout() {
  await stopJog("logout");
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
  window.clearTimeout(state.reconnectTimer);
  window.sessionStorage.removeItem(CLIENT_SESSION_KEY);
  await postJson("/api/hmi/auth/logout", {});
  showLogin("Abgemeldet");
}

async function sendJog(endpoint = "/api/hmi/jog/start") {
  if (!state.activeJog) return;
  const isTcpJog = state.activeJog.mode === "tcp";
  const payload = isTcpJog
    ? {
        axis: state.activeJog.axis,
        direction: state.activeJog.direction,
        linear_speed_mm_s: Number(tcpLinearSpeedRange.value) || 50,
        angular_speed_deg_s: Number(tcpAngularSpeedRange.value) || 10,
      }
    : {
        axis: state.activeJog.axis,
        direction: state.activeJog.direction,
        speed_percent: currentSpeed(),
      };
  const data = await postJson(endpoint, payload);
  if (isTcpJog) {
    motionValue.textContent = `TCP ${data.axis} ${payload.direction > 0 ? "+" : "-"}`;
    commandState.textContent = `TCP Jog ${data.axis} via ${data.twist_topic}`;
  } else {
    motionValue.textContent = `J${data.axis} ${payload.direction > 0 ? "+" : "-"}`;
    commandState.textContent = `Jog J${data.axis} bei ${data.speed_percent}%`;
  }
}

function handleJogError(error) {
  commandState.textContent = `Jog Fehler: ${error.message}`;
  if (error.status === 401) {
    stopJog("auth-error");
  }
}

function clearJogButtons() {
  document.querySelectorAll(".jog-button.active").forEach((button) => button.classList.remove("active"));
  document.querySelectorAll(".tcp-jog-button.active").forEach((button) => button.classList.remove("active"));
  mobileJoystick?.classList.remove("active");
}

async function stopJog(reason = "operator") {
  state.activeJog = null;
  state.activePointerId = null;
  state.joystickCommand = null;
  window.clearInterval(state.jogTimer);
  state.jogTimer = null;
  clearJogButtons();
  resetMobileJoystick();
  motionValue.textContent = "Idle";
  try {
    await postJson("/api/hmi/jog/stop", { reason });
    commandState.textContent = "Stop gesendet";
  } catch (error) {
    commandState.textContent = `Stop Fehler: ${error.message}`;
  }
}

function startJogCommand(command, pointerId = null, activeElement = null) {
  const isTcpJog = command.mode === "tcp";
  const axis = command.axis;
  const direction = Number(command.direction);
  if (isTcpJog) {
    if (!["x", "y", "z", "rx", "ry", "rz"].includes(axis) || ![-1, 1].includes(direction)) return;
    state.activeJog = { mode: "tcp", axis, direction };
  } else {
    if (!Number.isInteger(axis) || ![-1, 1].includes(direction)) return;
    state.activeJog = { mode: "axis", axis, direction };
  }
  state.activePointerId = pointerId;
  clearJogButtons();
  activeElement?.classList.add("active");
  const startEndpoint = isTcpJog ? "/api/hmi/tcp/start" : "/api/hmi/jog/start";
  const heartbeatEndpoint = isTcpJog ? "/api/hmi/tcp/heartbeat" : "/api/hmi/jog/heartbeat";
  sendJog(startEndpoint).catch(handleJogError);
  window.clearInterval(state.jogTimer);
  state.jogTimer = window.setInterval(() => {
    sendJog(heartbeatEndpoint).catch(handleJogError);
  }, 320);
}

function startJog(button, pointerId = null) {
  const isTcpJog = button.classList.contains("tcp-jog-button");
  startJogCommand(
    {
      mode: isTcpJog ? "tcp" : "axis",
      axis: isTcpJog ? button.dataset.tcpAxis : Number(button.dataset.axis),
      direction: Number(button.dataset.direction),
    },
    pointerId,
    button,
  );
}

function joystickCommandKey(command) {
  return command ? `${command.mode}:${command.axis}:${command.direction}` : "";
}

function resetMobileJoystick() {
  if (mobileJoystickKnob) {
    mobileJoystickKnob.style.transform = "translate(-50%, -50%)";
  }
  mobileJoystick?.classList.remove("active");
  if (mobileJoystickStatus && !state.activeJog) {
    mobileJoystickStatus.textContent = "Joystick bereit";
  }
}

function commandFromJoystick(dx, dy) {
  const target = mobileJoystickTarget?.value || "axis:0";
  const [mode, value] = target.split(":");
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < MOBILE_JOYSTICK_DEADZONE) return null;

  if (mode === "axis") {
    return {
      mode: "axis",
      axis: Number(value),
      direction: dx >= 0 ? 1 : -1,
      label: `J${Number(value) + 1} ${dx >= 0 ? "+" : "-"}`,
    };
  }

  if (value === "xy") {
    if (Math.abs(dx) > Math.abs(dy)) {
      return {
        mode: "tcp",
        axis: "y",
        direction: dx < 0 ? 1 : -1,
        label: dx < 0 ? "TCP Links" : "TCP Rechts",
      };
    }
    return {
      mode: "tcp",
      axis: "x",
      direction: dy < 0 ? 1 : -1,
      label: dy < 0 ? "TCP Vor" : "TCP Zurück",
    };
  }

  return {
    mode: "tcp",
    axis: value,
    direction: dy < 0 || dx > 0 ? 1 : -1,
    label: `${value.toUpperCase()} ${dy < 0 || dx > 0 ? "+" : "-"}`,
  };
}

function updateMobileJoystick(event) {
  if (!mobileJoystick || state.joystickPointerId !== event.pointerId) return;
  const rect = mobileJoystick.getBoundingClientRect();
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const rawX = (event.clientX - centerX) / radius;
  const rawY = (event.clientY - centerY) / radius;
  const magnitude = Math.hypot(rawX, rawY);
  const limit = magnitude > 1 ? 1 / magnitude : 1;
  const dx = rawX * limit;
  const dy = rawY * limit;
  mobileJoystickKnob.style.transform = `translate(calc(-50% + ${dx * 56}px), calc(-50% + ${dy * 56}px))`;

  const command = commandFromJoystick(dx, dy);
  const nextKey = joystickCommandKey(command);
  if (!command) {
    if (state.joystickCommand) stopJog("joystick-center");
    state.joystickCommand = null;
    mobileJoystickStatus.textContent = "Mitte";
    return;
  }
  if (nextKey === state.joystickCommand) return;
  state.joystickCommand = nextKey;
  mobileJoystickStatus.textContent = command.label;
  startJogCommand(command, event.pointerId, mobileJoystick);
}

function installControls() {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    try {
      await login(loginUsername.value, loginPassword.value);
      if (!state.socket) connectSocket();
      loadMaintenanceSummary();
    } catch (error) {
      showLogin(error.message);
    }
  });

  logoutButton.addEventListener("click", () => {
    logout().catch((error) => {
      commandState.textContent = `Logout Fehler: ${error.message}`;
      showLogin();
    });
  });

  axisBank.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".jog-button");
    if (!button) return;
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    startJog(button, event.pointerId);
  });
  tcpJogBank.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".tcp-jog-button");
    if (!button) return;
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    startJog(button, event.pointerId);
  });

  mobileJoystick?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    state.joystickPointerId = event.pointerId;
    mobileJoystick.setPointerCapture?.(event.pointerId);
    updateMobileJoystick(event);
  });
  mobileJoystick?.addEventListener("pointermove", (event) => {
    if (state.joystickPointerId === event.pointerId) {
      event.preventDefault();
      updateMobileJoystick(event);
    }
  });
  mobileJoystickTarget?.addEventListener("change", () => {
    if (state.joystickPointerId !== null) stopJog("joystick-target-change");
    resetMobileJoystick();
  });

  window.addEventListener("pointerup", (event) => {
    if (state.joystickPointerId === event.pointerId) {
      state.joystickPointerId = null;
      stopJog("joystick-release");
    } else if (state.activeJog && (state.activePointerId === null || state.activePointerId === event.pointerId)) {
      stopJog("release");
    }
  });
  window.addEventListener("pointercancel", (event) => {
    if (state.joystickPointerId === event.pointerId) {
      state.joystickPointerId = null;
      stopJog("joystick-cancel");
    } else if (state.activeJog && (state.activePointerId === null || state.activePointerId === event.pointerId)) {
      stopJog("cancel");
    }
  });
  window.addEventListener("blur", () => {
    state.joystickPointerId = null;
    if (state.activeJog) stopJog("window-blur");
  });

  stopButton.addEventListener("click", () => stopJog("stop-button"));
  document.querySelectorAll("[data-stop]").forEach((button) => {
    button.addEventListener("click", () => stopJog(`${button.dataset.stop}-stop`));
  });

  homeButton.addEventListener("click", async () => {
    if (!(await confirmHomeMove())) return;
    try {
      const data = await postJson("/api/hmi/home", { speed_percent: currentSpeed() });
      motionValue.textContent = "Home";
      commandState.textContent = `Home gesendet: ${data.speed_percent}%, ${data.duration_sec.toFixed(1)} s`;
    } catch (error) {
      commandState.textContent = `Home Fehler: ${error.message}`;
    }
  });

  homeConfirmCancel.addEventListener("click", () => closeHomeConfirm(false));
  homeConfirmOk.addEventListener("click", () => closeHomeConfirm(true));
  homeConfirmOverlay.addEventListener("click", (event) => {
    if (event.target === homeConfirmOverlay) closeHomeConfirm(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !homeConfirmOverlay.hidden) {
      closeHomeConfirm(false);
    }
  });

  speedRange.addEventListener("input", () => setSpeed(currentSpeed()));
  tcpLinearSpeedRange.addEventListener("input", () => {
    tcpLinearSpeedValue.textContent = `${tcpLinearSpeedRange.value} mm/s`;
  });
  tcpAngularSpeedRange.addEventListener("input", () => {
    tcpAngularSpeedValue.textContent = `${tcpAngularSpeedRange.value} deg/s`;
  });
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
  jogModeSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-jog-mode]");
    if (!button) return;
    stopJog("mode-switch");
    setJogMode(button.dataset.jogMode);
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
setJogMode("axis");
initTheme();
installControls();
checkAuth().then((authenticated) => {
  if (!authenticated) return;
  connectSocket();
  loadMaintenanceSummary();
});
window.setInterval(() => {
  if (state.authenticated) loadMaintenanceSummary();
}, 15000);
window.addEventListener("resize", fitHmiToViewport);
