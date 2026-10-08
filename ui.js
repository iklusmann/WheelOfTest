// DOM rendering for both views. User-supplied text is always set with textContent.

import { CONFIG } from "./config.js";
import { spinRule } from "./domain.js";
import { drawWheel } from "./reveal.js";

const $ = (id) => document.getElementById(id);

export const els = {
  roomMeta: $("room-meta"), roomCode: $("room-code"), copyLink: $("copy-link"),
  connection: $("connection"), connectionText: $("connection-text"),
  viewMessage: $("view-message"), messageTitle: $("message-title"), messageBody: $("message-body"), messageLink: $("message-link"),
  viewForm: $("view-form"), formTitle: $("form-title"), formLede: $("form-lede"), form: $("profile-form"),
  name: $("name"), nameError: $("name-error"), teamError: $("team-error"),
  formError: $("form-error"), formSubmit: $("form-submit"),
  viewRoom: $("view-room"), roomHeading: $("room-heading"), roomAlert: $("room-alert"),
  wheelArea: $("wheel-area"), wheelStage: $("wheel-stage"), wheelRotor: $("wheel-rotor"),
  spinBtn: $("spin-btn"), wheelStatus: $("wheel-status"),
  resultArea: $("result-area"), resultTitle: $("result-title"), myCount: $("my-count"),
  mineOnly: $("mine-only"), showFirstWrap: $("show-first-wrap"), showFirst: $("show-first"),
  viewingFirst: $("viewing-first"), resultTable: $("result-table"), resultBody: $("result-body"), resultEmpty: $("result-empty"),
  complaints: $("complaints"), complaintCount: $("complaint-count"), complaintHint: $("complaint-hint"),
  complainBtn: $("complain-btn"), respinBtn: $("respin-btn"),
  peopleSummary: $("people-summary"), peopleList: $("people-list"),
  announcer: $("announcer")
};

// ------------------------------------------------------------------ helpers

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  phone: "M8.5 2.5h7a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Zm2.5 16h2",
  desktop: "M3.5 4.5h17v11h-17zM8.5 20h7M12 15.5V20"
};
// Filled circle + glyph, in the style of SF Symbols' *.circle.fill
const STATUS_GLYPHS = {
  check: "M6.2 10.3l2.6 2.6 5-5.6",
  swap: "M6 8.1h7.6l-2-2M14 11.9H6.4l2 2",
  dash: "M6.5 10h7"
};

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function icon(name, className = "icon") {
  const svg = svgEl("svg", { viewBox: "0 0 24 24", class: className, "aria-hidden": "true", focusable: "false" });
  svg.append(svgEl("path", { d: ICONS[name] }));
  return svg;
}

function statusIcon(glyph) {
  const svg = svgEl("svg", { viewBox: "0 0 20 20", class: "icon", "aria-hidden": "true", focusable: "false" });
  svg.append(svgEl("circle", { cx: "10", cy: "10", r: "9", class: "icon-fill" }), svgEl("path", { d: STATUS_GLYPHS[glyph], class: "icon-glyph" }));
  return svg;
}

function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] || "?")[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toUpperCase();
}

