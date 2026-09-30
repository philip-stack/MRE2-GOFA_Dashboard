/**
 * Main browser controller for the SMAN ABB GoFa dashboard.
 *
 * The dashboard normalizes live ROS/EGM payloads, derives operator-facing
 * health and maintenance signals, and keeps 2D/3D views synchronized with real
 * telemetry or the local demo stream. Shared state is centralized because most
 * widgets depend on the same freshness, joint-position, and history-window data.
 */
import * as THREE from "/assets/vendor/three.module.min.js";
import { STLLoader } from "/assets/vendor/three-addons/loaders/STLLoader.js";

// Loaded as a deferred classic script before this module (see index.html).
const { t, locale } = window.i18n;

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
const messagePreviewFilterEl = document.getElementById("messagePreviewFilter");
const messagePreviewPauseEl = document.getElementById("messagePreviewPause");
const messagePreviewTopicEl = document.getElementById("messagePreviewTopic");
const jointTimestampEl = document.getElementById("jointTimestamp");
const developerJointTimestampEl = document.getElementById("developerJointTimestamp");
const twinCanvasEl = document.getElementById("twinCanvas");
const twinStatusEl = document.getElementById("twinStatus");
const twinJointCountEl = document.getElementById("twinJointCount");
const twinPoseLabelEl = document.getElementById("twinPoseLabel");
const jointPopoverEl = document.getElementById("jointPopover");
const eventToastStackEl = document.getElementById("eventToastStack");
const demoModeButtonEl = document.getElementById("demoModeButton");
const viewTabs = [...document.querySelectorAll(".view-tab")];
const dashboardViews = [...document.querySelectorAll("[data-dashboard-view]")];
const graphWindowEl = document.getElementById("graphWindow");
const jointActivityValueEl = document.getElementById("jointActivityValue");
const jointActivityLegendEl = document.getElementById("jointActivityLegend");
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
const workspaceValueEl = document.getElementById("workspaceValue");
const qualityValueEl = document.getElementById("qualityValue");
const latencyValueEl = document.getElementById("latencyValue");
const jitterValueEl = document.getElementById("jitterValue");
const dataAgeValueEl = document.getElementById("dataAgeValue");
const sampleCountValueEl = document.getElementById("sampleCountValue");
const healthStateValueEl = document.getElementById("healthStateValue");
const healthListEl = document.getElementById("healthList");
const healthScoreValueEl = document.getElementById("healthScoreValue");
const healthScoreRingEl = document.getElementById("healthScoreRing");
const healthReasonListEl = document.getElementById("healthReasonList");
const dataQualityLabelEl = document.getElementById("dataQualityLabel");
const userFreshnessValueEl = document.getElementById("userFreshnessValue");
const userSignalValueEl = document.getElementById("userSignalValue");
const userIssueCountEl = document.getElementById("userIssueCount");
const cycleStateValueEl = document.getElementById("cycleStateValue");
const idleValueEl = document.getElementById("idleValue");
const cycleValueEl = document.getElementById("cycleValue");
const trajectoryValueEl = document.getElementById("trajectoryValue");
const userWarningListEl = document.getElementById("userWarningList");
const maintenanceWindowEl = document.getElementById("maintenanceWindow");
const maintenanceHealthScoreEl = document.getElementById("maintenanceHealthScore");
const jointDistanceValueEl = document.getElementById("jointDistanceValue");
const nearLimitValueEl = document.getElementById("nearLimitValue");
const directionChangesValueEl = document.getElementById("directionChangesValue");
const maintenanceMaxVelocityEl = document.getElementById("maintenanceMaxVelocity");
const utilizationValueEl = document.getElementById("utilizationValue");
const axisWearListEl = document.getElementById("axisWearList");
const maintenanceTimelineEl = document.getElementById("maintenanceTimeline");
const eventCountValueEl = document.getElementById("eventCountValue");
const mailSettingsFormEl = document.getElementById("mailSettingsForm");
const mailRecipientsEl = document.getElementById("mailRecipients");
const mailEnabledEl = document.getElementById("mailEnabled");
const mailImmediateEl = document.getElementById("mailImmediate");
const mailDailyEl = document.getElementById("mailDaily");
const mailWeeklyEl = document.getElementById("mailWeekly");
const mailSettingsStateEl = document.getElementById("mailSettingsState");
const mailQueueValueEl = document.getElementById("mailQueueValue");
const mailQueueListEl = document.getElementById("mailQueueList");
const sendTestMailEl = document.getElementById("sendTestMail");
const manageMailRecipientsEl = document.getElementById("manageMailRecipients");
const mailRecipientsModalEl = document.getElementById("mailRecipientsModal");
const closeMailRecipientsEl = document.getElementById("closeMailRecipients");
const mailRecipientListEl = document.getElementById("mailRecipientList");
const testMailStateEl = document.getElementById("testMailState");
const egmStateValueEl = document.getElementById("egmStateValue");
const egmMotorsValueEl = document.getElementById("egmMotorsValue");
const egmRapidValueEl = document.getElementById("egmRapidValue");
const egmConvergenceValueEl = document.getElementById("egmConvergenceValue");
const egmUtilizationDeveloperValueEl = document.getElementById("egmUtilizationDeveloperValue");

// Chart ink (grid, axes, captions) comes from CSS tokens so the canvases follow
// the light/dark theme; it is re-read when the theme changes.
function readChartInk() {
  const style = getComputedStyle(document.documentElement);
  return {
    grid: style.getPropertyValue("--chart-grid").trim(),
    axis: style.getPropertyValue("--chart-axis").trim(),
    text: style.getPropertyValue("--chart-text").trim(),
  };
}
let chartInk = readChartInk();

const AXIS_ACTIVITY_COLORS = ["#20c997", "#5cc8ff", "#ffbd4a", "#ff5c8a", "#a78bfa", "#7ee787"];
// German source labels; the legend translates them with t() when it renders.
const AXIS_ACTIVITY_LABELS = [1, 2, 3, 4, 5, 6].map((number) => ({ source: "Achse {number}", params: { number } }));

const charts = {
  jointActivity: createAxisActivityChart(document.getElementById("jointActivityChart"), jointActivityLegendEl, {
    colors: AXIS_ACTIVITY_COLORS,
    labels: AXIS_ACTIVITY_LABELS,
    maxSamples: 64,
    yLabel: "rad/s",
    xLabel: "Zeit",
  }),
  rate: createSparkline(document.getElementById("rateChart"), {
    stroke: "#5cc8ff",
    fill: "rgba(92, 200, 255, 0.12)",
    maxSamples: 64,
    yLabel: "Hz",
    xLabel: "Zeit",
  }),
  packetFlow: createSparkline(document.getElementById("packetFlowChart"), {
    stroke: "#ffbd4a",
    fill: "rgba(255, 189, 74, 0.11)",
    maxSamples: 64,
    yLabel: "msg/s",
    xLabel: "Zeit",
  }),
  jointPositions: createBarChart(document.getElementById("jointPositionChart"), {
    color: "#20c997",
    accent: "#ff2a2a",
    yLabel: "rad",
    labels: ["A1", "A2", "A3", "A4", "A5", "A6"],
  }),
  topicFreshness: createBarChart(document.getElementById("topicFreshnessChart"), {
    color: "#5cc8ff",
    accent: "#ffbd4a",
    yLabel: "s",
  }),
  maintenanceHealth: createSparkline(document.getElementById("maintenanceHealthChart"), {
    stroke: "#20c997",
    fill: "rgba(32, 201, 151, 0.12)",
    maxSamples: 48,
    yLabel: "Score",
    xLabel: "Zeit",
    fixedMax: 100,
  }),
  axisWear: createBarChart(document.getElementById("axisWearChart"), {
    color: "#20c997",
    accent: "#ffbd4a",
    yLabel: "Score",
    labels: ["J1", "J2", "J3", "J4", "J5", "J6"],
  }),
  workspace: createWorkspaceMap(document.getElementById("workspaceMap")),
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
  demoSample: null,
  realDataReceived: false,
  forceDemo: new URLSearchParams(window.location.search).get("demo") === "1",
  previousTcpPose: null,
  currentTcpPose: null,
  currentTcpSpeed: 0,
  lastTcpPoseReceivedAt: null,
  currentMotionLabel: "Idle",
  latencySamples: [],
  jitterSamples: [],
  sampleCount: 0,
  healthIssues: [],
  healthScore: 100,
  idleStartedAt: null,
  lastMovingAt: null,
  trajectorySamples: 0,
  egmState: null,
  lastEgmStateAt: null,
  activeJointTopic: null,
  messagePreviewPaused: false,
  messagePreviewFilter: "important",
  lastMessagePreviewAt: 0,
  maintenanceWindow: "24h",
  showMailRecipients: false,
  eventToastsInitialized: false,
  seenEventIds: new Set(),
  graphWindow: "live",
  currentJointVelocities: [0, 0, 0, 0, 0, 0],
  maintenanceTimer: null,
};

const twin = createDigitalTwin(twinCanvasEl, {
  onModelMode: (mode) => {
    if (mode === "mesh") {
      twinStatusEl.textContent = "GoFa Mesh";
    }
  },
});

/**
 * Update the connection pill without forcing unnecessary DOM churn.
 *
 * @param {boolean} isOnline Whether the dashboard stream is connected.
 * @param {string} label Operator-facing connection label.
 * @returns {void}
 */
function setConnection(isOnline, label) {
  statusEl.classList.toggle("online", isOnline);
  statusEl.classList.toggle("offline", !isOnline);
  const labelEl = statusEl.querySelector("span:last-child");
  if (labelEl.textContent !== label) {
    labelEl.textContent = label;
  }
}

function formatAge(age) {
  if (age === undefined || age === null) return "-";
  if (age < 1) return `${Math.round(age * 1000)} ms`;
  return `${age.toFixed(1)} s`;
}

function formatTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp * 1000).toLocaleTimeString(locale());
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp * 1000).toLocaleString(locale(), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function radToDeg(value) {
  return Number.isFinite(value) ? (value * 180) / Math.PI : NaN;
}

function displayJointName(name, index) {
  const match = String(name || "").match(/(?:joint[_\s-]*)(\d+)$/i);
  const number = match ? Number(match[1]) : index + 1;
  return `Joint ${number}`;
}

function quaternionToEuler(orientation = {}) {
  const x = Number(orientation.x) || 0;
  const y = Number(orientation.y) || 0;
  const z = Number(orientation.z) || 0;
  const w = Number.isFinite(Number(orientation.w)) ? Number(orientation.w) : 1;

  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return { roll, pitch, yaw };
}

function effortLabel(value) {
  if (!Number.isFinite(value)) return t("nicht publiziert");
  return `${value.toFixed(3)} Nm`;
}

function velocityLabel(value) {
  if (!Number.isFinite(value)) return t("nicht publiziert");
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
  state.demoSample = null;
  twin.setDemoCell(null);
  demoModeButtonEl?.classList.remove("active");
}

function setLiveMode(label = "ROS live") {
  if (state.forceDemo) return;
  state.realDataReceived = true;
  stopDemoStream();
  rosStateEl.textContent = "online";
  setConnection(true, label);
}

function resetDemoState() {
  state.realDataReceived = false;
  state.lastJointReceivedAt = null;
  state.previousJointPositions = null;
  state.previousTcpPose = null;
  state.currentTcpPose = null;
  state.currentTcpSpeed = 0;
  state.lastTcpPoseReceivedAt = null;
  state.jointUpdateTimes = [];
  state.packetTimes = [];
  state.packetCount = 0;
  state.sampleCount = 0;
  state.latencySamples = [];
  state.jitterSamples = [];
  state.trajectorySamples = 0;
  twinCanvasEl.classList.remove("stale");
}

function enableDemoMode() {
  // Manual demo mode deliberately overrides future WebSocket data so the UI can
  // be used for screenshots, reviews, and training without a live ROS stack.
  state.forceDemo = true;
  resetDemoState();
  stopDemoStream();
  startDemoStream(true);
}

function updateLiveRate(receivedAt) {
  state.jointUpdateTimes.push(receivedAt);
  // Five seconds smooths packet jitter while still making stream degradation
  // visible quickly to the operator.
  state.jointUpdateTimes = state.jointUpdateTimes.filter((time) => receivedAt - time <= 5);

  if (state.jointUpdateTimes.length < 2) {
    liveRateEl.textContent = "0.0 Hz";
    rateValueEl.textContent = "0.0 Hz";
    state.lastLiveRate = 0;
    if (state.graphWindow === "live") charts.rate.push(0);
    return;
  }

  const duration = state.jointUpdateTimes.at(-1) - state.jointUpdateTimes[0];
  const rate = duration > 0 ? (state.jointUpdateTimes.length - 1) / duration : 0;
  liveRateEl.textContent = `${rate.toFixed(1)} Hz`;
  rateValueEl.textContent = `${rate.toFixed(1)} Hz`;
  state.lastLiveRate = rate;
  if (state.graphWindow === "live") charts.rate.push(rate);
}

function updatePacketFlow(receivedAt) {
  state.packetCount += 1;
  state.packetTimes.push(receivedAt);
  state.packetTimes = state.packetTimes.filter((time) => receivedAt - time <= 10);
  const packetRate = state.packetTimes.length / 10;
  packetFlowValueEl.textContent = `${state.packetCount} msg`;
  if (state.graphWindow === "live") charts.packetFlow.push(packetRate);
}

function updateJointWidgets(data) {
  const velocities = data.velocities || [];
  const positions = data.positions || [];
  const axisVelocities = AXIS_ACTIVITY_LABELS.map((_, index) => Math.abs(Number(velocities[index]) || 0));
  const activity = velocities.length
    ? velocities.reduce((sum, value) => sum + Math.abs(value || 0), 0) / velocities.length
    : 0;
  const range = positions.length ? Math.max(...positions) - Math.min(...positions) : 0;

  jointActivityValueEl.textContent = `Ø ${activity.toFixed(3)} rad/s`;
  jointRangeValueEl.textContent = t("Spanne {value} rad", { value: range.toFixed(2) });
  state.currentJointVelocities = axisVelocities;
  if (state.graphWindow === "live") {
    charts.jointActivity.push(axisVelocities);
    charts.jointPositions.setValues(positions);
  }
}

// Joint origins and axes from crb15000_5_95_macro.xacro. The TCP sits 45 mm in
// front of the flange to match the twin's TCP marker.
const GOFA_CHAIN = [
  { origin: [0, 0, 0.265], axis: "z" },
  { origin: [0, 0, 0], axis: "y" },
  { origin: [0, 0, 0.444], axis: "y" },
  { origin: [0, 0, 0.11], axis: "x" },
  { origin: [0.47, 0, 0], axis: "y" },
  { origin: [0.101, 0, 0.08], axis: "x" },
];
const GOFA_TCP_OFFSET = [0.045, 0, 0];

function axisRotation(axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === "x") return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === "y") return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function multiplyMatrix(a, b) {
  return a.map((row) => [0, 1, 2].map((col) => row[0] * b[0][col] + row[1] * b[1][col] + row[2] * b[2][col]));
}

