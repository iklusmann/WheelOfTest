import {
  TASKS,
  TEAM_MAPPING,
  acceptInitialResult,
  canAcceptInitialResult,
  canComplain,
  canReceiveTask,
  canStartSpin1,
  canStartSpin2,
  chooseAssignmentPair,
  commitSpin,
  createRoom,
  getAssignmentCandidates,
  getEligiblePairs,
  recordComplaint
} from "./logic.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const TEAMS = ["AF", "CYD", "PB"];
const TEAM_NAMES = { AF: "Team AF", CYD: "Team CYD", PB: "Team PB" };
const WHEEL_COLORS = ["#eaa0c9", "#9f92e6", "#82ceb8", "#78bfe8", "#f0cf73", "#f1a782"];
const MAX_NAME_LENGTH = 35;
const ICE_GATHERING_TIMEOUT_MS = 12000;
const SPIN_DURATION_MS = 4900;

let roomCode = null;
let isHost = false;
let room = null;
let guestProfile = null;
let guestRoomSnapshot = null;
let guestAnswerCode = "";
let guestConnectionStatus = "Not connected — paste a fresh offer code from the host.";
let guestPeer = null;
let guestDataChannel = null;
let guestConnected = false;
let remoteSpinPromise = null;
let pendingSnapshot = null;
let hostConnections = new Map();
let pendingOffers = [];
let displayWheelPairs = [];
let wheelRotationDegrees = 0;
let isSpinning = false;
let celebrateNextRender = false;
let toastTimeout = null;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function shorten(value, max = 16) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function makeId(prefix = "id") {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
  else for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function validRoomCode(value) {
  return /^[A-Z0-9]{6}$/.test(String(value ?? "").trim().toUpperCase());
}

function currentRoomUrl(code = roomCode) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (code) url.searchParams.set("room", code);
  return url.toString();
}

function hostStorageKey(code) { return `wheel-of-test:host:${code}`; }
function guestStorageKey(code) { return `wheel-of-test:guest:${code}`; }

function showToast(message, kind = "info") {
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.hidden = false;
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => { toast.hidden = true; }, 4200);
}

async function copyText(value, successMessage = "Copied to clipboard.") {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const helper = document.createElement("textarea");
      helper.value = value;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      const copied = document.execCommand("copy");
      helper.remove();
      if (!copied) throw new Error("Clipboard access is unavailable. Select and copy the text manually.");
    }
    showToast(successMessage, "success");
  } catch (error) {
    showToast(error?.message || "Copy failed. Select the text and copy it manually.", "error");
  }
}

function safeReadStorage(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.warn("WheelOfTest storage read failed", error);
    return null;
  }
}

function persistRoom() {
  if (!isHost || !room) return;
  try {
    localStorage.setItem(hostStorageKey(room.roomCode), JSON.stringify(room));
  } catch (error) {
    showToast("Could not save the room in this browser. Check local storage availability.", "error");
    console.error("WheelOfTest room persistence failed", error);
  }
}

function touchRoom() {
  if (!room) return;
  room.version = (Number(room.version) || 0) + 1;
  room.updatedAt = Date.now();
  persistRoom();
}

function persistGuestProfile() {
  if (!roomCode || !guestProfile) return;
  try {
    localStorage.setItem(guestStorageKey(roomCode), JSON.stringify(guestProfile));
  } catch (error) {
    console.warn("WheelOfTest guest profile persistence failed", error);
  }
}

function resetPeerState() {
  for (const connection of hostConnections.values()) {
    try { connection.channel?.close(); } catch { /* already closed */ }
    try { connection.pc?.close(); } catch { /* already closed */ }
  }
  hostConnections = new Map();
  pendingOffers = [];
  try { guestDataChannel?.close(); } catch { /* already closed */ }
  try { guestPeer?.close(); } catch { /* already closed */ }
  guestPeer = null;
  guestDataChannel = null;
  guestConnected = false;
  remoteSpinPromise = null;
  pendingSnapshot = null;
}

function navigateToRoom(code) {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!validRoomCode(normalized)) {
    showToast("Room codes contain exactly six letters or numbers.", "error");
    return;
  }
  history.pushState({}, "", currentRoomUrl(normalized));
  loadRoute();
}

function createNewRoom() {
  resetPeerState();
  const code = makeRoomCode();
  roomCode = code;
  isHost = true;
  guestRoomSnapshot = null;
  guestProfile = null;
  guestAnswerCode = "";
  guestConnectionStatus = "Not connected — paste a fresh offer code from the host.";
  room = createRoom(code, makeId("host"));
  displayWheelPairs = [];
  wheelRotationDegrees = 0;
  isSpinning = false;
  celebrateNextRender = false;
  history.pushState({}, "", currentRoomUrl(code));
  persistRoom();
  render();
}

function loadRoute() {
  const url = new URL(window.location.href);
  const candidateCode = String(url.searchParams.get("room") ?? "").trim().toUpperCase();
  resetPeerState();
  isSpinning = false;
  celebrateNextRender = false;
  room = null;
  guestRoomSnapshot = null;
  guestAnswerCode = "";
  if (!candidateCode) {
    isHost = false;
    roomCode = null;
    guestProfile = null;
    displayWheelPairs = [];
    renderLanding();
    return;
  }
  if (!validRoomCode(candidateCode)) {
    isHost = false;
    roomCode = null;
    guestProfile = null;
    renderLanding("That room code does not look valid. Enter a six-character code to continue.");
    return;
  }

  roomCode = candidateCode;
  const storedRoom = safeReadStorage(hostStorageKey(candidateCode));
  if (storedRoom && storedRoom.roomCode === candidateCode && Array.isArray(storedRoom.participants)) {
    isHost = true;
    room = storedRoom;
    room.maxSpins = 2;
    room.participants = room.participants.map((participant) => ({
      ...participant,
      connected: Boolean(participant.isHostTester)
    }));
    room.version = Number(room.version) || 0;
    persistRoom();
    displayWheelPairs = getAssignmentCandidates(room);
    guestProfile = null;
    render();
    return;
  }

  isHost = false;
  guestProfile = sanitizeStoredProfile(safeReadStorage(guestStorageKey(candidateCode)));
  guestConnectionStatus = "Not connected — the room code is only an identifier. Paste an offer code from the host.";
  displayWheelPairs = [];
  render();
}

function sanitizeStoredProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const name = String(profile.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
  const team = TEAMS.includes(profile.team) ? profile.team : "";
  if (!name || !team || !profile.id) return null;
  return {
    id: String(profile.id),
    name,
    team,
    android: Boolean(profile.android),
    ios: Boolean(profile.ios)
  };
}

