// DOM rendering for both views. User-supplied text is always set with textContent.

import { CONFIG } from "./config.js";
import { DEVICES, BROWSERS, MAC_BROWSER, USER_LEVELS, THEMES } from "./tasks.js";
import {
  spinRule, tasksEditable, isDefaultTaskList, taskBrowsers,
  hasCriticalFlows, isCriticalFlow, CRITICAL_FLOW_COUNT,
  peopleShortOfTasks, takeoversOpen, canRequestTakeover, canResolveTakeover, requestFor, pendingRequests,
  canReceiveTask, isOwner, tasksOf, canJoinTask, canLeaveTask
} from "./domain.js";
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
  sessionLinks: $("session-links"), sessionLinksList: $("session-links-list"), linksEdit: $("links-edit"),
  linksForm: $("links-form"), roomLinks: $("room-links"), linksError: $("links-error"), linksCancel: $("links-cancel"), linksSave: $("links-save"),
  formSettings: $("form-settings"), formColRoom: $("form-col-room"), tasksPerPerson: $("tasks-per-person"), tasksPerPersonError: $("tasks-per-person-error"), formLinks: $("form-links"),
  roomSettings: $("room-settings"), roomStepper: $("room-stepper"), roomTasksPerPerson: $("room-tasks-per-person"),
  roomTasksPerPersonValue: $("room-tasks-per-person-value"), roomSettingsHint: $("room-settings-hint"),
  resultAdd: $("result-add"), resultSettings: $("result-settings"),
  taskTesters: $("task-testers"), taskTestersChips: $("task-testers-chips"), taskTestersNote: $("task-testers-note"),
  testersDialog: $("testers-dialog"), testersForm: $("testers-form"), testersTask: $("testers-task"), testersChips: $("testers-chips"),
  testersError: $("testers-error"), testersCancel: $("testers-cancel"), testersSave: $("testers-save"),
  wheelArea: $("wheel-area"), wheelStage: $("wheel-stage"), wheelRotor: $("wheel-rotor"),
  spinBtn: $("spin-btn"), wheelStatus: $("wheel-status"), wheelWarning: $("wheel-warning"),
  resultArea: $("result-area"), resultTitle: $("result-title"), myCount: $("my-count"), resultHint: $("result-hint"),
  takeovers: $("takeovers"), takeoversTitle: $("takeovers-title"), takeoversHint: $("takeovers-hint"), takeoversList: $("takeovers-list"),
  mineOnly: $("mine-only"), showFirstWrap: $("show-first-wrap"), showFirst: $("show-first"),
  viewingFirst: $("viewing-first"), resultTable: $("result-table"), resultBody: $("result-body"), resultEmpty: $("result-empty"),
  complaints: $("complaints"), complaintCount: $("complaint-count"), complaintHint: $("complaint-hint"),
  complainBtn: $("complain-btn"), respinBtn: $("respin-btn"),
  peopleSummary: $("people-summary"), peopleList: $("people-list"),
  formTasks: $("form-tasks"), formTasksSummary: $("form-tasks-summary"), formTasksToggle: $("form-tasks-toggle"),
  formTasksBody: $("form-tasks-body"), formTaskTools: $("form-task-tools"), formTaskList: $("form-task-list"),
  roomTasks: $("room-tasks"), roomTasksSummary: $("room-tasks-summary"), roomTasksHint: $("room-tasks-hint"), roomTasksToggle: $("room-tasks-toggle"),
  roomTaskTools: $("room-task-tools"), roomTaskList: $("room-task-list"),
  taskDialog: $("task-dialog"), taskForm: $("task-form"), taskDialogTitle: $("task-dialog-title"),
  taskWhat: $("task-what"), taskWhatError: $("task-what-error"),
  taskTeamChips: $("task-team-chips"), taskTeamError: $("task-team-error"),
  taskThemeChips: $("task-theme-chips"), taskThemeError: $("task-theme-error"),
  taskDevicesChips: $("task-devices-chips"), taskDevicesError: $("task-devices-error"),
  taskBrowsersChips: $("task-browsers-chips"), taskUsersChips: $("task-users-chips"), taskBrowsersGroup: $("task-browsers"),
  taskFormError: $("task-form-error"), taskCancel: $("task-cancel"), taskSave: $("task-save"),
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
  desktop: "M3.5 4.5h17v11h-17zM8.5 20h7M12 15.5V20",
  laptop: "M5 6.5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v9H5zM2.5 15.5h19l-1.2 2.3a1 1 0 0 1-.9.5H4.6a1 1 0 0 1-.9-.5z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3.5 12h17M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9s1.2-6.5 3.6-9Z",
  person: "M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM4.75 20.25c.9-3.4 3.75-5.25 7.25-5.25s6.35 1.85 7.25 5.25",
  pencil: "M14.5 5.5l4 4M4.5 19.5l1-4.5L16 4.5a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L9 18.5l-4.5 1Z",
  trash: "M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.1M10 10.5v5.5M14 10.5v5.5",
  external: "M7.5 16.5l9-9M9 7.5h7.5V15",
  swap: "M4.5 8.5h13l-3.5-3.5M19.5 15.5h-13l3.5 3.5",
  plus: "M12 5v14M5 12h14",
  people: "M9 11a3.25 3.25 0 1 0 0-6.5A3.25 3.25 0 0 0 9 11ZM2.75 19.5c.7-3 3.1-4.75 6.25-4.75s5.55 1.75 6.25 4.75M15.5 11a2.75 2.75 0 1 0 0-5.5M17.25 14.9c2.1.45 3.55 2 4 4.35"
};

const labelIn = (options, value) => options.find((o) => o.value === value)?.label ?? value;
const labelsIn = (options, values) => values.map((v) => labelIn(options, v));
const PHONE_VALUES = ["android", "ios"];
const BROWSER_LABELS = [...BROWSERS, MAC_BROWSER];  // Safari isn't an option, but Mac tasks show it
/** "Chrome, Edge, Firefox, Safari": the browsers a task is tested in (Safari comes with Mac). */
const browsersText = (t, joiner = ", ") => labelsIn(BROWSER_LABELS, taskBrowsers(t)).join(joiner);
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

export function renderForm({ mode, code = null, profile = null, settings = null }) {
  if (mode === "join") {
    els.formTitle.textContent = `Join room ${code}`;
    els.formLede.textContent = "Tell the team who you are and what you can test on. The moderator spins once everyone is in.";
    els.formSubmit.textContent = "Join room";
  } else {
    els.formTitle.textContent = "WheelOfTest";
    els.formLede.textContent = "Join a room, spin once, and every QA task gets an owner.";
    els.formSubmit.textContent = "Create room";
  }
  els.formTasks.hidden = mode !== "create";
  els.formSettings.hidden = mode !== "create";
  els.formColRoom.hidden = mode !== "create";
  els.viewForm.classList.toggle("is-create", mode === "create");
  els.formSubmit.dataset.label = els.formSubmit.textContent;
  const form = els.form;
  form.reset();
  if (mode === "create") {
    els.tasksPerPerson.value = String(settings?.tasksPerPerson ?? 1);
    renderLinkRows(els.formLinks, settings?.links ?? [], "form-link");
    setSettingsErrors({});
  }
  if (profile) {
    form.elements.name.value = profile.name ?? "";
    for (const radio of form.querySelectorAll('input[name="team"]')) radio.checked = radio.value === profile.team;
    form.elements.mac.checked = profile.mac === true;
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
    mac: form.elements.mac.checked,
    android: form.elements.android.checked,
    ios: form.elements.ios.checked
  };
}

/** The create form's settings: { tasks_per_person (as typed), links: [{ label, url }] rows }. */
export function readSettingsForm() {
  return { tasks_per_person: els.tasksPerPerson.value, links: readLinkRows(els.formLinks) };
}

/** errors: { tasksPerPerson?, links?: [{ label?, url? }] }. Focuses the first field with an error. */
export function setSettingsErrors(errors) {
  els.tasksPerPersonError.hidden = !errors.tasksPerPerson;
  els.tasksPerPersonError.textContent = errors.tasksPerPerson || "";
  els.tasksPerPerson.setAttribute("aria-invalid", errors.tasksPerPerson ? "true" : "false");
  const first = setLinkErrors(els.formLinks, errors.links ?? []);
  if (errors.tasksPerPerson) els.tasksPerPerson.focus();
  else first?.focus();
}

