import * as THREE from "/assets/vendor/three.module.min.js";
import { STLLoader } from "/assets/vendor/three-addons/loaders/STLLoader.js";

const statusEl = document.getElementById("connectionStatus");
const rosStateEl = document.getElementById("rosState");
const topicCountEl = document.getElementById("topicCount");
const lastPacketEl = document.getElementById("lastPacket");
const readyCardEl = document.getElementById("readyCard");
const readyStateEl = document.getElementById("readyState");
const motionCardEl = document.getElementById("motionCard");
const motionStateEl = document.getElementById("motionState");
const liveRateEl = document.getElementById("liveRate");
const jointListEl = document.getElementById("jointList");
const topicListEl = document.getElementById("topicList");
const developerTopicListEl = document.getElementById("developerTopicList");
const developerJointListEl = document.getElementById("developerJointList");
const messagePreviewEl = document.getElementById("messagePreview");
const jointTimestampEl = document.getElementById("jointTimestamp");
const developerJointTimestampEl = document.getElementById("developerJointTimestamp");
const twinCanvasEl = document.getElementById("twinCanvas");
const twinStatusEl = document.getElementById("twinStatus");
const twinJointCountEl = document.getElementById("twinJointCount");
const twinPoseLabelEl = document.getElementById("twinPoseLabel");
const jointPopoverEl = document.getElementById("jointPopover");
const viewTabs = [...document.querySelectorAll(".view-tab")];
const dashboardViews = [...document.querySelectorAll("[data-dashboard-view]")];
const jointActivityValueEl = document.getElementById("jointActivityValue");
const rateValueEl = document.getElementById("rateValue");
const jointRangeValueEl = document.getElementById("jointRangeValue");
const packetFlowValueEl = document.getElementById("packetFlowValue");
const topicFreshnessValueEl = document.getElementById("topicFreshnessValue");
const tcpSpeedValueEl = document.getElementById("tcpSpeedValue");
const tcpXEl = document.getElementById("tcpX");
const tcpYEl = document.getElementById("tcpY");
const tcpZEl = document.getElementById("tcpZ");
const tcpRollEl = document.getElementById("tcpRoll");
const tcpPitchEl = document.getElementById("tcpPitch");
const tcpYawEl = document.getElementById("tcpYaw");
const trajectoryValueEl = document.getElementById("trajectoryValue");
const qualityValueEl = document.getElementById("qualityValue");
const latencyValueEl = document.getElementById("latencyValue");
const jitterValueEl = document.getElementById("jitterValue");
const dataAgeValueEl = document.getElementById("dataAgeValue");
const sampleCountValueEl = document.getElementById("sampleCountValue");
const healthStateValueEl = document.getElementById("healthStateValue");
const healthListEl = document.getElementById("healthList");

const charts = {
  jointActivity: createSparkline(document.getElementById("jointActivityChart"), {
    stroke: "#20c997",
    fill: "rgba(32, 201, 151, 0.12)",
    maxSamples: 64,
  }),
  rate: createSparkline(document.getElementById("rateChart"), {
    stroke: "#5cc8ff",
    fill: "rgba(92, 200, 255, 0.12)",
    maxSamples: 64,
  }),
  packetFlow: createSparkline(document.getElementById("packetFlowChart"), {
    stroke: "#ffbd4a",
    fill: "rgba(255, 189, 74, 0.11)",
    maxSamples: 64,
  }),
  jointPositions: createBarChart(document.getElementById("jointPositionChart"), {
    color: "#20c997",
    accent: "#ff2a2a",
  }),
  topicFreshness: createBarChart(document.getElementById("topicFreshnessChart"), {
    color: "#5cc8ff",
    accent: "#ffbd4a",
  }),
  trajectory: createTrajectoryChart(document.getElementById("trajectoryChart")),
};

const state = {
  topics: new Map(),
  configuredTopics: [],
  reconnectTimer: null,
  socket: null,
  jointPositions: [0, -0.35, 0.55, 0, 0.35, 0],
  previousJointPositions: null,
  jointUpdateTimes: [],
  lastJointReceivedAt: null,
  jointDetails: [],
  activeJointIndex: null,
  popoverPinned: false,
  lastLiveRate: 0,
  packetTimes: [],
  packetCount: 0,
  demoTimer: null,
  demoStartedAt: null,
  demoSequence: 0,
  realDataReceived: false,
  previousTcpPose: null,
  trajectory: [],
  latencySamples: [],
  jitterSamples: [],
  sampleCount: 0,
  healthIssues: [],
};

const twin = createDigitalTwin(twinCanvasEl, {
  onModelMode: (mode) => {
    if (mode === "mesh") {
      twinStatusEl.textContent = "GoFa Mesh";
    }
  },
});

function setConnection(isOnline, label) {
  statusEl.classList.toggle("online", isOnline);
  statusEl.classList.toggle("offline", !isOnline);
  statusEl.querySelector("span:last-child").textContent = label;
}

function formatAge(age) {
  if (age === undefined || age === null) return "-";
  if (age < 1) return `${Math.round(age * 1000)} ms`;
  return `${age.toFixed(1)} s`;
}

function formatTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp * 1000).toLocaleTimeString("de-DE");
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function radToDeg(value) {
  return Number.isFinite(value) ? (value * 180) / Math.PI : NaN;
}

function effortLabel(value) {
  if (!Number.isFinite(value)) return "nicht publiziert";
  return `${value.toFixed(3)} Nm`;
}