function renderLanding(errorMessage = "") {
  app.innerHTML = `
    <section class="landing-grid">
      <div class="card hero-card">
        <p class="eyebrow">A little randomness, a lot of testing</p>
        <h1>Let the wheel<br>pick your <span class="hero-title-highlight">next test.</span></h1>
        <p class="subtle">A friendly QA roulette for teams. Gather your testers, keep assignments fair, and let WheelOfTest choose what gets tested next.</p>
        <div class="hero-bubble-row">
          <span class="bubble bubble-pink">🎯 Team-first matching</span>
          <span class="bubble bubble-mint">📱 Device-aware</span>
          <span class="bubble bubble-blue">🔁 One appeal spin</span>
        </div>
        <button class="button button-primary" type="button" data-action="create-room">✦ Create a test room</button>
        <div class="hero-art" aria-hidden="true">
          <span class="hero-art-spark">✧</span><div class="hero-art-wheel">✳</div><span class="hero-art-spark">✦</span>
        </div>
      </div>

      <div class="side-stack">
        <section class="card side-card">
          <p class="eyebrow">Already invited?</p>
          <h2>Join a test room</h2>
          <p class="subtle">Enter the six-character room code from your host. Because this app has no shared server, you will also need the host's WebRTC offer code to connect.</p>
          ${errorMessage ? `<p class="error-text" role="alert">${escapeHTML(errorMessage)}</p>` : ""}
          <form class="stack" data-form="enter-room">
            <div class="field">
              <label for="room-code-input">Room code</label>
              <input class="input" id="room-code-input" name="roomCode" placeholder="E.G. A7K2PQ" maxlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="off" required>
            </div>
            <button class="button button-soft button-full" type="submit">Open room →</button>
          </form>
        </section>

        <section class="card side-card">
          <p class="eyebrow">How it works</p>
          <h2>Three easy steps</h2>
          <ol class="steps-list">
            <li class="step-row"><span class="step-number">1</span><div class="step-copy"><strong>Make a room</strong><span>Share the room link and exchange a connection code with every tester.</span></div></li>
            <li class="step-row"><span class="step-number">2</span><div class="step-copy"><strong>Spin once</strong><span>The wheel picks a compatible task/developer pair, preferring the matching team.</span></div></li>
            <li class="step-row"><span class="step-number">3</span><div class="step-copy"><strong>Appeal if needed</strong><span>A complaint unlocks one final replacement spin. No complaint? Accept the first result.</span></div></li>
          </ol>
          <div class="limit-note" style="margin-top:18px"><strong>Quick heads-up:</strong> GitHub Pages stores no shared room data. The host must keep the room open, and direct peer connections may fail on some networks.</div>
        </section>
      </div>
    </section>`;
}

function render() {
  if (!roomCode) {
    renderLanding();
    return;
  }
  if (isHost && room) {
    renderRoomPage(room, true);
  } else {
    renderGuestPage();
  }
}

function roomStatusLabel(data) {
  if (data.status === "completed") return "Room finished";
  if (["result", "challenged"].includes(data.status) && data.spinsUsed === 1) return data.complaints.length ? "Appeal requested" : "First result";
  if (data.status === "challenged") return "Appeal requested";
  return "Waiting to spin";
}

function participantDeviceSummary(participant) {
  const labels = [];
  if (participant.android) labels.push("Android");
  if (participant.ios) labels.push("iOS");
  return labels.length ? labels.join(" · ") : "No phone selected";
}

function renderParticipant(participant, index) {
  const initials = String(participant.name || "?").trim().slice(0, 1).toUpperCase();
  const connected = Boolean(participant.connected);
  const team = TEAMS.includes(participant.team) ? participant.team : "?";
  return `
    <article class="participant">
      <div class="avatar avatar-${index % 5}" aria-hidden="true">${escapeHTML(initials)}</div>
      <div class="participant-main">
        <div class="participant-name-row">
          <span class="participant-name">${escapeHTML(participant.name)}</span>
          ${participant.isHostTester ? '<span class="host-badge">✦ Host</span>' : ""}
          <span class="team-badge team-${escapeHTML(team)}">${escapeHTML(team)}</span>
        </div>
        <div class="participant-meta">
          <span class="${participant.android || participant.ios ? "device-badge" : "device-badge device-missing"}">${participant.android ? "🤖 Android" : ""}${participant.android && participant.ios ? " · " : ""}${participant.ios ? " iOS" : ""}${!participant.android && !participant.ios ? "📵 No phone" : ""}</span>
          <span class="connection-badge ${connected ? "connection-connected" : ""}">${connected ? "● Connected" : "○ Disconnected"}</span>
        </div>
      </div>
    </article>`;
}

function renderHostTesterForm(data) {
  const alreadyJoined = data.participants.some((participant) => participant.isHostTester);
  if (alreadyJoined) {
    const own = data.participants.find((participant) => participant.isHostTester);
    return `<div class="invite-box"><p class="tiny">You are also in the tester pool as <strong>${escapeHTML(own.name)}</strong> (${escapeHTML(own.team)}). Your browser acts as the room host.</p></div>`;
  }
  return `
    <div class="invite-box">
      <h3>Join the draw yourself?</h3>
      <p class="tiny">The host can participate too. This local profile does not need a peer connection.</p>
      <form class="stack" data-form="host-participant">
        <div class="field"><label for="host-tester-name">Your name</label><input class="input" id="host-tester-name" name="name" maxlength="${MAX_NAME_LENGTH}" placeholder="e.g. Alex" autocomplete="name" required></div>
        ${renderDeviceChoices("host-tester", false, false)}
        ${renderTeamChoices("host-tester", "AF")}
        <button class="button button-soft button-full" type="submit">Add me as a tester</button>
      </form>
    </div>`;
}

function renderHostConnectionControls() {
  const records = pendingOffers.map((offer) => `
    <div class="connection-card">
      <div class="connection-card-head">
        <div><div class="connection-card-title">Connection ${escapeHTML(offer.shortId)}</div><div class="connection-card-status">${escapeHTML(offer.status)}</div></div>
        <span class="count-pill">P2P</span>
      </div>
      ${offer.code ? `<div class="code-output"><label class="field-label" for="offer-${escapeHTML(offer.id)}">1. Send this offer code to one tester</label><textarea class="textarea" id="offer-${escapeHTML(offer.id)}" readonly>${escapeHTML(offer.code)}</textarea><div class="row"><button class="button button-soft button-small" type="button" data-action="copy-offer" data-connection-id="${escapeHTML(offer.id)}">Copy offer code</button></div></div>` : `<p class="tiny">Preparing offer and gathering local network candidates…</p>`}
      <form class="stack" data-form="accept-answer" data-connection-id="${escapeHTML(offer.id)}">
        <div class="field"><label for="answer-${escapeHTML(offer.id)}">2. Paste the tester's answer code</label><textarea class="textarea" id="answer-${escapeHTML(offer.id)}" name="answerCode" placeholder="The tester sends their answer code back to you…" required></textarea></div>
        <button class="button button-primary button-full" type="submit" ${offer.code ? "" : "disabled"}>Accept answer &amp; connect</button>
      </form>
      ${offer.error ? `<p class="error-text" role="alert">${escapeHTML(offer.error)}</p>` : ""}
    </div>`).join("");
  return `
    <div class="invite-box">
      <div class="split"><div><h3>Peer connection setup</h3><p class="tiny">Create a separate offer for each tester. Finish one exchange before starting another if you prefer a simpler handoff.</p></div></div>
      <ol class="steps-list">
        <li class="step-row"><span class="step-number">1</span><div class="step-copy"><strong>Create an offer</strong><span>Copy the offer code and send it with the room link to one tester.</span></div></li>
        <li class="step-row"><span class="step-number">2</span><div class="step-copy"><strong>Accept their answer</strong><span>The tester sends an answer code back. Paste it below to connect.</span></div></li>
      </ol>
      <button class="button button-soft button-full" type="button" data-action="create-offer" style="margin-top:14px">＋ Create connection code</button>
      ${records}
      <div class="warning-banner">No signaling, STUN, or TURN server is used. The room link and code do not carry room data. Direct connectivity is often limited across different networks, VPNs, and strict firewalls.</div>
    </div>`;
}

