/** Safe DOM rendering and accessible interaction helpers. User-controlled strings are always textContent. */
const SVG_NS = "http://www.w3.org/2000/svg";

function element(tag, className = "", text = null) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== null && text !== undefined) item.textContent = String(text);
  return item;
}

function svgElement(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function wheelMark() {
  const mark = element("span", "brand-mark");
  const svg = svgElement("svg", { viewBox: "0 0 44 44", "aria-hidden": "true", focusable: "false" });
  svg.append(svgElement("circle", { cx: 22, cy: 22, r: 17, fill: "none", stroke: "currentColor", "stroke-width": 2.5 }));
  svg.append(svgElement("circle", { cx: 22, cy: 22, r: 4, fill: "currentColor" }));
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * index) / 4;
    svg.append(svgElement("line", {
      x1: 22 + Math.cos(angle) * 6,
      y1: 22 + Math.sin(angle) * 6,
      x2: 22 + Math.cos(angle) * 15,
      y2: 22 + Math.sin(angle) * 15,
      stroke: "currentColor",
      "stroke-width": 1.4,
      "stroke-linecap": "round"
    }));
  }
  mark.append(svg);
  return mark;
}

function button(text, className, onClick, { disabled = false, title = "", type = "button" } = {}) {
  const control = element("button", `button ${className || "button-secondary"}`, text);
  control.type = type;
  control.disabled = Boolean(disabled);
  if (title) control.title = title;
  if (typeof onClick === "function") control.addEventListener("click", onClick);
  return control;
}

function labelControl(labelText, input, hint = "") {
  const wrapper = element("label", "field");
  wrapper.append(element("span", "field-label", labelText), input);
  if (hint) wrapper.append(element("span", "field-hint", hint));
  return wrapper;
}

function textInput({ value = "", placeholder = "", type = "text", required = false, maxLength = null, key, autocomplete = "off", disabled = false, readonly = false, onInput }) {
  const input = element("input", "input");
  input.type = type;
  input.value = value ?? "";
  input.placeholder = placeholder;
  input.required = required;
  input.autocomplete = autocomplete;
  input.disabled = disabled;
  if (maxLength) input.maxLength = maxLength;
  input.readOnly = readonly;
  if (key) input.dataset.focusKey = key;
  if (onInput) input.addEventListener("input", () => onInput(input.value));
  return input;
}

function textArea({ value = "", placeholder = "", rows = 4, key, readonly = false, onInput, spellcheck = false }) {
  const textarea = element("textarea", "textarea");
  textarea.value = value ?? "";
  textarea.placeholder = placeholder;
  textarea.rows = rows;
  textarea.readOnly = readonly;
  textarea.spellcheck = spellcheck;
  if (key) textarea.dataset.focusKey = key;
  if (onInput) textarea.addEventListener("input", () => onInput(textarea.value));
  return textarea;
}

function selectInput({ value = "AF", options, key, onChange }) {
  const select = element("select", "input select-input");
  if (key) select.dataset.focusKey = key;
  options.forEach((option) => {
    const opt = element("option", "", option.label);
    opt.value = option.value;
    select.append(opt);
  });
  select.value = value;
  if (onChange) select.addEventListener("change", () => onChange(select.value));
  return select;
}