function velocityLabel(value) {
  if (!Number.isFinite(value)) return "nicht publiziert";
  return `${value.toFixed(3)} rad/s`;
}

function setCardState(card, stateName) {
  card.classList.remove("ok", "warn", "danger");
  card.classList.add(stateName);
}

function stopDemoStream() {
  if (!state.demoTimer) return;
  clearInterval(state.demoTimer);
  state.demoTimer = null;
}

function updateLiveRate(receivedAt) {
  state.jointUpdateTimes.push(receivedAt);
  state.jointUpdateTimes = state.jointUpdateTimes.filter((time) => receivedAt - time <= 5);

  if (state.jointUpdateTimes.length < 2) {
    liveRateEl.textContent = "0.0 Hz";
    rateValueEl.textContent = "0.0 Hz";
    state.lastLiveRate = 0;
    charts.rate.push(0);
    return;
  }

  const duration = state.jointUpdateTimes.at(-1) - state.jointUpdateTimes[0];
  const rate = duration > 0 ? (state.jointUpdateTimes.length - 1) / duration : 0;
  liveRateEl.textContent = `${rate.toFixed(1)} Hz`;
  rateValueEl.textContent = `${rate.toFixed(1)} Hz`;
  state.lastLiveRate = rate;
  charts.rate.push(rate);
}

function updatePacketFlow(receivedAt) {
  state.packetCount += 1;
  state.packetTimes.push(receivedAt);
  state.packetTimes = state.packetTimes.filter((time) => receivedAt - time <= 10);
  const packetRate = state.packetTimes.length / 10;
  packetFlowValueEl.textContent = `${state.packetCount} msg`;
  charts.packetFlow.push(packetRate);
}

function updateJointWidgets(data) {
  const velocities = data.velocities || [];
  const positions = data.positions || [];
  const activity = velocities.length
    ? velocities.reduce((sum, value) => sum + Math.abs(value || 0), 0) / velocities.length
    : 0;
  const range = positions.length ? Math.max(...positions) - Math.min(...positions) : 0;

  jointActivityValueEl.textContent = `${activity.toFixed(3)} rad/s`;
  jointRangeValueEl.textContent = `${range.toFixed(2)} rad`;
  charts.jointActivity.push(activity);
  charts.jointPositions.setValues(positions);
}

function estimateTcpPose(positions) {
  const [j1 = 0, j2 = 0, j3 = 0, j4 = 0, j5 = 0, j6 = 0] = positions || [];
  const shoulder = j2;
  const elbow = j2 + j3;
  const wrist = j2 + j3 + j5;
  const radius = 0.24 + Math.cos(shoulder) * 0.34 + Math.cos(elbow) * 0.28 + Math.cos(wrist) * 0.16;
  const z = 0.42 + Math.sin(shoulder) * 0.28 + Math.sin(elbow) * 0.22 + Math.sin(wrist) * 0.12;

  return {
    x: Math.cos(j1) * radius,
    y: Math.sin(j1) * radius,
    z,
    roll: j4,
    pitch: j5,
    yaw: j1 + j6,
  };
}