function rotateVector(m, v) {
  return m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

function estimateTcpPose(positions) {
  // Joint-space forward kinematics of the URDF chain; used when no Cartesian
  // pose topic is present so workspace and health widgets stay meaningful.
  let rotation = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let point = [0, 0, 0];
  GOFA_CHAIN.forEach((joint, index) => {
    point = rotateVector(rotation, joint.origin).map((value, axis) => point[axis] + value);
    rotation = multiplyMatrix(rotation, axisRotation(joint.axis, Number(positions?.[index]) || 0));
  });
  point = rotateVector(rotation, GOFA_TCP_OFFSET).map((value, axis) => point[axis] + value);
  // tool0 is the flange rotated +90 deg about y (flange-tool0 joint in the URDF).
  const tool = multiplyMatrix(rotation, axisRotation("y", Math.PI / 2));

  return {
    x: point[0],
    y: point[1],
    z: point[2],
    roll: Math.atan2(tool[2][1], tool[2][2]),
    pitch: Math.asin(Math.max(-1, Math.min(1, -tool[2][0]))),
    yaw: Math.atan2(tool[1][0], tool[0][0]),
  };
}

function updateTcpPose(data, receivedAt) {
  const pose = estimateTcpPose(data.positions || []);
  return applyTcpPose(pose, receivedAt, "estimated");
}

function applyTcpPose(pose, receivedAt, source = "estimated") {
  let speed = 0;

  if (state.previousTcpPose) {
    const dt = Math.max(0.001, receivedAt - state.previousTcpPose.receivedAt);
    const dx = pose.x - state.previousTcpPose.x;
    const dy = pose.y - state.previousTcpPose.y;
    const dz = pose.z - state.previousTcpPose.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    speed = distance < 0.0005 ? 0 : distance / dt;
  }

  // Store the accepted pose once so health, workspace, and readouts all reason
  // about the same TCP sample.
  state.previousTcpPose = { ...pose, receivedAt };
  state.currentTcpPose = pose;
  state.currentTcpSpeed = speed;
  if (source === "egm") {
    state.lastTcpPoseReceivedAt = receivedAt;
  }
  tcpXEl.textContent = `${pose.x.toFixed(3)} m`;
  tcpYEl.textContent = `${pose.y.toFixed(3)} m`;
  tcpZEl.textContent = `${pose.z.toFixed(3)} m`;
  tcpRollEl.textContent = `${radToDeg(pose.roll).toFixed(1)} deg`;
  tcpPitchEl.textContent = `${radToDeg(pose.pitch).toFixed(1)} deg`;
  tcpYawEl.textContent = `${radToDeg(pose.yaw).toFixed(1)} deg`;
  tcpSpeedValueEl.textContent = `${speed.toFixed(2)} m/s`;
  workspaceValueEl.textContent = `${Math.hypot(pose.x, pose.y).toFixed(2)} m`;
  charts.workspace.setPose(pose);
  state.trajectorySamples = Math.min(9999, state.trajectorySamples + 1);
  trajectoryValueEl.textContent = `${state.trajectorySamples} Samples`;

  return { pose, speed };
}

function readPoseStamped(data) {
  const position = data?.position || data?.pose?.position;
  const orientation = data?.orientation || data?.pose?.orientation;
  if (!position) return null;
  const euler = quaternionToEuler(orientation);
  return {
    x: Number(position.x) || 0,
    y: Number(position.y) || 0,
    z: Number(position.z) || 0,
    ...euler,
  };
}

function updateTcpPoseFromPoseStamped(data, receivedAt) {
  const pose = readPoseStamped(data);
  if (!pose) return;
  const tcp = applyTcpPose(pose, receivedAt, "egm");
  twinPoseLabelEl.textContent = "EGM TCP";
  return tcp;
}

function currentTcpForHealth(data) {
  return {
    pose: state.currentTcpPose || estimateTcpPose(data.positions || []),
    speed: state.currentTcpSpeed || 0,
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function comparableHeaderStamp(headerStamp, receivedAt) {
  if (!Number.isFinite(headerStamp) || !Number.isFinite(receivedAt)) return null;
  const deltaSeconds = receivedAt - headerStamp;
  // Ignore ROS sim-time or unrelated clock domains; otherwise latency can look
  // catastrophically high even though packets are arriving normally.
  if (headerStamp < 1_000_000_000 || Math.abs(deltaSeconds) > 60) return null;
  return Math.max(0, deltaSeconds * 1000);
}

function updateDataQuality(data, receivedAt) {
  state.sampleCount += 1;

  const latencyMs = comparableHeaderStamp(data.header_stamp, receivedAt);
  if (latencyMs !== null) {
    state.latencySamples.push(latencyMs);
    // Keep recent quality samples bounded so a resolved network hiccup does not
    // dominate the status widgets for the rest of the session.
    state.latencySamples = state.latencySamples.slice(-80);

    if (state.latencySamples.length > 1) {
      const previous = state.latencySamples.at(-2);
      state.jitterSamples.push(Math.abs(latencyMs - previous));
      state.jitterSamples = state.jitterSamples.slice(-80);
    }
  } else if (state.latencySamples.some((value) => value > 60_000)) {
    state.latencySamples = [];
    state.jitterSamples = [];
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
  if (quality.latency > 250) issues.push({ level: "warn", label: t("Hohe Latenz"), value: `${quality.latency.toFixed(0)} ms` });
  if (quality.jitter > 80) issues.push({ level: "warn", label: t("Hoher Jitter"), value: `${quality.jitter.toFixed(0)} ms` });
  if (maxVelocity > 1.2) issues.push({ level: "warn", label: "Velocity Spike", value: `${maxVelocity.toFixed(2)} rad/s` });
  if (nearLimit) issues.push({ level: "warn", label: t("Achse nahe Limit"), value: "> 86 %" });
  if (tcp.speed > 0.65) issues.push({ level: "warn", label: t("TCP schnell"), value: `${tcp.speed.toFixed(2)} m/s` });

  // The score is a triage signal, not a certified safety value; the issue list
  // stays visible so operators can see exactly which heuristic moved it.
  state.healthIssues = issues;
  const scorePenalty = issues.reduce((sum, issue) => sum + (issue.level === "danger" ? 45 : 14), 0);
  state.healthScore = Math.max(0, Math.min(100, Math.round(100 - scorePenalty)));
  const stateLabel = issues.some((item) => item.level === "danger") ? t("Kritisch") : issues.length ? t("Warnung") : "OK";

  healthStateValueEl.textContent = issues.some((item) => item.level === "danger") ? "Critical" : issues.length ? "Warn" : "OK";
  healthScoreValueEl.textContent = String(state.healthScore);
  healthScoreRingEl.querySelector("strong").textContent = String(state.healthScore);
  healthScoreRingEl.querySelector("span").textContent = stateLabel;
  healthScoreRingEl.style.setProperty("--score", `${state.healthScore}%`);
  healthScoreRingEl.classList.toggle("warn", issues.length > 0 && !issues.some((item) => item.level === "danger"));
  healthScoreRingEl.classList.toggle("danger", issues.some((item) => item.level === "danger"));
  healthListEl.innerHTML = "";
  healthReasonListEl.innerHTML = "";
  userWarningListEl.innerHTML = "";

  const rows = issues.length ? issues : [{ level: "ok", label: t("Alle Checks stabil"), value: "OK" }];
  for (const issue of rows) {
    const row = document.createElement("div");
    row.className = `health-item ${issue.level}`;
    row.innerHTML = `<strong>${issue.label}</strong><span>${issue.value}</span>`;
    healthListEl.appendChild(row);

    const reason = row.cloneNode(true);
    healthReasonListEl.appendChild(reason);
    const userWarning = row.cloneNode(true);
    userWarningListEl.appendChild(userWarning);
  }

  dataQualityLabelEl.textContent = quality.latency > 250 || quality.jitter > 80 ? t("pruefen") : t("stabil");
  userFreshnessValueEl.textContent = `${quality.dataAgeMs.toFixed(0)} ms`;
  userSignalValueEl.textContent = jointTopic && jointTopic.age_sec <= 2.5 ? "Live" : t("kein Stream");
  userIssueCountEl.textContent = String(issues.length);
}

function updateEgmState(data) {
  const normalized = normalizeEgmState(data);
  if (!normalized) return;

  state.egmState = {
    ...(state.egmState || {}),
    ...Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== null && value !== undefined)),
  };
  state.lastEgmStateAt = Date.now() / 1000;

  egmStateValueEl.textContent = state.egmState.egmState || "-";
  egmMotorsValueEl.textContent = state.egmState.motors || "-";
  egmRapidValueEl.textContent = state.egmState.rapid || "-";
  egmConvergenceValueEl.textContent = state.egmState.convergence === true ? "met" : state.egmState.convergence === false ? "open" : "-";
  const utilization = state.egmState.utilization;
  const utilizationLabel = Number.isFinite(utilization) ? `${utilization.toFixed(1)} %` : "-";
  egmUtilizationDeveloperValueEl.textContent = utilizationLabel;
  utilizationValueEl.textContent = utilizationLabel;
}

function labelEnum(value, labels) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return labels[number] || `unknown:${number}`;
}

/**
 * Normalize ABB EGM state from any supported bridge format.
 *
 * @param {object} data Raw EGM payload.
 * @returns {object|null} Compact state fields for dashboard widgets.
 */
function normalizeEgmState(data) {
  if (!data) return null;
  if (typeof data.data === "string") {
    try {
      data = JSON.parse(data.data);
    } catch {
      return null;
    }
  }

  if (Array.isArray(data.channels) && data.channels.length === 0) return null;
  if (Array.isArray(data.egm_channels) && data.egm_channels.length === 0) return null;

  // Accept both ROS message fields and decoded UDP fields so the rest of the UI
  // can render EGM state independent of the bridge that supplied it.
  const channel = data.egm_channels?.[0] || data.channels?.[0] || data;
  if (!channel || typeof channel !== "object") return null;
  const utilization = Number(channel.utilization_rate);
  const result = {
    egmState: channel.mci_state_label || labelEnum(channel.egm_client_state ?? channel.egm_state ?? channel.mci_state, {
      1: "undefined",
      2: "error",
      3: "stopped",
      4: "running",
    }),
    motors: channel.motor_state_label || labelEnum(channel.motor_state, {
      1: "undefined",
      2: "on",
      3: "off",
    }),
    rapid: channel.rapid_exec_state_label || labelEnum(channel.rapid_execution_state ?? channel.rapid_exec_state, {
      1: "undefined",
      2: "stopped",
      3: "running",
    }),
    convergence: channel.mci_convergence_met ?? channel.egm_convergence_met,
    utilization: Number.isFinite(utilization) ? utilization : null,
  };

  return Object.values(result).some((value) => value !== null && value !== undefined) ? result : null;
}

/**
 * Render persisted maintenance, event, and notification state.
 *
 * @param {object} summary Backend summary response.
 * @returns {void}
 */
function renderMaintenanceSummary(summary) {
  if (!summary) return;
  maintenanceHealthScoreEl.textContent = String(summary.health_score ?? 100);
  jointDistanceValueEl.textContent = `${(summary.joint_distance_rad || 0).toFixed(1)} rad`;
  nearLimitValueEl.textContent = `${(summary.near_limit_seconds || 0).toFixed(1)} s`;
  directionChangesValueEl.textContent = String(summary.direction_changes || 0);
  maintenanceMaxVelocityEl.textContent = `${(summary.max_velocity_rad_s || 0).toFixed(2)} rad/s`;
  utilizationValueEl.textContent = Number.isFinite(summary.utilization_max) && summary.utilization_max > 0
    ? `${summary.utilization_max.toFixed(1)} %`
    : utilizationValueEl.textContent || "-";
  if (state.graphWindow === "live") {
    // In live mode the periodic summary acts as another sample; historical
    // graph windows replace complete series through refreshGraphHistory().
    charts.maintenanceHealth.push(summary.health_score ?? 100);
    charts.axisWear.setValues((summary.axis || []).map((axis) => axis.wear_score || 0), { max: 100 });
  }

  axisWearListEl.innerHTML = "";
  const axisRows = summary.axis?.length ? summary.axis : Array.from({ length: 6 }, (_, index) => ({
    axis: index + 1,
    wear_score: 0,
    distance_rad: 0,
    direction_changes: 0,
    near_limit_seconds: 0,
  }));
  for (const axis of axisRows) {
    const score = Math.round(axis.wear_score || 0);
    const row = document.createElement("div");
    row.className = "axis-wear-item";
    row.innerHTML = `
      <div>
        <strong>${t("Achse {number}", { number: axis.axis })}</strong>
        <span>${t("{distance} rad Weg · {changes} Richtungswechsel", {
          distance: (axis.distance_rad || 0).toFixed(1),
          changes: axis.direction_changes || 0,
        })}</span>
      </div>
      <div class="wear-bar"><span style="width: ${Math.min(100, score)}%"></span></div>
      <b>${score}</b>
    `;
    axisWearListEl.appendChild(row);
  }

  const events = summary.events || [];
  syncEventToasts(events, Boolean(summary.window));
  eventCountValueEl.textContent = `${events.length} Events`;
  maintenanceTimelineEl.innerHTML = "";
  if (!events.length) {
    maintenanceTimelineEl.innerHTML = `<p class="empty">${t("Keine Ereignisse im gewaehlten Zeitraum.")}</p>`;
  }
  for (const event of events) {
    const row = document.createElement("div");
    row.className = `timeline-item ${event.severity}`;
    const acknowledged = event.acknowledged_at ? `<span>${t("quittiert {time}", { time: formatTime(event.acknowledged_at) })}</span>` : "";
    row.innerHTML = `
      <div>
        <time>${formatTime(event.created_at)}</time>
        <strong>${event.title}</strong>
        <p>${event.detail}</p>
        ${acknowledged}
      </div>
      ${event.acknowledged_at ? "" : `<button type="button" data-ack-event="${event.id}">${t("Quittieren")}</button>`}
    `;
    maintenanceTimelineEl.appendChild(row);
  }

  const mailQueue = summary.mail_queue || [];
  mailQueueValueEl.textContent = String(mailQueue.length);
  mailQueueListEl.innerHTML = "";
  if (!mailQueue.length) {
    mailQueueListEl.innerHTML = `<p class="empty">${t("Keine Mail-Eintraege.")}</p>`;
  }
  for (const mail of mailQueue) {
    const row = document.createElement("div");
    row.className = `mail-item ${mail.status}`;
    row.innerHTML = `<strong>${mail.subject}</strong><span>${mail.status} · ${formatTime(mail.created_at)}</span>`;
    mailQueueListEl.appendChild(row);
  }

  const settings = summary.notification_settings || {};
  if (mailRecipientsEl && document.activeElement !== mailRecipientsEl) {
    mailRecipientsEl.value = "";
  }
  if (mailEnabledEl) {
    mailEnabledEl.checked = settings.mail_enabled !== false;
  }
  mailImmediateEl.checked = settings.immediate_critical !== false;
  mailDailyEl.checked = settings.daily_summary !== false;
  mailWeeklyEl.checked = settings.weekly_report !== false;
  renderMailRecipients(settings.all_recipients || []);
  mailSettingsStateEl.textContent = settings.smtp_configured
    ? (settings.mail_enabled === false ? t("pausiert") : settings.recipients ? t("aktiv") : t("Empfaenger fehlen"))
    : t("SMTP fehlt");
}

function syncEventToasts(events, shouldNotify) {
  if (!shouldNotify || !eventToastStackEl) return;
  const orderedEvents = [...events].sort((left, right) => (left.created_at || 0) - (right.created_at || 0));
  if (!state.eventToastsInitialized) {
    // First load can include old events, so seed the seen set before notifying
    // operators about only genuinely new events.
    for (const event of orderedEvents) {
      if (event.id !== undefined && event.id !== null) state.seenEventIds.add(String(event.id));
    }
    state.eventToastsInitialized = true;
    return;
  }
  for (const event of orderedEvents) {
    if (event.id === undefined || event.id === null) continue;
    const eventId = String(event.id);
    if (state.seenEventIds.has(eventId)) continue;
    state.seenEventIds.add(eventId);
    showEventToast(event);
  }
}

function showEventToast(event) {
  const toast = document.createElement("article");
  toast.className = `event-toast ${event.severity || "info"}`;
  const content = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = event.title || t("Neues Event");
  const detail = document.createElement("p");
  detail.textContent = event.detail || event.type || "";
  const meta = document.createElement("span");
  meta.textContent = `${event.severity || "info"} · ${formatTime(event.created_at)}`;
  content.append(title, detail, meta);

  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", t("Meldung schließen"));
  close.textContent = "×";
  close.addEventListener("click", () => toast.remove());
  toast.append(content, close);
  eventToastStackEl.appendChild(toast);
  window.setTimeout(() => toast.remove(), 14000);
}

function renderMailRecipients(recipients) {
  if (!mailRecipientListEl) return;
  mailRecipientListEl.innerHTML = "";
  if (!recipients.length) {
    mailRecipientListEl.innerHTML = `<p class="empty">${t("Noch keine Empfaenger gespeichert.")}</p>`;
    return;
  }
  for (const recipient of recipients) {
    const row = document.createElement("label");
    row.className = "mail-recipient-item";
    const email = document.createElement("strong");
    email.textContent = recipient.email;
    const stateLabel = document.createElement("span");
    stateLabel.textContent = recipient.subscribed ? t("abonniert") : t("deaktiviert");
    const switchBox = document.createElement("input");
    switchBox.type = "checkbox";
    switchBox.checked = recipient.subscribed;
    switchBox.dataset.mailRecipient = recipient.email;
    row.append(email, stateLabel, switchBox);
    mailRecipientListEl.appendChild(row);
  }
}

function openMailRecipientsModal() {
  if (!mailRecipientsModalEl) return;
  state.showMailRecipients = true;
  mailRecipientsModalEl.hidden = false;
  manageMailRecipientsEl?.setAttribute("aria-expanded", "true");
  closeMailRecipientsEl?.focus();
}

function closeMailRecipientsModal() {
  if (!mailRecipientsModalEl) return;
  state.showMailRecipients = false;
  mailRecipientsModalEl.hidden = true;
  manageMailRecipientsEl?.setAttribute("aria-expanded", "false");
  manageMailRecipientsEl?.focus();
}

async function refreshMaintenanceSummary() {
  try {
    const response = await fetch(`/api/history/summary?window=${encodeURIComponent(state.maintenanceWindow)}`);
    if (!response.ok) return;
    renderMaintenanceSummary(await response.json());
  } catch {
    // The dashboard still works in demo/offline mode without the history API.
  }
}

/**
 * Refresh live or historical chart data for the selected graph window.
 *
 * @returns {Promise<void>}
 */
async function refreshGraphHistory() {
  if (state.graphWindow === "live") {
    charts.jointActivity.push(state.currentJointVelocities);
    charts.jointPositions.setValues(state.jointPositions);
    await refreshMaintenanceSummary();
    return;
  }

  try {
    const response = await fetch(`/api/history/series?window=${encodeURIComponent(state.graphWindow)}`);
    if (!response.ok) return;
    const history = await response.json();
    const points = history.points || [];
    // History responses are sparse when an axis has no data, so normalize to
    // six slots to keep chart geometry stable.
    const axisPositions = Array.from({ length: 6 }, (_, index) => {
      const row = (history.axis_positions || []).find((item) => item.axis === index + 1);
      return row?.position_rad ?? 0;
    });
    const axisWear = Array.from({ length: 6 }, (_, index) => {
      const row = (history.axis_wear || []).find((item) => item.axis === index + 1);
      return row?.wear_score ?? 0;
    });

    const axisVelocitySeries = AXIS_ACTIVITY_LABELS.map((_, index) => {
      const row = (history.axis_velocity_series || []).find((item) => item.axis === index + 1);
      return row?.values || [];
    });

    charts.jointActivity.setSeries(axisVelocitySeries, {
      firstLabel: formatDateTime(points[0]?.time),
      lastLabel: formatDateTime(points.at(-1)?.time),
    });
    charts.rate.setSeries(points.map((point) => point.sample_rate_hz || 0), {
      firstLabel: formatDateTime(points[0]?.time),
      lastLabel: formatDateTime(points.at(-1)?.time),
    });
    charts.packetFlow.setSeries(points.map((point) => point.sample_rate_hz || 0), {
      firstLabel: formatDateTime(points[0]?.time),
      lastLabel: formatDateTime(points.at(-1)?.time),
    });
    charts.maintenanceHealth.setSeries(points.map((point) => point.health_score ?? 100), {
      firstLabel: formatDateTime(points[0]?.time),
      lastLabel: formatDateTime(points.at(-1)?.time),
    });
    charts.jointPositions.setValues(axisPositions, { labels: ["A1", "A2", "A3", "A4", "A5", "A6"] });
    charts.axisWear.setValues(axisWear, { max: 100, labels: ["J1", "J2", "J3", "J4", "J5", "J6"] });
  } catch {
    // Historical charts are optional; live data continues independently.
  }
}

async function saveMailSettings(event) {
  event.preventDefault();
  await persistMailSettings();
}

async function persistMailSettings() {
  const body = {
    recipients: mailRecipientsEl.value,
    mail_enabled: mailEnabledEl.checked,
    immediate_critical: mailImmediateEl.checked,
    daily_summary: mailDailyEl.checked,
    weekly_report: mailWeeklyEl.checked,
  };
  try {
    const response = await fetch("/api/settings/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      mailRecipientsEl.value = "";
      renderMaintenanceSummary({ notification_settings: await response.json(), axis: [], events: [], mail_queue: [] });
      await refreshMaintenanceSummary();
    }
  } catch {
    mailSettingsStateEl.textContent = t("Fehler");
  }
}

async function updateMailRecipient(email, subscribed) {
  try {
    const response = await fetch("/api/mail/recipients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, subscribed }),
    });
    if (response.ok) {
      renderMaintenanceSummary({ notification_settings: await response.json(), axis: [], events: [], mail_queue: [] });
      await refreshMaintenanceSummary();
    }
  } catch {
    mailSettingsStateEl.textContent = t("Fehler");
  }
}