function renderParticipantsPanel(data, hostMode) {
  const connectedCount = data.participants.filter((participant) => participant.connected).length;
  const people = data.participants.length
    ? data.participants.map(renderParticipant).join("")
    : `<div class="empty-state"><div class="empty-state-icon">🪴</div><strong>It's quiet in here… for now.</strong><p class="tiny" style="margin:7px 0 0">Share the room details and invite your testers to join.</p></div>`;
  return `
    <section class="card panel participants-panel">
      <div class="panel-header"><div><p class="eyebrow">The lobby</p><h2>Testers in the room</h2><p class="panel-caption">Everyone's team and phone availability at a glance.</p></div><span class="count-pill" title="Connected participants">${connectedCount} online</span></div>
      <div class="participant-list">${people}</div>
      ${hostMode ? renderHostTesterForm(data) : ""}
      ${hostMode ? renderHostConnectionControls() : `
        <div class="invite-box"><p class="tiny">Room participants update when your direct connection to the host is live. A saved profile is only a convenience; it is not a live connection.</p></div>`}
      ${renderInviteBox(hostMode)}
    </section>`;
}

function renderInviteBox(hostMode) {
  if (!hostMode) return "";
  return `
    <div class="invite-box">
      <p class="eyebrow">Invite your crew</p>
      <h3>Room link</h3>
      <div class="room-code">${escapeHTML(roomCode)}</div>
      <p class="invite-url" style="margin:9px 0 0">${escapeHTML(currentRoomUrl())}</p>
      <div class="invite-actions"><button class="button button-soft button-small" type="button" data-action="copy-invite">Copy room link</button><button class="button button-soft button-small" type="button" data-action="copy-room-code">Copy code</button></div>
    </div>`;
}

function serializePair(pair) {
  return {
    taskId: pair.task.id,
    taskWhat: pair.task.what,
    theme: pair.task.theme,
    device: pair.task.device,
    platform: pair.task.platform,
    taskTeam: pair.task.team,
    participantId: pair.participant.id,
    participantName: pair.participant.name,
    participantTeam: pair.participant.team,
    android: Boolean(pair.participant.android),
    ios: Boolean(pair.participant.ios)
  };
}

function normalizeWheelPair(pair) {
  if (pair?.task && pair?.participant) return serializePair(pair);
  return pair;
}

function wheelPairLabel(pair) {
  const normalized = normalizeWheelPair(pair);
  const team = normalized?.taskTeam ? ` · ${normalized.taskTeam}` : "";
  return `${shorten(normalized?.participantName || "Tester", 13)}${team}`;
}

function renderWheelMarkup() {
  return `
    <div class="wheel-wrap"><div class="wheel-stage" aria-label="Assignment wheel">
      <div class="wheel-pointer" aria-hidden="true"></div>
      <div class="wheel" id="assignment-wheel" role="img" aria-label="A colorful task assignment wheel"><div class="wheel-hub">LET'S<br>TEST!</div></div>
    </div></div>`;
}

function renderWheelPanel(data, hostMode) {
  const candidates = getAssignmentCandidates(data);
  const connected = data.participants.filter((participant) => participant.connected).length;
  const canSpinOne = hostMode && !isSpinning && canStartSpin1(data);
  const canSpinTwo = hostMode && !isSpinning && canStartSpin2(data);
  const hasFirstResult = data.spinsUsed === 1;
  const spinLabel = hasFirstResult ? "🔁 Resolve complaint" : "🎡 Spin 1 · Pick a task";
  const spinButtonClass = hasFirstResult ? "button button-soft" : "button button-primary";
  let hint = "The wheel favors a task from a connected tester's own team when a compatible match exists.";
  if (!connected) hint = "Connect at least one tester before spinning. Only live, connected participants can be selected.";
  else if (!candidates.length && data.status === "waiting") hint = "No compatible task/developer pair is available. Check connections and phone availability.";
  else if (hasFirstResult && data.complaints.length && !candidates.length) hint = "No compatible unused task remains for the replacement. Keep the room open; no invalid assignment will be made.";
  else if (data.status === "completed") hint = "The room is complete. Create a new room to run another assignment.";
  else if (hasFirstResult && !data.complaints.length) hint = "The first result is provisional. A connected tester can complain to unlock one replacement spin.";
  else if (canStartSpin2(data)) hint = "Complaint received. The host can make one replacement spin, and the original task cannot repeat.";

  return `
    <section class="card panel wheel-panel">
      <div class="panel-header"><div><p class="eyebrow">The main event</p><h2>Ready to test?</h2><p class="panel-caption">Every segment represents a compatible task/developer pair.</p></div><span class="count-pill">${candidates.length} pairs</span></div>
      ${renderWheelMarkup()}
      <p class="wheel-hint">${escapeHTML(hint)}</p>
      <div class="spin-actions">
        ${hostMode && data.status !== "completed" ? `<button class="${spinButtonClass}" type="button" data-action="spin" ${canSpinOne || canSpinTwo ? "" : "disabled"}>${escapeHTML(spinLabel)}</button>` : ""}
        ${hostMode && data.status === "completed" ? `<button class="button button-soft" type="button" data-action="create-room">＋ Create a new room</button>` : ""}
      </div>
      <div class="spin-counter">Spins used: <strong>${data.spinsUsed}</strong> / ${data.maxSpins ?? 2} · Remaining tasks: <strong>${Math.max(0, TASKS.length - data.usedTaskIds.length)}</strong></div>
      <div class="team-hint">✦ Soft preference: match the task's team first</div>
      ${hostMode && ["result", "challenged"].includes(data.status) && data.complaints.length && !candidates.length ? `<div class="state-line warning" style="margin-top:14px;text-align:left">No eligible replacement remains. Spin 2 stays disabled so device compatibility is never bypassed.</div>` : ""}
    </section>`;
}

