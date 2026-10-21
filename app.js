// Bootstrap, routing by ?room=, and wiring between domain, backend, UI and reveal.

import { CONFIG, isConfigured } from "./config.js";
import { THEMES, defaultTasks } from "./tasks.js";
import {
  validateProfile, normalizeRoomCode, assignTasks, spinRule,
  normalizeTask, validateTask, validateTaskList, newTaskId, tasksEditable
} from "./domain.js";
import * as backend from "./backend.js";
import * as ui from "./ui.js";
import { playReveal } from "./reveal.js";

const PROFILE_KEY = "wheeloftest.profile";

const state = {
  me: null,
  code: null,
  snapshot: null,
  online: new Set(),
  connection: "connecting",  // connecting | connected | reconnecting
  connectionDetail: "",
  synced: false,             // room re-fetched since the last (re)subscribe
  presenceReady: false,      // at least one presence sync since the last (re)subscribe
  busy: null,                // "spin" | "complain" | "tasks" | null
  stageSpin: 0,              // spin shown on the stage; 0 = wheel
  revealing: false,
  mineOnly: false,
  showFirst: false,
  alert: null,
  formMode: "create",
  draftTasks: defaultTasks(),  // create form: the tasks the new room will start with
  draftOpen: false,            // create form: task list expanded
  editor: null                 // open task editor: { scope: "draft" | "room", taskId: string | null }
};

let subscription = null;
let session = 0;           // bumps whenever we leave a room, to drop stale async results
let refreshJob = null;     // pending re-fetch: { animate, sync }
let refreshRunning = false;
const SYNC_ALERT = "Can't reach the server to update the room. Retrying…";

// ------------------------------------------------------------------ utilities

function secureRandom() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

function loadProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

function saveProfile(profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* storage unavailable */ }
}

function roomUrl(code) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}

const latestSpin = (snap) => snap.spins.reduce((max, s) => Math.max(max, s.spin_number), 0);

function render() {
  if (!subscription || !state.snapshot) return;
  // The room left the lobby (e.g. the moderator spun in another tab): the tasks are locked now.
  if (state.editor?.scope === "room" && !tasksEditable(state.snapshot.room)) closeEditor();
  ui.renderRoom(state);
}

/** Rooms created before tasks were editable store an older task shape; read both. */
function normalizeSnapshot(snap) {
  if (!snap?.room) return snap;
  return {
    ...snap,
    room: { ...snap.room, tasks: (snap.room.tasks ?? []).map(normalizeTask) },
    spins: (snap.spins ?? []).map((s) => ({
      ...s,
      assignments: (s.assignments ?? []).map((a) => ({ ...a, task: normalizeTask(a.task) }))
    }))
  };
}

// ------------------------------------------------------------------ routing

async function route() {
  await leaveRoom();
  document.title = "WheelOfTest";
  if (!isConfigured()) return ui.renderSetup();

  const raw = new URLSearchParams(location.search).get("room");
  if (raw === null) {
    state.formMode = "create";
    state.draftTasks = defaultTasks();  // every new room starts from the defaults
    state.draftOpen = false;
    ui.renderForm({ mode: "create", profile: loadProfile() });
    return renderDraft();
  }

  const code = normalizeRoomCode(raw);
  if (!code) return ui.renderNotFound(raw.trim().slice(0, 12));

  const mySession = session;
  ui.renderMessage({ title: `Opening room ${code}…`, body: "One moment.", focus: false });
  try {
    state.me = await backend.ensureSession();
    const snap = await backend.getRoom(code);
    if (mySession !== session) return;
    if (!snap.exists) return ui.renderNotFound(code);
    if (!snap.member) {
      state.formMode = "join";
      state.code = code;
      document.title = `Join ${code} · WheelOfTest`;
      return ui.renderForm({ mode: "join", code, profile: loadProfile() });
    }
    enterRoom(snap);
  } catch (error) {
    if (mySession !== session) return;
    ui.renderMessage({ title: "Couldn't open the room", body: error.message, linkText: "Try again", linkHref: roomUrl(code) });
  }
}