function checkbox(labelText, checked, onChange, hint = "") {
  const label = element("label", "checkbox-field");
  const input = element("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked));
  label.append(input, element("span", "checkbox-copy", labelText));
  if (hint) label.append(element("span", "checkbox-hint", hint));
  return label;
}

function sectionHeading(kicker, title, helper = "") {
  const heading = element("div", "section-heading");
  heading.append(element("span", "eyebrow", kicker), element("h2", "", title));
  if (helper) heading.append(element("p", "muted", helper));
  return heading;
}

function statusPill(label, tone = "neutral") {
  const pill = element("span", `status-pill status-${tone}`);
  pill.append(element("span", "status-dot"), element("span", "", label));
  return pill;
}

function noticeBox(text, tone = "info", title = "") {
  const box = element("div", `notice notice-${tone}`);
  if (title) box.append(element("strong", "", title));
  box.append(element("p", "", text));
  return box;
}

function profileFields(draft, onDraft, prefix = "profile") {
  const fields = element("div", "profile-fields");
  fields.append(labelControl("Display name", textInput({
    value: draft.name,
    placeholder: "e.g. Alex",
    required: true,
    maxLength: 40,
    key: `${prefix}-name`,
    autocomplete: "name",
    onInput: (value) => onDraft("name", value)
  })));
  fields.append(labelControl("Team", selectInput({
    value: draft.team || "AF",
    key: `${prefix}-team`,
    options: [{ value: "AF", label: "AF" }, { value: "CYD", label: "CYD" }, { value: "PB", label: "PB" }],
    onChange: (value) => onDraft("team", value)
  })));
  const phones = element("div", "phone-options");
  phones.append(element("span", "field-label", "Phone availability"));
  const phoneRow = element("div", "phone-checkbox-row");
  phoneRow.append(
    checkbox("Android", draft.android, (value) => onDraft("android", value), "Optional"),
    checkbox("iOS", draft.ios, (value) => onDraft("ios", value), "Optional")
  );
  phones.append(phoneRow, element("p", "field-hint", "Desktop tasks need no phone. Either or both phones enable mobile tasks."));
  fields.append(phones);
  return fields;
}

function commonHeader({ subtitle = "QA assignment workspace", right = null } = {}) {
  const header = element("header", "app-header");
  const brand = element("div", "brand-lockup");
  brand.append(wheelMark());
  const copy = element("div", "brand-copy");
  copy.append(element("strong", "brand-name", "WheelOfTest"), element("span", "brand-subtitle", subtitle));
  brand.append(copy);
  header.append(brand);
  if (right) header.append(right);
  return header;
}

function footer() {
  const item = element("footer", "app-footer");
  item.append(element("span", "", "WheelOfTest · Local-first QA tooling"), element("span", "", "No backend · No external signaling · No tracking"));
  return item;
}

function renderLanding(model, actions) {
  const page = element("div", "page-shell landing-page");
  const header = commonHeader({
    subtitle: "A thoughtful way to share the next test",
    right: statusPill("Local-first", "gold")
  });
  page.append(header);

  const hero = element("section", "landing-hero");
  const heroCopy = element("div", "hero-copy");
  heroCopy.append(element("span", "eyebrow", "RELEASE QUALITY · TEAM WORKFLOW"));
  heroCopy.append(element("h1", "hero-title", "Make the next test assignment count."));
  heroCopy.append(element("p", "hero-description", "A focused, fair task draw for your QA team. Match release work to the right team first, keep every decision visible, and resolve one complaint with a second spin."));
  const heroStats = element("div", "hero-signals");
  heroStats.append(
    statItem("22", "curated tasks"),
    statItem("2", "spins maximum"),
    statItem("0", "external services")
  );
  heroCopy.append(heroStats);

  const createCard = element("section", "panel create-panel");
  createCard.append(element("span", "eyebrow", "HOST WORKSPACE"), element("h2", "panel-title", "Create a test room"));
  createCard.append(element("p", "muted", "The host owns the authoritative room state in this browser. Create a room to begin; no account or backend is involved."));
  const hostDraft = model.hostDraft || { name: "", team: "AF", android: false, ios: false };
  createCard.append(checkbox("I'll test too", model.hostTesterEnabled, actions.onHostTesterToggle, "Optional host-local tester profile"));
  if (model.hostTesterEnabled) {
    createCard.append(profileFields(hostDraft, actions.onHostDraft, "host"));
    createCard.append(element("p", "field-hint", "The host is eligible only while this host page is active."));
  }
  createCard.append(button("Create a test room", "button-primary button-wide", actions.onCreateRoom, {
    disabled: model.creatingRoom || !model.storageAvailable,
    title: !model.storageAvailable ? "Browser storage is not writable. Use Retry storage before creating a room." : "Create a new room without deleting saved rooms."
  }));
  if (!model.storageAvailable) createCard.append(button("Retry browser storage", "button-secondary button-wide", actions.onRetryStorage));
  if (model.error) createCard.append(noticeBox(model.error, "danger", "Action needs attention"));
  if (model.notice) createCard.append(noticeBox(model.notice, "success"));
  if (model.storageError) createCard.append(noticeBox(model.storageError, "danger", "Storage warning"));
  hero.append(heroCopy, createCard);
  page.append(hero);

  const workspaceRow = element("section", "landing-secondary-grid");
  const joinCard = element("section", "panel join-panel");
  joinCard.append(sectionHeading("JOIN A ROOM", "Have a room code?", "A code locates the room; it does not connect a guest or sync state by itself."));
  const roomForm = element("form", "join-form");
  roomForm.addEventListener("submit", (event) => { event.preventDefault(); actions.onJoinRoom(); });
  roomForm.append(labelControl("Six-character room code", textInput({ value: model.roomCodeDraft || "", placeholder: "ABC123", maxLength: 6, key: "landing-room-code", onInput: actions.onRoomCodeDraft })), button("Continue as guest", "button-secondary", null, { type: "submit" }));
  joinCard.append(roomForm);
  if (model.savedRoom) {
    const saved = element("div", "saved-room-card");
    const details = element("div", "saved-room-details");
    details.append(element("strong", "", `Saved room ${model.savedRoom.roomCode}`), element("span", "muted small", `${model.savedRoom.status} · ${model.savedRoom.spinsUsed}/2 spins · updated ${formatDate(model.savedRoom.updatedAt)}`));
    saved.append(details, button("Resume", "button-secondary", () => actions.onResumeRoom(model.savedRoom.roomCode)));
    joinCard.append(saved);
  }
  if (model.storageWarnings?.length) joinCard.append(noticeBox(model.storageWarnings.join(" "), "warning", "Saved room warning"));

  const howCard = element("section", "panel how-panel");
  howCard.append(sectionHeading("HOW IT WORKS", "Three clear steps"));
  const steps = element("ol", "step-list");
  [
    ["Create", "The host creates a local room and shares its invite URL."],
    ["Connect", "Each guest exchanges a unique WebRTC offer and answer code with the host."],
    ["Assign", "Spin 1 proposes a task/developer pair. A valid complaint enables one final replacement spin."]
  ].forEach(([title, copy], index) => {
    const li = element("li", "step-item");
    li.append(element("span", "step-number", String(index + 1)), element("div", "step-copy", ""));
    li.lastChild.append(element("strong", "", title), element("p", "muted", copy));
    steps.append(li);
  });
  howCard.append(steps);
  workspaceRow.append(joinCard, howCard);
  page.append(workspaceRow);
  page.append(noticeBox("Direct peer-to-peer connectivity is best-effort without STUN/TURN. It may work on the same LAN and fail across NATs, VPNs or restrictive networks. Room data is shared only while the host and a guest have an active data channel.", "warning", "Connectivity limitation"));
  page.append(footer());
  return page;
}

function statItem(value, label) {
  const item = element("div", "hero-stat");
  item.append(element("strong", "", value), element("span", "", label));
  return item;
}

function formatDate(timestamp) {
  if (!Number.isFinite(timestamp)) return "unknown";
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp)); }
  catch { return new Date(timestamp).toLocaleString(); }
}