async function sendTestMail() {
  testMailStateEl.textContent = t("sendet...");
  await persistMailSettings();
  try {
    const response = await fetch("/api/mail/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: mailRecipientsEl.value }),
    });
    if (!response.ok) {
      testMailStateEl.textContent = t("Fehler");
      return;
    }
    const result = await response.json();
    testMailStateEl.textContent = result.status === "sent"
      ? t("gesendet")
      : result.status === "needs_recipients"
        ? t("Empfaenger fehlt")
        : result.status === "smtp_missing"
          ? t("SMTP fehlt")
        : result.error
          ? t("SMTP Fehler")
          : result.status;
    await refreshMaintenanceSummary();
  } catch {
    testMailStateEl.textContent = t("Fehler");
  }
}

async function acknowledgeEvent(eventId) {
  await fetch(`/api/events/${eventId}/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acknowledged_by: "dashboard", comment: "" }),
  });
  await refreshMaintenanceSummary();
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

  // Use both velocity and position delta because some telemetry sources publish
  // one more reliably than the other.
  readyStateEl.textContent = hasFreshJointState && hasPositions ? "Ready" : "Waiting";
  setCardState(readyCardEl, hasFreshJointState && hasPositions ? "ok" : "warn");

  motionStateEl.textContent = moving ? t("Bewegt") : t("Steht");
  setCardState(motionCardEl, moving ? "ok" : "warn");
  state.currentMotionLabel = moving ? "In Bewegung" : "Steht";
  if (moving) {
    state.lastMovingAt = receivedAt;
    state.idleStartedAt = null;
    cycleStateValueEl.textContent = t("aktiv");
    cycleValueEl.textContent = t("Bewegung");
  } else {
    state.idleStartedAt ??= receivedAt;
    const idleSeconds = Math.max(0, receivedAt - state.idleStartedAt);
    idleValueEl.textContent = `${idleSeconds.toFixed(1)} s`;
    cycleStateValueEl.textContent = idleSeconds > 3 ? t("wartet") : t("bereit");
    cycleValueEl.textContent = state.lastMovingAt ? t("letzte Bewegung {age}", { age: formatAge(receivedAt - state.lastMovingAt) }) : "-";
  }

  updateLiveRate(receivedAt);
  state.previousJointPositions = [...(data.positions || [])];
  state.lastJointReceivedAt = receivedAt;
}

function renderJointPopover(detail) {
  const position = detail.position;
  const degrees = radToDeg(position);
  const effortField = Number.isFinite(detail.effort)
    ? `
      <div class="popover-field">
        <span>${t("Moment")}</span>
        <strong>${effortLabel(detail.effort)}</strong>
      </div>
    `
    : "";
  jointPopoverEl.innerHTML = `
    <div class="popover-head">
      <div>
        <span>${detail.topic}</span>
        <h3>${detail.displayName}</h3>
      </div>
      <button class="popover-close" type="button" aria-label="${t("Details schliessen")}">×</button>
    </div>
    <div class="popover-grid">
      <div class="popover-field">
        <span>${t("Achswinkel")}</span>
        <strong>${formatNumber(position)} rad</strong>
      </div>
      <div class="popover-field">
        <span>${t("Grad")}</span>
        <strong>${formatNumber(degrees, 1)} deg</strong>
      </div>
      <div class="popover-field">
        <span>${t("Geschwindigkeit")}</span>
        <strong>${velocityLabel(detail.velocity)}</strong>
      </div>
      ${effortField}
      <div class="popover-field">
        <span>${t("Normierter Weg")}</span>
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

/**
 * Merge topic freshness updates into the visible topic lists.
 *
 * @param {Array<object>} statusTopics Topic status rows from the backend.
 * @returns {void}
 */
function updateTopics(statusTopics = []) {
  for (const topic of statusTopics) {
    state.topics.set(topic.name, topic);
  }

  // Merge configured and observed names so the dashboard shows expected topics
  // that have not produced data yet alongside dynamically discovered topics.
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
    userSignalValueEl.textContent = t("kein Stream");
    dataQualityLabelEl.textContent = t("unterbrochen");
    if (jointTopic?.age_sec > 4) {
      motionStateEl.textContent = t("Kein Live-Datenstrom");
      setCardState(motionCardEl, "warn");
      state.currentMotionLabel = "Steht";
      twinStatusEl.textContent = t("letzte Pose");
      twinCanvasEl.classList.add("stale");
    }
  } else {
    twinCanvasEl.classList.remove("stale");
  }

  if (topicListEl) topicListEl.innerHTML = "";
  developerTopicListEl.innerHTML = "";

  if (allNames.size === 0) {
    const empty = `<p class="empty">${t("Noch keine Topics empfangen.")}</p>`;
    if (topicListEl) topicListEl.innerHTML = empty;
    developerTopicListEl.innerHTML = empty;
    return;
  }

  for (const name of allNames) {
    const topic = state.topics.get(name);
    const configured = state.configuredTopics.find((item) => item.name === name);
    const row = document.createElement("div");
    row.className = "topic-item";
    row.innerHTML = `
      <strong>${configured?.label || name}</strong>
      <span>${topic ? formatAge(topic.age_sec) : t("wartet")}</span>
    `;
    if (topicListEl) topicListEl.appendChild(row);

    const developerRow = document.createElement("div");
    developerRow.className = "topic-item";
    developerRow.innerHTML = `
      <div>
        <strong>${name}</strong>
        <small>${configured?.type || topic?.type || t("konfiguriert")}</small>
      </div>
      <span>${topic ? formatAge(topic.age_sec) : t("wartet")}</span>
    `;
    developerTopicListEl.appendChild(developerRow);
  }
}

function shouldUseJointTopic(topic) {
  // Feedback beats planned state for the twin; planned trajectories can be
  // ahead of the physical robot and should not drive the operator view.
  if (topic === "/egm/planned_joint_states") return false;
  if (!state.activeJointTopic) return topic === "/egm/feedback_joint_states" || topic === "/joint_states";
  if (state.activeJointTopic === "/joint_states" && topic === "/egm/feedback_joint_states") return true;
  return topic === state.activeJointTopic;
}

/**
 * Render joint-state telemetry and propagate it to charts, health, and the twin.
 *
 * @param {object} data Normalized JointState payload data.
 * @param {string} topic Source topic name.
 * @returns {void}
 */
function updateJointStates(data, topic = "/joint_states") {
  if (!shouldUseJointTopic(topic)) return;
  state.activeJointTopic = topic;
  const receivedAt = data.received_at ?? Date.now() / 1000;
  jointTimestampEl.textContent = data.header_stamp ? `ROS ${data.header_stamp.toFixed(3)}` : "-";
  developerJointTimestampEl.textContent = jointTimestampEl.textContent;
  jointListEl.innerHTML = "";
  developerJointListEl.innerHTML = "";

  if (!data.names?.length) {
    const empty = `<p class="empty">${t("Noch keine Joint-State-Daten.")}</p>`;
    jointListEl.innerHTML = empty;
    developerJointListEl.innerHTML = empty;
    return;
  }

  state.jointDetails = data.names.map((name, index) => {
    const position = data.positions?.[index] ?? 0;
    // The bar is a quick relative cue around +/- pi; exact values remain visible
    // in the numeric readout and popover.
    const normalized = Math.max(0, Math.min(100, ((position + Math.PI) / (Math.PI * 2)) * 100));
    return {
      index,
      name,
      displayName: displayJointName(name, index),
      position,
      velocity: data.velocities?.[index],
      effort: data.efforts?.[index],
      normalized,
      topic,
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
      <div class="joint-name" title="${detail.name}">${detail.displayName}</div>
      <div class="bar" aria-label="${detail.displayName} Position"><span style="width: ${detail.normalized}%"></span></div>
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
      <div class="joint-name" title="${detail.name}">${detail.displayName}</div>
      <div class="bar" aria-label="${detail.displayName} Position"><span style="width: ${detail.normalized}%"></span></div>
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
  // Demo samples arrive at 5 Hz, so the twin tweens between them; live data is
  // applied as-is to avoid adding display lag to real robot motion.
  twin.setJoints(state.jointPositions, data.demo ? DEMO_JOINT_INTERVAL_MS / 1000 : 0);
  twinStatusEl.textContent = t("synchron");
  twinJointCountEl.textContent = t("{count} Achsen", { count: data.names.length });
  updateJointWidgets(data);
  updateShowcaseStatus(data, receivedAt);
  const hasFreshEgmTcp = state.lastTcpPoseReceivedAt !== null && receivedAt - state.lastTcpPoseReceivedAt < 1.0;
  // Fresh Cartesian EGM pose wins over the rough joint-based estimate because it
  // reflects the controller's measured TCP state.
  const tcp = hasFreshEgmTcp ? currentTcpForHealth(data) : updateTcpPose(data, receivedAt);
  if (!hasFreshEgmTcp) {
    twinPoseLabelEl.textContent = "ROS2";
  }
  const quality = updateDataQuality(data, receivedAt);
  updateHealth(data, quality, tcp);
  refreshOpenJointPopover();
}

function previewPayload(payload) {
  const data = payload.data || {};
  if (payload.topic === "/egm/raw_input" && typeof data.data === "string") {
    try {
      return {
        ...payload,
        data: JSON.parse(data.data),
      };
    } catch {
      return payload;
    }
  }
  if (payload.type === "sensor_msgs/msg/JointState") {
    // JointState payloads can be large; trim the preview to the fields most
    // useful when debugging live motion.
    return {
      kind: payload.kind,
      topic: payload.topic,
      type: payload.type,
      received_at: payload.received_at,
      data: {
        names: data.names,
        positions: data.positions,
        velocities: data.velocities,
      },
    };
  }
  if (payload.type === "geometry_msgs/msg/PoseStamped") {
    return {
      kind: payload.kind,
      topic: payload.topic,
      type: payload.type,
      received_at: payload.received_at,
      data,
    };
  }
  return payload;
}

function shouldPreviewMessage(payload) {
  if (state.messagePreviewPaused) return false;
  const filter = state.messagePreviewFilter;
  if (filter !== "all" && filter !== "important" && payload.topic !== filter) return false;

  if (filter === "important") {
    const importantTopics = new Set([
      "/egm/state",
      "/egm/raw_input",
      "/egm/feedback_joint_states",
      "/egm/feedback_pose",
      "/joint_states",
    ]);
    if (!importantTopics.has(payload.topic)) return false;
  }

  const now = performance.now();
  const minIntervalMs = filter === "all" ? 1200 : 700;
  // Throttle preview writes so fast ROS topics do not make the developer panel
  // unreadable while charts continue to update at full speed.
  if (now - state.lastMessagePreviewAt < minIntervalMs) return false;
  state.lastMessagePreviewAt = now;
  return true;
}

function updateMessagePreview(payload) {
  if (!shouldPreviewMessage(payload)) return;
  messagePreviewEl.textContent = JSON.stringify(previewPayload(payload), null, 2);
  if (messagePreviewTopicEl) {
    messagePreviewTopicEl.textContent = payload.topic || "Raw JSON";
  }
}

/**
 * Dispatch one backend WebSocket message into the appropriate dashboard update.
 *
 * @param {object} payload Message from the dashboard WebSocket or demo stream.
 * @returns {void}
 */
function handleMessage(payload) {
  if (!payload.demo && payload.kind === "topic") {
    // Any real topic packet leaves passive demo mode; forced demo mode still
    // ignores live traffic for stable presentations.
    setLiveMode("ROS live");
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
    if (payload.demo && state.realDataReceived) return;
    rosStateEl.textContent = payload.demo ? "demo" : payload.ros_ok ? "online" : "offline";
    updateTopics(payload.topics || []);
    return;
  }

  if (payload.kind !== "topic") return;

  updatePacketFlow(payload.received_at ?? Date.now() / 1000);
  lastPacketEl.textContent = formatTime(payload.received_at);
  updateMessagePreview(payload);

  if (payload.type === "sensor_msgs/msg/JointState") {
    updateJointStates({ ...payload.data, received_at: payload.received_at, demo: payload.demo }, payload.topic);
  } else if (payload.type === "geometry_msgs/msg/PoseStamped" && payload.topic === "/egm/feedback_pose") {
    updateTcpPoseFromPoseStamped(payload.data, payload.received_at ?? Date.now() / 1000);
  } else if (payload.topic === "/egm/raw_input") {
    updateEgmState(payload.data);
  } else if (payload.topic === "/egm/state" || payload.type === "abb_egm_msgs/msg/EGMState") {
    updateEgmState(payload.data);
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

// Demo pick & place cell. Joint keyframes were solved offline for the
// CRB 15000-5/0.95 chain with the tool pointing straight down (A2+A3+A5 = pi/2);
// A1 selects the station, so hover/grip poses are shared by both stations.
const DEMO_JOINT_INTERVAL_MS = 200;
// Stations sit symmetric to the robot's front; the twin frames the camera on them.
const DEMO_STATION_A1 = { A: 1.1, B: -1.1 };
const DEMO_POSES = {
  home: [0, -0.375, 0.67, 0, 1.276, 0],
  hover: [0, 0.115, 0.635, 0, 0.821, 0],
  grip: [0, 0.375, 0.735, 0, 0.461, 0],
};
const DEMO_PAYLOAD_KG = 1.2;

function demoPose(name, station) {
  const pose = [...DEMO_POSES[name]];
  if (station) pose[0] = DEMO_STATION_A1[station];
  return pose;
}

function buildDemoCycle() {
  // One period moves the part A -> B and back B -> A, so the cell state at the
  // end of the period matches the start and the timeline can simply wrap.
  const segments = [];
  let previous = demoPose("home");
  let start = 0;
  for (const [from, to] of [["A", "B"], ["B", "A"]]) {
    // partStation is where the part rests while it is not held (null = in gripper).
    const steps = [
      { label: "Anfahrt Pick", pose: demoPose("hover", from), duration: 2.0, partStation: from },
      { label: "Absenken", pose: demoPose("grip", from), duration: 0.8, partStation: from },
      { label: "Greifen", pose: demoPose("grip", from), duration: 0.5, partStation: from },
      { label: "Anheben", pose: demoPose("hover", from), duration: 0.8, partStation: null },
      { label: "Transfer", pose: demoPose("hover", to), duration: 4.0, partStation: null },
      { label: "Absenken", pose: demoPose("grip", to), duration: 0.8, partStation: null },
      { label: "Ablegen", pose: demoPose("grip", to), duration: 0.5, partStation: null },
      { label: "Rückzug", pose: demoPose("hover", to), duration: 0.8, partStation: to },
      { label: "Home", pose: demoPose("home"), duration: 1.9, partStation: to },
      { label: "Warten", pose: demoPose("home"), duration: 0.8, partStation: to },
    ];
    for (const step of steps) {
      segments.push({ ...step, holding: step.partStation === null, from: previous, start, source: from });
      previous = step.pose;
      start += step.duration;
    }
  }
  return { segments, period: start };
}

const DEMO_CYCLE = buildDemoCycle();

/**
 * Sample the pick & place trajectory with a quintic (minimum-jerk) blend per
 * segment, so velocities start and end at zero like a real point-to-point move.
 *
 * @param {number} t Seconds since the demo started.
 */
function sampleDemoTrajectory(t) {
  const cycleIndex = Math.floor(t / DEMO_CYCLE.period);
  const local = t - cycleIndex * DEMO_CYCLE.period;
  const segment = DEMO_CYCLE.segments.findLast((candidate) => candidate.start <= local) ?? DEMO_CYCLE.segments[0];
  const u = Math.min(1, Math.max(0, (local - segment.start) / segment.duration));
  const blend = u * u * u * (10 - 15 * u + 6 * u * u);
  const blendRate = (30 * u * u * (1 - u) * (1 - u)) / segment.duration;
  const positions = segment.from.map((value, index) => value + (segment.pose[index] - value) * blend);
  const velocities = segment.from.map((value, index) => (segment.pose[index] - value) * blendRate);
  // Two transfers per period, so the operator-facing cycle counter counts both.
  const transferIndex = cycleIndex * 2 + (segment.source === "A" ? 1 : 2);
  return { positions, velocities, label: segment.label, holding: segment.holding, partStation: segment.partStation, transferIndex };
}

function demoEfforts(positions, velocities, holding) {
  // Rough static gravity load on A2/A3/A5 plus viscous friction; enough to make
  // the effort readouts react to reach and payload without a dynamics model.
  const [, a2, a3, , a5] = positions;
  const elbowReach = 0.444 * Math.sin(a2);
  const wristReach = elbowReach + 0.47 * Math.cos(a2 + a3);
  const toolReach = wristReach + 0.12 * Math.cos(a2 + a3 + a5);
  const payload = holding ? DEMO_PAYLOAD_KG : 0;
  const g = 9.81;
  const gravity = [
    0,
    g * (4.0 * elbowReach * 0.5 + 3.0 * wristReach * 0.6 + (0.8 + payload) * toolReach),
    g * (3.0 * (wristReach - elbowReach) * 0.6 + (0.8 + payload) * (toolReach - elbowReach)),
    0,
    g * (0.8 + payload) * (toolReach - wristReach),
    0,
  ];
  return gravity.map((value, index) => value + velocities[index] * 2.5);
}

function demoJointPayload(now) {
  const sample = sampleDemoTrajectory(now - state.demoStartedAt);
  const { positions, velocities } = sample;
  const efforts = demoEfforts(positions, velocities, sample.holding);
  state.demoSample = sample;

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
    "/egm/state": 0.08 + Math.abs(Math.sin(now * 0.8)) * 0.12,
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

function startDemoStream(force = false) {
  if (state.demoTimer || (state.realDataReceived && !force)) return;

  // The demo stream uses the same message dispatcher as real WebSocket data so
  // every widget exercises the production rendering path.
  state.demoStartedAt = Date.now() / 1000;
  state.configuredTopics = [
    { name: "/joint_states", type: "sensor_msgs/msg/JointState", label: "Joint States" },
    { name: "/tf", type: "tf2_msgs/msg/TFMessage", label: "TF" },
    { name: "/diagnostics", type: "diagnostic_msgs/msg/DiagnosticArray", label: "Diagnostics" },
    { name: "/egm/state", type: "abb/egm/RobotState", label: "EGM State" },
  ];
  rosStateEl.textContent = "demo";
  setConnection(true, t("Demo Daten"));
  demoModeButtonEl?.classList.add("active");
  updateTopics();

  const tick = () => {
    if (state.realDataReceived && !state.forceDemo) {
      stopDemoStream();
      return;
    }
    const now = Date.now() / 1000;
    state.demoSequence += 1;
    handleMessage(demoJointPayload(now));
    const sample = state.demoSample;
    cycleValueEl.textContent = `#${sample.transferIndex} ${t(sample.label)}`;
    twinPoseLabelEl.textContent = "Pick & Place";
    twin.setDemoCell({
      stations: { A: demoPose("grip", "A"), B: demoPose("grip", "B") },
      partStation: sample.partStation,
    });

    // Joints stream at 5 Hz for a smooth twin; slower topics keep their old pace.
    if (state.demoSequence % 3 !== 1) return;
    handleMessage(demoStatusPayload(now));
    handleMessage({
      demo: true,
      kind: "topic",
      topic: "/egm/state",
      type: "abb/egm/RobotState",
      label: "EGM State",
      received_at: now,
      data: {
        motor_state_label: "on",
        mci_state_label: "running",
        rapid_exec_state_label: "running",
        mci_convergence_met: true,
        utilization_rate: 42 + Math.sin(now * 0.4) * 8,
      },
    });

    if (state.demoSequence % 12 === 1) {
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
  state.demoTimer = setInterval(tick, DEMO_JOINT_INTERVAL_MS);
}

function connect() {
  // Reconnects stay simple because the server sends a snapshot immediately on
  // connection, rebuilding client state after any network gap.
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    if (!state.demoTimer) {
      setConnection(true, t("Verbunden"));
    }
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  });

  socket.addEventListener("message", (event) => {
    if (state.forceDemo) return;
    handleMessage(JSON.parse(event.data));
  });

  socket.addEventListener("close", () => {
    if (!state.demoTimer) {
      setConnection(false, t("Getrennt"));
    }
    state.reconnectTimer = setTimeout(connect, 1500);
  });

  socket.addEventListener("error", () => {
    if (!state.demoTimer) {
      setConnection(false, t("Fehler"));
    }
    socket.close();
  });
}

const waitingMarkup = `<p class="empty">${t("Warte auf ROS2-Daten...")}</p>`;
jointListEl.innerHTML = waitingMarkup;
if (topicListEl) topicListEl.innerHTML = waitingMarkup;
developerJointListEl.innerHTML = waitingMarkup;
developerTopicListEl.innerHTML = waitingMarkup;
twin.setJoints(state.jointPositions);
charts.jointPositions.setValues(state.jointPositions);
Object.values(charts).forEach((chart) => chart.draw());
connect();
refreshMaintenanceSummary();
refreshGraphHistory();
state.maintenanceTimer = setInterval(refreshMaintenanceSummary, 15000);
window.setTimeout(() => {
  if (state.forceDemo || (!state.realDataReceived && !state.lastJointReceivedAt)) {
    startDemoStream(state.forceDemo);
  }
}, 1200);

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchDashboard(tab.dataset.view));
});

demoModeButtonEl?.addEventListener("click", enableDemoMode);

messagePreviewFilterEl?.addEventListener("change", () => {
  state.messagePreviewFilter = messagePreviewFilterEl.value;
  state.lastMessagePreviewAt = 0;
  messagePreviewEl.textContent = "{}";
  if (messagePreviewTopicEl) messagePreviewTopicEl.textContent = t("wartet");
});

messagePreviewPauseEl?.addEventListener("click", () => {
  state.messagePreviewPaused = !state.messagePreviewPaused;
  messagePreviewPauseEl.classList.toggle("active", state.messagePreviewPaused);
  messagePreviewPauseEl.textContent = state.messagePreviewPaused ? t("Weiter") : "Pause";
});

maintenanceWindowEl?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-window]");
  if (!button) return;
  state.maintenanceWindow = button.dataset.window;
  maintenanceWindowEl.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  refreshMaintenanceSummary();
});

graphWindowEl?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-window]");
  if (!button) return;
  state.graphWindow = button.dataset.window;
  graphWindowEl.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  refreshGraphHistory();
});