function updateTcpPose(data, receivedAt) {
  const pose = estimateTcpPose(data.positions || []);
  let speed = 0;

  if (state.previousTcpPose) {
    const dt = Math.max(0.001, receivedAt - state.previousTcpPose.receivedAt);
    const dx = pose.x - state.previousTcpPose.x;
    const dy = pose.y - state.previousTcpPose.y;
    const dz = pose.z - state.previousTcpPose.z;
    speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
  }

  state.previousTcpPose = { ...pose, receivedAt };
  state.trajectory.push({ ...pose, receivedAt });
  state.trajectory = state.trajectory.filter((point) => receivedAt - point.receivedAt <= 30).slice(-180);

  tcpXEl.textContent = `${pose.x.toFixed(3)} m`;
  tcpYEl.textContent = `${pose.y.toFixed(3)} m`;
  tcpZEl.textContent = `${pose.z.toFixed(3)} m`;
  tcpRollEl.textContent = `${radToDeg(pose.roll).toFixed(1)} deg`;
  tcpPitchEl.textContent = `${radToDeg(pose.pitch).toFixed(1)} deg`;
  tcpYawEl.textContent = `${radToDeg(pose.yaw).toFixed(1)} deg`;
  tcpSpeedValueEl.textContent = `${speed.toFixed(2)} m/s`;
  trajectoryValueEl.textContent = `${state.trajectory.length} Samples`;
  charts.trajectory.setPoints(state.trajectory);

  return { pose, speed };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function updateDataQuality(data, receivedAt) {
  state.sampleCount += 1;

  if (data.header_stamp) {
    const latencyMs = Math.max(0, (receivedAt - data.header_stamp) * 1000);
    state.latencySamples.push(latencyMs);
    state.latencySamples = state.latencySamples.slice(-80);

    if (state.latencySamples.length > 1) {
      const previous = state.latencySamples.at(-2);
      state.jitterSamples.push(Math.abs(latencyMs - previous));
      state.jitterSamples = state.jitterSamples.slice(-80);
    }
  }

  const dataAgeMs = Math.max(0, (Date.now() / 1000 - receivedAt) * 1000);
  const latency = state.latencySamples.length ? average(state.latencySamples) : 0;
  const jitter = state.jitterSamples.length ? average(state.jitterSamples) : 0;

  latencyValueEl.textContent = state.latencySamples.length ? `${latency.toFixed(1)} ms` : "-";
  jitterValueEl.textContent = state.jitterSamples.length ? `${jitter.toFixed(1)} ms` : "-";
  dataAgeValueEl.textContent = `${dataAgeMs.toFixed(0)} ms`;
  sampleCountValueEl.textContent = String(state.sampleCount);
  qualityValueEl.textContent = state.latencySamples.length ? `${latency.toFixed(0)} / ${jitter.toFixed(0)} ms` : "Demo";

  return { latency, jitter, dataAgeMs };
}

function updateHealth(data, quality, tcp) {
  const issues = [];
  const jointTopic = state.topics.get("/joint_states");
  const maxVelocity = Math.max(0, ...(data.velocities || []).map((value) => Math.abs(value || 0)));
  const nearLimit = (data.positions || []).some((value) => Math.abs(value) > Math.PI * 0.86);

  if (!jointTopic || jointTopic.age_sec > 2.5) issues.push({ level: "danger", label: "Joint State stale", value: formatAge(jointTopic?.age_sec) });
  if (quality.latency > 250) issues.push({ level: "warn", label: "Hohe Latenz", value: `${quality.latency.toFixed(0)} ms` });
  if (quality.jitter > 80) issues.push({ level: "warn", label: "Hoher Jitter", value: `${quality.jitter.toFixed(0)} ms` });
  if (maxVelocity > 1.2) issues.push({ level: "warn", label: "Velocity Spike", value: `${maxVelocity.toFixed(2)} rad/s` });
  if (nearLimit) issues.push({ level: "warn", label: "Achse nahe Limit", value: "> 86 %" });
  if (tcp.speed > 0.65) issues.push({ level: "warn", label: "TCP schnell", value: `${tcp.speed.toFixed(2)} m/s` });

  state.healthIssues = issues;
  healthStateValueEl.textContent = issues.some((item) => item.level === "danger") ? "Critical" : issues.length ? "Warn" : "OK";
  healthListEl.innerHTML = "";

  const rows = issues.length ? issues : [{ level: "ok", label: "Alle Checks stabil", value: "OK" }];
  for (const issue of rows) {
    const row = document.createElement("div");
    row.className = `health-item ${issue.level}`;
    row.innerHTML = `<strong>${issue.label}</strong><span>${issue.value}</span>`;
    healthListEl.appendChild(row);
  }
}

function updateShowcaseStatus(data, receivedAt) {
  const topicAge = Date.now() / 1000 - receivedAt;
  const hasFreshJointState = topicAge < 2.5;
  const hasPositions = data.positions?.length > 0;
  const velocityPeak = Math.max(0, ...(data.velocities || []).map((value) => Math.abs(value)));
  let positionDelta = 0;

  if (state.previousJointPositions?.length) {
    positionDelta = data.positions.reduce((peak, value, index) => {
      const delta = Math.abs(value - (state.previousJointPositions[index] ?? value));
      return Math.max(peak, delta);
    }, 0);
  }

  const moving = velocityPeak > 0.015 || positionDelta > 0.006;

  readyStateEl.textContent = hasFreshJointState && hasPositions ? "Ready" : "Waiting";
  setCardState(readyCardEl, hasFreshJointState && hasPositions ? "ok" : "warn");

  motionStateEl.textContent = moving ? "Moving" : "Idle";
  setCardState(motionCardEl, moving ? "ok" : "warn");

  updateLiveRate(receivedAt);
  state.previousJointPositions = [...(data.positions || [])];
  state.lastJointReceivedAt = receivedAt;
}

function renderJointPopover(detail) {
  const position = detail.position;
  const degrees = radToDeg(position);
  jointPopoverEl.innerHTML = `
    <div class="popover-head">
      <div>
        <span>${detail.topic}</span>
        <h3>${detail.name}</h3>
      </div>
      <button class="popover-close" type="button" aria-label="Details schliessen">×</button>
    </div>
    <div class="popover-grid">
      <div class="popover-field">
        <span>Achswinkel</span>
        <strong>${formatNumber(position)} rad</strong>
      </div>
      <div class="popover-field">
        <span>Grad</span>
        <strong>${formatNumber(degrees, 1)} deg</strong>
      </div>
      <div class="popover-field">
        <span>Geschwindigkeit</span>
        <strong>${velocityLabel(detail.velocity)}</strong>
      </div>
      <div class="popover-field">
        <span>Effort / Moment</span>
        <strong>${effortLabel(detail.effort)}</strong>
      </div>
      <div class="popover-field">
        <span>Normierter Weg</span>
        <strong>${formatNumber(detail.normalized, 1)} %</strong>
      </div>
      <div class="popover-field">
        <span>Update</span>
        <strong>${formatTime(detail.receivedAt)}</strong>
      </div>
    </div>
  `;

  jointPopoverEl.querySelector(".popover-close")?.addEventListener("click", hideJointPopover);
}

function placeJointPopover(anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
  const topSpace = rect.top;
  const below = rect.bottom + 10;
  const above = rect.top - jointPopoverEl.offsetHeight - 10;
  const top = topSpace > jointPopoverEl.offsetHeight + 24 ? above : below;

  jointPopoverEl.style.left = `${left}px`;
  jointPopoverEl.style.top = `${Math.min(Math.max(12, top), window.innerHeight - jointPopoverEl.offsetHeight - 12)}px`;
}

function showJointPopover(index, anchor, pinned = false) {
  const detail = state.jointDetails[index];
  if (!detail) return;

  state.activeJointIndex = index;
  state.popoverPinned = pinned;
  renderJointPopover(detail);
  jointPopoverEl.hidden = false;
  jointPopoverEl.classList.toggle("pinned", pinned);
  document.querySelectorAll(".joint-row.active").forEach((row) => row.classList.remove("active"));
  anchor.classList.add("active");
  requestAnimationFrame(() => placeJointPopover(anchor));
}

function refreshOpenJointPopover() {
  if (state.activeJointIndex === null || jointPopoverEl.hidden) return;
  const anchor = document.querySelector(`[data-joint-index="${state.activeJointIndex}"].active`);
  if (!anchor) return;
  renderJointPopover(state.jointDetails[state.activeJointIndex]);
  placeJointPopover(anchor);
}

function hideJointPopover() {
  state.activeJointIndex = null;
  state.popoverPinned = false;
  jointPopoverEl.hidden = true;
  jointPopoverEl.classList.remove("pinned");
  document.querySelectorAll(".joint-row.active").forEach((row) => row.classList.remove("active"));
}

function updateTopics(statusTopics = []) {
  for (const topic of statusTopics) {
    state.topics.set(topic.name, topic);
  }

  const allNames = new Set([
    ...state.configuredTopics.map((topic) => topic.name),
    ...state.topics.keys(),
  ]);

  topicCountEl.textContent = String(state.topics.size);
  const newestTopic = [...state.topics.values()].sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0))[0];
  if (newestTopic?.last_seen && lastPacketEl.textContent === "-") {
    lastPacketEl.textContent = formatTime(newestTopic.last_seen);
  }
  const freshnessValues = [...state.topics.values()].map((topic) => topic.age_sec ?? 0);
  const freshest = freshnessValues.length ? Math.min(...freshnessValues) : null;
  topicFreshnessValueEl.textContent = freshest === null ? "-" : formatAge(freshest);
  charts.topicFreshness.setValues(freshnessValues, { max: 5, invert: true });

  const jointTopic = state.topics.get("/joint_states");
  if (!jointTopic || jointTopic.age_sec > 2.5) {
    readyStateEl.textContent = "Waiting";
    setCardState(readyCardEl, "warn");
    if (jointTopic?.age_sec > 4) {
      motionStateEl.textContent = "Idle";
      setCardState(motionCardEl, "warn");
    }
  }

  topicListEl.innerHTML = "";
  developerTopicListEl.innerHTML = "";

  if (allNames.size === 0) {
    topicListEl.innerHTML = '<p class="empty">Noch keine Topics empfangen.</p>';
    developerTopicListEl.innerHTML = '<p class="empty">Noch keine Topics empfangen.</p>';
    return;
  }

  for (const name of allNames) {
    const topic = state.topics.get(name);
    const configured = state.configuredTopics.find((item) => item.name === name);
    const row = document.createElement("div");
    row.className = "topic-item";
    row.innerHTML = `
      <strong>${configured?.label || name}</strong>
      <span>${topic ? formatAge(topic.age_sec) : "wartet"}</span>
    `;
    topicListEl.appendChild(row);

    const developerRow = document.createElement("div");
    developerRow.className = "topic-item";
    developerRow.innerHTML = `
      <div>
        <strong>${name}</strong>
        <small>${configured?.type || topic?.type || "konfiguriert"}</small>
      </div>
      <span>${topic ? formatAge(topic.age_sec) : "wartet"}</span>
    `;
    developerTopicListEl.appendChild(developerRow);
  }
}