function createDecorativeWheel() {
  const wheel = element("div", "reveal-wheel");
  wheel.setAttribute("aria-label", "Decorative reveal wheel; the assignment is selected by rules before the animation.");
  const pointer = element("div", "wheel-pointer");
  const disc = element("div", "wheel-disc");
  const sectors = element("div", "wheel-sectors");
  ["TEAM", "TEST", "DEVICE", "FLOW", "TEAM", "TEST", "DEVICE", "FLOW"].forEach((label, index) => {
    const sector = element("span", `wheel-sector wheel-sector-${index % 4}`, label);
    sector.style.setProperty("--sector-index", String(index));
    sectors.append(sector);
  });
  disc.append(sectors, element("div", "wheel-hub", "W"));
  wheel.append(pointer, disc);
  return wheel;
}

function personInitials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "?").join("").toUpperCase();
}

function profileLine(profile, stateLabel, tone, isHost = false) {
  const row = element("li", "participant-row");
  const avatar = element("span", `avatar avatar-${profile.team || "neutral"}`, personInitials(profile.name));
  avatar.setAttribute("aria-hidden", "true");
  const text = element("div", "participant-copy");
  const nameRow = element("div", "participant-name-row");
  nameRow.append(element("strong", "participant-name", profile.name));
  if (isHost || profile.hostTester) nameRow.append(element("span", "mini-label mini-host", "Host · Tester"));
  nameRow.append(element("span", `team-badge team-${profile.team || "neutral"}`, profile.team || "—"));
  text.append(nameRow);
  const deviceTags = element("div", "device-tags");
  deviceTags.append(element("span", "device-tag", profile.android ? "Android" : "No Android"), element("span", "device-tag", profile.ios ? "iOS" : "No iOS"));
  text.append(deviceTags);
  row.append(avatar, text, statusPill(stateLabel, tone));
  return row;
}