mailSettingsFormEl?.addEventListener("submit", saveMailSettings);
sendTestMailEl?.addEventListener("click", sendTestMail);
mailEnabledEl?.addEventListener("change", () => persistMailSettings());
manageMailRecipientsEl?.addEventListener("click", openMailRecipientsModal);
closeMailRecipientsEl?.addEventListener("click", closeMailRecipientsModal);
mailRecipientsModalEl?.addEventListener("click", (event) => {
  if (event.target === mailRecipientsModalEl) {
    closeMailRecipientsModal();
  }
});
mailRecipientListEl?.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-mail-recipient]");
  if (!input) return;
  updateMailRecipient(input.dataset.mailRecipient, input.checked);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mailRecipientsModalEl && !mailRecipientsModalEl.hidden) {
    closeMailRecipientsModal();
  }
});

maintenanceTimelineEl?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-ack-event]");
  if (!button) return;
  acknowledgeEvent(button.dataset.ackEvent);
});

document.addEventListener("click", (event) => {
  if (!state.popoverPinned) return;
  const target = event.target;
  if (jointPopoverEl.contains(target) || target.closest?.(".joint-row")) return;
  hideJointPopover();
});

window.addEventListener("resize", refreshOpenJointPopover);
window.addEventListener("resize", () => Object.values(charts).forEach((chart) => chart.draw()));