function updateJointStates(data) {
  const receivedAt = data.received_at ?? Date.now() / 1000;
  jointTimestampEl.textContent = data.header_stamp ? `ROS ${data.header_stamp.toFixed(3)}` : "-";
  developerJointTimestampEl.textContent = jointTimestampEl.textContent;
  jointListEl.innerHTML = "";
  developerJointListEl.innerHTML = "";

  if (!data.names?.length) {
    jointListEl.innerHTML = '<p class="empty">Noch keine Joint-State-Daten.</p>';
    developerJointListEl.innerHTML = '<p class="empty">Noch keine Joint-State-Daten.</p>';
    return;
  }

  state.jointDetails = data.names.map((name, index) => {
    const position = data.positions?.[index] ?? 0;
    const normalized = Math.max(0, Math.min(100, ((position + Math.PI) / (Math.PI * 2)) * 100));
    return {
      index,
      name,
      position,
      velocity: data.velocities?.[index],
      effort: data.efforts?.[index],
      normalized,
      topic: "/joint_states",
      rosStamp: data.header_stamp,
      receivedAt,
    };
  });

  state.jointDetails.forEach((detail) => {
    const row = document.createElement("div");
    row.className = "joint-row";
    row.dataset.jointIndex = String(detail.index);
    row.tabIndex = 0;
    row.innerHTML = `
      <div class="joint-name" title="${detail.name}">${detail.name}</div>
      <div class="bar" aria-label="${detail.name} Position"><span style="width: ${detail.normalized}%"></span></div>
      <div class="joint-value">${detail.position.toFixed(3)} rad</div>
    `;
    row.addEventListener("mouseenter", () => {
      if (!state.popoverPinned) showJointPopover(detail.index, row, false);
    });
    row.addEventListener("mouseleave", () => {
      if (!state.popoverPinned) hideJointPopover();
    });
    row.addEventListener("focus", () => {
      if (!state.popoverPinned) showJointPopover(detail.index, row, false);
    });
    row.addEventListener("blur", () => {
      if (!state.popoverPinned) hideJointPopover();
    });
    row.addEventListener("click", () => {
      const isSame = state.activeJointIndex === detail.index && state.popoverPinned;
      if (isSame) {
        hideJointPopover();
      } else {
        showJointPopover(detail.index, row, true);
      }
    });
    jointListEl.appendChild(row);

    const developerRow = document.createElement("div");
    developerRow.className = "joint-row";
    developerRow.dataset.jointIndex = String(detail.index);
    developerRow.tabIndex = 0;
    developerRow.innerHTML = `
      <div class="joint-name" title="${detail.name}">${detail.name}</div>
      <div class="bar" aria-label="${detail.name} Position"><span style="width: ${detail.normalized}%"></span></div>
      <div class="joint-value">${detail.position.toFixed(3)} rad</div>
    `;
    developerRow.addEventListener("mouseenter", () => {
      if (!state.popoverPinned) showJointPopover(detail.index, developerRow, false);
    });
    developerRow.addEventListener("mouseleave", () => {
      if (!state.popoverPinned) hideJointPopover();
    });
    developerRow.addEventListener("focus", () => {
      if (!state.popoverPinned) showJointPopover(detail.index, developerRow, false);
    });
    developerRow.addEventListener("blur", () => {
      if (!state.popoverPinned) hideJointPopover();
    });
    developerRow.addEventListener("click", () => {
      const isSame = state.activeJointIndex === detail.index && state.popoverPinned;
      if (isSame) {
        hideJointPopover();
      } else {
        showJointPopover(detail.index, developerRow, true);
      }
    });
    developerJointListEl.appendChild(developerRow);
  });

  state.jointPositions = state.jointPositions.map((fallback, index) => data.positions?.[index] ?? fallback);
  twin.setJoints(state.jointPositions);
  twinStatusEl.textContent = "synchron";
  twinJointCountEl.textContent = `${data.names.length} Achsen`;
  twinPoseLabelEl.textContent = "ROS2";
  updateJointWidgets(data);
  updateShowcaseStatus(data, receivedAt);
  const tcp = updateTcpPose(data, receivedAt);
  const quality = updateDataQuality(data, receivedAt);
  updateHealth(data, quality, tcp);
  refreshOpenJointPopover();
}