async function onFormSubmit(event) {
  event.preventDefault();
  const result = validateProfile(ui.readForm());
  ui.setFormErrors(result.errors);
  ui.setFormError(null);
  if (!result.ok) return;

  const mode = state.formMode;
  const code = state.code;
  const tasks = state.draftTasks;
  if (mode === "create") {
    const check = validateTaskList(tasks);
    if (!check.ok) return ui.setFormError(check.error);
  }
  ui.setFormBusy(true, mode === "create" ? "Creating room…" : "Joining…");
  try {
    state.me = await backend.ensureSession();
    const snap = mode === "create"
      ? await backend.createRoom(result.value, tasks)
      : await backend.joinRoom(code, result.value);
    saveProfile(result.value);
    if (mode === "create") history.pushState(null, "", roomUrl(snap.room.code));
    enterRoom(snap);
  } catch (error) {
    ui.setFormBusy(false);
    if (error.code === "room_not_found") return ui.renderNotFound(code);
    if (error.code === "room_full") return ui.setFormError(`This room is full (${CONFIG.roomCapacity} people max).`);
    ui.setFormError(error.message);
  }
}

// ------------------------------------------------------------------ room lifecycle

function enterRoom(raw) {
  closeEditor();
  const snap = normalizeSnapshot(raw);
  Object.assign(state, {
    snapshot: snap,
    code: snap.room.code,
    stageSpin: latestSpin(snap),   // spins that already exist are shown without animation
    online: new Set(),
    connection: "connecting",
    connectionDetail: "",
    synced: false,
    presenceReady: false,
    busy: null,
    revealing: false,
    mineOnly: false,
    showFirst: false,
    alert: null
  });
  document.title = `Room ${snap.room.code} · WheelOfTest`;
  ui.enterRoomView(snap.room.code);

  const mySession = session;
  subscription = backend.subscribeRoom({
    roomId: snap.room.id,
    userId: state.me,
    onChange: () => { if (mySession === session) refresh("event"); },
    onPresence: (ids) => {
      if (mySession !== session) return;
      state.online = ids;
      state.presenceReady = true;
      render();
    },
    onStatus: (status, detail) => { if (mySession === session) onConnection(status, detail); }
  });
  render();
}

async function leaveRoom() {
  closeEditor();
  session += 1;
  refreshJob = null;
  refreshRunning = false;  // a loop from the old room exits on its own (session mismatch)
  const sub = subscription;
  subscription = null;
  state.snapshot = null;
  state.code = null;
  if (sub) await sub.unsubscribe();
}

function onConnection(status, detail) {
  if (status === "subscribed") {
    state.connection = "connected";
    state.connectionDetail = "";
    state.synced = false;
    render();
    refresh("subscribe");
  } else {
    state.connection = "reconnecting";
    state.connectionDetail = detail || "";
    state.synced = false;
    state.presenceReady = false;  // the moderator waits for a fresh presence sync before spinning
    state.online = new Set();     // who was online before the drop is no longer known
    render();
  }
}

/**
 * Re-fetch the room (single flight; requests made meanwhile are merged). reason:
 *   "event"     — a realtime change arrived while connected → new spins animate
 *   "subscribe" — (re)subscribed → new spins show immediately, no animation,
 *                 and the room counts as synced once the fetch succeeds
 * Failures retry with backoff for as long as the room is open, with a visible alert.
 */
function refresh(reason) {
  const job = refreshJob ?? { animate: false, sync: false };
  if (reason === "event") job.animate = true;
  if (reason === "subscribe") job.sync = true;
  refreshJob = job;
  if (!refreshRunning) runRefresh();
}

async function runRefresh() {
  const mySession = session;
  refreshRunning = true;
  let failures = 0;
  try {
    while (refreshJob && mySession === session) {
      const job = refreshJob;
      refreshJob = null;
      try {
        const snap = await backend.getRoom(state.code);
        if (mySession !== session) return;
        if (!snap.member) continue;
        failures = 0;
        if (state.alert === SYNC_ALERT) state.alert = null;
        if (job.sync) state.synced = true;
        // A reconnect re-fetch never animates: the change may have happened while we were away.
        applySnapshot(snap, job.animate && !job.sync ? "event" : "subscribe");
        render();
      } catch (error) {
        if (mySession !== session) return;
        failures += 1;
        console.warn("[WheelOfTest] refresh failed", error);
        refreshJob = { animate: job.animate || Boolean(refreshJob?.animate), sync: job.sync || Boolean(refreshJob?.sync) };
        if (failures >= 2) { state.alert = SYNC_ALERT; render(); }
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** (failures - 1), 15000)));
      }
    }
  } finally {
    if (mySession === session) refreshRunning = false;
  }
}