// Live widgets pick up the new language on their next update; views that only
// render occasionally are redrawn right away.
window.uiTheme.onChange(() => {
  chartInk = readChartInk();
  charts.workspace.applyInk();
  twin.applyInk();
  Object.values(charts).forEach((chart) => chart.draw());
});

window.i18n.onChange(() => {
  charts.jointActivity.renderLegend();
  Object.values(charts).forEach((chart) => chart.draw());
  refreshOpenJointPopover();
  refreshMaintenanceSummary();
});

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
  // Draw in CSS pixels after allocating a high-DPI backing store; this keeps
  // chart math readable and text crisp.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawGrid(ctx, width, height, area = { left: 38, right: width - 14, top: 16, bottom: height - 30 }, yTicks = []) {
  ctx.strokeStyle = chartInk.grid;
  ctx.lineWidth = 1;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillStyle = chartInk.text;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let index = 0; index < 4; index += 1) {
    const ratio = index / 3;
    const y = area.top + (area.bottom - area.top) * ratio;
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.stroke();
    if (yTicks[index] !== undefined) {
      ctx.fillText(yTicks[index], area.left - 7, y);
    }
  }
  ctx.strokeStyle = chartInk.axis;
  ctx.beginPath();
  ctx.moveTo(area.left, area.top);
  ctx.lineTo(area.left, area.bottom);
  ctx.lineTo(area.right, area.bottom);
  ctx.stroke();
}