function bump(node) {
  if (typeof node.animate !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  node.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)", offset: 0.35 }, { transform: "scale(1)" }],
    { duration: 420, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function announce(text) {
  els.announcer.textContent = "";
  // A fresh text node after a tick makes screen readers re-announce identical messages.
  setTimeout(() => { els.announcer.textContent = text; }, 50);
}

// ------------------------------------------------------------------ views

export function showView(name) {
  els.viewMessage.hidden = name !== "message";
  els.viewForm.hidden = name !== "form";
  els.viewRoom.hidden = name !== "room";
  els.roomMeta.hidden = name !== "room";
}

export function renderMessage({ title, body, linkText = null, linkHref = "./", focus = true }) {
  els.messageTitle.textContent = title;
  els.messageBody.textContent = body;
  els.messageLink.hidden = !linkText;
  if (linkText) {
    els.messageLink.textContent = linkText;
    els.messageLink.href = linkHref;
  }
  showView("message");
  if (focus) els.messageTitle.focus({ preventScroll: true });
}

export function renderSetup() {
  renderMessage({
    title: "WheelOfTest needs a backend",
    body: "Add your Supabase project URL and publishable key to config.js, then reload. The README walks through the setup."
  });
}

export function renderNotFound(code) {
  renderMessage({
    title: "Room not found",
    body: code ? `There is no room with the code ${code}. Check the link, or start a new room.` : "This link has no valid room code.",
    linkText: "Create a new room",
    linkHref: "./"
  });
}

// ------------------------------------------------------------------ form

export function renderForm({ mode, code = null, profile = null }) {
  if (mode === "join") {
    els.formTitle.textContent = `Join room ${code}`;
    els.formLede.textContent = "Tell the team who you are and what you can test on. The moderator spins once everyone is in.";
    els.formSubmit.textContent = "Join room";
  } else {
    els.formTitle.textContent = "WheelOfTest";
    els.formLede.textContent = "Join a room, spin once, and every QA task gets an owner.";
    els.formSubmit.textContent = "Create room";
  }
  els.formSubmit.dataset.label = els.formSubmit.textContent;
  const form = els.form;
  form.reset();
  if (profile) {
    form.elements.name.value = profile.name ?? "";
    for (const radio of form.querySelectorAll('input[name="team"]')) radio.checked = radio.value === profile.team;
    form.elements.android.checked = profile.android === true;
    form.elements.ios.checked = profile.ios === true;
  }
  setFormErrors({});
  setFormError(null);
  setFormBusy(false);
  showView("form");
}

export function readForm() {
  const form = els.form;
  const team = form.querySelector('input[name="team"]:checked');
  return {
    name: form.elements.name.value,
    team: team ? team.value : null,
    android: form.elements.android.checked,
    ios: form.elements.ios.checked
  };
}

export function setFormErrors(errors) {
  const pairs = [[els.nameError, errors.name, els.name], [els.teamError, errors.team, null]];
  for (const [node, message, input] of pairs) {
    node.hidden = !message;
    node.textContent = message || "";
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  }
  if (errors.name) els.name.focus();
  else if (errors.team) els.form.querySelector('input[name="team"]').focus();
}

export function setFormError(message) {
  els.formError.hidden = !message;
  els.formError.textContent = message || "";
}

export function setFormBusy(busy, label) {
  els.formSubmit.disabled = busy;
  els.formSubmit.textContent = busy ? label : els.formSubmit.dataset.label || els.formSubmit.textContent;
}

// ------------------------------------------------------------------ room

let wheelKey = null;
let tableKey = null;
let lastComplaintCount = null;

export function enterRoomView(code) {
  wheelKey = null;
  tableKey = null;
  lastComplaintCount = null;
  els.roomCode.textContent = code;
  els.roomHeading.textContent = `Room ${code}`;
  els.mineOnly.checked = false;
  els.showFirst.checked = false;
  els.wheelArea.hidden = false;
  els.resultArea.hidden = true;
  showView("room");
}

function moderatorCanAct(state) {
  return state.connection === "connected" && state.synced && state.presenceReady && !state.busy && !state.revealing;
}

function isOnline(state, userId) {
  return userId === state.me ? state.connection === "connected" : state.online.has(userId);
}

export function renderRoom(state) {
  const snap = state.snapshot;
  if (!snap) return;
  renderConnection(state);
  renderAlert(state.alert);
  renderPeople(state);
  renderStage(state);
  renderComplaints(state);
}

function renderConnection(state) {
  const labels = { connecting: "Connecting…", connected: "Connected", reconnecting: "Reconnecting…" };
  els.connection.dataset.state = state.connection;
  els.connectionText.textContent = labels[state.connection];
  els.connection.title = state.connectionDetail || "";
}

function renderAlert(message) {
  els.roomAlert.hidden = !message;
  els.roomAlert.textContent = message || "";
}

function renderPeople(state) {
  const { participants, room } = state.snapshot;
  const onlineCount = participants.filter((p) => isOnline(state, p.user_id)).length;
  const people = participants.length === 1 ? "1 person" : `${participants.length} people`;
  els.peopleSummary.textContent = `${people}, ${onlineCount} online`;

  const items = participants.map((p) => {
    const online = isOnline(state, p.user_id);
    const li = el("li", `person${online ? " is-online" : ""}`);

    const avatar = el("span", "avatar", initials(p.name));
    avatar.dataset.team = p.team;
    avatar.setAttribute("aria-hidden", "true");

    const top = el("div", "person-top");
    const presence = el("span", "presence");
    presence.append(el("span", "presence-dot"), el("span", "presence-text", online ? "Online" : "Offline"));
    top.append(el("span", "person-name", p.name));
    if (p.user_id === state.me) top.append(el("span", "tag tag-you", "You"));
    if (p.user_id === room.host_user_id) top.append(el("span", "tag tag-mod", "Moderator"));

    const meta = el("div", "person-meta");
    const badge = el("span", "team-badge", p.team);
    badge.dataset.team = p.team;
    meta.append(badge);
    const devices = el("span", "devices");
    if (p.android || p.ios) {
      if (p.android) { const d = el("span", "device"); d.append(icon("phone"), document.createTextNode("Android")); devices.append(d); }
      if (p.ios) { const d = el("span", "device"); d.append(icon("phone"), document.createTextNode("iOS")); devices.append(d); }
    } else {
      const d = el("span", "device device-none"); d.append(icon("desktop"), document.createTextNode("Desktop only")); devices.append(d);
    }
    meta.append(devices);
    li.append(avatar, top, presence, meta);
    return li;
  });
  els.peopleList.replaceChildren(...items);
}

// ---- stage: wheel before the first spin, table after

function renderStage(state) {
  if (state.revealing) {
    els.spinBtn.hidden = true;
    els.wheelStatus.textContent = "Spinning…";
    return;
  }
  if (state.stageSpin === 0) {
    els.resultArea.hidden = true;
    els.wheelArea.hidden = false;
    renderWheelArea(state);
  } else {
    els.wheelArea.hidden = true;
    els.resultArea.hidden = false;
    renderResult(state);
  }
}

function drawWheelFor(state) {
  const names = state.snapshot.participants.map((p) => p.name);
  const key = JSON.stringify(names);
  if (key !== wheelKey) {
    drawWheel(els.wheelRotor, names);
    els.wheelRotor.setAttribute("aria-label", `Wheel with ${plural(names.length, "name")}: ${names.join(", ")}`);
    wheelKey = key;
  }
}

function renderWheelArea(state) {
  const snap = state.snapshot;
  drawWheelFor(state);
  const isHost = snap.room.host_user_id === state.me;
  els.spinBtn.hidden = !isHost;
  if (!isHost) {
    els.wheelStatus.textContent = "Waiting for the moderator to spin";
    return;
  }
  const rule = spinRule(snap.room, snap.complaints.length, CONFIG.complaintThreshold);
  const ready = moderatorCanAct(state);
  els.spinBtn.disabled = !(ready && rule.allowed);
  els.spinBtn.textContent = state.busy === "spin" ? "Spinning…" : "Spin";
  els.wheelStatus.textContent = moderatorStatus(state) ?? (() => {
    const online = snap.participants.filter((p) => isOnline(state, p.user_id)).length;
    return online === snap.participants.length
      ? `Everyone is online. ${plural(snap.room.tasks.length, "task")} will be shared out.`
      : `${online} of ${snap.participants.length} people are online. Only people online get tasks.`;
  })();
}

function moderatorStatus(state) {
  if (state.busy === "spin") return "Saving the spin…";
  if (state.connection === "connecting") return "Connecting to the room…";
  if (state.connection === "reconnecting") return "Reconnecting. Spinning is paused until the room is back in sync.";
  if (!state.synced) return "Syncing the room…";
  if (!state.presenceReady) return "Waiting for the list of who is online…";
  return null;
}

/** Prepare the stage for a reveal: wheel visible, result hidden. */
export function prepareReveal(state) {
  els.resultArea.hidden = true;
  els.wheelArea.hidden = false;
  drawWheelFor(state);
  els.spinBtn.hidden = true;
  els.wheelStatus.textContent = "Spinning…";
}

export function revealElements() {
  return {
    wheelArea: els.wheelArea, resultArea: els.resultArea, stage: els.wheelStage, rotor: els.wheelRotor,
    pointer: $("wheel-pointer"), shadow: $("wheel-shadow")
  };
}

/** Render the result table for state.stageSpin. Returns the visible rows (for the reveal stagger). */
export function renderResult(state) {
  const snap = state.snapshot;
  const finalShown = state.stageSpin === 2;
  const showingFirst = finalShown && state.showFirst;
  const spin = snap.spins.find((s) => s.spin_number === (showingFirst ? 1 : state.stageSpin));
  if (!spin) return [];

  const mine = spin.assignments.filter((a) => a.participant_id === state.me);
  els.resultTitle.textContent = showingFirst ? "First spin (replaced)" : finalShown ? "Final result" : "Result";
  els.myCount.textContent = `You have ${plural(mine.length, "task")}`;
  els.showFirstWrap.hidden = !finalShown;
  els.viewingFirst.hidden = !showingFirst;
  els.showFirst.checked = showingFirst;
  els.mineOnly.checked = state.mineOnly;

  const visible = state.mineOnly ? mine : spin.assignments;
  els.resultEmpty.hidden = visible.length > 0;
  els.resultTable.hidden = visible.length === 0;

  const key = JSON.stringify([spin.spin_number, state.mineOnly, state.me, spin.created_at]);
  if (key !== tableKey) {
    els.resultBody.replaceChildren(...visible.map((a) => resultRow(a, state.me)));
    tableKey = key;
  }
  return Array.from(els.resultBody.children);
}

function cell(label, content, className) {
  const td = el("td", className);
  td.setAttribute("role", "cell");
  td.dataset.label = label;
  if (content instanceof Node) td.append(content);
  else td.textContent = content;
  return td;
}

function resultRow(a, me) {
  const t = a.task;
  const isMine = a.participant_id !== null && a.participant_id === me;
  const tr = el("tr", isMine ? "is-mine" : a.participant_id === null ? "is-unassigned" : "");
  tr.setAttribute("role", "row");

  const what = el("span", "task-what", t.what);
  const assignee = el("span", "assignee");
  if (a.participant_id === null) {
    assignee.append(el("span", "unassigned", "Unassigned"), el("span", "reason", a.reason || "No compatible person was online."));
  } else {
    if (isMine) assignee.append(el("span", "tag tag-you", "You"));
    assignee.append(el("span", "assignee-name", a.participant.name));
  }

  const match = el("span", "match");
  if (a.participant_id === null) { match.classList.add("match-none"); match.append(el("span", null, "—"), el("span", "sr-only", "Not applicable")); }
  else if (a.team_match === true) { match.classList.add("match-yes"); match.append(statusIcon("check"), document.createTextNode("Team match")); }
  else if (a.team_match === false) { match.classList.add("match-no"); match.append(statusIcon("swap"), document.createTextNode("Cross-team")); }
  else { match.classList.add("match-neutral"); match.append(statusIcon("dash"), document.createTextNode("Any team")); }

  tr.append(
    cell("Task", what, "c-what"),
    cell("Theme", t.theme),
    cell("Device", t.device),
    cell("Platform", t.platform),
    cell("Task team", t.team ?? "Any"),
    cell("Assigned to", assignee, "c-assignee"),
    cell("Their team", a.participant ? a.participant.team : "—"),
    cell("Team match", match, "c-match")
  );
  return tr;
}

// ---- complaints and the second spin

function renderComplaints(state) {
  const snap = state.snapshot;
  const { room, complaints } = snap;
  const visible = room.status !== "lobby" && state.stageSpin >= 1 && !state.revealing;
  els.complaints.hidden = !visible;
  if (!visible) return;

  const isHost = room.host_user_id === state.me;
  const threshold = CONFIG.complaintThreshold;
  const count = complaints.length;

  if (room.status === "final") {
    els.complaintCount.textContent = "Final result";
    els.complaintHint.textContent = "Both spins are used. No more spins or complaints.";
    els.complainBtn.hidden = true;
    els.respinBtn.hidden = true;
    return;
  }

  els.complaintCount.textContent = count < threshold ? `${count} of ${threshold} complaints` : plural(count, "complaint");
  if (lastComplaintCount !== null && count > lastComplaintCount) bump(els.complaintCount);
  lastComplaintCount = count;

  const iComplained = complaints.some((c) => c.user_id === state.me);
  els.complainBtn.hidden = false;
  els.complainBtn.disabled = iComplained || state.busy === "complain";
  els.complainBtn.textContent = iComplained ? "You complained" : state.busy === "complain" ? "Sending…" : "Complain";

  const rule = spinRule(room, count, threshold);
  els.respinBtn.hidden = !isHost;
  if (isHost) {
    els.respinBtn.disabled = !(rule.allowed && moderatorCanAct(state));
    els.respinBtn.textContent = state.busy === "spin" ? "Spinning…" : "Spin again";
    els.complaintHint.textContent = rule.allowed
      ? moderatorStatus(state) ?? "Second spin unlocked. It reassigns every task and is final."
      : rule.reason;
  } else {
    els.complaintHint.textContent = count < threshold
      ? `Not happy? If ${threshold} or more people complain, the moderator can run one final spin.`
      : "Second spin unlocked. Waiting for the moderator.";
  }
}

export function focusResultTitle() {
  els.resultTitle.focus({ preventScroll: true });
}

export function flashCopied() {
  const original = "Copy invite link";
  els.copyLink.textContent = "Copied";
  clearTimeout(flashCopied.timer);
  flashCopied.timer = setTimeout(() => { els.copyLink.textContent = original; }, 2000);
}