function fmtDate(timestamp) {
  if (!timestamp) return "Time not recorded";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function currentAssignment(data) {
  return data.assignments.find((assignment) => assignment.isFinal) ?? data.assignments[data.assignments.length - 1] ?? null;
}

function assignmentState(assignment) {
  if (assignment.isChallenged || assignment.resultStatus === "challenged") return { className: "challenged", text: "Challenged" };
  if (assignment.isFinal || assignment.resultStatus === "final") return { className: "final", text: "Final assignment" };
  return { className: "provisional", text: "Provisional result" };
}

function renderConfetti() {
  const colors = ["#f1a5ce", "#a899ec", "#83d6bf", "#8ccdf1", "#ffdb8c", "#ffb89e"];
  return `<div class="confetti" aria-hidden="true">${Array.from({ length: 17 }, (_, index) => `<span style="left:${(index * 17 + 3) % 100}%;background:${colors[index % colors.length]};animation-delay:${(index % 6) * 45}ms;transform:rotate(${index * 21}deg)"></span>`).join("")}</div>`;
}

function renderResultPanel(data, hostMode, celebrate = false) {
  const assignment = currentAssignment(data);
  const localParticipantId = hostMode
    ? data.participants.find((participant) => participant.isHostTester)?.id
    : guestProfile?.id;
  const canLocalComplain = !hostMode && guestConnected && canComplain(data, localParticipantId);
  const canHostTesterComplain = hostMode && localParticipantId && canComplain(data, localParticipantId);
  const canResolve = hostMode && canStartSpin2(data) && !isSpinning;
  const state = assignment ? assignmentState(assignment) : null;
  let notice = "No assignment yet. Once a tester connects, the host can spin the wheel.";
  let noticeKind = "";
  if (assignment && ["result", "challenged"].includes(data.status)) {
    notice = data.complaints.length ? `Complaint received from ${data.complaints.length} tester${data.complaints.length === 1 ? "" : "s"}. The host may resolve it with Spin 2.` : "The first result is provisional. Accept it to finish, or let a tester raise a complaint.";
    noticeKind = data.complaints.length ? "warning" : "";
  } else if (data.status === "completed") {
    notice = "The room is closed. This is the final assignment; no more spins or complaints are allowed.";
    noticeKind = "success";
  }

  const assignmentMarkup = !assignment ? `
    <div class="empty-state"><div class="empty-state-icon">🎁</div><strong>The result will appear here.</strong><p class="tiny" style="margin:7px 0 0">No rush — get everyone connected first.</p></div>` : `
    <div class="result-hero">
      ${celebrate ? renderConfetti() : ""}
      <span class="result-label">${data.status === "completed" ? "Final assignment" : "The wheel has spoken!"}</span>
      <div class="result-winner">${escapeHTML(assignment.participantName)}</div>
      <div class="result-task">${escapeHTML(assignment.taskWhat)}</div>
      <div class="result-details">
        <div class="detail-tile"><span class="detail-label">Theme</span><span class="detail-value">${escapeHTML(assignment.theme)}</span></div>
        <div class="detail-tile"><span class="detail-label">Browser / device</span><span class="detail-value">${escapeHTML(assignment.device)} · ${escapeHTML(assignment.platform)}</span></div>
        <div class="detail-tile"><span class="detail-label">Task team</span><span class="detail-value">${assignment.taskTeam ? escapeHTML(assignment.taskTeam) : "Team-neutral"}</span></div>
        <div class="detail-tile"><span class="detail-label">Developer team</span><span class="detail-value">${escapeHTML(assignment.participantTeam)}${assignment.teamMatched ? " · Nice match!" : ""}</span></div>
        <div class="detail-tile"><span class="detail-label">Device availability</span><span class="detail-value">${escapeHTML([assignment.selectedDevices.android ? "Android" : "", assignment.selectedDevices.ios ? "iOS" : ""].filter(Boolean).join(" · ") || "No phone selected")}</span></div>
        <div class="detail-tile"><span class="detail-label">User roles</span><span class="detail-value">${escapeHTML(assignment.users.join(", "))}</span></div>
      </div>
      <p class="tiny" style="margin:12px 0 0">Assigned ${escapeHTML(fmtDate(assignment.timestamp))} · Spin ${assignment.spinNumber}</p>
    </div>`;

  let actions = "";
  if (assignment && ["result", "challenged"].includes(data.status) && data.spinsUsed === 1) {
    if (canLocalComplain || canHostTesterComplain) {
      actions += `<button class="button button-complain" type="button" data-action="complain">⚑ Something doesn't look right? Complain</button>`;
    }
    if (hostMode && canAcceptInitialResult(data)) {
      actions += `<button class="button button-mint" type="button" data-action="accept-result">✓ Accept result &amp; finish</button>`;
    }
    if (hostMode && data.complaints.length) {
      actions += `<button class="button button-soft" type="button" data-action="spin" ${canResolve ? "" : "disabled"}>↻ Resolve complaint</button>`;
    }
  }
  if (data.status === "completed") {
    actions = `<span class="status-badge final">✓ Final assignment locked</span>`;
  }
  const complaintList = data.complaints.length ? `<div class="state-line warning" style="margin-top:13px"><span>⚑</span><div><strong>Complaint received</strong><br>${data.complaints.map((complaint) => escapeHTML(complaint.name)).join(", ")}</div></div>` : "";

  return `
    <section class="card panel result-panel">
      <div class="panel-header"><div><p class="eyebrow">The result</p><h2>Assignment card</h2><p class="panel-caption">Full task details and room decision.</p></div>${state ? `<span class="status-badge ${state.className}">${escapeHTML(state.text)}</span>` : ""}</div>
      <div class="state-line ${noticeKind}"><span>${noticeKind === "success" ? "✓" : noticeKind === "warning" ? "⚑" : "✧"}</span><span>${escapeHTML(notice)}</span></div>
      ${assignmentMarkup}
      ${complaintList}
      ${actions ? `<div class="result-actions">${actions}</div>` : ""}
      ${["result", "challenged"].includes(data.status) && !hostMode && !guestConnected ? `<p class="tiny" style="margin-top:12px">Reconnect to send a complaint or receive the latest room state.</p>` : ""}
    </section>`;
}

function renderHistoryPanel(data) {
  const history = [...data.assignments].sort((a, b) => b.spinNumber - a.spinNumber);
  const content = history.length ? history.map((assignment) => {
    const state = assignmentState(assignment);
    return `
      <article class="history-item">
        <div class="history-index">${assignment.spinNumber}</div>
        <div class="history-copy">
          <div class="history-title">${escapeHTML(assignment.participantName)} → ${escapeHTML(assignment.taskWhat)}</div>
          <div class="history-description">${escapeHTML(assignment.theme)} · ${escapeHTML(assignment.device)} · ${escapeHTML(assignment.taskTeam || "Team-neutral")} task / ${escapeHTML(assignment.participantTeam)} developer team<br>${escapeHTML(fmtDate(assignment.timestamp))}</div>
          <div class="history-status"><span class="status-badge ${state.className}">${escapeHTML(state.text)}</span>${assignment.teamMatched ? ` <span class="team-badge team-${escapeHTML(assignment.participantTeam)}">Team match</span>` : ""}</div>
        </div>
      </article>`;
  }).join("") : `<div class="empty-state"><div class="empty-state-icon">📜</div><strong>Your assignment trail starts here.</strong><p class="tiny" style="margin:7px 0 0">Each spin is saved, including a challenged result.</p></div>`;
  return `
    <section class="card panel history-panel">
      <div class="panel-header"><div><p class="eyebrow">The paper trail</p><h2>Assignment history</h2><p class="panel-caption">Latest spin first. Challenged tasks stay unavailable.</p></div><span class="count-pill">${data.assignments.length}</span></div>
      <div class="history-list">${content}</div>
    </section>`;
}

function renderRoomPage(data, hostMode) {
  if (!isSpinning && !remoteSpinPromise) displayWheelPairs = getAssignmentCandidates(data);
  const status = roomStatusLabel(data);
  const titleLine = hostMode ? "Your test room is ready" : "You're in the test room";
  const guestRoomNotice = !hostMode && !guestConnected
    ? `<div class="state-line warning" style="margin-bottom:17px"><span>↻</span><span>This is the last room snapshot received. Reconnect with a new offer/answer exchange to see live updates.</span></div>` : "";
  app.innerHTML = `
    <section class="room-heading">
      <div><p class="eyebrow">${hostMode ? "Room host" : "Room guest"} · ${escapeHTML(status)}</p><h1 class="room-title">${escapeHTML(titleLine)} <span aria-hidden="true">✦</span></h1><div class="room-meta"><span class="room-code">${escapeHTML(data.roomCode)}</span><span class="bubble bubble-mint">${data.participants.filter((participant) => participant.connected).length} connected</span><span class="bubble bubble-blue">${data.spinsUsed}/2 spins used</span></div></div>
      <div class="row"><button class="button button-soft" type="button" data-action="back-home">← Home</button>${hostMode ? `<button class="button button-primary" type="button" data-action="create-room">＋ New room</button>` : ""}</div>
    </section>
    ${guestRoomNotice}
    ${renderGuestConnectCard()}
    <section class="room-grid">
      ${renderParticipantsPanel(data, hostMode)}
      ${renderWheelPanel(data, hostMode)}
    </section>
    <section class="result-history-grid">
      ${renderResultPanel(data, hostMode, celebrateNextRender)}
      ${renderHistoryPanel(data)}
    </section>
    <p class="tiny" style="margin:17px 4px 0">Room state is authoritative only in the host's browser while peer connections are active. Room code: identifier, not a password. Team mapping: ${escapeHTML(JSON.stringify(TEAM_MAPPING))}.</p>`;
  celebrateNextRender = false;
  requestAnimationFrame(() => drawWheel(displayWheelPairs));
}

function renderGuestPage() {
  if (guestRoomSnapshot) {
    renderRoomPage(guestRoomSnapshot, false);
    return;
  }
  app.innerHTML = `
    <section class="room-heading">
      <div><p class="eyebrow">Room guest · Waiting for the host</p><h1 class="room-title">Let's get you connected. <span aria-hidden="true">✦</span></h1><div class="room-meta"><span class="room-code">${escapeHTML(roomCode)}</span><span class="bubble bubble-blue">No live connection yet</span></div></div>
      <div class="row"><button class="button button-soft" type="button" data-action="back-home">← Home</button></div>
    </section>
    ${renderGuestConnectCard()}
    <section class="card panel" style="margin-top:18px"><div class="empty-state"><div class="empty-state-icon">🔌</div><strong>Waiting for a direct connection</strong><p class="tiny" style="margin:7px auto 0;max-width:460px">Once your host accepts your answer code, your profile and the latest room snapshot will arrive over WebRTC. A room code alone cannot load shared state from GitHub Pages.</p></div></section>`;
}

function renderDeviceChoices(prefix, android = false, ios = false) {
  return `
    <div class="form-section">
      <div class="form-section-title">Phone availability <span class="muted" style="font-weight:500">(optional)</span></div>
      <div class="device-options">
        <label class="choice-card"><input type="checkbox" name="android" value="true" ${android ? "checked" : ""}><span class="choice-icon" aria-hidden="true">🤖</span><span class="choice-copy"><strong>Android</strong><span>Android phone available</span></span></label>
        <label class="choice-card"><input type="checkbox" name="ios" value="true" ${ios ? "checked" : ""}><span class="choice-icon" aria-hidden="true">📱</span><span class="choice-copy"><strong>iOS / iPhone</strong><span>Apple phone available</span></span></label>
      </div>
      <p class="field-hint" style="margin:9px 0 0">Neither is fine. Desktop tasks remain eligible.</p>
    </div>`;
}

function renderTeamChoices(prefix, selected = "") {
  return `
    <div class="form-section">
      <div class="form-section-title">Choose your team <span style="color:#d95ca8">*</span></div>
      <div class="team-options">
        ${TEAMS.map((team) => `<div class="team-option"><input type="radio" id="${prefix}-team-${team}" name="team" value="${team}" ${selected === team ? "checked" : ""} required><label for="${prefix}-team-${team}"><strong>${team}</strong><span>${team === "AF" ? "AF Release" : team === "PB" ? "PB Release" : "CD Release"}</span></label></div>`).join("")}
      </div>
    </div>`;
}

function renderGuestConnectCard() {
  if (isHost || guestConnected) return "";
  const profile = guestProfile ?? { name: "", team: "", android: false, ios: false };
  return `
    <section class="card panel" style="margin-bottom:18px">
      <div class="panel-header"><div><p class="eyebrow">Step 1 · Your profile</p><h2>Join as a tester</h2><p class="panel-caption">Enter your name and team, then paste the host's offer code.</p></div><span class="count-pill">Guest</span></div>
      <form class="stack" data-form="guest-connect">
        <div class="field"><label for="guest-name">Your name</label><input class="input" id="guest-name" name="name" maxlength="${MAX_NAME_LENGTH}" value="${escapeHTML(profile.name)}" placeholder="e.g. Alex" autocomplete="name" required></div>
        ${renderDeviceChoices("guest", Boolean(profile.android), Boolean(profile.ios))}
        ${renderTeamChoices("guest", profile.team)}
        <div class="field"><label for="guest-offer-code">Host's WebRTC offer code</label><textarea class="textarea" id="guest-offer-code" name="offerCode" placeholder="Ask the host to create a connection code, then paste it here…" required></textarea><p class="field-hint">The offer code is separate from the room URL. It contains the direct connection details for this browser session.</p></div>
        <button class="button button-primary button-full" type="submit">Generate answer code →</button>
      </form>
      ${guestAnswerCode ? `<div class="code-output" style="margin-top:16px"><p class="eyebrow">Step 2 · Send this back</p><h3>Your answer code is ready</h3><p class="tiny">Copy this full code and send it to the host. Keep this page open while the host accepts it.</p><label class="field-label" for="guest-answer-code">Your answer code</label><textarea class="textarea" id="guest-answer-code" readonly>${escapeHTML(guestAnswerCode)}</textarea><button class="button button-soft button-small" style="margin-top:9px" type="button" data-action="copy-answer">Copy answer code</button></div>` : ""}
      <div class="state-line ${guestConnected ? "success" : ""}" style="margin-top:14px"><span>↔</span><span>${escapeHTML(guestConnectionStatus)}</span></div>
      <div class="warning-banner">Network note: without STUN/TURN infrastructure, direct WebRTC may not connect across different networks. If it fails, try the same trusted local network and check VPN/firewall settings.</div>
    </section>`;
}

function drawWheel(pairs, targetIndex = null) {
  const wheel = document.querySelector("#assignment-wheel");
  if (!wheel) return;
  const normalizedPairs = (pairs ?? []).map(normalizeWheelPair).filter(Boolean);
  const count = normalizedPairs.length;
  if (!count) {
    wheel.style.background = "conic-gradient(#f6b4d8 0 16.6%, #b7a9f2 16.6% 33.2%, #a9e5d2 33.2% 49.8%, #a8daf4 49.8% 66.4%, #ffe3a0 66.4% 83%, #ffc6ab 83% 100%)";
    wheel.querySelectorAll(".wheel-label").forEach((node) => node.remove());
    wheel.style.transform = `rotate(${wheelRotationDegrees}deg)`;
    return;
  }
  const segmentAngle = 360 / count;
  const segments = normalizedPairs.map((_, index) => `${WHEEL_COLORS[index % WHEEL_COLORS.length]} ${index * segmentAngle}deg ${(index + 1) * segmentAngle}deg`);
  wheel.style.background = `conic-gradient(${segments.join(",")})`;
  wheel.querySelectorAll(".wheel-label, .wheel-hub").forEach((node) => node.remove());

  const labelIndexes = new Set();
  if (count <= 12) {
    for (let index = 0; index < count; index += 1) labelIndexes.add(index);
  } else {
    if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < count) labelIndexes.add(targetIndex);
    for (let step = 0; step < 11; step += 1) labelIndexes.add(Math.floor(step * count / 11));
    if (labelIndexes.size < 12) {
      for (let index = 0; index < count && labelIndexes.size < 12; index += 1) labelIndexes.add(index);
    }
  }

  for (const index of [...labelIndexes].sort((a, b) => a - b)) {
    const angle = (index + .5) * segmentAngle - 90;
    const radians = angle * Math.PI / 180;
    const radius = count > 18 ? 34 : 33;
    const label = document.createElement("span");
    label.className = "wheel-label";
    label.textContent = wheelPairLabel(normalizedPairs[index]);
    label.style.left = `${50 + Math.cos(radians) * radius}%`;
    label.style.top = `${50 + Math.sin(radians) * radius}%`;
    label.style.setProperty("--label-rotation", `${angle + 90}deg`);
    wheel.append(label);
  }
  const hub = document.createElement("div");
  hub.className = "wheel-hub";
  hub.innerHTML = "LET'S<br>TEST!";
  wheel.append(hub);
  wheel.style.transform = `rotate(${wheelRotationDegrees}deg)`;
}