function niceTick(value) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/**
 * Build a multi-axis live/history line chart.
 *
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @param {HTMLElement} legendEl Interactive axis legend container.
 * @param {object} options Chart colors, labels, and sample limits.
 * @returns {object} Chart API with push, setSeries, and draw methods.
 */
function createAxisActivityChart(canvas, legendEl, options = {}) {
  const labels = options.labels || [];
  const colors = options.colors || [];
  const maxSamples = options.maxSamples || 60;
  const series = labels.map(() => []);
  const active = labels.map(() => true);
  let axisMeta = {};

  function renderLegend() {
    if (!legendEl) return;
    legendEl.innerHTML = "";
    labels.forEach((label, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `axis-legend-button${active[index] ? "" : " inactive"}`;
      button.style.setProperty("--axis-color", colors[index] || "#20c997");
      button.setAttribute("aria-pressed", String(active[index]));
      button.innerHTML = `<span class="axis-color-dot" aria-hidden="true"></span><span>${t(label.source, label.params)}</span>`;
      button.addEventListener("click", () => {
        const visibleCount = active.filter(Boolean).length;
        // First click isolates one axis; later clicks toggle axes while keeping
        // at least one visible series so the chart never renders empty.
        if (visibleCount === active.length) {
          active.fill(false);
          active[index] = true;
        } else {
          active[index] = !active[index];
          if (!active.some(Boolean)) active[index] = true;
        }
        renderLegend();
        draw();
      });
      legendEl.appendChild(button);
    });
  }

  function draw() {
    if (!canvas) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);

    const activeSeries = series.filter((_, index) => active[index]);
    const allValues = activeSeries.flat();
    const max = Math.max(0.001, ...allValues, options.fixedMax || 0);
    const left = 42;
    const right = width - 16;
    const top = 18;
    const bottom = height - 32;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, bottom - top);
    drawGrid(ctx, width, height, { left, right, top, bottom }, [niceTick(max), niceTick(max * 0.67), niceTick(max * 0.33), "0"]);

    ctx.fillStyle = chartInk.text;
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(options.yLabel || "", left, 3);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(axisMeta.firstLabel || t(options.xLabel || "Live"), left, height - 6);
    ctx.textAlign = "right";
    ctx.fillText(axisMeta.lastLabel || t("jetzt"), right, height - 6);

    series.forEach((values, axisIndex) => {
      if (!active[axisIndex]) return;
      const points = values.length ? values : [0];
      ctx.beginPath();
      points.forEach((value, pointIndex) => {
        const x = left + (plotWidth * pointIndex) / Math.max(1, points.length - 1);
        const y = bottom - (Math.max(0, value) / max) * plotHeight;
        if (pointIndex === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = colors[axisIndex] || "#20c997";
      ctx.lineWidth = 2.4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    });
  }

  renderLegend();

  return {
    push(nextValues) {
      labels.forEach((_, index) => {
        const value = Array.isArray(nextValues) ? nextValues[index] : nextValues;
        series[index].push(Number.isFinite(value) ? value : 0);
        while (series[index].length > maxSamples) series[index].shift();
      });
      axisMeta = {};
      draw();
    },
    setSeries(nextSeries, nextMeta = {}) {
      labels.forEach((_, index) => {
        const values = Array.isArray(nextSeries?.[index]) ? nextSeries[index] : [];
        series[index] = values.map((value) => (Number.isFinite(value) ? value : 0));
      });
      axisMeta = nextMeta;
      draw();
    },
    renderLegend,
    draw,
  };
}

/**
 * Build a single-series compact chart for rate, packet flow, or health.
 *
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @param {object} options Chart colors, labels, and fixed scale options.
 * @returns {object} Chart API with push, setSeries, and draw methods.
 */
function createSparkline(canvas, options = {}) {
  const values = [];
  const maxSamples = options.maxSamples || 60;
  const stroke = options.stroke || "#20c997";
  const fill = options.fill || "rgba(32, 201, 151, 0.12)";
  let axisMeta = {};

  function draw() {
    if (!canvas) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);

    const points = values.length ? values : [0];
    const max = options.fixedMax || Math.max(0.001, ...points);
    const left = 42;
    const right = width - 16;
    const top = 18;
    const bottom = height - 32;
    const plotWidth = Math.max(1, right - left);
    const plotHeight = Math.max(1, bottom - top);
    drawGrid(ctx, width, height, { left, right, top, bottom }, [niceTick(max), niceTick(max * 0.67), niceTick(max * 0.33), "0"]);

    ctx.fillStyle = chartInk.text;
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(options.yLabel || "", left, 3);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(axisMeta.firstLabel || t(options.xLabel || "Live"), left, height - 6);
    ctx.textAlign = "right";
    ctx.fillText(axisMeta.lastLabel || t("jetzt"), right, height - 6);

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
      axisMeta = {};
      draw();
    },
    setSeries(nextValues, nextMeta = {}) {
      values.splice(0, values.length, ...(nextValues || []).map((value) => (Number.isFinite(value) ? value : 0)));
      axisMeta = nextMeta;
      draw();
    },
    draw,
  };
}

/**
 * Build a compact bar chart for joint positions, freshness, or wear.
 *
 * @param {HTMLCanvasElement} canvas Target canvas.
 * @param {object} options Chart colors and labels.
 * @returns {object} Chart API with setValues and draw methods.
 */
function createBarChart(canvas, options = {}) {
  let values = [];
  let config = {};
  const color = options.color || "#20c997";
  const accent = options.accent || "#ff2a2a";

  function draw() {
    if (!canvas) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    ctx.clearRect(0, 0, width, height);

    const source = values.length ? values : [0];
    const maxAbs = config.max || Math.max(0.001, ...source.map((value) => Math.abs(value)));
    const left = 42;
    const right = width - 16;
    const top = 18;
    const bottom = height - 34;
    const zero = config.invert ? bottom : top + (bottom - top) / 2;
    const gap = 8;
    const barWidth = Math.max(10, (right - left - gap * (source.length - 1)) / source.length);
    drawGrid(ctx, width, height, { left, right, top, bottom }, config.invert ? [niceTick(maxAbs), niceTick(maxAbs * 0.67), niceTick(maxAbs * 0.33), "0"] : [niceTick(maxAbs), niceTick(maxAbs * 0.33), niceTick(-maxAbs * 0.33), niceTick(-maxAbs)]);

    ctx.fillStyle = chartInk.text;
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(config.yLabel || options.yLabel || "", left, 3);
    ctx.textBaseline = "alphabetic";

    source.forEach((value, index) => {
      const x = left + index * (barWidth + gap);
      const normalized = Math.min(1, Math.abs(value) / maxAbs);
      const barHeight = Math.max(3, normalized * (config.invert ? bottom - top : (bottom - top) / 2));
      const y = config.invert ? bottom - barHeight : value >= 0 ? zero - barHeight : zero;
      ctx.fillStyle = index % 2 === 0 ? color : accent;
      ctx.globalAlpha = config.invert ? Math.max(0.25, 1 - normalized * 0.7) : 0.9;
      ctx.fillRect(x, y, barWidth, barHeight);
      ctx.globalAlpha = 1;
      const label = config.labels?.[index] || options.labels?.[index];
      if (label) {
        ctx.fillStyle = chartInk.text;
        ctx.textAlign = "center";
        ctx.fillText(label, x + barWidth / 2, height - 7);
      }
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

/**
 * Build the interactive TCP workspace map.
 *
 * @param {HTMLCanvasElement} canvas Target WebGL canvas.
 * @returns {object} Map API with setPose and draw methods.
 */
function createWorkspaceMap(canvas) {
  if (!canvas) return { setPose() {}, applyInk() {}, draw() {} };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 10);
  const target = new THREE.Vector3(0, 0.42, 0);
  const cameraState = { yaw: -0.72, pitch: 0.48, radius: 2.45 };
  const trail = [];

  scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x101217, 2.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(2, 3, 2);
  scene.add(keyLight);

  // The map sits on the panel background, so its grid follows the page theme.
  const WORKSPACE_INK = {
    dark: { gridCenter: 0x334050, grid: 0x27313d, ring: 0x3a4350 },
    light: { gridCenter: 0xa9b4c2, grid: 0xcfd6df, ring: 0xb7c1cd },
  };
  let grid = null;
  const ringMaterial = new THREE.LineBasicMaterial({ color: WORKSPACE_INK.dark.ring, transparent: true, opacity: 0.7 });

  function applyInk() {
    const ink = WORKSPACE_INK[window.uiTheme.theme] || WORKSPACE_INK.dark;
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
    }
    // GridHelper bakes its colors into vertex colors, so it is rebuilt.
    grid = new THREE.GridHelper(2.4, 12, ink.gridCenter, ink.grid);
    scene.add(grid);
    ringMaterial.color.setHex(ink.ring);
  }
  applyInk();

  for (const radius of [0.35, 0.7, 1.05]) {
    const points = [];
    for (let index = 0; index <= 96; index += 1) {
      const angle = (index / 96) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 0.006, Math.sin(angle) * radius));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), ringMaterial));
  }

  const axisMaterial = new THREE.LineBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.58 });
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.1, 0.012, 0),
    new THREE.Vector3(1.1, 0.012, 0),
  ]), axisMaterial));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.012, -1.1),
    new THREE.Vector3(0, 0.012, 1.1),
  ]), axisMaterial));

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.035, 32),
    new THREE.MeshStandardMaterial({ color: 0x5cc8ff, emissive: 0x092a36, roughness: 0.46 }),
  );
  base.position.y = 0.018;
  scene.add(base);

  const tcpMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 28, 16),
    new THREE.MeshStandardMaterial({ color: 0x20c997, emissive: 0x063a2d, roughness: 0.38 }),
  );
  tcpMarker.visible = false;
  scene.add(tcpMarker);

  const trajectoryLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x20c997, transparent: true, opacity: 0.86 }),
  );
  scene.add(trajectoryLine);

  const heightLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x9da6b2, transparent: true, opacity: 0.54 }),
  );
  heightLine.visible = false;
  scene.add(heightLine);

  const headingLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffbd4a, transparent: true, opacity: 0.95 }),
  );
  headingLine.visible = false;
  scene.add(headingLine);

  function poseToVector(nextPose) {
    // Convert ROS x/y/z into the dashboard's x/up/z scene coordinates so the
    // map matches the visual orientation of the digital twin.
    return new THREE.Vector3(nextPose.x, Math.max(0.02, nextPose.z), -nextPose.y);
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

  function draw() {
    resize();
    updateCamera();
    renderer.render(scene, camera);
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
    cameraState.pitch = Math.max(0.08, Math.min(1.22, cameraState.pitch + dy * 0.006));
    draw();
  });

  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      cameraState.radius = Math.max(1.35, Math.min(4.2, cameraState.radius + event.deltaY * 0.0018));
      draw();
    },
    { passive: false },
  );

  return {
    setPose(nextPose) {
      if (!Number.isFinite(nextPose.x) || !Number.isFinite(nextPose.y) || !Number.isFinite(nextPose.z)) return;
      const current = poseToVector(nextPose);
      trail.push(current.clone());
      while (trail.length > 180) trail.shift();

      tcpMarker.visible = true;
      heightLine.visible = true;
      headingLine.visible = true;
      tcpMarker.position.copy(current);
      trajectoryLine.geometry.dispose();
      trajectoryLine.geometry = new THREE.BufferGeometry().setFromPoints(trail);
      heightLine.geometry.dispose();
      heightLine.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(current.x, 0.018, current.z),
        current,
      ]);

      const yaw = Number.isFinite(nextPose.yaw) ? nextPose.yaw : 0;
      const heading = new THREE.Vector3(Math.cos(yaw) * 0.18, 0, -Math.sin(yaw) * 0.18);
      headingLine.geometry.dispose();
      headingLine.geometry = new THREE.BufferGeometry().setFromPoints([current, current.clone().add(heading)]);
      draw();
    },
    applyInk,
    draw,
  };
}