function handleMessage(payload) {
  if (!payload.demo && payload.kind === "topic") {
    state.realDataReceived = true;
    stopDemoStream();
  }

  if (payload.kind === "hello") {
    state.configuredTopics = payload.topics || [];
    updateTopics();
    return;
  }

  if (payload.kind === "snapshot") {
    if (payload.status) {
      handleMessage(payload.status);
    }
    for (const topicPayload of payload.topics || []) {
      handleMessage(topicPayload);
    }
    return;
  }

  if (payload.kind === "status") {
    rosStateEl.textContent = payload.demo ? "demo" : payload.ros_ok ? "online" : "offline";
    updateTopics(payload.topics || []);
    return;
  }

  if (payload.kind !== "topic") return;

  updatePacketFlow(payload.received_at ?? Date.now() / 1000);
  lastPacketEl.textContent = formatTime(payload.received_at);
  messagePreviewEl.textContent = JSON.stringify(payload, null, 2);

  if (payload.type === "sensor_msgs/msg/JointState") {
    updateJointStates({ ...payload.data, received_at: payload.received_at });
  }
}

function switchDashboard(view) {
  viewTabs.forEach((tab) => {
    const isActive = tab.dataset.view === view;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  dashboardViews.forEach((section) => {
    const isActive = section.dataset.dashboardView === view;
    section.classList.toggle("active", isActive);
    section.hidden = !isActive;
  });

  requestAnimationFrame(() => {
    Object.values(charts).forEach((chart) => chart.draw());
    refreshOpenJointPopover();
  });
}

function demoJointPayload(now) {
  const t = now - state.demoStartedAt;
  const positions = [
    Math.sin(t * 0.7) * 0.85,
    -0.42 + Math.sin(t * 0.46 + 0.8) * 0.38,
    0.55 + Math.sin(t * 0.58 + 1.7) * 0.52,
    Math.sin(t * 0.9 + 2.2) * 0.72,
    0.28 + Math.sin(t * 0.62 + 3.1) * 0.42,
    Math.sin(t * 1.15 + 1.2) * 0.95,
  ];
  const velocities = positions.map((value, index) => Math.cos(t * (0.45 + index * 0.11)) * 0.04 + value * 0.015);
  const efforts = positions.map((value, index) => Math.sin(t * 0.33 + index) * 0.6 + value * 0.2);

  return {
    demo: true,
    kind: "topic",
    topic: "/joint_states",
    type: "sensor_msgs/msg/JointState",
    label: "Joint States",
    received_at: now,
    data: {
      header_stamp: now,
      names: ["joint_1", "joint_2", "joint_3", "joint_4", "joint_5", "joint_6"],
      positions,
      velocities,
      efforts,
    },
  };
}

function demoStatusPayload(now) {
  const topicAges = {
    "/joint_states": 0.05 + Math.abs(Math.sin(now * 1.7)) * 0.08,
    "/tf": 0.18 + Math.abs(Math.sin(now * 0.9)) * 0.2,
    "/diagnostics": 0.42 + Math.abs(Math.sin(now * 0.35)) * 0.7,
  };

  return {
    demo: true,
    kind: "status",
    ros_ok: true,
    time: now,
    topics: Object.entries(topicAges).map(([name, age]) => ({
      name,
      last_seen: now - age,
      age_sec: Number(age.toFixed(3)),
    })),
  };
}

function startDemoStream() {
  if (state.demoTimer || state.realDataReceived) return;

  state.demoStartedAt = Date.now() / 1000;
  state.configuredTopics = [
    { name: "/joint_states", type: "sensor_msgs/msg/JointState", label: "Joint States" },
    { name: "/tf", type: "tf2_msgs/msg/TFMessage", label: "TF" },
    { name: "/diagnostics", type: "diagnostic_msgs/msg/DiagnosticArray", label: "Diagnostics" },
  ];
  rosStateEl.textContent = "demo";
  setConnection(true, "Demo Daten");
  updateTopics();

  const tick = () => {
    if (state.realDataReceived) {
      stopDemoStream();
      return;
    }
    const now = Date.now() / 1000;
    state.demoSequence += 1;
    handleMessage(demoStatusPayload(now));
    handleMessage(demoJointPayload(now));

    if (state.demoSequence % 4 === 0) {
      handleMessage({
        demo: true,
        kind: "topic",
        topic: "/diagnostics",
        type: "diagnostic_msgs/msg/DiagnosticArray",
        label: "Diagnostics",
        received_at: now,
        data: {
          header_stamp: now,
          status: [
            {
              name: "demo/controller",
              hardware_id: "sman-gofa-demo",
              level: 0,
              message: "Demo Stream aktiv",
              values: {
                mode: "simulation",
                sequence: String(state.demoSequence),
              },
            },
          ],
        },
      });
    }
  };

  tick();
  state.demoTimer = setInterval(tick, 500);
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    if (!state.demoTimer) {
      setConnection(true, "Verbunden");
    }
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  });

  socket.addEventListener("message", (event) => {
    handleMessage(JSON.parse(event.data));
  });

  socket.addEventListener("close", () => {
    if (!state.demoTimer) {
      setConnection(false, "Getrennt");
    }
    state.reconnectTimer = setTimeout(connect, 1500);
  });

  socket.addEventListener("error", () => {
    if (!state.demoTimer) {
      setConnection(false, "Fehler");
    }
    socket.close();
  });
}