function animateWheel(targetIndex, pairs) {
  const wheel = document.querySelector("#assignment-wheel");
  if (!wheel || !pairs?.length || targetIndex < 0 || targetIndex >= pairs.length) return Promise.resolve();
  drawWheel(pairs, targetIndex);
  const segmentAngle = 360 / pairs.length;
  const centerAngle = (targetIndex + .5) * segmentAngle;
  const targetModulo = (360 - centerAngle + 360) % 360;
  const currentModulo = ((wheelRotationDegrees % 360) + 360) % 360;
  const delta = (targetModulo - currentModulo + 360) % 360;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reducedMotion ? 0 : SPIN_DURATION_MS;
  const targetRotation = wheelRotationDegrees + (reducedMotion ? delta : 360 * 5 + delta);

  return new Promise((resolve) => {
    let settled = false;
    let fallback = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (fallback) window.clearTimeout(fallback);
      wheel.removeEventListener("transitionend", onEnd);
      wheel.removeEventListener("transitioncancel", finish);
      wheel.style.transition = "none";
      wheelRotationDegrees = targetRotation;
      wheel.style.transform = `rotate(${wheelRotationDegrees}deg)`;
      resolve();
    };
    const onEnd = (event) => {
      if (event.target === wheel && event.propertyName === "transform") finish();
    };
    wheel.addEventListener("transitionend", onEnd);
    wheel.addEventListener("transitioncancel", finish);
    wheel.style.transition = "none";
    wheel.style.transform = `rotate(${wheelRotationDegrees}deg)`;
    // Force style flush before applying the animated target.
    void wheel.offsetWidth;
    requestAnimationFrame(() => {
      wheel.style.transition = duration ? `transform ${duration}ms cubic-bezier(.12,.72,.16,1)` : "none";
      wheel.style.transform = `rotate(${targetRotation}deg)`;
      if (!duration) finish();
      else fallback = window.setTimeout(finish, duration + 850);
    });
  });
}