function participantsPanel(model, actions) {
  const panel = element("section", "panel participants-panel");
  const heading = sectionHeading("ROOM ROSTER", "Participants & connection", "Only live, accepted data channels are eligible for an assignment.");
  const liveCount = Number.isInteger(model.liveCount) ? model.liveCount : 0;
  heading.append(statusPill(`${liveCount} live`, liveCount ? "success" : "neutral"));
  panel.append(heading);
  const list = element("ul", "participant-list");
  const rows = model.participantRows || [];
  if (!rows.length) {
    const empty = element("li", "empty-state");
    empty.append(element("strong", "", "No participants yet"), element("p", "muted", "Create a connection code and invite a developer. Participants appear here only after their data channel is open and their profile is accepted."));
    list.append(empty);
  } else {
    rows.forEach((row) => list.append(profileLine(row.profile, row.stateLabel, row.tone, row.isHost)));
  }
  panel.append(list);
  const invite = element("div", "invite-box");
  invite.append(element("span", "field-label", "Guest invite URL"));
  invite.append(textInput({ value: model.inviteUrl || "", readonly: true, key: "invite-url" }));
  const inviteActions = element("div", "button-row");
  inviteActions.append(button("Copy invite URL", "button-secondary", actions.onCopyInvite));
  invite.append(inviteActions);
  if (model.role === "host") {
    panel.append(invite);
    panel.append(hostSignalingPanel(model, actions));
  } else {
    const connectionNotice = model.guestOnline
      ? noticeBox("The data channel is open and the host snapshot is current.", "success", "Connected to host")
      : noticeBox("Not connected to the host. The snapshot below, if present, is historical and must not be treated as live. Use a fresh offer/answer exchange to reconnect.", "warning", "Guest connection status");
    panel.append(connectionNotice);
    if (model.error) panel.append(noticeBox(model.error, "danger", "Connection message"));
  }
  return panel;
}

function hostSignalingPanel(model, actions) {
  const section = element("div", "signaling-section");
  section.append(element("div", "subsection-title", "Manual WebRTC signaling"));
  section.append(element("p", "muted small", "Create one offer per guest. The answer must be pasted into the matching connection row; codes expire after 10 minutes."));
  section.append(button(model.creatingOffer ? "Creating connection code…" : "Create connection code", "button-primary button-wide", actions.onCreateOffer, {
    disabled: model.creatingOffer || !model.storageAvailable,
    title: model.creatingOffer ? "Waiting for ICE gathering." : "Creates a new peer connection for one guest."
  }));
  if (model.signalingError) section.append(noticeBox(model.signalingError, "danger"));
  if (model.offers?.length) {
    const offerList = element("div", "offer-list");
    model.offers.forEach((offer) => {
      const card = element("div", "offer-card");
      const top = element("div", "offer-card-top");
      const left = element("div", "", "");
      left.append(element("strong", "", `Connection ${offer.connectionId.slice(0, 14)}`), element("span", "muted small", offer.statusLabel || "Waiting for answer"));
      top.append(left, statusPill(offer.stateLabel || "Pending", offer.tone || "neutral"));
      card.append(top, labelControl("Host offer code", textArea({ value: offer.code, rows: 3, readonly: true, key: `offer-code-${offer.connectionId}` })));
      card.append(button("Copy offer", "button-secondary button-small", () => actions.onCopyOffer(offer.connectionId)));
      card.append(labelControl("Guest answer code", textArea({ value: model.answerDrafts?.[offer.connectionId] || "", placeholder: "Paste the answer returned by this guest…", rows: 3, key: `answer-${offer.connectionId}`, onInput: (value) => actions.onAnswerDraft(offer.connectionId, value) })));
      const controls = element("div", "button-row");
      controls.append(button("Apply matching answer", "button-secondary", () => actions.onApplyAnswer(offer.connectionId), { disabled: offer.answerApplied || offer.closed || model.applyingAnswer === offer.connectionId }));
      controls.append(button("Close peer", "button-quiet-danger", () => actions.onClosePeer(offer.connectionId)));
      card.append(controls);
      offerList.append(card);
    });
    section.append(offerList);
  }
  if (model.peerDiagnostics?.length) {
    const details = element("details", "diagnostics-details");
    details.append(element("summary", "", "Connection diagnostics"));
    const list = element("ul", "diagnostics-list");
    model.peerDiagnostics.forEach((peer) => {
      const row = element("li", "diagnostic-row");
      row.append(element("span", "", peer.connectionId.slice(0, 18)), element("span", "muted", `PC ${peer.connectionState || "new"} · ICE ${peer.iceState || "new"} · ${peer.profileAccepted ? "profile accepted" : "awaiting profile"}`));
      list.append(row);
    });
    details.append(list);
    section.append(details);
  }
  section.append(noticeBox("This is direct WebRTC with iceServers: []. No STUN/TURN or signaling service is used. Same-network connections may work; other networks are not guaranteed.", "warning", "Best-effort connectivity"));
  return section;
}