jointListEl.innerHTML = '<p class="empty">Warte auf ROS2-Daten...</p>';
topicListEl.innerHTML = '<p class="empty">Warte auf ROS2-Daten...</p>';
developerJointListEl.innerHTML = '<p class="empty">Warte auf ROS2-Daten...</p>';
developerTopicListEl.innerHTML = '<p class="empty">Warte auf ROS2-Daten...</p>';
twin.setJoints(state.jointPositions);
charts.jointPositions.setValues(state.jointPositions);
Object.values(charts).forEach((chart) => chart.draw());
connect();
window.setTimeout(() => {
  if (!state.realDataReceived && !state.lastJointReceivedAt) {
    startDemoStream();
  }
}, 1200);

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchDashboard(tab.dataset.view));
});

document.addEventListener("click", (event) => {
  if (!state.popoverPinned) return;
  const target = event.target;
  if (jointPopoverEl.contains(target) || target.closest?.(".joint-row")) return;
  hideJointPopover();
});

window.addEventListener("resize", refreshOpenJointPopover);
window.addEventListener("resize", () => Object.values(charts).forEach((chart) => chart.draw()));

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = "rgba(157, 166, 178, 0.16)";
  ctx.lineWidth = 1;
  for (let index = 1; index < 4; index += 1) {
    const y = (height / 4) * index;
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(width - 14, y);
    ctx.stroke();
  }
}

