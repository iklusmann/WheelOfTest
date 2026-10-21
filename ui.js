// DOM rendering for both views. User-supplied text is always set with textContent.

import { CONFIG } from "./config.js";
import { DEVICES, BROWSERS, MAC_BROWSER, USER_LEVELS, THEMES } from "./tasks.js";
import {
  spinRule, tasksEditable, isDefaultTaskList, taskBrowsers,
  hasCriticalFlows, isCriticalFlow, CRITICAL_FLOW_COUNT
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
  wheelArea: $("wheel-area"), wheelStage: $("wheel-stage"), wheelRotor: $("wheel-rotor"),
  spinBtn: $("spin-btn"), wheelStatus: $("wheel-status"),
  resultArea: $("result-area"), resultTitle: $("result-title"), myCount: $("my-count"),
  mineOnly: $("mine-only"), showFirstWrap: $("show-first-wrap"), showFirst: $("show-first"),
  viewingFirst: $("viewing-first"), resultTable: $("result-table"), resultBody: $("result-body"), resultEmpty: $("result-empty"),
  complaints: $("complaints"), complaintCount: $("complaint-count"), complaintHint: $("complaint-hint"),
  complainBtn: $("complain-btn"), respinBtn: $("respin-btn"),
  peopleSummary: $("people-summary"), peopleList: $("people-list"),
  formTasks: $("form-tasks"), formTasksSummary: $("form-tasks-summary"), formTasksToggle: $("form-tasks-toggle"),
  formTasksBody: $("form-tasks-body"), formTaskTools: $("form-task-tools"), formTaskList: $("form-task-list"),
  roomTasks: $("room-tasks"), roomTasksSummary: $("room-tasks-summary"), roomTasksHint: $("room-tasks-hint"),
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
  trash: "M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.1M10 10.5v5.5M14 10.5v5.5"
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
  els.formTasks.hidden = mode !== "create";
  els.formSubmit.dataset.label = els.formSubmit.textContent;
  const form = els.form;
  form.reset();
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

function taskRow(t, { editable, busy, lastOne }) {
  const li = el("li", "task-row");
  li.dataset.taskId = t.id;

  const main = el("div", "task-main");
  const title = el("div", "task-title");
  title.append(el("span", "task-name", t.what), el("span", "tag tag-theme", labelIn(THEMES, t.theme)));

  const meta = el("div", "task-meta");
  if (t.devices.includes("desktop")) meta.append(metaItem("desktop", "Desktop"));
  if (t.devices.includes("mac")) meta.append(metaItem("laptop", "Mac"));
  const phones = t.devices.filter((d) => PHONE_VALUES.includes(d));
  if (phones.length) meta.append(metaItem("phone", labelsIn(DEVICES, phones).join(", ")));
  if (taskBrowsers(t).length) meta.append(metaItem("globe", browsersText(t)));
  if (t.users.length) meta.append(metaItem("person", labelsIn(USER_LEVELS, t.users).join(", ")));
  main.append(title, meta);
  li.append(main);

  if (editable) {
    const description = describeTask(t);
    const edit = iconButton("pencil", `Edit ${description}`, "edit", t.id);
    const del = iconButton("trash", `Delete ${description}`, "delete", t.id);
    del.classList.add("icon-btn-danger", "btn-confirmable");
    del.append(el("span", "when-armed", "Delete"));
    edit.disabled = busy;
    del.disabled = busy || lastOne;
    if (lastOne) del.title = "A room needs at least one task.";
    const actions = el("div", "task-actions");
    actions.append(edit, del);
    li.append(actions);
  }
  return li;
}

const listKeys = new WeakMap();

/**
 * Render tasks grouped by team ("All teams" first, then the configured teams).
 * Keyed, so presence updates don't rebuild the list (and don't drop an armed Delete).
 */
function renderTaskList(container, tasks, { editable, busy }) {
  const key = JSON.stringify([tasks, editable, busy, CONFIG.teams]);
  if (listKeys.get(container) === key) return;
  listKeys.set(container, key);

  const groups = [{ team: null, label: "All teams" }, ...CONFIG.teams.map((team) => ({ team, label: team }))];
  for (const t of tasks) {
    if (t.team !== null && !groups.some((g) => g.team === t.team)) groups.push({ team: t.team, label: t.team });
  }
  const sections = [];
  for (const group of groups) {
    const items = tasks.filter((t) => t.team === group.team);
    if (items.length === 0) continue;
    const section = el("section", "task-group");
    const head = el("h3", "task-group-title");
    if (group.team === null) head.append(el("span", "task-group-name", group.label));
    else {
      const badge = el("span", "team-badge", group.label);
      badge.dataset.team = group.team;
      head.append(badge);
    }
    head.append(el("span", "task-group-count", String(items.length)));
    head.setAttribute("aria-label", `${group.team === null ? "All teams" : `Team ${group.label}`}, ${plural(items.length, "task")}`);
    const list = el("ul", "group task-rows");
    list.append(...items.map((t) => taskRow(t, { editable, busy, lastOne: tasks.length === 1 })));
    section.append(head, list);
    sections.push(section);
  }
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

export function openTaskEditor({ task, isNew }) {
  buildTaskChips();
  addExtraChips(task);
  const form = els.taskForm;
  form.reset();
  els.taskDialogTitle.textContent = isNew ? "New task" : "Edit task";
  els.taskSave.textContent = isNew ? "Add task" : "Save";
  els.taskSave.dataset.label = els.taskSave.textContent;
  form.elements.what.value = task.what;
  for (const input of form.querySelectorAll("input[type=radio], input[type=checkbox]")) {
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
    users: checked("users")
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

export function closeTaskEditor() {
  if (els.taskDialog.open) els.taskDialog.close();
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
  els.roomTasksSummary.textContent = tasksSummary(room.tasks);
  els.roomTasksHint.textContent = !isHost
    ? "The moderator can change these until the wheel spins."
    : state.busy === "tasks" ? "Saving the tasks…"
    : "You can change the tasks until you spin. Everyone in the room sees changes right away.";
  els.roomTaskTools.hidden = !isHost;
  if (isHost) renderTaskTools(els.roomTaskTools, room.tasks, !canEdit);
  renderTaskList(els.roomTaskList, room.tasks, { editable: isHost, busy: !canEdit });
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
    // Desktop always, then whichever of Mac / Android / iOS the tester has
    const devices = el("span", "devices");
    const owned = [["desktop", "Desktop", true], ["laptop", "Mac", p.mac], ["phone", "Android", p.android], ["phone", "iOS", p.ios]];
    for (const [iconName, label, has] of owned) {
      if (!has) continue;
      const d = el("span", "device");
      d.append(icon(iconName), document.createTextNode(label));
      devices.append(d);
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

  const what = el("span", "task-what-box");
  what.append(el("span", "task-what", t.what));
  if (t.users.length) what.append(el("span", "task-users", labelsIn(USER_LEVELS, t.users).join(", ")));
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
    cell("Theme", labelIn(THEMES, t.theme)),
    cell("Devices", labelsIn(DEVICES, t.devices).join(", ")),
    cell("Browsers", taskBrowsers(t).length ? browsersText(t) : "—"),
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