// ---- the two session link rows (create form and the room's links editor)

function linkField(id, name, label, value, type, placeholder) {
  const wrap = el("div", "link-field");
  const lab = el("label", "link-field-label", label);
  lab.htmlFor = id;
  const input = document.createElement("input");
  Object.assign(input, { id, name, type, value, placeholder, autocomplete: "off", spellcheck: false });
  input.className = "input";
  if (name === "label") input.maxLength = 40;
  if (name === "url") { input.inputMode = "url"; input.maxLength = 500; }
  const error = el("p", "field-error", "");
  error.id = `${id}-error`;
  error.hidden = true;
  input.setAttribute("aria-describedby", error.id);
  wrap.append(lab, input, error);
  return wrap;
}

const LINK_PLACEHOLDERS = ["Test environment", "Test cases", "Bug tracker", "Release notes"];

function linkRow(i, link, prefix) {
  const row = el("div", "group-row link-row");
  row.dataset.index = String(i);
  row.append(
    linkField(`${prefix}-${i}-label`, "label", `Link ${i + 1} label`, link.label ?? "", "text", LINK_PLACEHOLDERS[i] ?? "Label"),
    linkField(`${prefix}-${i}-url`, "url", `Link ${i + 1} address`, link.url ?? "", "url", "https://")
  );
  return row;
}

/**
 * Rows of label + address, filled with `links`: two to start with (empty if there is nothing to
 * show), then Add link for more, up to CONFIG.maxLinks.
 */
export function renderLinkRows(container, links, prefix) {
  const count = Math.min(CONFIG.maxLinks, Math.max(2, links.length));
  const rows = Array.from({ length: count }, (_, i) => linkRow(i, links[i] ?? { label: "", url: "" }, prefix));
  const add = el("button", "btn btn-plain btn-small links-add");
  add.type = "button";
  add.dataset.linkAdd = prefix;
  add.append(icon("plus", "icon icon-stroke"), el("span", null, "Add link"));
  const addRow = el("div", "group-row links-add-row");
  addRow.append(add);
  container.replaceChildren(...rows, addRow);
  syncLinkAdd(container);
}

/** One more empty row (up to CONFIG.maxLinks); focuses its label. Returns false at the limit. */
export function addLinkRow(container) {
  const rows = container.querySelectorAll(".link-row");
  if (rows.length >= CONFIG.maxLinks) return false;
  const prefix = container.querySelector("[data-link-add]").dataset.linkAdd;
  const row = linkRow(rows.length, { label: "", url: "" }, prefix);
  container.querySelector(".links-add-row").before(row);
  syncLinkAdd(container);
  row.querySelector("input").focus();
  return true;
}

function syncLinkAdd(container) {
  const add = container.querySelector("[data-link-add]");
  const count = container.querySelectorAll(".link-row").length;
  const full = count >= CONFIG.maxLinks;
  add.disabled = full;
  add.querySelector("span").textContent = full ? `${CONFIG.maxLinks} links at most` : "Add link";
}

export function readLinkRows(container) {
  return Array.from(container.querySelectorAll(".link-row"), (row) => ({
    label: row.querySelector('input[name="label"]').value,
    url: row.querySelector('input[name="url"]').value
  }));
}

/** Show per-row errors; returns the first invalid input (or null). */
function setLinkErrors(container, errors) {
  let first = null;
  container.querySelectorAll(".link-row").forEach((row, i) => {
    for (const name of ["label", "url"]) {
      const input = row.querySelector(`input[name="${name}"]`);
      const message = errors[i]?.[name] ?? "";
      const node = row.querySelector(`#${CSS.escape(input.id)}-error`);
      node.hidden = !message;
      node.textContent = message;
      input.setAttribute("aria-invalid", message ? "true" : "false");
      if (message && !first) first = input;
    }
  });
  return first;
}

/** Clamp the number field next to a −/+ stepper after a press; returns the new value. */
export function stepValue(stepper, delta) {
  const input = stepper.querySelector("input");
  const current = Number.parseInt(input.value, 10);
  const next = Math.min(Number(input.max), Math.max(Number(input.min), (Number.isFinite(current) ? current : 1) + delta));
  input.value = String(next);
  syncStepper(stepper);
  return next;
}

/** After a save: focus the pressed −/+ again, or the other one if it reached its limit, or the field. */
export function focusStepper(stepper, step) {
  if (stepper.hidden) return;
  const [minus, plus] = stepper.querySelectorAll(".stepper-btn");
  const pressed = step === "-1" ? minus : step === "1" ? plus : null;
  const other = pressed === minus ? plus : minus;
  const target = [pressed, other, stepper.querySelector("input")].find((n) => n && !n.disabled);
  if (target && (document.activeElement === document.body || !document.activeElement || stepper.contains(document.activeElement))) target.focus();
}