function assignmentStatus(assignment, room) {
  if (assignment.void) return { label: "CHALLENGED · VOID", tone: "danger" };
  if (assignment.final || room.status === "completed") return { label: "FINAL RESULT", tone: "gold" };
  if (room.status === "challenged") return { label: "CHALLENGED · PROVISIONAL", tone: "warning" };
  return { label: "PROVISIONAL RESULT", tone: "viridian" };
}

function resultCard(assignment, room, { compact = false } = {}) {
  const card = element("article", `assignment-card${compact ? " assignment-card-compact" : ""}`);
  const state = assignmentStatus(assignment, room);
  const header = element("div", "assignment-card-header");
  header.append(statusPill(state.label, state.tone), element("span", "assignment-time", formatDate(assignment.timestamp)));
  card.append(header);
  card.append(element("div", "assignment-task-title", assignment.task.what));
  const taskMeta = element("div", "assignment-meta");
  taskMeta.append(element("span", "meta-chip", assignment.task.theme.toUpperCase()), element("span", "meta-chip", assignment.task.device.toUpperCase()), element("span", "meta-chip", assignment.task.platform));
  if (assignment.task.team) taskMeta.append(element("span", `team-badge team-${assignment.task.team}`, `Task team · ${assignment.task.team}`));
  else taskMeta.append(element("span", "meta-chip meta-neutral", "Neutral team"));
  card.append(taskMeta);
  const developer = element("div", "assignment-developer");
  developer.append(element("span", "eyebrow", `SPIN ${assignment.spinNumber} · DEVELOPER`), element("strong", "developer-name", assignment.developer.name));
  const teamStatus = assignment.teamsMatched ? "Team match" : (assignment.task.team ? "Cross-team fallback" : "Neutral task");
  developer.append(element("div", "developer-detail", `${assignment.developer.team} · ${teamStatus}`));
  const phones = element("div", "device-tags");
  phones.append(element("span", "device-tag", assignment.developer.android ? "Android available" : "Android unavailable"), element("span", "device-tag", assignment.developer.ios ? "iOS available" : "iOS unavailable"));
  developer.append(phones);
  card.append(developer);
  const metadata = element("div", "assignment-detail-grid");
  metadata.append(detailItem("Browser / device", assignment.task.device), detailItem("Platform", assignment.task.platform), detailItem("Task theme", assignment.task.theme), detailItem("Role metadata", assignment.task.users?.join(", ") || "—"));
  card.append(metadata);
  if (assignment.challenged && !assignment.void) card.append(element("p", "assignment-note", "The team filed a complaint, then explicitly accepted the original result because no compatible replacement pair was available."));
  return card;
}

function detailItem(label, value) {
  const item = element("div", "detail-item");
  item.append(element("span", "muted", label), element("strong", "", value));
  return item;
}