function applySnapshot(raw, reason) {
  const prev = state.snapshot;
  if (prev && raw.room.state_version <= prev.room.state_version) return;
  const snap = normalizeSnapshot(raw);
  state.snapshot = snap;
  const latest = latestSpin(snap);
  if (!state.revealing) {
    if (latest > state.stageSpin && (reason === "event" || reason === "action")) {
      startReveal(latest);
      return;
    }
    state.stageSpin = latest;
  }
  render();
}

async function startReveal(target) {
  const mySession = session;
  state.revealing = true;
  state.showFirst = false;
  ui.prepareReveal(state);
  render();
  try {
    await playReveal({
      els: ui.revealElements(),
      showResult: () => {
        state.stageSpin = target;
        return ui.renderResult(state);
      }
    });
  } finally {
    if (mySession === session) {
      state.revealing = false;
      state.stageSpin = Math.max(state.stageSpin, target);
      render();
      const mine = state.snapshot.spins.find((s) => s.spin_number === target)
        ?.assignments.filter((a) => a.participant_id === state.me).length ?? 0;
      ui.announce(`${target === 2 ? "Final result is in" : "The wheel has spun"}. You have ${mine} task${mine === 1 ? "" : "s"}.`);
      if (!document.activeElement || document.activeElement === document.body) ui.focusResultTitle();
      const latest = latestSpin(state.snapshot);
      if (latest > state.stageSpin) startReveal(latest); // a newer spin landed during the animation
    }
  }
}

// ------------------------------------------------------------------ actions

async function onSpin() {
  const snap = state.snapshot;
  if (!snap || state.busy || state.revealing || snap.room.host_user_id !== state.me) return;
  if (state.connection !== "connected" || !state.synced || !state.presenceReady) return;
  const rule = spinRule(snap.room, snap.complaints.length, CONFIG.complaintThreshold);
  if (!rule.allowed) return;

  state.busy = "spin";
  state.alert = null;
  render();
  const mySession = session;
  try {
    const participants = snap.participants.map((p) => ({
      ...p,
      online: p.user_id === state.me || state.online.has(p.user_id)
    }));
    const result = assignTasks(snap.room.tasks, participants, secureRandom);
    if (!result.ok) throw new Error(result.error);
    const next = await backend.commitSpin(snap.room.id, rule.spinNumber, result.assignments);
    if (mySession !== session) return;
    state.busy = null;
    applySnapshot(next, "action");
  } catch (error) {
    if (mySession !== session) return;
    state.busy = null;
    state.alert = `Spin failed: ${error.message}`;
    render();
    const button = rule.spinNumber === 1 ? ui.els.spinBtn : ui.els.respinBtn;
    if (!button.hidden && !button.disabled) button.focus();
    if (error.code === "stale_spin" || error.code === "spin_not_allowed") refresh("subscribe");
  }
}

async function onComplain() {
  const snap = state.snapshot;
  if (!snap || state.busy) return;
  state.busy = "complain";
  state.alert = null;
  render();
  const mySession = session;
  try {
    const next = await backend.complain(snap.room.id);
    if (mySession !== session) return;
    state.busy = null;
    applySnapshot(next, "action");
    render();
    ui.announce("Complaint sent.");
  } catch (error) {
    if (mySession !== session) return;
    state.busy = null;
    state.alert = `Complaint failed: ${error.message}`;
    render();
  }
}

// ------------------------------------------------------------------ tasks
// Two lists can be edited: the create form's draft (local until "Create room") and the
// room's own list (saved through update_tasks, moderator only, until the first spin).

let editorReturn = null;  // what to focus once the editor has closed: { scope, taskId }
let editorOpener = null;  // the button that opened the editor (the browser returns focus there on close)