function waitForIceGatheringComplete(pc, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
  if (pc.iceGatheringState === "complete") return Promise.resolve(true);
  return new Promise((resolve) => {
    let finished = false;
    const finish = (complete) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve(complete);
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") finish(true);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function encodeConnectionCode(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return `WOT1.${btoa(binary)}`;
}

function decodeConnectionCode(rawValue) {
  const raw = String(rawValue ?? "").trim().replace(/\s+/g, "");
  if (!raw) throw new Error("Paste the full connection code first.");
  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  }
  const match = raw.match(/^WOT1\.([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("That code format is not recognized. Copy the entire WOT1 code.");
  const binary = atob(match[1]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || parsed.v !== 1 || typeof parsed.type !== "string") throw new Error("This connection code is incomplete or uses an unsupported version.");
  return parsed;
}

function hostSnapshotMessage() {
  return { type: "SNAPSHOT", roomCode: room.roomCode, room: JSON.parse(JSON.stringify(room)) };
}

function broadcastMessage(message) {
  if (!isHost || !room) return;
  const encoded = JSON.stringify(message);
  for (const record of hostConnections.values()) {
    if (record.channel?.readyState === "open") {
      try { record.channel.send(encoded); }
      catch (error) { console.warn("WheelOfTest broadcast failed", error); }
    }
  }
}

function broadcastSnapshot() {
  if (!room) return;
  broadcastMessage(hostSnapshotMessage());
}

async function createHostOffer() {
  if (!isHost || !room) return;
  if (!("RTCPeerConnection" in window)) {
    showToast("This browser does not support WebRTC peer connections.", "error");
    return;
  }
  const connectionId = makeId("connection");
  const record = { id: connectionId, pc: null, channel: null, participantId: null, status: "Creating offer…", code: "", error: "", closeHandled: false };
  pendingOffers.unshift({ id: connectionId, shortId: connectionId.slice(-5).toUpperCase(), status: record.status, code: "", error: "" });
  hostConnections.set(connectionId, record);
  render();
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    record.pc = pc;
    record.channel = pc.createDataChannel("wheel-of-test", { ordered: true });
    record.channel.onopen = () => {
      const pending = pendingOffers.find((item) => item.id === connectionId);
      if (pending) pending.status = "Data channel open — waiting for tester profile.";
      if (pending) render();
    };
    record.channel.onmessage = (event) => handleHostDataMessage(connectionId, event.data);
    record.channel.onclose = () => markPeerDisconnected(connectionId);
    record.channel.onerror = () => {
      const pending = pendingOffers.find((item) => item.id === connectionId);
      if (pending) { pending.status = "Data channel error. Try a fresh offer/answer exchange."; render(); }
    };
    pc.onconnectionstatechange = () => {
      const pending = pendingOffers.find((item) => item.id === connectionId);
      if (pending && ["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        pending.status = `Connection ${pc.connectionState}. Create a fresh offer if needed.`;
        render();
      }
      if (["failed", "closed"].includes(pc.connectionState)) markPeerDisconnected(connectionId);
      if (pc.connectionState === "disconnected") {
        window.setTimeout(() => {
          if (pc.connectionState === "disconnected") markPeerDisconnected(connectionId);
        }, 3500);
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const gathered = await waitForIceGatheringComplete(pc);
    if (!pc.localDescription?.sdp) throw new Error("The browser did not produce an SDP offer.");
    const code = encodeConnectionCode({
      v: 1,
      type: "offer",
      roomCode: room.roomCode,
      connectionId,
      sdp: pc.localDescription.sdp
    });
    record.code = code;
    record.status = gathered ? "Offer ready. Send it to one tester." : "Offer prepared, but ICE gathering timed out. Direct connection may fail.";
    const pending = pendingOffers.find((item) => item.id === connectionId);
    if (pending) { pending.code = code; pending.status = record.status; }
    render();
  } catch (error) {
    console.error("Could not create WebRTC offer", error);
    record.status = "Could not create an offer.";
    record.error = error?.message || "Unknown WebRTC error.";
    const pending = pendingOffers.find((item) => item.id === connectionId);
    if (pending) { pending.status = record.status; pending.error = record.error; }
    render();
    showToast(record.error, "error");
  }
}

async function acceptHostAnswer(connectionId, answerText) {
  const record = hostConnections.get(connectionId);
  const pending = pendingOffers.find((item) => item.id === connectionId);
  if (!record?.pc || !pending) throw new Error("This offer is no longer pending. Create a fresh connection code.");
  const answer = decodeConnectionCode(answerText);
  if (answer.type !== "answer" || answer.v !== 1) throw new Error("This is not a supported WheelOfTest answer code.");
  if (answer.roomCode !== room.roomCode) throw new Error("That answer belongs to a different room.");
  if (answer.connectionId !== connectionId) throw new Error("That answer belongs to a different offer. Use the answer for this connection card.");
  if (typeof answer.sdp !== "string" || !answer.sdp.includes("v=0")) throw new Error("The answer code does not contain a valid SDP description.");
  await record.pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
  pending.status = "Answer accepted. Waiting for the direct connection and profile…";
  pending.error = "";
  render();
}

function validateProfile(data) {
  const name = String(data.get("name") ?? "").trim().slice(0, MAX_NAME_LENGTH);
  const team = String(data.get("team") ?? "");
  if (!name) throw new Error("Please enter your name.");
  if (!TEAMS.includes(team)) throw new Error("Choose exactly one team: AF, CYD, or PB.");
  return { name, team, android: data.get("android") === "true", ios: data.get("ios") === "true" };
}

function addHostTester(formData) {
  if (!isHost || !room) return;
  if (room.participants.some((participant) => participant.isHostTester)) {
    showToast("The host already has a tester profile in this room.", "error");
    return;
  }
  const profile = validateProfile(formData);
  room.participants.push({
    id: makeId("host-tester"),
    ...profile,
    connected: true,
    isHostTester: true,
    joinedAt: Date.now()
  });
  touchRoom();
  broadcastSnapshot();
  displayWheelPairs = getAssignmentCandidates(room);
  render();
  showToast("You're in the tester pool. Good luck!", "success");
}

async function startGuestConnection(formData) {
  if (isHost || !roomCode) return;
  if (!("RTCPeerConnection" in window)) throw new Error("This browser does not support WebRTC peer connections.");
  const profileFields = validateProfile(formData);
  const offerText = String(formData.get("offerCode") ?? "").trim();
  const offer = decodeConnectionCode(offerText);
  if (offer.type !== "offer" || offer.v !== 1) throw new Error("Paste the host's offer code, not an answer code.");
  if (offer.roomCode !== roomCode) throw new Error("That offer belongs to a different room code.");
  if (typeof offer.connectionId !== "string" || typeof offer.sdp !== "string" || !offer.sdp.includes("v=0")) {
    throw new Error("The offer code is incomplete. Ask the host to create a fresh code.");
  }

  try { guestDataChannel?.close(); } catch { /* already closed */ }
  try { guestPeer?.close(); } catch { /* already closed */ }
  guestRoomSnapshot = null;
  guestAnswerCode = "";
  guestConnected = false;
  guestProfile = {
    id: guestProfile?.id || makeId("participant"),
    ...profileFields
  };
  persistGuestProfile();
  guestConnectionStatus = "Creating your answer. Keep this page open while the host accepts it…";
  render();

  const pc = new RTCPeerConnection({ iceServers: [] });
  guestPeer = pc;
  pc.ondatachannel = (event) => {
    guestDataChannel = event.channel;
    guestDataChannel.onopen = () => {
      guestConnected = true;
      guestConnectionStatus = "Connected. Waiting for the host's latest room snapshot…";
      sendGuestMessage({ type: "JOIN", roomCode, connectionId: offer.connectionId, profile: guestProfile });
      render();
    };
    guestDataChannel.onmessage = (messageEvent) => handleGuestDataMessage(messageEvent.data);
    guestDataChannel.onerror = () => {
      guestConnectionStatus = "The data channel reported an error. Try reconnecting with fresh codes.";
      showToast(guestConnectionStatus, "error");
    };
    guestDataChannel.onclose = () => {
      guestConnected = false;
      guestConnectionStatus = "Disconnected. Ask the host for a fresh offer code, then reconnect.";
      render();
    };
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(pc.connectionState)) {
      guestConnected = false;
      guestConnectionStatus = `Peer connection ${pc.connectionState}. Ask the host for a fresh offer code.`;
      render();
    } else if (pc.connectionState === "disconnected") {
      guestConnectionStatus = "Connection interrupted. If it does not recover, exchange fresh codes.";
      render();
    }
  };

  await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  const gathered = await waitForIceGatheringComplete(pc);
  if (!pc.localDescription?.sdp) throw new Error("The browser did not produce an SDP answer.");
  guestAnswerCode = encodeConnectionCode({
    v: 1,
    type: "answer",
    roomCode,
    connectionId: offer.connectionId,
    sdp: pc.localDescription.sdp
  });
  guestConnectionStatus = gathered
    ? "Answer ready. Send it back to the host, and keep this page open."
    : "Answer prepared, but ICE gathering timed out. Direct connection may fail.";
  render();
}

function sendGuestMessage(message) {
  if (guestDataChannel?.readyState !== "open") {
    showToast("You're not connected to the host yet. Complete the offer/answer exchange first.", "error");
    return false;
  }
  try {
    guestDataChannel.send(JSON.stringify(message));
    return true;
  } catch (error) {
    showToast(error?.message || "Could not send your message to the host.", "error");
    return false;
  }
}

function validRemoteProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const id = String(profile.id ?? "").trim();
  const name = String(profile.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
  const team = String(profile.team ?? "");
  if (!id || id.length > 140 || !name || !TEAMS.includes(team)) return null;
  return { id, name, team, android: Boolean(profile.android), ios: Boolean(profile.ios) };
}

function handleHostDataMessage(connectionId, raw) {
  if (!isHost || !room) return;
  let message;
  try { message = JSON.parse(raw); }
  catch { return sendHostError(connectionId, "The message from this peer was not valid JSON."); }
  if (!message || message.roomCode !== room.roomCode) return sendHostError(connectionId, "The message references a different room.");
  const record = hostConnections.get(connectionId);
  if (!record) return;

  if (message.type === "JOIN") {
    if (message.connectionId !== connectionId) return sendHostError(connectionId, "This profile belongs to a different connection code.");
    const profile = validRemoteProfile(message.profile);
    if (!profile) return sendHostError(connectionId, "The profile is incomplete. Reconnect with a valid name and team.");
    const existing = room.participants.find((participant) => participant.id === profile.id);
    const existingPeer = [...hostConnections.entries()].find(([otherId, peer]) => otherId !== connectionId && peer.participantId === profile.id && peer.channel?.readyState === "open");
    if (existingPeer) return sendHostError(connectionId, "This participant is already connected in another browser session.");
    if (existing?.connected && !existingPeer && existing.connectionId && existing.connectionId !== connectionId) {
      // After host refresh the persisted connectionId is stale; only active map entries block a reconnect.
      existing.connected = false;
    }
    if (existing) {
      Object.assign(existing, profile, { connected: true, connectionId, isHostTester: false });
    } else {
      room.participants.push({ ...profile, connected: true, isHostTester: false, connectionId, joinedAt: Date.now() });
    }
    record.participantId = profile.id;
    record.closeHandled = false;
    const pending = pendingOffers.find((item) => item.id === connectionId);
    if (pending) pending.status = `${profile.name} connected (${profile.team}).`;
    touchRoom();
    broadcastSnapshot();
    render();
    return;
  }

  if (message.type === "COMPLAIN") {
    if (!record.participantId) return sendHostError(connectionId, "Join the room before sending a complaint.");
    const result = recordComplaint(room, record.participantId, Date.now());
    if (!result.ok) return sendHostError(connectionId, result.reason);
    persistRoom();
    broadcastSnapshot();
    render();
    showToast("Complaint received. Spin 2 is now available to the host.", "success");
    return;
  }

  if (message.type === "PING") {
    try { record.channel?.send(JSON.stringify({ type: "PONG", roomCode: room.roomCode, version: room.version })); } catch { /* ignored */ }
  }
}

function sendHostError(connectionId, message) {
  const record = hostConnections.get(connectionId);
  try { record?.channel?.send(JSON.stringify({ type: "ERROR", roomCode: room?.roomCode, message })); } catch { /* ignored */ }
  console.warn("WheelOfTest peer message rejected:", message);
}

function handleGuestDataMessage(raw) {
  let message;
  try { message = JSON.parse(raw); }
  catch { showToast("The host sent an unreadable message.", "error"); return; }
  if (!message || message.roomCode !== roomCode) return;
  if (message.type === "ERROR") {
    guestConnectionStatus = String(message.message || "The host rejected a message.");
    showToast(guestConnectionStatus, "error");
    render();
    return;
  }
  if (message.type === "SNAPSHOT" && message.room && message.room.roomCode === roomCode) {
    const version = Number(message.room.version) || 0;
    const currentVersion = Number(guestRoomSnapshot?.version) || -1;
    if (version < currentVersion) return;
    if (remoteSpinPromise) {
      pendingSnapshot = message.room;
      return;
    }
    applyGuestSnapshot(message.room);
    return;
  }
  if (message.type === "SPIN_ANIMATION") {
    if (!Array.isArray(message.wheelPairs) || !Number.isInteger(message.targetIndex)) return;
    if (remoteSpinPromise) return;
    const currentVersion = Number(guestRoomSnapshot?.version) || -1;
    if (Number(message.version) < currentVersion) return;
    const pairs = message.wheelPairs;
    displayWheelPairs = pairs;
    remoteSpinPromise = animateWheel(message.targetIndex, pairs).finally(() => {
      remoteSpinPromise = null;
      if (pendingSnapshot) {
        const snapshot = pendingSnapshot;
        pendingSnapshot = null;
        applyGuestSnapshot(snapshot);
      } else {
        render();
      }
    });
  }
}

function applyGuestSnapshot(nextRoom) {
  const currentVersion = Number(guestRoomSnapshot?.version) || -1;
  const nextVersion = Number(nextRoom.version) || 0;
  if (nextVersion < currentVersion) return;
  guestRoomSnapshot = nextRoom;
  guestConnectionStatus = "Connected. Room state is live.";
  guestConnected = guestDataChannel?.readyState === "open";
  render();
}

function markPeerDisconnected(connectionId) {
  const record = hostConnections.get(connectionId);
  if (!record || record.closeHandled) return;
  record.closeHandled = true;
  const participant = room?.participants.find((item) => item.id === record.participantId);
  if (participant && participant.connected) {
    participant.connected = false;
    touchRoom();
    broadcastSnapshot();
    render();
    showToast(`${participant.name} disconnected. They can reconnect with fresh connection codes.`, "info");
  }
  const pending = pendingOffers.find((item) => item.id === connectionId);
  if (pending && !participant) {
    pending.status = "Peer disconnected before joining.";
    render();
  }
}

async function startSpin() {
  if (!isHost || !room || isSpinning) return;
  const candidates = getAssignmentCandidates(room);
  const firstEligible = canStartSpin1(room);
  const secondEligible = canStartSpin2(room);
  if (!firstEligible && !secondEligible) {
    showToast(room.complaints.length && room.spinsUsed === 1
      ? "There is no compatible unused replacement task available."
      : "The room is not eligible to spin yet.", "error");
    return;
  }
  if (!candidates.length) {
    showToast("No compatible connected tester/task pair is available.", "error");
    return;
  }
  const selected = chooseAssignmentPair(room);
  if (!selected) {
    showToast("No valid assignment pair is available.", "error");
    return;
  }
  const selectedIndex = candidates.findIndex(({ task, participant }) => task.id === selected.task.id && participant.id === selected.participant.id);
  const spinNumber = room.spinsUsed + 1;
  const transition = commitSpin(room, selected, Date.now());
  if (!transition.ok) {
    showToast(transition.reason, "error");
    return;
  }

  // Commit before animation so refresh/cancel cannot lose or repeat the chosen task.
  room = transition.room;
  persistRoom();
  displayWheelPairs = candidates;
  isSpinning = true;
  const spinButton = app.querySelector('[data-action="spin"]');
  if (spinButton) {
    spinButton.disabled = true;
    spinButton.textContent = spinNumber === 1 ? "The wheel is spinning…" : "Resolving the complaint…";
  }
  const animationMessage = {
    type: "SPIN_ANIMATION",
    roomCode: room.roomCode,
    version: room.version,
    spinNumber,
    targetIndex: selectedIndex,
    wheelPairs: candidates.map(serializePair)
  };
  broadcastMessage(animationMessage);

  await animateWheel(selectedIndex, candidates);
  isSpinning = false;
  celebrateNextRender = true;
  broadcastSnapshot();
  render();
  if (spinNumber === 2) showToast("Complaint resolved. The replacement is final.", "success");
  else showToast(selected.task.team && selected.task.team === selected.participant.team ? "Nice — that's a team match!" : "The wheel has picked your assignment!", "success");
}

function acceptResult() {
  if (!isHost || !room) return;
  const transition = acceptInitialResult(room, Date.now());
  if (!transition.ok) {
    showToast(transition.reason, "error");
    return;
  }
  room = transition.room;
  persistRoom();
  broadcastSnapshot();
  render();
  showToast("Result accepted. The room is now complete.", "success");
}

function complain() {
  const data = isHost ? room : guestRoomSnapshot;
  const participantId = isHost
    ? data?.participants.find((participant) => participant.isHostTester)?.id
    : guestProfile?.id;
  if (!data || !participantId) {
    showToast("Join the tester pool before complaining.", "error");
    return;
  }
  if (!canComplain(data, participantId)) {
    showToast("A complaint is not allowed in the current room state, or you have already complained.", "error");
    return;
  }
  if (!isHost) {
    sendGuestMessage({ type: "COMPLAIN", roomCode });
    showToast("Complaint sent to the host.", "success");
    return;
  }
  const result = recordComplaint(room, participantId, Date.now());
  if (!result.ok) {
    showToast(result.reason, "error");
    return;
  }
  persistRoom();
  broadcastSnapshot();
  render();
  showToast("Complaint received. Spin 2 is now available.", "success");
}

function backHome() {
  resetPeerState();
  history.pushState({}, "", currentRoomUrl(null));
  roomCode = null;
  isHost = false;
  room = null;
  guestRoomSnapshot = null;
  guestProfile = null;
  guestAnswerCode = "";
  displayWheelPairs = [];
  renderLanding();
}

app.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === "create-room") createNewRoom();
    else if (action === "back-home") backHome();
    else if (action === "create-offer") await createHostOffer();
    else if (action === "copy-invite") await copyText(currentRoomUrl(), "Room link copied.");
    else if (action === "copy-room-code") await copyText(roomCode, "Room code copied.");
    else if (action === "copy-offer") {
      const offer = pendingOffers.find((item) => item.id === button.dataset.connectionId);
      if (offer?.code) await copyText(offer.code, "Offer code copied. Send it to one tester.");
    } else if (action === "copy-answer") {
      if (guestAnswerCode) await copyText(guestAnswerCode, "Answer code copied. Send it back to the host.");
    } else if (action === "spin") await startSpin();
    else if (action === "accept-result") acceptResult();
    else if (action === "complain") complain();
  } catch (error) {
    console.error("WheelOfTest action failed", error);
    showToast(error?.message || "That action failed. Please try again.", "error");
  }
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const formData = new FormData(form);
  try {
    if (form.dataset.form === "enter-room") {
      navigateToRoom(formData.get("roomCode"));
    } else if (form.dataset.form === "host-participant") {
      addHostTester(formData);
    } else if (form.dataset.form === "accept-answer") {
      const connectionId = form.dataset.connectionId;
      const pending = pendingOffers.find((item) => item.id === connectionId);
      if (pending) { pending.status = "Validating answer…"; pending.error = ""; }
      await acceptHostAnswer(connectionId, formData.get("answerCode"));
      showToast("Answer accepted. Waiting for WebRTC to connect…", "success");
    } else if (form.dataset.form === "guest-connect") {
      await startGuestConnection(formData);
    }
  } catch (error) {
    console.error("WheelOfTest form submission failed", error);
    const message = error?.message || "Please check the form and try again.";
    const connectionId = form.dataset.connectionId;
    if (connectionId) {
      const pending = pendingOffers.find((item) => item.id === connectionId);
      if (pending) { pending.error = message; pending.status = "Answer could not be accepted."; render(); }
    } else if (form.dataset.form === "guest-connect") {
      guestConnectionStatus = message;
      showToast(message, "error");
      render();
    } else {
      showToast(message, "error");
    }
  }
});

window.addEventListener("popstate", loadRoute);
window.addEventListener("beforeunload", () => {
  // Connections intentionally do not survive reload/close. Persisted host state remains local.
  for (const record of hostConnections.values()) {
    try { record.channel?.close(); } catch { /* ignored */ }
    try { record.pc?.close(); } catch { /* ignored */ }
  }
  try { guestDataChannel?.close(); } catch { /* ignored */ }
  try { guestPeer?.close(); } catch { /* ignored */ }
});

// Expose no application API on window; initialize from the static URL.
loadRoute();