function wheelPanel(model, actions) {
  const panel = element("section", "panel wheel-panel");
  const heading = sectionHeading("ASSIGNMENT ENGINE", "Task / developer draw", "Team-first rules choose a valid pair. The wheel only reveals the already-committed result.");
  const statusText = ({ waiting: "Ready to spin", result: "Spin 1 · Provisional", challenged: "Complaint received", completed: "Room complete" })[model.room.status] || model.room.status;
  heading.append(statusPill(statusText, model.room.status === "completed" ? "gold" : model.room.status === "challenged" ? "warning" : model.room.status === "result" ? "viridian" : "neutral"));
  panel.append(heading);
  const metricRow = element("div", "wheel-metrics");
  metricRow.append(statItem(String(model.remainingTaskCount), "unused tasks"), statItem(String(model.pairCount), "valid pairs"), statItem(`${model.room.spinsUsed}/2`, "spins used"));
  panel.append(metricRow);
  panel.append(createDecorativeWheel());
  panel.append(element("p", "wheel-disclaimer", "Decorative reveal · the result is selected by validated business rules, not by wheel rotation."));
  if (model.blocker && model.room.status === "waiting") panel.append(noticeBox(model.blocker, "warning", "Spin unavailable"));
  if (model.room.status === "challenged" && !model.replacementAvailable) panel.append(noticeBox("No unused compatible task/developer pair is currently available. Spin 2 has not been consumed; reconnect an eligible tester and retry, or explicitly accept the original result below.", "warning", "Replacement unavailable"));
  if (model.error) panel.append(noticeBox(model.error, "danger", "Action needs attention"));
  if (model.notice) panel.append(noticeBox(model.notice, "success"));

  const controls = element("div", "spin-controls");
  if (model.role === "host" && model.room.status === "waiting") {
    const reason = !model.storageAvailable ? "Retry browser storage before changing room state." : model.blocker || (model.animationBusy ? "Wait for the reveal to finish." : "Choose a task/developer pair.");
    controls.append(button(model.animationBusy ? "Revealing result…" : "Spin 1 · Draw assignment", "button-primary button-wide button-spin", actions.onSpin1, {
      disabled: !model.storageAvailable || Boolean(model.blocker) || model.animationBusy,
      title: reason
    }));
    controls.append(element("p", "control-hint", reason));
  } else if (model.role === "host" && model.room.status === "result") {
    controls.append(button("Accept result · Finish room", "button-primary button-wide", actions.onAcceptResult, {
      disabled: !model.storageAvailable || model.animationBusy,
      title: model.animationBusy ? "Wait for the reveal to finish." : "Finalize Spin 1 without using Spin 2."
    }));
    controls.append(element("p", "control-hint", "No complaint has been filed. Accepting finalizes Spin 1 without spending the second spin."));
  } else if (model.role === "host" && model.room.status === "challenged") {
    controls.append(button("Spin 2 · Resolve", "button-primary button-wide button-spin", actions.onSpin2, {
      disabled: !model.storageAvailable || !model.replacementAvailable || model.animationBusy,
      title: !model.storageAvailable ? "Retry browser storage." : !model.replacementAvailable ? "No compatible unused pair is available." : model.animationBusy ? "Wait for the reveal to finish." : "Choose a replacement from unused tasks."
    }));
    controls.append(element("p", "control-hint", "The replacement task cannot repeat Spin 1. The same developer may be selected again."));
    if (!model.replacementAvailable) controls.append(button("Accept original result anyway…", "button-warning button-wide", actions.onAcceptOriginal, { disabled: !model.storageAvailable || model.animationBusy }));
  } else if (model.room.status === "completed") {
    controls.append(noticeBox("This room is final. No further spins or complaints are accepted. Create a new room for another assignment.", "success", "Assignment locked"));
  } else if (model.role === "guest") {
    controls.append(noticeBox("Only the host can draw assignments or finalize the room.", "info", "Host-controlled action"));
  }
  panel.append(controls);
  const timeline = element("ol", "timeline");
  [
    { label: "Room created", done: true },
    { label: "Spin 1 committed", done: model.room.spinsUsed >= 1 },
    { label: "Complaint received", done: model.room.complaints.length > 0 },
    { label: "Final result", done: model.room.status === "completed" }
  ].forEach((item) => {
    const row = element("li", `timeline-item${item.done ? " timeline-done" : ""}`);
    row.append(element("span", "timeline-marker"), element("span", "", item.label));
    timeline.append(row);
  });
  panel.append(timeline);
  return panel;
}