/**
 * Build the interactive GoFa digital twin.
 *
 * @param {HTMLCanvasElement} canvas Target WebGL canvas.
 * @param {object} options Optional callbacks for model loading state.
 * @returns {object} Twin API with setJoints method.
 */
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

  const hemiLight = new THREE.HemisphereLight(0xe8f3ff, 0x101217, 2.3);
  scene.add(hemiLight);
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(2.5, 4, 3);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x38c6a3, 1.3);
  rimLight.position.set(-3, 2, -2);
  scene.add(rimLight);

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.04, 96), materials.floor);
  floor.position.y = -0.03;
  root.add(floor);

  let grid = null;

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
    // ROS uses z-up with y lateral; the Three.js scene uses y-up, so every mesh
    // and joint pivot passes through the same coordinate conversion.
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
    // Load the real STL visual meshes when available; the procedural arm above
    // stays as a deterministic fallback for offline or packaging issues.
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

  const tween = { from: [], to: [], start: 0, duration: 0 };
  let renderedJoints = [];

  function applyJoints(values) {
    renderedJoints = [...values];
    activeAxes.forEach((axis, index) => {
      const value = values[index] ?? 0;
      axis.group.rotation.set(0, 0, 0);
      axis.group.rotation[axis.axis] = value * axis.sign + axis.offset;
    });
  }

  function setJoints(values, transitionSec = 0) {
    tween.from = renderedJoints.length ? renderedJoints : [...values];
    tween.to = [...values];
    tween.start = performance.now() / 1000;
    tween.duration = transitionSec;
    if (!transitionSec) applyJoints(tween.to);
  }

  function updateTween() {
    if (!tween.duration) return;
    const u = Math.min(1, (performance.now() / 1000 - tween.start) / tween.duration);
    applyJoints(tween.to.map((value, index) => (tween.from[index] ?? value) + (value - (tween.from[index] ?? value)) * u));
    if (u >= 1) tween.duration = 0;
  }

  // Demo work cell: two stations and one part that rides on the TCP while held.
  const PART_SIZE = 0.1;
  const cellMaterials = {
    stand: new THREE.MeshStandardMaterial({ color: 0x323b47, roughness: 0.7, metalness: 0.15 }),
    top: new THREE.MeshStandardMaterial({ color: 0x5b6878, roughness: 0.5, metalness: 0.2 }),
    marker: new THREE.MeshStandardMaterial({ color: 0x38c6a3, emissive: 0x0f4f43, roughness: 0.45 }),
    part: new THREE.MeshStandardMaterial({ color: 0xffbd4a, emissive: 0x3a2400, roughness: 0.4, metalness: 0.1 }),
  };
  const cell = new THREE.Group();
  cell.visible = false;
  root.add(cell);

  // Stage colors follow the page theme; the robot materials stay the same.
  const TWIN_INK = {
    dark: { floor: 0x1b222c, gridCenter: 0x334050, grid: 0x27313d, hemiGround: 0x101217, rim: 1.3, stand: 0x323b47, top: 0x5b6878 },
    light: { floor: 0xb9c2cd, gridCenter: 0x93a0b0, grid: 0xb0bac6, hemiGround: 0xb6c0cb, rim: 0.5, stand: 0x76828f, top: 0x9ba6b3 },
  };

  function applyInk() {
    const ink = TWIN_INK[window.uiTheme.theme] || TWIN_INK.dark;
    materials.floor.color.setHex(ink.floor);
    hemiLight.groundColor.setHex(ink.hemiGround);
    rimLight.intensity = ink.rim;
    cellMaterials.stand.color.setHex(ink.stand);
    cellMaterials.top.color.setHex(ink.top);
    if (grid) {
      root.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
    }
    // GridHelper bakes its colors into vertex colors, so it is rebuilt.
    grid = new THREE.GridHelper(2.8, 14, ink.gridCenter, ink.grid);
    root.add(grid);
  }
  applyInk();
  const part = new THREE.Mesh(new THREE.BoxGeometry(PART_SIZE, PART_SIZE, PART_SIZE), cellMaterials.part);
  part.castShadow = true;
  cell.add(part);
  const cellState = { config: null, modelKey: null, stations: {} };
  const tcpWorld = new THREE.Vector3();

  function tcpWorldPositionFor(values) {
    const restore = renderedJoints;
    applyJoints(values);
    root.updateMatrixWorld(true);
    const position = activeTool.getWorldPosition(new THREE.Vector3());
    applyJoints(restore);
    return position;
  }

  function buildStations() {
    // Stations sit exactly under the TCP grip pose, so the part is handed over
    // without a visible jump regardless of which arm model is active.
    cell.children.filter((child) => child !== part).forEach((child) => cell.remove(child));
    cellState.stations = {};
    for (const [name, joints] of Object.entries(cellState.config.stations)) {
      const grip = tcpWorldPositionFor(joints);
      const topY = Math.max(0.05, grip.y - PART_SIZE);
      const station = new THREE.Group();
      station.position.set(grip.x, 0, grip.z);
      station.rotation.y = Math.atan2(grip.x, grip.z);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.2, topY - 0.02, 0.2), cellMaterials.stand);
      stand.position.y = (topY - 0.02) / 2;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.3), cellMaterials.top);
      top.position.y = topY - 0.01;
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.004, 0.02), cellMaterials.marker);
      marker.position.set(0, topY + 0.002, 0.14);
      station.add(stand, top, marker);
      cell.add(station);
      cellState.stations[name] = new THREE.Vector3(grip.x, topY + PART_SIZE / 2, grip.z);
    }
    cellState.modelKey = activeTool.uuid;
    if (!cellState.framed) {
      // Face the cell once when the demo starts; the operator can orbit freely after.
      const center = Object.values(cellState.stations).reduce((sum, point) => sum.add(point), new THREE.Vector3());
      cameraState.yaw = Math.atan2(center.x, center.z);
      cameraState.pitch = 0.48;
      cameraState.radius = 3.1;
      cellState.framed = true;
    }
  }

  function setDemoCell(config) {
    if (!config) cellState.framed = false;
    cellState.config = config;
    cell.visible = Boolean(config);
  }

  function updateCell() {
    if (!cellState.config) return;
    if (cellState.modelKey !== activeTool.uuid) {
      // The mesh model resets the camera when it finishes loading, so re-frame.
      cellState.framed = false;
      buildStations();
    }
    const resting = cellState.stations[cellState.config.partStation];
    if (resting) {
      part.position.copy(resting);
    } else {
      activeTool.getWorldPosition(tcpWorld);
      part.position.set(tcpWorld.x, tcpWorld.y - PART_SIZE / 2, tcpWorld.z);
    }
    part.rotation.y = Math.atan2(part.position.x, part.position.z);
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
    updateTween();
    activeTool.rotation.y += 0.006;
    root.updateMatrixWorld(true);
    updateCell();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  animate();

  return { setJoints, setDemoCell, applyInk };
}