const currentTasks = (scope) => (scope === "draft" ? state.draftTasks : state.snapshot?.room.tasks ?? []);
const blankTask = () => ({ what: "", theme: THEMES[0].value, team: null, devices: ["desktop"], browsers: [], users: [] });

function renderDraft() {
  ui.renderFormTasks({ tasks: state.draftTasks, open: state.draftOpen });
}

function openEditor(scope, taskId) {
  if (state.editor) return;
  if (scope === "room" && !ui.canEditRoomTasks(state)) return;
  const tasks = currentTasks(scope);
  if (taskId === null && tasks.length >= CONFIG.maxTasks) return;
  const task = taskId === null ? blankTask() : tasks.find((t) => t.id === taskId);
  if (!task) return;
  state.editor = { scope, taskId };
  editorOpener = document.activeElement;
  ui.openTaskEditor({ task, isNew: taskId === null });
}

function closeEditor(returnTo = null) {
  if (!state.editor) return;
  editorReturn = returnTo ?? { scope: state.editor.scope, taskId: state.editor.taskId };
  state.editor = null;
  ui.closeTaskEditor();
}

function onEditorClosed() {
  if (ui.els.taskDialog.open) return;
  const target = editorReturn ?? (state.editor ? { scope: state.editor.scope, taskId: state.editor.taskId } : null);
  state.editor = null;   // also covers Escape, which closes the dialog by itself
  editorReturn = null;
  // The close event arrives a moment after the dialog closes. Only place focus if it is still
  // where closing left it (nowhere, or back on the opener); never pull it back from where the
  // person has already moved.
  const current = document.activeElement;
  const untouched = !current || current === document.body || current === editorOpener || ui.els.taskDialog.contains(current);
  editorOpener = null;
  if (target && untouched) ui.focusTask(target.scope, target.taskId);
}

/** Save a new task list for the room. Resolves to { ok } or { ok: false, error, stale }. */
async function saveRoomTasks(next) {
  const snap = state.snapshot;
  if (!snap || !ui.canEditRoomTasks(state)) return { ok: false, error: "The room is still syncing. Try again in a moment." };
  state.busy = "tasks";
  state.alert = null;
  render();
  const mySession = session;
  try {
    const updated = await backend.updateTasks(snap.room.id, next);
    if (mySession !== session) return { ok: false, stale: true };
    state.busy = null;
    applySnapshot(updated, "action");
    render();
    return { ok: true };
  } catch (error) {
    if (mySession !== session) return { ok: false, stale: true };
    state.busy = null;
    if (error.code === "tasks_locked" || error.code === "not_host") {
      state.alert = error.message;
      refresh("subscribe");
    }
    render();
    return { ok: false, error: error.message, code: error.code };
  }
}

async function onTaskFormSubmit(event) {
  event.preventDefault();
  const editor = state.editor;
  if (!editor || ui.taskEditorBusy()) return;
  const tasks = currentTasks(editor.scope);
  const original = editor.taskId === null ? null : tasks.find((t) => t.id === editor.taskId) ?? null;
  const result = validateTask(ui.readTaskForm(), { keep: original });
  ui.setTaskFormErrors(result.errors);
  ui.setTaskFormError(null);
  if (!result.ok) return;

  const editing = original !== null;
  if (!editing && tasks.length >= CONFIG.maxTasks) {
    return ui.setTaskFormError(`A room can have at most ${CONFIG.maxTasks} tasks.`);
  }
  const id = editing ? editor.taskId : newTaskId(tasks.map((t) => t.id), secureRandom);
  const task = { id, ...result.value };
  const next = editing ? tasks.map((t) => (t.id === id ? task : t)) : [...tasks, task];
  const message = editing ? "Task saved." : "Task added.";

  if (editor.scope === "draft") {
    state.draftTasks = next;
    renderDraft();
    closeEditor({ scope: "draft", taskId: id });
    ui.announce(message);
    return;
  }

  ui.setTaskFormBusy(true, "Saving…");
  const outcome = await saveRoomTasks(next);
  if (state.editor !== editor) return;  // closed meanwhile: the room locked or we left it
  ui.setTaskFormBusy(false);
  if (outcome.ok) {
    closeEditor({ scope: "room", taskId: id });
    ui.announce(message);
  } else {
    ui.setTaskFormError(`Couldn't save the task: ${outcome.error}`);
  }
}