function resultPanel(model, actions) {
  const panel = element("section", "panel result-panel");
  panel.append(sectionHeading("AUDIT TRAIL", "Result & history", "Every committed assignment stays in history; the newest appears first."));
  if (!model.room.assignments.length) {
    const empty = element("div", "result-empty");
    empty.append(element("span", "result-empty-mark", "—"), element("strong", "", "No assignment yet"), element("p", "muted", "When the host commits Spin 1, the full task/developer pair and its audit details appear here."));
    panel.append(empty);
  } else {
    const assignmentList = element("div", "assignment-history");
    [...model.room.assignments].reverse().forEach((assignment) => assignmentList.append(resultCard(assignment, model.room)));
    panel.append(assignmentList);
  }
  const complaints = element("div", "complaint-section");
  complaints.append(element("div", "subsection-title", `Complaints (${model.room.complaints.length})`));
  if (model.room.complaints.length) {
    const list = element("ul", "complaint-list");
    [...model.room.complaints].reverse().forEach((complaint) => {
      const item = element("li", "complaint-row");
      item.append(element("span", "complaint-bullet", "!"), element("div", "complaint-copy", ""));
      item.lastChild.append(element("strong", "", complaint.participantName), element("span", "muted small", formatDate(complaint.timestamp)));
      list.append(item);
    });
    complaints.append(list);
  } else {
    complaints.append(element("p", "muted small", "No complaint has been filed."));
  }
  const myId = model.myParticipantId;
  const hasComplained = Boolean(myId && model.room.complaints.some((complaint) => complaint.participantId === myId));
  const canComplain = Boolean(myId && model.isMyParticipantLive && model.room.spinsUsed === 1 && model.room.status !== "completed" && !hasComplained);
  if (model.role === "guest" || (model.role === "host" && model.hostProfile)) {
    complaints.append(button(hasComplained ? "Complaint already submitted" : "Complain about this result", "button-secondary", actions.onComplain, {
      disabled: !canComplain,
      title: !model.isMyParticipantLive ? "Your participant profile is not currently live." : hasComplained ? "A participant may complain only once per room." : model.room.status === "completed" ? "The room is complete." : "Files one complaint for your own connected participant profile."
    }));
    if (!canComplain && !hasComplained && model.room.status !== "completed") complaints.append(element("p", "control-hint", "Complaint is available only to your live participant profile after Spin 1."));
  }
  panel.append(complaints);
  return panel;
}

function renderRoom(model, actions) {
  const page = element("div", "page-shell room-page");
  const topRight = element("div", "header-actions");
  topRight.append(statusPill(model.role === "host" ? "Host authority · this browser" : (model.guestOnline ? "Live connection" : "Guest · offline"), model.role === "host" ? "gold" : model.guestOnline ? "success" : "warning"));
  topRight.append(button("Dashboard", "button-quiet", actions.onDashboard));
  topRight.append(button("New room", "button-secondary", actions.onNewRoom));
  page.append(commonHeader({ subtitle: `Room ${model.room?.roomCode || model.roomCode || "Guest connection"}`, right: topRight }));

  if (model.role === "guest" && !model.guestSnapshotReceived) {
    page.append(element("section", "guest-room-intro", ""));
    const guestIntro = page.lastChild;
    guestIntro.append(element("span", "eyebrow", `ROOM ${model.room?.roomCode || model.roomCode} · GUEST VIEW`), element("h1", "room-title", "Connect to the host."), element("p", "muted", "A room code is a locator only. You need a fresh host offer and a matching answer before any shared state can appear."));
    page.append(guestConnectionPanel(model, actions));
    if (model.error) page.append(noticeBox(model.error, "danger", "Action needs attention"));
    page.append(noticeBox("A room code is only a locator. The host must be online, create a unique offer, and return the matching answer before this browser can receive an authoritative snapshot.", "info", "Waiting for the real host snapshot"));
    page.append(footer());
    return page;
  }

  if (!model.room) {
    page.append(noticeBox("No authoritative room snapshot is available.", "warning", "Room unavailable"));
    page.append(footer());
    return page;
  }
  const roomIntro = element("section", "room-intro");
  const titleBlock = element("div", "", "");
  titleBlock.append(element("span", "eyebrow", `ROOM ${model.room.roomCode} · ${model.role.toUpperCase()} VIEW`), element("h1", "room-title", model.room.status === "completed" ? "Assignment finalized." : "Keep the next test moving."));
  titleBlock.append(element("p", "muted", "A transparent task draw with team-first matching, explicit complaints, and a complete audit trail."));
  roomIntro.append(titleBlock);
  const roomMeta = element("div", "room-meta-strip");
  roomMeta.append(detailItem("Lifecycle", model.room.status), detailItem("State version", String(model.room.stateVersion)), detailItem("Tasks used", `${model.room.usedTaskIds.length} / 22`));
  roomIntro.append(roomMeta);
  page.append(roomIntro);

  if (model.storageError) page.append(noticeBox(model.storageError, "danger", "Persistence error"));
  if (model.warning) page.append(noticeBox(model.warning, "warning", "Important limitation"));
  if (!model.storageAvailable && model.role === "host") {
    const storageNotice = element("div", "notice notice-danger storage-retry-row");
    storageNotice.append(element("p", "", "State-changing actions are paused because the last persistence operation failed. The previous committed state is still active in memory."), button("Retry storage", "button-secondary", actions.onRetryStorage));
    page.append(storageNotice);
  }
  if (model.guestHistorical) page.append(noticeBox("The host connection is closed or stale. This view shows the last received snapshot for reference only; no participant is marked live until a fresh snapshot arrives.", "warning", "Historical snapshot · offline"));
  if (model.error) page.append(noticeBox(model.error, "danger", "Action needs attention"));

  const dashboard = element("section", "room-dashboard-grid");
  dashboard.append(participantsPanel(model, actions), wheelPanel(model, actions), resultPanel(model, actions));
  page.append(dashboard);
  page.append(footer());
  return page;
}