function syncStepper(stepper) {
  const input = stepper.querySelector("input");
  const value = Number.parseInt(input.value, 10);
  const [minus, plus] = stepper.querySelectorAll(".stepper-btn");
  minus.disabled = input.disabled || !(value > Number(input.min));
  plus.disabled = input.disabled || !(value < Number(input.max));
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

// ------------------------------------------------------------------ task lists

/** "Critical User Flows, E3DC, Android and iOS" — for button labels and announcements. */
export function describeTask(t) {
  const parts = [t.what, labelIn(THEMES, t.theme), labelsIn(DEVICES, t.devices).join(" and ")];
  if (taskBrowsers(t).length) parts.push(browsersText(t));
  return parts.join(", ");
}

function tasksSummary(tasks) {
  return `${plural(tasks.length, "task")} · ${isDefaultTaskList(tasks) ? "default set" : "edited"}`;
}

/** The theme as a coloured tag: E3DC green, Flow blue, anything else neutral. */
function themeTag(theme) {
  const tag = el("span", "tag tag-theme", labelIn(THEMES, theme));
  tag.dataset.theme = theme;
  return tag;
}

function metaItem(iconName, text) {
  const item = el("span", "meta-item");
  item.append(icon(iconName, "icon icon-stroke"), document.createTextNode(text));
  return item;
}

function iconButton(iconName, label, action, taskId) {
  const button = el("button", "icon-btn");
  button.type = "button";
  button.dataset.action = action;
  button.dataset.taskId = taskId;
  button.setAttribute("aria-label", label);
  const idle = el("span", "when-idle");
  idle.append(icon(iconName, "icon icon-stroke"));
  button.append(idle);
  return button;
}

/** One task in a list under its group header: just the device and browsers, plus Edit / Delete. */
function taskRow(t, { editable, busy, lastOne }) {
  const li = el("li", "task-row");
  li.dataset.taskId = t.id;

  const main = el("div", "task-main");
  const devices = el("div", "task-devices");
  devices.append(el("span", "sr-only", `${t.what}, ${labelIn(THEMES, t.theme)}: `));
  for (const d of t.devices) {
    const item = el("span", "device-name");
    item.append(icon({ desktop: "desktop", mac: "laptop", android: "phone", ios: "phone" }[d] ?? "desktop", "icon icon-stroke"), document.createTextNode(labelIn(DEVICES, d)));
    devices.append(item);
  }
  main.append(devices);
  if (taskBrowsers(t).length) main.append(el("span", "device-browsers", browsersText(t, " · ")));
  li.append(main);

  if (editable) {
    const description = describeTask(t);
    const edit = iconButton("pencil", `Edit ${description}`, "edit", t.id);
    const del = iconButton("trash", `Delete ${description}`, "delete", t.id);
    del.classList.add("icon-btn-danger", "btn-confirmable");
    del.append(el("span", "when-armed", "Delete"));
    edit.disabled = busy;
    del.disabled = busy || lastOne;
    edit.title = "Edit task";
    del.title = lastOne ? "A room needs at least one task." : "Delete task";
    const actions = el("div", "task-actions");
    actions.append(edit, del);
    li.append(actions);
  }
  return li;
}

const listKeys = new WeakMap();

/**
 * Render tasks grouped like the result table: one header per run of tasks that share name, theme,
 * team and user levels (in the defaults, a release in one theme), then one row per device.
 * Keyed, so presence updates don't rebuild the list (and don't drop an armed Delete).
 */
function renderTaskList(container, tasks, { editable, busy }) {
  const key = JSON.stringify([tasks, editable, busy, CONFIG.teams]);
  if (listKeys.get(container) === key) return;
  listKeys.set(container, key);

  const groups = [];
  for (const t of tasks) {
    const k = JSON.stringify([t.what, t.theme, t.team, t.users]);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(t);
    else groups.push({ key: k, items: [t] });
  }
  const sections = groups.map(({ items }) => {
    const t = items[0];
    const section = el("section", "task-group");
    const head = el("h3", "task-group-title");
    head.append(el("span", "task-group-name", t.what), themeTag(t.theme));
    if (t.team) {
      const badge = el("span", "team-badge", t.team);
      badge.dataset.team = t.team;
      head.append(badge);
    } else {
      head.append(el("span", "group-any", "All teams"));
    }
    if (t.users.length) head.append(el("span", "group-users", labelsIn(USER_LEVELS, t.users).join(", ")));
    head.setAttribute("aria-label", `${t.what}, ${labelIn(THEMES, t.theme)}, ${t.team ? `team ${t.team}` : "all teams"}, ${plural(items.length, "task")}`);
    const list = el("ul", "group task-rows");
    list.append(...items.map((x) => taskRow(x, { editable, busy, lastOne: tasks.length === 1 })));
    section.append(head, list);
    return section;
  });
  container.replaceChildren(...sections);
}

function renderTaskTools(tools, tasks, busy) {
  const add = tools.querySelector('[data-action="add"]');
  const reset = tools.querySelector('[data-action="reset"]');
  const full = tasks.length >= CONFIG.maxTasks;
  add.disabled = busy || full;
  add.title = full ? `A room can have at most ${CONFIG.maxTasks} tasks.` : "";
  const isDefault = isDefaultTaskList(tasks);
  reset.disabled = busy || isDefault;
  reset.title = isDefault ? "These are already the default tasks." : "";
  if (reset.disabled) disarm(reset);

  // Critical User Flows switch: on while the block is in the list
  const cuf = tools.querySelector('[data-toggle="critical-flows"]');
  const on = hasCriticalFlows(tasks);
  const wouldEmpty = on && tasks.every(isCriticalFlow);
  const wouldOverflow = !on && tasks.length + CRITICAL_FLOW_COUNT > CONFIG.maxTasks;
  cuf.checked = on;
  cuf.disabled = busy || wouldEmpty || wouldOverflow;
  cuf.closest("label").title = wouldEmpty ? "A room needs at least one task."
    : wouldOverflow ? `A room can have at most ${CONFIG.maxTasks} tasks.`
    : on ? `Turn off to leave out the ${CRITICAL_FLOW_COUNT} Critical User Flows tasks.` : "Turn on to add the Critical User Flows tasks.";
}

/** The task section of the create form. */
export function renderFormTasks({ tasks, open }) {
  els.formTasksSummary.textContent = tasksSummary(tasks);
  els.formTasksToggle.textContent = open ? "Hide" : "Review";
  els.formTasksToggle.setAttribute("aria-expanded", String(open));
  els.formTasksBody.hidden = !open;
  if (!open) return;
  renderTaskTools(els.formTaskTools, tasks, false);
  renderTaskList(els.formTaskList, tasks, { editable: true, busy: false });
}

/** The task shown after `taskId` (or before it, if it is the last row), in display order. */
export function adjacentTaskId(scope, taskId) {
  const list = scope === "draft" ? els.formTaskList : els.roomTaskList;
  const ids = Array.from(list.querySelectorAll("li.task-row"), (li) => li.dataset.taskId);
  const i = ids.indexOf(taskId);
  if (i < 0) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

/** Focus a task's button after the list changed; falls back to "Add task". */
export function focusTask(scope, taskId, action = "edit") {
  const [list, tools] = scope === "draft" ? [els.formTaskList, els.formTaskTools] : [els.roomTaskList, els.roomTaskTools];
  const target = taskId ? list.querySelector(`button[data-task-id="${CSS.escape(taskId)}"][data-action="${action}"]`) : null;
  const fallback = tools.querySelector('[data-action="add"]');
  const node = target && !target.disabled ? target : fallback && !fallback.disabled && !tools.hidden ? fallback : null;
  node?.focus();
}

/** Put focus back on the Critical User Flows switch (it is briefly disabled while a room save runs). */
export function focusCriticalFlows(scope) {
  const tools = scope === "draft" ? els.formTaskTools : els.roomTaskTools;
  const input = tools.querySelector('[data-toggle="critical-flows"]');
  if (input && !input.disabled && !tools.hidden) input.focus();
}

// ---- two-step confirm for Delete and Reset

const armTimers = new WeakMap();

function disarm(button) {
  if (button.dataset.armed !== "true") return;
  delete button.dataset.armed;
  clearTimeout(armTimers.get(button));
  if (button.dataset.idleLabel) {
    button.setAttribute("aria-label", button.dataset.idleLabel);
    delete button.dataset.idleLabel;
  }
}

/**
 * First press arms the button (it turns red and asks for a second press); returns false.
 * A second press within 4 seconds returns true. Leaving the button disarms it.
 */
export function confirmPress(button) {
  if (button.dataset.armed === "true") {
    disarm(button);
    return true;
  }
  for (const other of document.querySelectorAll('[data-armed="true"]')) disarm(other);
  button.dataset.armed = "true";
  const label = button.getAttribute("aria-label");
  if (label) {
    button.dataset.idleLabel = label;
    button.setAttribute("aria-label", `Confirm: ${label.charAt(0).toLowerCase()}${label.slice(1)}`);
  }
  armTimers.set(button, setTimeout(() => disarm(button), 4000));
  button.addEventListener("blur", () => disarm(button), { once: true });
  announce("Press again to confirm.");
  return false;
}

// ------------------------------------------------------------------ task editor

let chipsBuilt = false;

function chip(type, name, value, label) {
  const wrap = el("label", "chip");
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.value = value;
  wrap.append(input, el("span", null, label));
  return wrap;
}

function buildTaskChips() {
  if (chipsBuilt) return;
  chipsBuilt = true;
  els.taskTeamChips.append(chip("radio", "team", "", "All teams"), ...CONFIG.teams.map((t) => chip("radio", "team", t, t)));
  els.taskThemeChips.append(...THEMES.map((o) => chip("radio", "theme", o.value, o.label)));
  els.taskDevicesChips.append(...DEVICES.map((o) => chip("checkbox", "devices", o.value, o.label)));
  els.taskBrowsersChips.append(...BROWSERS.map((o) => chip("checkbox", "browsers", o.value, o.label)));
  els.taskUsersChips.append(...USER_LEVELS.map((o) => chip("checkbox", "users", o.value, o.label)));
}

/** Chips for values this task has that the option lists don't offer, so editing keeps them. */
function addExtraChips(task) {
  for (const extra of els.taskForm.querySelectorAll(".chip-extra")) extra.remove();
  const add = (container, type, name, options, values) => {
    for (const value of values) {
      if (!value || options.includes(value)) continue;
      const extra = chip(type, name, value, name === "browsers" ? labelIn(BROWSER_LABELS, value) : value);
      extra.classList.add("chip-extra");
      container.append(extra);
    }
  };
  add(els.taskTeamChips, "radio", "team", CONFIG.teams, task.team ? [task.team] : []);
  add(els.taskThemeChips, "radio", "theme", THEMES.map((o) => o.value), task.theme ? [task.theme] : []);
  add(els.taskBrowsersChips, "checkbox", "browsers", BROWSERS.map((o) => o.value), task.browsers);
  add(els.taskUsersChips, "checkbox", "users", USER_LEVELS.map((o) => o.value), task.users);
}

/**
 * Checkbox chips for the people in the room, to pick who tests a task. People without the
 * devices the task needs are disabled; offline people are marked.
 */
function buildTesterChips(container, { participants, selected, isOnline, task }) {
  const chips = participants.map((p) => {
    const wrap = chip("checkbox", "owners", p.user_id, "");
    wrap.classList.add("chip-person");
    wrap.dataset.userId = p.user_id;
    const span = wrap.querySelector("span");
    span.textContent = "";
    const badge = el("span", "team-badge", p.team);
    badge.dataset.team = p.team;
    span.append(el("span", "chip-name", p.name), badge);
    const state = el("span", "chip-state", "");
    span.append(state);
    const input = wrap.querySelector("input");
    input.checked = selected.includes(p.user_id);
    input.dataset.online = isOnline(p.user_id) ? "true" : "false";
    if (!isOnline(p.user_id)) wrap.classList.add("is-offline");
    return wrap;
  });
  container.replaceChildren(...chips);
  syncTesterChips(container, task, participants);
}

/**
 * Enable the people who can take `task` (its devices as now checked), uncheck anyone who no
 * longer can, and say so. Returns the names that were unchecked.
 */
function syncTesterChips(container, task, participants) {
  const dropped = [];
  for (const wrap of container.querySelectorAll(".chip-person")) {
    const p = participants.find((x) => x.user_id === wrap.dataset.userId);
    const input = wrap.querySelector("input");
    const able = Boolean(p) && canReceiveTask(task, p);
    if (!able && input.checked) { input.checked = false; dropped.push(p?.name ?? "Someone"); }
    input.disabled = !able;
    wrap.title = able ? "" : "Doesn't have the Mac or phone this task needs";
    const parts = [];
    if (!able) parts.push("no device");
    if (input.dataset.online !== "true") parts.push("offline");
    wrap.querySelector(".chip-state").textContent = parts.length ? parts.join(", ") : "";
    input.setAttribute("aria-label", `${p?.name ?? ""}, ${p?.team ?? ""}${parts.length ? `, ${parts.join(", ")}` : ""}`);
  }
  return dropped;
}

let editorTesters = null;   // { participants, isOnline } while the editor shows the Testers section

export function openTaskEditor({ task, isNew, testers = null }) {
  buildTaskChips();
  addExtraChips(task);
  const form = els.taskForm;
  form.reset();
  editorTesters = testers;
  els.taskTesters.hidden = !testers;
  els.taskTestersNote.hidden = true;
  if (testers) buildTesterChips(els.taskTestersChips, { ...testers, task });
  else els.taskTestersChips.replaceChildren();
  els.taskDialogTitle.textContent = isNew ? "New task" : "Edit task";
  els.taskSave.textContent = isNew ? "Add task" : "Save";
  els.taskSave.dataset.label = els.taskSave.textContent;
  form.elements.what.value = task.what;
  for (const input of form.querySelectorAll("input[type=radio], input[type=checkbox]")) {
    if (input.name === "owners") continue;   // the testers were set when their chips were built
    const value = input.name === "team" ? task.team ?? "" : task[input.name];
    input.checked = Array.isArray(value) ? value.includes(input.value) : value === input.value;
  }
  syncTaskForm({ fillBrowsers: false });
  setTaskFormErrors({}, { focus: false });
  setTaskFormError(null);
  setTaskFormBusy(false);
  if (!els.taskDialog.open) els.taskDialog.showModal();
  els.taskDialog.querySelector(".sheet-body").scrollTop = 0;
  els.taskWhat.focus();
}

/**
 * The + beside Devices / Browsers / User levels. When every option in its group is already
 * selected it dims (aria-disabled, so it keeps keyboard focus instead of dropping it).
 */
export function syncSelectAll() {
  for (const button of els.taskForm.querySelectorAll("[data-select-all]")) {
    const inputs = Array.from(els.taskForm.querySelectorAll(`input[name="${button.dataset.selectAll}"]`));
    const all = inputs.length > 0 && inputs.every((i) => i.checked);
    button.setAttribute("aria-disabled", String(all));
    button.title = all ? "All selected" : "Select all";
  }
}

/**
 * Keep the editor consistent after any change: browsers only apply to Desktop, so the group
 * is disabled without it (the selection is kept for when Desktop comes back). When Desktop is
 * turned on and no browser is selected, every browser is selected, like on a new task.
 * fillBrowsers: false when opening a task, so it shows exactly what was saved.
 */
export function syncTaskForm({ fillBrowsers = true } = {}) {
  const desktop = els.taskForm.querySelector('input[name="devices"][value="desktop"]');
  const on = Boolean(desktop?.checked);
  const turnedOn = on && els.taskBrowsersGroup.disabled;
  els.taskBrowsersGroup.disabled = !on;
  const browsers = Array.from(els.taskBrowsersChips.querySelectorAll("input"));
  if (fillBrowsers && turnedOn && !browsers.some((i) => i.checked)) {
    for (const input of browsers) if (BROWSERS.some((o) => o.value === input.value)) input.checked = true;
  }
  syncSelectAll();
  // A control in a fieldset's first <legend> isn't disabled with the fieldset, so do it here.
  els.taskForm.querySelector('[data-select-all="browsers"]').disabled = !on;
  if (editorTesters) {
    const devices = Array.from(els.taskForm.querySelectorAll('input[name="devices"]:checked'), (i) => i.value);
    const dropped = syncTesterChips(els.taskTestersChips, { devices }, editorTesters.participants);
    if (dropped.length) {
      els.taskTestersNote.hidden = false;
      els.taskTestersNote.textContent = `Unchecked ${dropped.join(", ")}: no device for this task any more.`;
    }
  }
}

/** Select every option in a group (including values only this task has). Returns false if nothing changed. */
export function selectAllChips(name) {
  const inputs = Array.from(els.taskForm.querySelectorAll(`input[name="${name}"]`));
  if (inputs.every((i) => i.checked)) return false;
  for (const input of inputs) input.checked = true;
  syncTaskForm();  // e.g. the Devices + turns Desktop on, which enables (and fills) Browsers
  const label = els.taskForm.querySelector(`[data-select-all="${name}"]`)?.getAttribute("aria-label").replace(/^Select all /, "");
  announce(`All ${label} selected.`);
  return true;
}

export function readTaskForm() {
  const form = els.taskForm;
  const checked = (name) => Array.from(form.querySelectorAll(`input[name="${name}"]:checked`), (i) => i.value);
  return {
    what: form.elements.what.value,
    team: checked("team")[0] ?? "",
    theme: checked("theme")[0] ?? null,
    devices: checked("devices"),
    browsers: checked("browsers"),
    users: checked("users"),
    owners: checked("owners")
  };
}

export function setTaskFormErrors(errors, { focus = true } = {}) {
  const pairs = [
    [els.taskWhatError, errors.what], [els.taskTeamError, errors.team],
    [els.taskThemeError, errors.theme], [els.taskDevicesError, errors.devices]
  ];
  for (const [node, message] of pairs) {
    node.hidden = !message;
    node.textContent = message || "";
  }
  els.taskWhat.setAttribute("aria-invalid", errors.what ? "true" : "false");
  if (!focus) return;
  const first = errors.what ? els.taskWhat
    : errors.team ? els.taskTeamChips.querySelector("input")
    : errors.theme ? els.taskThemeChips.querySelector("input")
    : errors.devices ? els.taskDevicesChips.querySelector("input") : null;
  first?.focus();
}

export function setTaskFormError(message) {
  els.taskFormError.hidden = !message;
  els.taskFormError.textContent = message || "";
}

export function setTaskFormBusy(busy, label) {
  els.taskForm.dataset.busy = busy ? "true" : "false";
  els.taskSave.disabled = busy;
  els.taskCancel.disabled = busy;
  els.taskSave.textContent = busy ? label : els.taskSave.dataset.label || els.taskSave.textContent;
}

export const taskEditorBusy = () => els.taskForm.dataset.busy === "true";

// ---- who tests a task (moderator, after the spin)

export function openTestersDialog({ task, participants, selected, isOnline }) {
  els.testersTask.textContent = describeTask(task);
  buildTesterChips(els.testersChips, { participants, selected, isOnline, task });
  setTestersError(null);
  setTestersBusy(false);
  if (!els.testersDialog.open) els.testersDialog.showModal();
  (els.testersChips.querySelector("input:not(:disabled)") ?? els.testersCancel).focus();
}

export const readTesters = () => Array.from(els.testersChips.querySelectorAll("input:checked"), (i) => i.value);

export function setTestersError(message) {
  els.testersError.hidden = !message;
  els.testersError.textContent = message || "";
}

export function setTestersBusy(busy) {
  els.testersForm.dataset.busy = busy ? "true" : "false";
  els.testersSave.disabled = busy;
  els.testersCancel.disabled = busy;
  els.testersSave.textContent = busy ? "Saving…" : "Save";
}

export const testersBusy = () => els.testersForm.dataset.busy === "true";

export function closeTestersDialog() {
  if (els.testersDialog.open) els.testersDialog.close();
}

export function closeTaskEditor() {
  if (els.taskDialog.open) els.taskDialog.close();
}

// ------------------------------------------------------------------ room

/**
 * The links the team uses in this session (set when the room was created). The moderator can
 * change them (`editing` shows the form). Hidden for others when there are none.
 */
export function renderSessionLinks(links, { isHost = false, editing = false, busy = false } = {}) {
  const key = JSON.stringify(links);
  if (els.sessionLinksList.dataset.key !== key) {
    els.sessionLinksList.dataset.key = key;
    els.sessionLinksList.replaceChildren(...linkItems(links));
  }
  els.sessionLinksList.hidden = links.length === 0;
  els.linksEdit.hidden = !isHost || editing;
  els.linksEdit.textContent = links.length ? "Edit links" : "Add session links";
  els.linksEdit.setAttribute("aria-expanded", String(editing));
  els.linksEdit.disabled = busy;
  els.linksSave.disabled = busy;
  els.linksCancel.disabled = busy;
  els.linksSave.textContent = busy ? "Saving…" : "Save links";
  els.linksForm.hidden = !editing;
  els.sessionLinks.hidden = links.length === 0 && !isHost;
  els.sessionLinks.classList.toggle("is-empty", links.length === 0 && !editing);
}

/** Open the links form with the room's links in it. */
export function openLinksForm(links) {
  renderLinkRows(els.roomLinks, links, "room-link");
  setLinksErrors({});
  els.linksForm.hidden = false;
  els.roomLinks.querySelector("input")?.focus();
}

export const readLinksForm = () => readLinkRows(els.roomLinks);

export function setLinksErrors({ links = [], message = null }) {
  const first = setLinkErrors(els.roomLinks, links);
  els.linksError.hidden = !message;
  els.linksError.textContent = message || "";
  first?.focus();
}

export function focusLinksEdit() {
  if (!els.linksEdit.hidden) els.linksEdit.focus();
}

function linkItems(links) {
  return links.map(({ label, url }) => {
    const li = el("li");
    const a = el("a", "btn btn-tinted btn-small session-link");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.append(el("span", null, linkLabel({ label, url })), icon("external", "icon icon-stroke"), el("span", "sr-only", "(opens in a new tab)"));
    li.append(a);
    return li;
  });
}

/** A link's label, or its host name when it has none. */
export function linkLabel(link) {
  if (link.label) return link.label;
  try { return new URL(link.url).hostname; } catch { return link.url; }
}

let wheelKey = null;
let tableKey = null;
let takeoversKey = null;
let lastComplaintCount = null;
let lastMyCount = null;        // { spin, count }: bumps "You have N tasks" when a takeover changes it
let lastPendingCount = null;   // { spin, count }: bumps the requests heading when one arrives

export function enterRoomView(code) {
  wheelKey = null;
  tableKey = null;
  takeoversKey = null;
  lastComplaintCount = null;
  lastMyCount = null;
  lastPendingCount = null;
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

/** Whether anyone in the room may send a request right now (connected and in sync, nothing else running). */
function memberCanAct(state) {
  return state.connection === "connected" && state.synced && !state.busy && !state.revealing;
}

/** Whether this browser may change the room's tasks right now (presence isn't needed for that). */
export function canEditRoomTasks(state) {
  const snap = state.snapshot;
  return Boolean(snap) && snap.room.host_user_id === state.me && tasksEditable(snap.room)
    && state.connection === "connected" && state.synced && !state.busy && !state.revealing && state.stageSpin === 0;
}

function isOnline(state, userId) {
  return userId === state.me ? state.connection === "connected" : state.online.has(userId);
}

export function renderRoom(state) {
  const snap = state.snapshot;
  if (!snap) return;
  renderConnection(state);
  renderAlert(state.alert);
  renderSessionLinks(snap.room.links, { isHost: snap.room.host_user_id === state.me, editing: state.linksEditing, busy: state.busy === "settings" });
  renderPeople(state);
  renderStage(state);
  renderRoomTasks(state);
  renderComplaints(state);
}

function renderRoomTasks(state) {
  const { room } = state.snapshot;
  const visible = tasksEditable(room) && state.stageSpin === 0 && !state.revealing;
  els.roomTasks.hidden = !visible;
  if (!visible) return;

  const isHost = room.host_user_id === state.me;
  const canEdit = canEditRoomTasks(state);
  const n = room.tasks_per_person;
  // The moderator edits the list, so it's always open for them. Everyone else gets a one-line
  // summary and the list on request, so the room isn't one long scroll.
  const open = isHost || state.lobbyTasksOpen;
  els.roomTasksSummary.textContent = isHost ? tasksSummary(room.tasks)
    : `${plural(room.tasks.length, "task")} · at least ${n} each`;
  els.roomTasksToggle.hidden = isHost;
  els.roomTasksToggle.textContent = open ? "Hide tasks" : "Show tasks";
  els.roomTasksToggle.setAttribute("aria-expanded", String(open));
  els.roomTasksHint.hidden = !open;
  els.roomTasksHint.textContent = !isHost
    ? "The moderator can change these until the spin."
    : state.busy === "tasks" ? "Saving the tasks…"
    : "Change them until you spin; everyone sees changes right away.";
  els.roomTaskTools.hidden = !isHost;
  els.roomTaskList.hidden = !open;
  els.roomSettings.hidden = !isHost;
  els.roomSettingsHint.hidden = !isHost;
  if (isHost) renderTaskTools(els.roomTaskTools, room.tasks, !canEdit);
  if (open) renderTaskList(els.roomTaskList, room.tasks, { editable: isHost, busy: !canEdit });

  // Tasks per person: the moderator's stepper, a plain value for everyone else
  els.roomStepper.hidden = !isHost;
  els.roomTasksPerPersonValue.hidden = isHost;
  els.roomTasksPerPersonValue.textContent = String(n);
  const input = els.roomTasksPerPerson;
  // Don't overwrite what the moderator is typing; do show what the room has once they leave the field
  if (document.activeElement !== input || input.dataset.saved !== String(n)) {
    if (document.activeElement !== input) input.value = String(n);
    input.dataset.saved = String(n);
  }
  input.disabled = !canEdit;
  syncStepper(els.roomStepper);
  els.roomSettingsHint.textContent = state.busy === "settings" ? "Saving…"
    : n === 1 ? "At least one task each. With more people than tasks, some tasks get two testers."
    : `Everyone gets at least ${n} tasks, so tasks get several testers.`;
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
    // Everyone has Desktop, so only the extras are listed
    const devices = el("span", "devices");
    const owned = [["laptop", "Mac", p.mac], ["phone", "Android", p.android], ["phone", "iOS", p.ios]];
    for (const [iconName, label, has] of owned) {
      if (!has) continue;
      const d = el("span", "device");
      d.append(icon(iconName), document.createTextNode(label));
      devices.append(d);
    }
    if (!devices.childNodes.length) devices.append(el("span", "device device-none", "Desktop only"));
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
    els.wheelWarning.hidden = true;
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
    els.wheelWarning.hidden = true;
    return;
  }
  const rule = spinRule(snap.room, snap.complaints.length, CONFIG.complaintThreshold);
  const ready = moderatorCanAct(state);
  els.spinBtn.disabled = !(ready && rule.allowed);
  els.spinBtn.textContent = state.busy === "spin" ? "Spinning…" : "Spin";
  const status = moderatorStatus(state);
  els.wheelStatus.textContent = status ?? (() => {
    const online = snap.participants.filter((p) => isOnline(state, p.user_id)).length;
    const each = snap.room.tasks_per_person > 1 ? ` At least ${snap.room.tasks_per_person} each.` : "";
    return online === snap.participants.length
      ? `Everyone is online. ${plural(snap.room.tasks.length, "task")} will be shared out.${each}`
      : `${online} of ${snap.participants.length} people are online. Only people online get tasks.${each}`;
  })();
  // Only once we know who is online; otherwise the count would be a guess.
  const warning = status === null ? coverageWarning(state) : null;
  els.wheelWarning.hidden = !warning;
  els.wheelWarning.textContent = warning ?? "";
}

const countPeople = (n) => (n === 1 ? "1 person" : `${n} people`);

/** Tell the moderator before spinning when someone online can't get as many tasks as the room asks for. */
function coverageWarning(state) {
  const { room, participants } = state.snapshot;
  const n = room.tasks_per_person;
  const roster = participants.map((p) => ({ ...p, online: isOnline(state, p.user_id) }));
  const online = roster.filter((p) => p.online);
  const short = peopleShortOfTasks(room.tasks, roster, n);
  if (short.length === 0) return null;
  const wanted = n === 1 ? "a task" : `${n} tasks`;
  const who = `${short.length} of the ${countPeople(online.length)} online won't get ${wanted}`;
  const shown = short.slice(0, 3).map(({ participant, max }) =>
    `${participant.name} can take ${max === 0 ? "none" : max === 1 ? "only 1" : `only ${max}`}`);
  const more = short.length > 3 ? ` and ${short.length - 3} more` : "";
  const fix = n > 1
    ? "Add tasks they have the devices for, lower Tasks per person, or ask them to turn on the Mac and phones they have."
    : "Add tasks they have the devices for, or ask them to turn on the Mac and phones they have.";
  return `${who}: ${shown.join(", ")}${more}. ${fix}`;
}

function moderatorStatus(state) {
  if (state.busy === "spin") return "Saving the spin…";
  if (state.busy === "tasks") return "Saving the tasks…";
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
  els.wheelWarning.hidden = true;
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

  const mine = tasksOf(spin.assignments, state.me);
  els.resultTitle.textContent = showingFirst ? "First spin (replaced)" : finalShown ? "Final result" : "Result";
  els.myCount.textContent = `You have ${plural(mine.length, "task")}`;
  if (lastMyCount?.spin === spin.spin_number && lastMyCount.count !== mine.length) bump(els.myCount);
  lastMyCount = { spin: spin.spin_number, count: mine.length };
  els.showFirstWrap.hidden = !finalShown;
  els.viewingFirst.hidden = !showingFirst;
  els.showFirst.checked = showingFirst;
  els.mineOnly.checked = state.mineOnly;

  const visible = state.mineOnly ? mine : spin.assignments;
  els.resultEmpty.hidden = visible.length > 0;
  els.resultTable.hidden = visible.length === 0;

  // Takeovers and the moderator's changes apply to the current spin only; the first spin is
  // history once the second exists.
  const open = takeoversOpen(snap.room) && spin.spin_number === snap.room.spins_used;
  const requests = open ? snap.requests ?? [] : [];
  const isHost = snap.room.host_user_id === state.me;
  const ctx = {
    me: state.me,
    meRow: snap.participants.find((p) => p.user_id === state.me) ?? null,
    room: snap.room,
    participants: snap.participants,
    requests,
    open,
    isHost,
    canAct: open && memberCanAct(state),
    canEdit: open && isHost && memberCanAct(state),
    lastTask: snap.room.tasks.length <= 1,
    atLimit: pendingRequests(requests).filter((r) => r.user_id === state.me).length >= CONFIG.maxPendingRequests,
    isOnline: (userId) => isOnline(state, userId)
  };
  els.resultHint.hidden = !open;
  els.resultHint.textContent = !open ? ""
    : ctx.atLimit ? `You have ${CONFIG.maxPendingRequests} requests waiting. Withdraw one to ask for another.`
    : isHost ? "Change testers, edit or add tasks in the table. You answer takeover requests above."
    : `Assign me adds you to a task (up to ${CONFIG.maxTestersToJoin} testers). Take over asks for someone's place.`;
  els.resultSettings.hidden = !(open && snap.room.tasks_per_person > 1);
  els.resultSettings.textContent = `Tasks per person: at least ${snap.room.tasks_per_person}.`;
  els.resultAdd.hidden = !(open && isHost);
  const full = snap.room.tasks.length >= CONFIG.maxTasks;
  els.resultAdd.disabled = !ctx.canEdit || full;
  els.resultAdd.title = full ? `A room can have at most ${CONFIG.maxTasks} tasks.` : "";

  const key = JSON.stringify([spin.spin_number, state.mineOnly, state.me, spin.created_at, takeoverKey(spin, ctx)]);
  if (key !== tableKey) {
    els.resultBody.replaceChildren(...groupedRows(visible, ctx));
    tableKey = key;
  }
  renderTakeovers(spin, ctx);
  return Array.from(els.resultBody.children);
}

/** Everything the table and the requests box depend on, so presence updates don't rebuild them. */
function takeoverKey(spin, ctx) {
  return [
    spin.assignments.map((a) => [a.task_id, a.task, a.reason,
      a.owners.map((o) => [o.user_id, o.name, o.team, o.team_match, o.took_over_at ?? null, o.took_over_from?.user_id ?? null, o.took_over_by ?? null, o.assigned_at ?? null])]),
    ctx.requests.map((r) => [r.id, r.task_id, r.user_id, r.from_user_id ?? null, r.status, r.resolved_by ?? null]),
    ctx.participants.map((p) => [p.user_id, p.name, p.mac, p.android, p.ios]),
    ctx.room.host_user_id, ctx.open, ctx.canAct, ctx.canEdit, ctx.atLimit, ctx.lastTask
  ];
}

const nameOf = (participants, userId) => participants.find((p) => p.user_id === userId)?.name ?? "Someone";

/** "Ada", "Ada and Bob", "Ada, Bob and Cy" */
function listNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function actionButton(label, className, data, enabled) {
  const button = el("button", className, label);
  button.type = "button";
  Object.assign(button.dataset, data);
  button.disabled = !enabled;
  return button;
}

/** "Assign me": the main way to get a task. A clear pill with an icon; it adds you next to whoever tests it. */
function joinButton(a, ctx) {
  const button = actionButton(null, "btn btn-small join-btn", { action: "join", taskId: a.task_id }, ctx.canAct);
  button.append(icon("plus", "icon icon-stroke"), el("span", null, "Assign me"));
  const task = describeTask(a.task);
  button.setAttribute("aria-label", a.owners.length ? `Assign me to ${task} too` : `Assign me to ${task}`);
  return button;
}

/** Take over: ask for one tester's place (they or the moderator approve). Secondary to Assign me. */
function takeoverButton(a, owner, ctx) {
  const many = a.owners.length > 1;
  const text = many ? `Take over from ${owner.name}` : "Take over";
  const button = actionButton(null, "btn btn-small takeover-btn", { action: "request", taskId: a.task_id, from: owner?.user_id ?? "" }, ctx.canAct && !ctx.atLimit);
  button.append(icon("swap", "icon icon-stroke"), el("span", null, text));
  const task = describeTask(a.task);
  button.setAttribute("aria-label", !owner ? `Ask to take ${task}, which is unassigned`
    : `Ask to take over ${task}${many || owner.user_id !== ctx.room.host_user_id ? ` from ${owner.name}` : ""}`);
  if (ctx.atLimit) button.setAttribute("aria-description", `You have ${CONFIG.maxPendingRequests} requests waiting.`);
  return button;
}

/**
 * The request line for one place on a task (a tester's, or the unassigned task's): who else asked
 * for it, and my own state: Take over, Requested + Withdraw, or Declined (+ Dismiss).
 */
function slotControls(a, owner, ctx) {
  if (!ctx.open) return null;
  const from = owner?.user_id ?? null;
  const wrap = el("span", "takeover-row");
  const others = pendingRequests(ctx.requests).filter((r) => r.task_id === a.task_id && r.user_id !== ctx.me && (r.from_user_id ?? null) === from);
  if (others.length) {
    const names = listNames(others.map((r) => nameOf(ctx.participants, r.user_id)));
    wrap.append(el("span", "footnote takeover-note", `${names} asked to take ${owner ? `${owner.user_id === ctx.me ? "your" : `${owner.name}'s`} place` : "this task"}.`));
  }
  if (owner && owner.user_id === ctx.me) {
    // A task I assigned myself to: I can leave it (two presses)
    if (ctx.open && canLeaveTask(a, ctx.me)) {
      const leave = actionButton(null, "btn btn-plain btn-small btn-inline btn-confirmable", { action: "leave", taskId: a.task_id }, ctx.canAct);
      leave.append(el("span", "when-idle", "Leave"), el("span", "when-armed", "Confirm leave"));
      leave.setAttribute("aria-label", `Leave ${describeTask(a.task)}`);
      wrap.append(leave);
    }
    return wrap.childNodes.length ? wrap : null;
  }
  const mine = requestFor(ctx.requests, a.task_id, ctx.me);
  const mineHere = mine && (mine.from_user_id ?? null) === from;
  const task = describeTask(a.task);
  if (mineHere && mine.status === "pending") {
    const withdraw = actionButton("Withdraw", "btn btn-plain btn-small btn-inline", { action: "withdraw", requestId: mine.id, taskId: a.task_id }, ctx.canAct);
    withdraw.setAttribute("aria-label", `Withdraw your request for ${task}`);
    wrap.append(el("span", "tag tag-requested", "Requested"), withdraw);
  } else if (mineHere && (mine.status === "declined" || (mine.status === "withdrawn" && mine.resolved_by))) {
    // Declined stays declined for this place. Dismiss takes it out of the answerer's list for good.
    const tag = el("span", "tag tag-declined", "Declined");
    tag.append(el("span", "sr-only", ": your request for this place was declined"));
    wrap.append(tag);
    if (mine.status === "declined") {
      const dismiss = actionButton("Dismiss", "btn btn-plain btn-small btn-inline", { action: "withdraw", requestId: mine.id, taskId: a.task_id }, ctx.canAct);
      dismiss.setAttribute("aria-label", `Dismiss your declined request for ${task}`);
      wrap.append(dismiss);
    }
  } else if (owner && !["pending", "declined"].includes(mine?.status) && !(mine?.status === "withdrawn" && mine.resolved_by)
             && canRequestTakeover(a, ctx.meRow)) {
    wrap.append(takeoverButton(a, owner, ctx));
  }
  return wrap.childNodes.length ? wrap : null;
}

/** How a tester got the task, when it wasn't the spin. */
function handoverText(o, ctx) {
  if (o.took_over_at) {
    const from = o.took_over_from ? `Took over from ${o.took_over_from.name}` : "Took over an unassigned task";
    const byModerator = o.took_over_by && o.took_over_by === ctx.room.host_user_id && o.took_over_by !== o.took_over_from?.user_id;
    return byModerator ? `${from} (approved by the moderator)` : from;
  }
  if (o.assigned_at) return "Added by the moderator";
  if (o.joined_at) return o.user_id === ctx.me ? "You assigned yourself" : "Assigned themselves";
  return null;
}

/**
 * One tester: You tag and name; their team only when it isn't the task's (cross-team); how they
 * got the task, quietly; and on the right, the request control for their place.
 */
function ownerLine(a, o, ctx) {
  const li = el("li", `owner${o.user_id === ctx.me ? " is-me" : ""}`);
  const info = el("div", "owner-info");
  const top = el("span", "owner-top");
  if (o.user_id === ctx.me) top.append(el("span", "tag tag-you", "You"));
  top.append(el("span", "assignee-name", o.name));
  if (o.team_match === false) {
    const cross = el("span", "cross-team");
    const badge = el("span", "team-badge", o.team ?? "");
    badge.dataset.team = o.team ?? "";
    cross.append(badge, document.createTextNode("cross-team"));
    cross.title = `${o.name} is in ${o.team}; this task is ${a.task.team}'s`;
    top.append(cross);
  }
  info.append(top);
  const how = handoverText(o, ctx);
  if (how) info.append(el("span", "handover", how));
  li.append(info);
  const controls = slotControls(a, o, ctx);
  if (controls) {
    // Notes ("Cy asked to take your place") read with the name; only the buttons go to the right
    for (const note of controls.querySelectorAll(".takeover-note")) info.append(note);
    if (controls.childNodes.length) li.append(controls);
  }
  return li;
}

/** After a request changed, put focus on that task's control (table row first, then the requests list, then the title). */
export function focusTakeover(taskId) {
  const row = els.resultBody.querySelector(`tr[data-task-id="${CSS.escape(taskId)}"] button:not(:disabled)`);
  const node = row ?? els.takeoversList.querySelector("button:not(:disabled)");
  if (node) node.focus();
  else focusResultTitle();
}

/** Put focus on a row's moderator control (Change testers, Edit), or the next sensible place. */
export function focusRowControl(taskId, action) {
  const row = taskId ? els.resultBody.querySelector(`tr[data-task-id="${CSS.escape(taskId)}"]`) : null;
  const node = row?.querySelector(`button[data-action="${action}"]:not(:disabled)`) ?? row?.querySelector("button:not(:disabled)")
    ?? (els.resultAdd.hidden || els.resultAdd.disabled ? null : els.resultAdd);
  if (node) node.focus();
  else focusResultTitle();
}

/** The task shown after `taskId` in the result table (or before it, if last). */
export function adjacentRowTaskId(taskId) {
  const ids = Array.from(els.resultBody.querySelectorAll("tr[data-task-id]"), (tr) => tr.dataset.taskId);
  const i = ids.indexOf(taskId);
  return i < 0 ? null : ids[i + 1] ?? ids[i - 1] ?? null;
}

/**
 * After a request was answered: the list's heading while there are more requests, else the result
 * title. Never another request's button, so a repeated key press can't answer someone else's request.
 */
export function focusAfterResolve() {
  if (!els.takeovers.hidden) els.takeoversTitle.focus({ preventScroll: true });
  else focusResultTitle();
}

/**
 * "Cy Dee is offline." for the people a request waits on. Presence changes often, so these
 * notes are filled in place (patchOfflineNotes) instead of rebuilding the list, which would
 * drop focus and disarm a half-pressed Decline.
 */
function offlineNote(userIds) {
  const note = el("p", "footnote takeover-offline");
  note.dataset.users = [...new Set(userIds.filter(Boolean))].join(",");
  note.hidden = true;
  return note;
}

function patchOfflineNotes(ctx) {
  for (const note of els.takeoversList.querySelectorAll(".takeover-offline")) {
    const names = note.dataset.users.split(",").filter((id) => id && !ctx.isOnline(id)).map((id) => nameOf(ctx.participants, id));
    note.hidden = names.length === 0;
    note.textContent = names.length ? `${listNames(names)} ${names.length === 1 ? "is" : "are"} offline.` : "";
  }
}

/** "Waiting for Bob or the moderator." for my own pending request. */
function waitingFor(slotOwner, ctx) {
  return !slotOwner || slotOwner.user_id === ctx.room.host_user_id
    ? "Waiting for the moderator."
    : `Waiting for ${slotOwner.name} or the moderator.`;
}

/**
 * The requests of the current spin that concern people: every pending one (Approve / Decline
 * for whoever may answer, Withdraw for the requester), then the declined ones that I could
 * still approve after all. Hidden when there is nothing to show.
 */
function renderTakeovers(spin, ctx) {
  const pending = pendingRequests(ctx.requests);
  const entryOf = (r) => spin.assignments.find((x) => x.task_id === r.task_id);
  // Declined requests I could still approve after all (the moderator: their own too)
  const reconsider = ctx.requests.filter((r) => r.status === "declined" && (r.user_id !== ctx.me || ctx.isHost)
    && canResolveTakeover(entryOf(r), ctx.room, ctx.me, r));
  els.takeovers.hidden = pending.length + reconsider.length === 0;
  if (lastPendingCount?.spin === spin.spin_number && pending.length > lastPendingCount.count) bump(els.takeoversTitle);
  lastPendingCount = { spin: spin.spin_number, count: pending.length };
  if (pending.length + reconsider.length === 0) {
    takeoversKey = null;
    els.takeoversList.replaceChildren();
    return;
  }
  const key = JSON.stringify([spin.spin_number, takeoverKey(spin, ctx), ctx.me]);
  if (key === takeoversKey) {
    patchOfflineNotes(ctx);  // presence changed, nothing else: keep the list (and focus) as it is
    return;
  }
  takeoversKey = key;

  els.takeoversTitle.textContent = pending.length ? plural(pending.length, "takeover request") : "Declined requests";
  els.takeoversHint.textContent = pending.length === 0
    ? "Declined for this spin. You can still approve one after all."
    : ctx.isHost
      ? "You can approve or decline any of them. The person whose place is asked for can answer too."
      : "The moderator or the person whose place is asked for approves or declines.";

  const items = [];
  [...pending, ...reconsider].forEach((r) => {
    const a = entryOf(r);
    if (!a) return;
    const li = el("li", "takeover");
    const iAsked = r.user_id === ctx.me;
    const from = r.from_user_id ?? null;
    const slotOwner = from ? a.owners.find((o) => o.user_id === from) ?? null : null;
    const iHaveIt = from != null && from === ctx.me;
    const requester = nameOf(ctx.participants, r.user_id);
    if (iAsked || iHaveIt) li.classList.add("is-mine");

    const text = el("div", "takeover-text");
    const line = el("p", "takeover-line");
    const declined = r.status === "declined";
    line.append(el("b", null, iAsked ? "You" : requester), document.createTextNode(` ${declined ? "asked" : iAsked ? "want" : "wants"} to take over `), el("b", null, describeTask(a.task)));
    if (!from) line.append(document.createTextNode(", which is unassigned."));
    else line.append(document.createTextNode(" from "), el("b", null, iHaveIt ? "you" : slotOwner?.name ?? nameOf(ctx.participants, from)), document.createTextNode("."));
    text.append(line);

    const actions = el("div", "takeover-actions");
    const requesterRow = ctx.participants.find((p) => p.user_id === r.user_id) ?? null;
    const stillAble = requesterRow !== null && canReceiveTask(a.task, requesterRow);
    const task = describeTask(a.task);
    const whose = iAsked ? "your" : `${requester}'s`;
    const canAnswer = canResolveTakeover(a, ctx.room, ctx.me, r);
    if (declined) {
      li.classList.add("is-declined");
      text.append(el("p", "footnote", `${r.resolved_by === ctx.me ? "You" : nameOf(ctx.participants, r.resolved_by)} declined.${stillAble ? "" : ` ${requester} no longer has the Mac or phone this task needs.`}`));
      const approve = actionButton("Approve after all", "btn btn-tinted btn-small", { action: "approve", requestId: r.id, taskId: r.task_id }, ctx.canAct && stillAble);
      approve.setAttribute("aria-label", `Approve ${whose} request to take over ${task} after all`);
      actions.append(approve);
    } else if (iAsked) {
      // Mine: Withdraw, and, for the moderator, Approve (they may answer their own request)
      text.append(el("p", "footnote", canAnswer ? "You can approve this yourself." : waitingFor(slotOwner, ctx)));
      const withdraw = actionButton("Withdraw", "btn btn-plain btn-small", { action: "withdraw", requestId: r.id, taskId: r.task_id }, ctx.canAct);
      withdraw.setAttribute("aria-label", `Withdraw your request for ${task}`);
      if (canAnswer) {
        const approve = actionButton("Approve", "btn btn-primary btn-small", { action: "approve", requestId: r.id, taskId: r.task_id }, ctx.canAct && stillAble);
        approve.setAttribute("aria-label", `Approve your own request to take over ${task}`);
        actions.append(approve);
      }
      actions.append(withdraw);
    } else if (canAnswer) {
      // Who else this waits on: the moderator sees whether the tester is around, the tester whether the moderator is
      text.append(offlineNote([r.user_id, iHaveIt ? ctx.room.host_user_id : from]));
      if (!stillAble) text.append(el("p", "footnote", `${requester} no longer has the Mac or phone this task needs.`));
      const approve = actionButton("Approve", "btn btn-primary btn-small", { action: "approve", requestId: r.id, taskId: r.task_id }, ctx.canAct && stillAble);
      approve.setAttribute("aria-label", `Approve ${whose} request to take over ${task}`);
      const decline = actionButton(null, "btn btn-tinted btn-small btn-confirmable", { action: "decline", requestId: r.id, taskId: r.task_id }, ctx.canAct);
      decline.append(el("span", "when-idle", "Decline"), el("span", "when-armed", "Confirm decline"));
      decline.setAttribute("aria-label", `Decline ${whose} request to take over ${task}`);
      actions.append(approve, decline);
    }
    li.append(text, actions);
    items.push(li);
  });
  els.takeoversList.replaceChildren(...items);
  patchOfflineNotes(ctx);
}

function cell(label, content, className) {
  const td = el("td", className);
  td.setAttribute("role", "cell");
  td.dataset.label = label;
  if (content instanceof Node) td.append(content);
  else td.textContent = content;
  return td;
}

/**
 * The table, grouped: one header row per run of tasks that share name, theme, team and user
 * levels (in the defaults, a release in one theme), then one row per device. What a whole group
 * shares is said once instead of on every row.
 */
function groupedRows(assignments, ctx) {
  const groups = [];
  for (const a of assignments) {
    const t = a.task;
    const key = JSON.stringify([t.what, t.theme, t.team, t.users]);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(a);
    else groups.push({ key, items: [a] });
  }
  return groups.flatMap((g) => [groupRow(g.items[0].task, g.items, ctx), ...g.items.map((a) => resultRow(a, ctx))]);
}

function groupRow(t, items, ctx) {
  const tr = el("tr", "group-head");
  tr.setAttribute("role", "row");
  const th = el("th", null);
  th.setAttribute("role", "rowheader");
  th.colSpan = 3;
  th.scope = "colgroup";
  const line = el("div", "group-line");
  line.append(el("span", "group-name", t.what), themeTag(t.theme));
  if (t.team) {
    const badge = el("span", "team-badge", t.team);
    badge.dataset.team = t.team;
    badge.title = `Team ${t.team}`;
    line.append(badge);
  } else {
    line.append(el("span", "group-any", "All teams"));
  }
  if (t.users.length) line.append(el("span", "group-users", labelsIn(USER_LEVELS, t.users).join(", ")));
  const mine = items.filter((a) => isOwner(a, ctx.me)).length;
  if (mine) line.append(el("span", "group-mine", mine === 1 ? "1 is yours" : `${mine} are yours`));
  th.append(line);
  tr.append(th);
  return tr;
}

const DEVICE_ICONS = { desktop: "desktop", mac: "laptop", android: "phone", ios: "phone" };

function resultRow(a, ctx) {
  const t = a.task;
  const isMine = isOwner(a, ctx.me);
  const tr = el("tr", `result-row${isMine ? " is-mine" : a.owners.length === 0 ? " is-unassigned" : ""}`);
  tr.setAttribute("role", "row");
  tr.dataset.taskId = t.id;
  const description = describeTask(t);

  // Device (the group header says what the task is; screen readers get it here too)
  const device = el("div", "device-box");
  const names = el("span", "device-names");
  names.append(el("span", "sr-only", `${t.what}, ${labelIn(THEMES, t.theme)}: `));
  for (const d of t.devices) {
    const item = el("span", "device-name");
    item.append(icon(DEVICE_ICONS[d] ?? "desktop", "icon icon-stroke"), document.createTextNode(labelIn(DEVICES, d)));
    names.append(item);
  }
  device.append(names);
  if (taskBrowsers(t).length) device.append(el("span", "device-browsers", browsersText(t, " · ")));

  // Testers
  const testers = el("div", "assignee-box");
  if (a.owners.length === 0) {
    const none = el("div", "unassigned-box");
    none.append(el("span", "unassigned", "Unassigned"), el("span", "reason", a.reason || "No compatible person was online."));
    testers.append(none);
    const controls = slotControls(a, null, ctx);
    if (controls) testers.append(controls);
  } else {
    const list = el("ul", "owners");
    list.append(...a.owners.map((o) => ownerLine(a, o, ctx)));
    testers.append(list);
  }

  // Actions: Assign me, and the moderator's tools as icon buttons
  const actions = el("div", "row-actions");
  if (ctx.open && canJoinTask(a, ctx.meRow)) actions.append(joinButton(a, ctx));
  if (ctx.isHost && ctx.open) {
    const tools = el("span", "row-tools");
    const change = iconButton("people", `${a.owners.length ? "Change testers" : "Assign testers"} for ${description}`, "testers", t.id);
    change.title = a.owners.length ? "Change testers" : "Assign testers";
    const edit = iconButton("pencil", `Edit ${description}`, "edit-task", t.id);
    edit.title = "Edit task";
    const del = iconButton("trash", `Delete ${description}`, "delete-task", t.id);
    del.title = ctx.lastTask ? "A room needs at least one task." : "Delete task";
    del.classList.add("icon-btn-danger", "btn-confirmable");
    del.append(el("span", "when-armed", "Delete"));
    change.disabled = !ctx.canEdit;
    edit.disabled = !ctx.canEdit;
    del.disabled = !ctx.canEdit || ctx.lastTask;
    tools.append(change, edit, del);
    actions.append(tools);
  }

  tr.append(cell("Device", device, "c-device"), cell("Testers", testers, "c-testers"), cell("Actions", actions, "c-actions"));
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
    els.complaintHint.textContent = "Both spins are used. No more spins or complaints, but tasks can still change hands through takeover requests.";
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