function createSparkline(canvas, options = {}) {
  const values = [];
  const maxSamples = options.maxSamples || 60;
  const stroke = options.stroke || "#20c997";
  const fill = options.fill || "rgba(32, 201, 151, 0.12)";

  function draw() {
    if (!canvas) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    const points = values.length ? values : [0];
    const max = Math.max(0.001, ...points);
    const left = 14;
    const right = width - 14;
    const top = 12;
    const bottom = height - 18;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, bottom - top);

    ctx.beginPath();
    points.forEach((value, index) => {
      const x = left + (plotWidth * index) / Math.max(1, points.length - 1);
      const y = bottom - (Math.max(0, value) / max) * plotHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.lineTo(right, bottom);
    ctx.lineTo(left, bottom);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  return {
    push(value) {
      values.push(Number.isFinite(value) ? value : 0);
      while (values.length > maxSamples) values.shift();
      draw();
    },
    draw,
  };
}

function createBarChart(canvas, options = {}) {
  let values = [];
  let config = {};
  const color = options.color || "#20c997";
  const accent = options.accent || "#ff2a2a";

  function draw() {
    if (!canvas) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    const source = values.length ? values : [0];
    const maxAbs = config.max || Math.max(0.001, ...source.map((value) => Math.abs(value)));
    const left = 16;
    const right = width - 16;
    const top = 12;
    const bottom = height - 22;
    const zero = config.invert ? bottom : top + (bottom - top) / 2;
    const gap = 8;
    const barWidth = Math.max(10, (right - left - gap * (source.length - 1)) / source.length);

    source.forEach((value, index) => {
      const x = left + index * (barWidth + gap);
      const normalized = Math.min(1, Math.abs(value) / maxAbs);
      const barHeight = Math.max(3, normalized * (config.invert ? bottom - top : (bottom - top) / 2));
      const y = config.invert ? bottom - barHeight : value >= 0 ? zero - barHeight : zero;
      ctx.fillStyle = index % 2 === 0 ? color : accent;
      ctx.globalAlpha = config.invert ? Math.max(0.25, 1 - normalized * 0.7) : 0.9;
      ctx.fillRect(x, y, barWidth, barHeight);
      ctx.globalAlpha = 1;
    });
  }

  return {
    setValues(nextValues, nextConfig = {}) {
      values = (nextValues || []).map((value) => (Number.isFinite(value) ? value : 0));
      config = nextConfig;
      draw();
    },
    draw,
  };
}

function createTrajectoryChart(canvas) {
  let points = [];

  function draw() {
    if (!canvas) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    const left = 16;
    const right = width - 16;
    const top = 14;
    const bottom = height - 18;
    const plotWidth = right - left;
    const plotHeight = bottom - top;

    if (points.length < 2) {
      ctx.fillStyle = "rgba(157, 166, 178, 0.55)";
      ctx.font = "12px Inter, sans-serif";
      ctx.fillText("Warte auf TCP Samples", left, top + 18);
      return;
    }

    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(0.001, maxX - minX);
    const spanY = Math.max(0.001, maxY - minY);

    ctx.beginPath();
    points.forEach((point, index) => {
      const x = left + ((point.x - minX) / spanX) * plotWidth;
      const y = bottom - ((point.y - minY) / spanY) * plotHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#20c997";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    const latest = points.at(-1);
    const x = left + ((latest.x - minX) / spanX) * plotWidth;
    const y = bottom - ((latest.y - minY) / spanY) * plotHeight;
    ctx.fillStyle = "#ff2a2a";
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    setPoints(nextPoints) {
      points = nextPoints || [];
      draw();
    },
    draw,
  };
}

function createDigitalTwin(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const target = new THREE.Vector3(0, 1.05, 0);
  const cameraState = { yaw: -0.72, pitch: 0.34, radius: 3.6 };

  const root = new THREE.Group();
  scene.add(root);

  const materials = {
    red: new THREE.MeshStandardMaterial({ color: 0xff2a2a, roughness: 0.48, metalness: 0.08 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf3f6f8, roughness: 0.42, metalness: 0.04 }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x252d38, roughness: 0.52, metalness: 0.24 }),
    joint: new THREE.MeshStandardMaterial({ color: 0x8f9aaa, roughness: 0.35, metalness: 0.38 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 0.82, metalness: 0.02 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x38c6a3, emissive: 0x0f4f43, roughness: 0.45 }),
  };

  scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x101217, 2.3));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(2.5, 4, 3);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x38c6a3, 1.3);
  rimLight.position.set(-3, 2, -2);
  scene.add(rimLight);

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.04, 96), materials.floor);
  floor.position.y = -0.03;
  root.add(floor);

  const grid = new THREE.GridHelper(2.8, 14, 0x334050, 0x27313d);
  grid.position.y = 0;
  root.add(grid);

  const proceduralAxes = [];
  const meshAxes = [];
  const joints = [];

  function jointSphere(radius = 0.13, material = materials.joint) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 18), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function link(length, radius, material) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 32), material);
    body.position.y = length / 2;
    body.castShadow = true;
    group.add(body);
    return group;
  }

  function bracket(width, height, depth, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const base = new THREE.Group();
  root.add(base);
  proceduralAxes.push({ group: base, axis: "y", sign: 1, offset: 0 });

  const baseColumn = link(0.32, 0.19, materials.red);
  base.add(baseColumn);

  const shoulder = new THREE.Group();
  shoulder.position.y = 0.34;
  base.add(shoulder);
  proceduralAxes.push({ group: shoulder, axis: "z", sign: -1, offset: -0.28 });
  shoulder.add(jointSphere(0.17, materials.white));

  const upperArm = link(0.68, 0.105, materials.white);
  shoulder.add(upperArm);
  joints.push(upperArm);

  const elbow = new THREE.Group();
  elbow.position.y = 0.68;
  shoulder.add(elbow);
  proceduralAxes.push({ group: elbow, axis: "z", sign: 1, offset: 0.74 });
  elbow.add(jointSphere(0.145, materials.red));

  const forearm = link(0.6, 0.082, materials.red);
  elbow.add(forearm);

  const wrist1 = new THREE.Group();
  wrist1.position.y = 0.6;
  elbow.add(wrist1);
  proceduralAxes.push({ group: wrist1, axis: "x", sign: 1, offset: 0 });
  wrist1.add(jointSphere(0.12, materials.white));

  const wristLink = link(0.34, 0.064, materials.white);
  wrist1.add(wristLink);

  const wrist2 = new THREE.Group();
  wrist2.position.y = 0.34;
  wrist1.add(wrist2);
  proceduralAxes.push({ group: wrist2, axis: "z", sign: -1, offset: 0 });
  wrist2.add(jointSphere(0.105, materials.red));

  const flangeLink = link(0.24, 0.052, materials.graphite);
  wrist2.add(flangeLink);

  const wrist3 = new THREE.Group();
  wrist3.position.y = 0.24;
  wrist2.add(wrist3);
  proceduralAxes.push({ group: wrist3, axis: "y", sign: 1, offset: 0 });
  wrist3.add(jointSphere(0.095, materials.joint));

  const tool = bracket(0.3, 0.07, 0.12, materials.glow);
  tool.position.y = 0.14;
  wrist3.add(tool);

  const tcp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 10), materials.glow);
  tcp.position.y = 0.23;
  wrist3.add(tcp);

  let activeAxes = proceduralAxes;
  let activeTool = tool;
  loadGoFaMeshes().catch((error) => {
    console.warn("GoFa mesh model could not be loaded, using procedural fallback.", error);
  });

  function rosVector(x, y, z) {
    return new THREE.Vector3(x, z, -y);
  }

  function rosAxis(axis) {
    const vector = rosVector(axis[0], axis[1], axis[2]);
    const largest = ["x", "y", "z"].reduce((current, candidate) =>
      Math.abs(vector[candidate]) > Math.abs(vector[current]) ? candidate : current,
    );
    return {
      axis: largest,
      sign: Math.sign(vector[largest]) || 1,
    };
  }

  function convertRosGeometry(geometry) {
    geometry.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  async function loadStlMesh(loader, file, material) {
    const geometry = await loader.loadAsync(file);
    const mesh = new THREE.Mesh(convertRosGeometry(geometry), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  async function loadGoFaMeshes() {
    const loader = new STLLoader();
    const assetBase = "/assets/robot/abb_crb15000_support/meshes/crb15000_5_95/visual";
    const meshRoot = new THREE.Group();
    meshRoot.name = "ABB GoFa CRB 15000-5/0.95 visual meshes";
    meshRoot.position.y = 0.02;
    meshRoot.scale.setScalar(1.7);

    const dark = new THREE.MeshStandardMaterial({ color: 0x2c333c, roughness: 0.58, metalness: 0.2 });
    const graphiteWhite = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.46, metalness: 0.08 });
    const grayWhite = new THREE.MeshStandardMaterial({ color: 0xf5f6f7, roughness: 0.42, metalness: 0.06 });

    const baseMesh = await loadStlMesh(loader, `${assetBase}/base_link.stl`, dark);
    meshRoot.add(baseMesh);

    const joint1 = new THREE.Group();
    joint1.position.copy(rosVector(0, 0, 0.265));
    meshRoot.add(joint1);
    meshAxes.push({ group: joint1, offset: 0, ...rosAxis([0, 0, 1]) });
    joint1.add(await loadStlMesh(loader, `${assetBase}/link_1.stl`, dark));

    const joint2 = new THREE.Group();
    joint1.add(joint2);
    meshAxes.push({ group: joint2, offset: 0, ...rosAxis([0, 1, 0]) });
    joint2.add(await loadStlMesh(loader, `${assetBase}/link_2.stl`, dark));

    const joint3 = new THREE.Group();
    joint3.position.copy(rosVector(0, 0, 0.444));
    joint2.add(joint3);
    meshAxes.push({ group: joint3, offset: 0, ...rosAxis([0, 1, 0]) });
    joint3.add(await loadStlMesh(loader, `${assetBase}/link_3.stl`, dark));

    const joint4 = new THREE.Group();
    joint4.position.copy(rosVector(0, 0, 0.110));
    joint3.add(joint4);
    meshAxes.push({ group: joint4, offset: 0, ...rosAxis([1, 0, 0]) });
    joint4.add(await loadStlMesh(loader, `${assetBase}/link_4.stl`, graphiteWhite));

    const joint5 = new THREE.Group();
    joint5.position.copy(rosVector(0.470, 0, 0));
    joint4.add(joint5);
    meshAxes.push({ group: joint5, offset: 0, ...rosAxis([0, 1, 0]) });
    joint5.add(await loadStlMesh(loader, `${assetBase}/link_5.stl`, graphiteWhite));

    const joint6 = new THREE.Group();
    joint6.position.copy(rosVector(0.101, 0, 0.080));
    joint5.add(joint6);
    meshAxes.push({ group: joint6, offset: 0, ...rosAxis([1, 0, 0]) });
    joint6.add(await loadStlMesh(loader, `${assetBase}/link_6.stl`, grayWhite));

    const meshTcp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 10), materials.glow);
    meshTcp.position.copy(rosVector(0.045, 0, 0));
    joint6.add(meshTcp);

    base.visible = false;
    root.add(meshRoot);
    activeAxes = meshAxes;
    activeTool = meshTcp;
    target.set(0, 0.78, 0);
    cameraState.radius = 2.65;
    setJoints(state.jointPositions);
    options.onModelMode?.("mesh");
  }

  function setJoints(values) {
    activeAxes.forEach((axis, index) => {
      const value = values[index] ?? 0;
      axis.group.rotation.set(0, 0, 0);
      axis.group.rotation[axis.axis] = value * axis.sign + axis.offset;
    });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function updateCamera() {
    const x = Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch) * cameraState.radius;
    const y = target.y + Math.sin(cameraState.pitch) * cameraState.radius;
    const z = Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch) * cameraState.radius;
    camera.position.set(x, y, z);
    camera.lookAt(target);
  }

  let dragging = false;
  let lastPointer = { x: 0, y: 0 };

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    cameraState.yaw -= dx * 0.008;
    cameraState.pitch = Math.max(-0.2, Math.min(1.05, cameraState.pitch + dy * 0.006));
  });

  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      cameraState.radius = Math.max(2.2, Math.min(5.4, cameraState.radius + event.deltaY * 0.002));
    },
    { passive: false },
  );

  function animate() {
    resize();
    updateCamera();
    activeTool.rotation.y += 0.006;
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();

  return { setJoints };
}