function guestConnectionPanel(model, actions) {
  const panel = element("section", "panel guest-connect-panel");
  panel.append(sectionHeading("GUEST SETUP", "Connect to the host", `Room ${model.room?.roomCode || model.roomCode} · Your browser stores only your own profile.`));
  panel.append(noticeBox("Connection is best-effort without external STUN/TURN. Keep the host browser open while exchanging codes. Share offer/answer codes only with the intended participant.", "warning", "Before you connect"));
  const form = element("form", "guest-profile-form");
  form.addEventListener("submit", (event) => { event.preventDefault(); actions.onGuestConnect(); });
  form.append(profileFields(model.profileDraft, actions.onProfileDraft, "guest"));
  form.append(labelControl("Paste the host offer code", textArea({ value: model.guestOfferDraft || "", placeholder: "Paste the full JSON offer code here…", rows: 6, key: "guest-offer-code", onInput: actions.onGuestOfferDraft })));
  form.append(button(model.creatingAnswer ? "Preparing answer…" : "Create answer code", "button-primary button-wide", null, { type: "submit", disabled: model.creatingAnswer }));
  if (model.guestConnectionError) form.append(noticeBox(model.guestConnectionError, "danger", "Could not connect"));
  panel.append(form);
  if (model.guestAnswerCode) {
    const answerCard = element("div", "answer-card");
    answerCard.append(element("h3", "", "Send this answer to the host"), element("p", "muted", "Return this exact code to the host row that created your offer. It expires 10 minutes after the offer was created."));
    answerCard.append(labelControl("Guest answer code", textArea({ value: model.guestAnswerCode, rows: 6, readonly: true, key: "guest-answer-code" })));
    answerCard.append(button("Copy answer code", "button-secondary", actions.onCopyGuestAnswer));
    answerCard.append(element("p", "field-hint", model.guestTransportStatus || "Waiting for the host to apply the answer and accept your profile…"));
    panel.append(answerCard);
  }
  return panel;
}

function restoreFocus(root, activeKey, selectionStart, selectionEnd) {
  if (!activeKey) return;
  const target = [...root.querySelectorAll("[data-focus-key]")].find((item) => item.dataset.focusKey === activeKey);
  if (!target) return;
  target.focus({ preventScroll: true });
  if (typeof target.setSelectionRange === "function" && selectionStart !== null && selectionEnd !== null) {
    try { target.setSelectionRange(selectionStart, selectionEnd); } catch {}
  }
}

export function createUI(root) {
  function render(model, actions) {
    const active = document.activeElement;
    const activeKey = active && root.contains(active) ? active.dataset.focusKey : null;
    const selectionStart = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    const selectionEnd = active && typeof active.selectionEnd === "number" ? active.selectionEnd : null;
    let page;
    if (model.screen === "landing") page = renderLanding(model, actions);
    else page = renderRoom(model, actions);
    root.replaceChildren(page);
    restoreFocus(root, activeKey, selectionStart, selectionEnd);
  }

  return { render };
}