async function deleteTask(scope, taskId) {
  const tasks = currentTasks(scope);
  const index = tasks.findIndex((t) => t.id === taskId);
  if (index < 0) return;
  const next = tasks.filter((t) => t.id !== taskId);
  if (!validateTaskList(next).ok) return;  // the last task can't be deleted (its button is disabled)
  const neighbour = ui.adjacentTaskId(scope, taskId);  // where focus goes, in the order shown on screen
  const message = `Deleted ${ui.describeTask(tasks[index])}.`;

  if (scope === "draft") {
    state.draftTasks = next;
    renderDraft();
    ui.focusTask("draft", neighbour);
    ui.announce(message);
    return;
  }
  const outcome = await saveRoomTasks(next);
  if (outcome.ok) {
    ui.focusTask("room", neighbour);
    ui.announce(message);
  } else if (!outcome.stale && !state.alert) {
    state.alert = `Couldn't delete the task: ${outcome.error}`;
    render();
  }
}

async function resetTasks(scope) {
  const message = "Back to the default tasks.";
  if (scope === "draft") {
    state.draftTasks = defaultTasks();
    renderDraft();
    ui.focusTask("draft", null);
    ui.announce(message);
    return;
  }
  const outcome = await saveRoomTasks(defaultTasks());
  if (outcome.ok) {
    ui.focusTask("room", null);
    ui.announce(message);
  } else if (!outcome.stale && !state.alert) {
    state.alert = `Couldn't reset the tasks: ${outcome.error}`;
    render();
  }
}

/** Add / Edit / Delete / Reset buttons in either task list (event delegation). */
function onTaskAreaClick(scope) {
  return (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    const { action, taskId } = button.dataset;
    if (action === "add") openEditor(scope, null);
    else if (action === "edit") openEditor(scope, taskId);
    else if (action === "delete") { if (ui.confirmPress(button)) deleteTask(scope, taskId); }
    else if (action === "reset") { if (ui.confirmPress(button)) resetTasks(scope); }
  };
}

async function onCopyLink() {
  const url = roomUrl(state.code);
  try {
    await navigator.clipboard.writeText(url);
    ui.flashCopied();
    ui.announce("Invite link copied.");
  } catch {
    window.prompt("Copy this invite link:", url);
  }
}

// ------------------------------------------------------------------ wiring

ui.els.form.addEventListener("submit", onFormSubmit);
ui.els.spinBtn.addEventListener("click", onSpin);
ui.els.respinBtn.addEventListener("click", onSpin);
ui.els.complainBtn.addEventListener("click", onComplain);
ui.els.copyLink.addEventListener("click", onCopyLink);
ui.els.mineOnly.addEventListener("change", () => { state.mineOnly = ui.els.mineOnly.checked; render(); });
ui.els.showFirst.addEventListener("change", () => { state.showFirst = ui.els.showFirst.checked; render(); });

ui.els.formTasksToggle.addEventListener("click", () => { state.draftOpen = !state.draftOpen; renderDraft(); });
ui.els.formTasks.addEventListener("click", onTaskAreaClick("draft"));
ui.els.roomTasks.addEventListener("click", onTaskAreaClick("room"));
ui.els.taskForm.addEventListener("submit", onTaskFormSubmit);
ui.els.taskForm.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-all]");
  if (button && button.getAttribute("aria-disabled") !== "true" && !ui.taskEditorBusy()) ui.selectAllChips(button.dataset.selectAll);
});
ui.els.taskForm.addEventListener("change", () => ui.syncSelectAll());
ui.els.taskCancel.addEventListener("click", () => closeEditor());
ui.els.taskDialog.addEventListener("cancel", (event) => { if (ui.taskEditorBusy()) event.preventDefault(); });
ui.els.taskDialog.addEventListener("close", onEditorClosed);

window.addEventListener("popstate", route);
window.addEventListener("offline", () => { if (subscription) onConnection("reconnecting", "Your device is offline."); });
window.addEventListener("online", () => {
  // Rejoin explicitly: "Connected" comes back only from a real SUBSCRIBED, followed by a re-fetch.
  if (subscription) subscription.reconnect();
});

route();
