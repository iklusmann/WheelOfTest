// Bootstrap, routing by ?room=, and wiring between domain, backend, UI and reveal.

import { CONFIG, isConfigured } from "./config.js";
import { THEMES, BROWSERS, USER_LEVELS, defaultTasks } from "./tasks.js";
import {
  validateProfile, normalizeRoomCode, assignTasks, spinRule,
  normalizeTask, validateTask, validateTaskList, newTaskId, tasksEditable,
  withCriticalFlows, CRITICAL_FLOW_COUNT, takeoverChanges, takeoversOpen,
  normalizeAssignment, ownerIds, tasksOf, suggestOwner, validateTasksPerPerson, validateLinks
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
  busy: null,                // "spin" | "complain" | "tasks" | "takeover" | "settings" | "moderator" | null
  stageSpin: 0,              // spin shown on the stage; 0 = wheel
  revealing: false,
  mineOnly: false,
  showFirst: false,
  alert: null,
  formMode: "create",
  draftTasks: defaultTasks(),  // create form: the tasks the new room will start with
  draftOpen: false,            // create form: task list expanded
  editor: null,                // open task editor: { scope: "draft" | "room" | "spin", taskId: string | null }
  testers: null,               // open testers dialog: { taskId }
  linksEditing: false,         // the moderator's links form is open
  lobbyTasksOpen: false        // a participant opened the lobby's task list
};

let subscription = null;
let session = 0;           // bumps whenever we leave a room, to drop stale async results
let refreshJob = null;     // pending re-fetch: { animate, sync }
let refreshRunning = false;
let afterRefresh = null;   // runs once the next re-fetch has rendered (focus after a failed takeover action)
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
  // A spin landed (or the first spin is shown): post-spin changes were for the spin before it.
  if (state.editor?.scope === "spin" && !spinEditable()) closeEditor();
  if (state.testers && !spinEditable()) closeTesters();
  ui.renderRoom(state);
}

/** The spin the moderator's post-spin changes apply to is on screen, and nothing else is running. */
function spinEditable() {
  const snap = state.snapshot;
  return Boolean(snap) && snap.room.host_user_id === state.me && takeoversOpen(snap.room)
    && state.stageSpin === snap.room.spins_used && !state.showFirst && !state.revealing;
}

const canEditSpin = () => spinEditable() && memberCanAct();
const currentSpin = () => state.snapshot?.spins.find((s) => s.spin_number === state.snapshot.room.spins_used) ?? null;
const isOnlineNow = (userId) => userId === state.me ? state.connection === "connected" : state.online.has(userId);

/**
 * Read any stored state in the current shape: rooms created before tasks were editable store an
 * older task shape; spins from before several testers per task have one participant per task.
 * A database from before these features sends no requests, settings or links: no requests, one
 * task per person, and the configured default links.
 */
function normalizeSnapshot(snap) {
  if (!snap?.room) return snap;
  const n = Number(snap.room.tasks_per_person);
  return {
    ...snap,
    room: {
      ...snap.room,
      tasks: (snap.room.tasks ?? []).map(normalizeTask),
      tasks_per_person: Number.isInteger(n) && n >= 1 ? n : 1,
      links: Array.isArray(snap.room.links)
        ? snap.room.links.filter((l) => l && typeof l.url === "string").map((l) => ({ label: typeof l.label === "string" ? l.label : "", url: l.url }))
        : CONFIG.sessionLinks
    },
    spins: (snap.spins ?? []).map((s) => ({ ...s, assignments: (s.assignments ?? []).map(normalizeAssignment) })),
    requests: (Array.isArray(snap.requests) ? snap.requests : []).map((r) => ({ ...r, from_user_id: r.from_user_id ?? null }))
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
    // New rooms start with one task per person and the configured links, both changeable here
    ui.renderForm({ mode: "create", profile: loadProfile(), settings: { tasksPerPerson: 1, links: CONFIG.sessionLinks } });
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
  const mode = state.formMode;
  if (!result.ok) {
    if (mode === "create") ui.setSettingsErrors({});
    return;
  }

  const code = state.code;
  const tasks = state.draftTasks;
  let settings = null;
  if (mode === "create") {
    const raw = ui.readSettingsForm();
    const perPerson = validateTasksPerPerson(raw.tasks_per_person);
    const links = validateLinks(raw.links);
    ui.setSettingsErrors({ tasksPerPerson: perPerson.error, links: links.errors });
    if (!perPerson.ok || !links.ok) return;
    settings = { tasks_per_person: perPerson.value, links: links.value };
    const check = validateTaskList(tasks);
    if (!check.ok) return ui.setFormError(check.error);
  }
  ui.setFormBusy(true, mode === "create" ? "Creating room…" : "Joining…");
  try {
    state.me = await backend.ensureSession();
    const snap = mode === "create"
      ? await backend.createRoom(result.value, tasks, settings)
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
    alert: null,
    testers: null,
    linksEditing: false
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
        if (afterRefresh) {
          const run = afterRefresh;
          afterRefresh = null;
          run();
        }
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
  // Other people's takeover actions arrive silently through realtime; say what changed for me.
  // Not after a reconnect ("subscribe"): the changes may be old news, and the table shows them anyway.
  // Not while my own takeover action is in flight either: its realtime event can land before the
  // RPC answers, and that action announces its own result.
  if (reason === "event" && prev && !state.revealing && !["takeover", "moderator", "settings"].includes(state.busy)) {
    announceTakeovers(takeoverChanges(prev, snap, state.me));
  }
}

function announceTakeovers(changes) {
  if (changes.length) ui.announce(takeoverLines(changes).join(" "));
}

/** One sentence per change, for the screen reader. */
function takeoverLines(changes) {
  const snap = state.snapshot;
  const name = (id) => snap.participants.find((p) => p.user_id === id)?.name ?? "Someone";
  const count = tasksOf(currentSpin()?.assignments, state.me).length;
  const youHave = `You have ${count} task${count === 1 ? "" : "s"}.`;
  return changes.map((c) => {
    const task = ui.describeTask(c.task);
    switch (c.kind) {
      case "asked": return `${name(c.by)} asks to take over ${task}${c.mine ? " from you" : c.from ? ` from ${name(c.from)}` : ""}.`;
      case "approved": return `${task} is now yours. ${youHave}`;
      case "declined": return `Your request for ${task} was declined.`;
      case "dropped": return c.deleted ? `The moderator deleted ${task}, so your request for it is over.` : `Your request for ${task} no longer applies: its testers changed.`;
      case "given": return `The moderator gave you ${task}. ${youHave}`;
      case "joined": return `${name(c.by)} joined you on ${task}.`;
      case "added": return `The moderator added ${task} and gave it to you. ${youHave}`;
      case "removed": return `The moderator deleted ${task}. ${youHave}`;
      default: return c.to ? `${task} went to ${name(c.to)}. ${youHave}` : `You are no longer on ${task}. ${youHave}`;
    }
  });
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
      const mine = tasksOf(state.snapshot.spins.find((s) => s.spin_number === target)?.assignments, state.me).length;
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
    const result = assignTasks(snap.room.tasks, participants, secureRandom, { tasksPerPerson: snap.room.tasks_per_person });
    if (!result.ok) throw new Error(result.error);
    const payload = result.assignments.map((a) => ({ task_id: a.task_id, task: a.task, owner_ids: ownerIds(a) }));
    const next = await backend.commitSpin(snap.room.id, rule.spinNumber, payload);
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

// ------------------------------------------------------------------ takeovers
// After a spin, anyone may ask to take over a task; the moderator or whoever has it answers.
// Every action sends one RPC and applies the snapshot it returns, like complaining does.

const memberCanAct = () => state.connection === "connected" && state.synced && !state.busy && !state.revealing;

async function takeoverAction(call, { taskId, done, failed, focus }) {
  const before = state.snapshot;
  if (!before || !memberCanAct()) return;
  state.busy = "takeover";
  state.alert = null;
  render();  // the controls are rebuilt disabled, so focus is restored below either way
  const mySession = session;
  try {
    const next = await call(before);
    if (mySession !== session) return;
    state.busy = null;
    applySnapshot(next, "action");
    render();
    // Other people's changes that arrived meanwhile were kept quiet (busy); say them now, after mine.
    const others = takeoverChanges(before, state.snapshot, state.me).filter((c) => c.task.id !== taskId);
    ui.announce([done, ...takeoverLines(others)].join(" "));
    focus();
  } catch (error) {
    if (mySession !== session) return;
    state.busy = null;
    state.alert = `${failed}: ${error.message}`;
    render();
    if (error.code === "network") {
      focus();
    } else {
      // The room moved on (answered, withdrawn, spun): re-fetch, as an "event" so a spin that landed
      // meanwhile still plays its reveal, and put focus back once the fresh state is on screen.
      afterRefresh = focus;
      refresh("event");
    }
  }
}

function onRequestTakeover(taskId, fromUserId) {
  takeoverAction((snap) => backend.requestTakeover(snap.room.id, taskId, fromUserId || null), {
    taskId,
    done: "Request sent. The moderator or the person who has the task can approve it.",
    failed: "Couldn't send the request",
    focus: () => ui.focusTakeover(taskId)
  });
}

function onJoinTask(taskId) {
  const task = currentSpin()?.assignments.find((a) => a.task_id === taskId)?.task;
  takeoverAction((snap) => backend.joinTask(snap.room.id, snap.room.spins_used, taskId), {
    taskId,
    done: `You are now on ${task ? ui.describeTask(task) : "the task"}.`,
    failed: "Couldn't assign you",
    focus: () => ui.focusRowControl(taskId, "leave")
  });
}

function onLeaveTask(taskId) {
  const task = currentSpin()?.assignments.find((a) => a.task_id === taskId)?.task;
  takeoverAction((snap) => backend.leaveTask(snap.room.id, snap.room.spins_used, taskId), {
    taskId,
    done: `You left ${task ? ui.describeTask(task) : "the task"}.`,
    failed: "Couldn't leave the task",
    focus: () => ui.focusRowControl(taskId, "join")
  });
}

function onWithdrawTakeover(requestId, taskId) {
  takeoverAction(() => backend.withdrawTakeover(requestId), {
    taskId,
    done: "Request withdrawn.",
    failed: "Couldn't withdraw the request",
    focus: () => ui.focusTakeover(taskId)
  });
}

function onResolveTakeover(requestId, approve, taskId) {
  takeoverAction(() => backend.resolveTakeover(requestId, approve), {
    taskId,
    done: approve ? "Request approved. The task has a new owner." : "Request declined.",
    failed: approve ? "Couldn't approve the request" : "Couldn't decline the request",
    // Not onto another request's button: a repeated Enter would answer someone else's request.
    focus: () => ui.focusAfterResolve()
  });
}

/**
 * Clicks in the result area (event delegation): Take over / Withdraw / Dismiss in the table,
 * Approve / Decline / Withdraw in the requests list, and the moderator's Add task, Change
 * testers, Edit and Delete.
 */
function onTakeoverClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const { action, taskId, requestId } = button.dataset;
  if (action === "add-task") openEditor("spin", null);
  else if (action === "edit-task") openEditor("spin", taskId);
  else if (action === "testers") openTesters(taskId);
  else if (action === "delete-task") { if (ui.confirmPress(button)) deleteTask("spin", taskId); }
  else if (action === "join") onJoinTask(taskId);
  else if (action === "leave") { if (ui.confirmPress(button)) onLeaveTask(taskId); }
  else if (action === "request") onRequestTakeover(taskId, button.dataset.from);
  else if (action === "withdraw") onWithdrawTakeover(requestId, taskId);
  else if (action === "approve") onResolveTakeover(requestId, true, taskId);
  else if (action === "decline") { if (ui.confirmPress(button)) onResolveTakeover(requestId, false, taskId); }
}

// ------------------------------------------------------------------ the moderator after the spin
// Add, edit and delete tasks, and change who tests them. Each change is one RPC on the current
// spin; the snapshot it returns is applied like any other action.

/**
 * Run one moderator RPC with the room marked busy. Resolves to { ok } or { ok: false, error, code }.
 * When the room moved on (another spin, a task gone), a re-fetch follows.
 */
async function moderatorCall(call, busy = "moderator", taskId = null) {
  const snap = state.snapshot;
  if (!snap || !memberCanAct()) return { ok: false, error: "The room is busy or still syncing. Try again in a moment." };
  state.busy = busy;
  state.alert = null;
  render();
  const mySession = session;
  try {
    const next = await call(snap);
    if (mySession !== session) return { ok: false, stale: true };
    state.busy = null;
    applySnapshot(next, "action");
    render();
    // Other people's changes that arrived meanwhile were kept quiet (busy); the caller says them after its own
    const others = takeoverChanges(snap, state.snapshot, state.me).filter((c) => c.task.id !== taskId);
    return { ok: true, others: takeoverLines(others) };
  } catch (error) {
    if (mySession !== session) return { ok: false, stale: true };
    state.busy = null;
    render();
    const moved = ["stale_spin", "task_not_found", "task_exists", "not_host", "not_spun", "settings_locked", "last_task"];
    if (moved.includes(error.code)) refresh("event");
    return { ok: false, error: error.message, code: error.code };
  }
}

/**
 * The testers to save: the current ones, minus the people the moderator unchecked, plus the ones
 * they checked (relative to what the dialog showed when it opened). Order: current, then new.
 */
function applyTesterChanges(current, opened, chosen) {
  const removed = opened.filter((id) => !chosen.includes(id));
  const added = chosen.filter((id) => !opened.includes(id));
  const kept = current.filter((id) => !removed.includes(id));
  return [...kept, ...added.filter((id) => !kept.includes(id))];
}

const namesOf = (ids) => {
  const names = ids.map((id) => state.snapshot.participants.find((p) => p.user_id === id)?.name ?? "someone");
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

// ---- who tests a task

let testersOpener = null;
let testersReturn = null;

function openTesters(taskId) {
  if (state.testers || state.editor || !canEditSpin()) return;
  const entry = currentSpin()?.assignments.find((a) => a.task_id === taskId);
  if (!entry) return;
  state.testers = { taskId, opened: ownerIds(entry) };
  testersOpener = document.activeElement;
  ui.openTestersDialog({ task: entry.task, participants: state.snapshot.participants, selected: ownerIds(entry), isOnline: isOnlineNow });
}

function closeTesters() {
  if (!state.testers) return;
  testersReturn = state.testers.taskId;
  state.testers = null;
  ui.closeTestersDialog();
}

function onTestersClosed() {
  if (ui.els.testersDialog.open) return;
  const taskId = testersReturn ?? state.testers?.taskId ?? null;
  state.testers = null;   // also covers Escape
  testersReturn = null;
  const current = document.activeElement;
  const untouched = !current || current === document.body || current === testersOpener || ui.els.testersDialog.contains(current);
  testersOpener = null;
  if (taskId && untouched) ui.focusRowControl(taskId, "testers");
}

async function onTestersSubmit(event) {
  event.preventDefault();
  const open = state.testers;
  if (!open || ui.testersBusy()) return;
  const entry = currentSpin()?.assignments.find((a) => a.task_id === open.taskId);
  const task = state.snapshot.room.tasks.find((t) => t.id === open.taskId);
  if (!entry || !task) return closeTesters();
  // Testers who stay keep their place in the list; new ones follow, in the order shown
  // Apply only what the moderator changed in the dialog to the testers as they are now, so a
  // takeover approved while it was open isn't undone
  const owners = applyTesterChanges(ownerIds(entry), open.opened, ui.readTesters());
  const current = ownerIds(entry);
  if (owners.length === current.length && owners.every((id, i) => id === current[i])) return closeTesters();

  ui.setTestersBusy(true);
  ui.setTestersError(null);
  const outcome = await moderatorCall((snap) => backend.saveTask(snap.room.id, snap.room.spins_used, task, owners, false), "moderator", task.id);
  if (state.testers !== open) return;   // closed meanwhile (a spin landed, we left the room)
  ui.setTestersBusy(false);
  if (outcome.ok) {
    closeTesters();
    ui.announce([owners.length ? `Testers saved. ${ui.describeTask(task)} now goes to ${namesOf(owners)}.` : `${ui.describeTask(task)} is now unassigned.`, ...outcome.others].join(" "));
  } else if (!outcome.stale) {
    ui.setTestersError(`Couldn't save the testers: ${outcome.error}`);
  }
}

// ---- room settings: tasks per person (lobby) and the session links (any time)

async function saveTasksPerPerson(value, focusAfter = null) {
  const room = state.snapshot?.room;
  if (!room || !ui.canEditRoomTasks(state) || value === room.tasks_per_person) return;
  const outcome = await moderatorCall((snap) => backend.updateSettings(snap.room.id, { tasks_per_person: value }), "settings");
  if (outcome.ok) ui.announce(`Tasks per person: ${value}.`);
  else if (!outcome.stale) { state.alert = `Couldn't change tasks per person: ${outcome.error}`; render(); }
  // The stepper was disabled while saving; put focus back where it was (the other button at a limit)
  ui.focusStepper(ui.els.roomStepper, focusAfter);
}

function onRoomSettingsClick(event) {
  const button = event.target.closest("button[data-step]");
  if (!button || button.disabled || !ui.canEditRoomTasks(state)) return;
  saveTasksPerPerson(ui.stepValue(ui.els.roomStepper, Number(button.dataset.step)), button.dataset.step);
}

function onRoomSettingsChange() {
  const input = ui.els.roomTasksPerPerson;
  const check = validateTasksPerPerson(input.value);
  if (!check.ok) {
    input.value = String(state.snapshot.room.tasks_per_person);  // back to what the room has
    ui.announce(check.error);
    return;
  }
  saveTasksPerPerson(check.value);
}

function openLinksEditor() {
  if (state.snapshot?.room.host_user_id !== state.me || state.linksEditing) return;
  state.linksEditing = true;
  render();
  ui.openLinksForm(state.snapshot.room.links);
}

function closeLinksEditor() {
  if (!state.linksEditing) return;
  state.linksEditing = false;
  render();
  ui.focusLinksEdit();
}

async function onLinksSubmit(event) {
  event.preventDefault();
  if (!state.linksEditing || state.busy === "settings") return;
  const check = validateLinks(ui.readLinksForm());
  ui.setLinksErrors({ links: check.errors });
  if (!check.ok) return;
  const outcome = await moderatorCall((snap) => backend.updateSettings(snap.room.id, { links: check.value }), "settings");
  if (outcome.ok) {
    closeLinksEditor();
    ui.announce(check.value.length ? "Session links saved." : "Session links removed.");
  } else if (!outcome.stale) {
    ui.setLinksErrors({ links: check.errors, message: `Couldn't save the links: ${outcome.error}` });
  }
}

// ------------------------------------------------------------------ tasks
// Two lists can be edited: the create form's draft (local until "Create room") and the
// room's own list (saved through update_tasks, moderator only, until the first spin).

let editorReturn = null;  // what to focus once the editor has closed: { scope, taskId }
let editorOpener = null;  // the button that opened the editor (the browser returns focus there on close)

const currentTasks = (scope) => (scope === "draft" ? state.draftTasks : state.snapshot?.room.tasks ?? []);
// A new task starts like the defaults: Desktop, every browser, every user level.
const blankTask = () => ({
  what: "", theme: THEMES[0].value, team: null, devices: ["desktop"],
  browsers: BROWSERS.map((o) => o.value), users: USER_LEVELS.map((o) => o.value)
});

function renderDraft() {
  ui.renderFormTasks({ tasks: state.draftTasks, open: state.draftOpen });
}

function openEditor(scope, taskId) {
  if (state.editor || state.testers) return;
  if (scope === "room" && !ui.canEditRoomTasks(state)) return;
  if (scope === "spin" && !canEditSpin()) return;
  const tasks = currentTasks(scope);
  if (taskId === null && tasks.length >= CONFIG.maxTasks) return;
  const task = taskId === null ? blankTask() : tasks.find((t) => t.id === taskId);
  if (!task) return;
  // After the spin the editor also says who tests the task. A new task suggests someone online
  // with the devices and the fewest tasks.
  let testers = null;
  if (scope === "spin") {
    const assignments = currentSpin()?.assignments ?? [];
    const entry = taskId === null ? null : assignments.find((a) => a.task_id === taskId);
    const selected = entry ? ownerIds(entry) : [suggestOwner(task, state.snapshot.participants, assignments, isOnlineNow)].filter(Boolean);
    testers = { participants: state.snapshot.participants, selected, isOnline: isOnlineNow };
  }
  state.editor = { scope, taskId, opened: testers?.selected ?? [] };
  editorOpener = document.activeElement;
  ui.openTaskEditor({ task, isNew: taskId === null, testers });
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
  if (!target || !untouched) return;
  if (target.scope === "spin") ui.focusRowControl(target.taskId, "edit-task");
  else ui.focusTask(target.scope, target.taskId);
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

  if (editor.scope === "spin") {
    // After the spin: the task and its testers in one call (the database checks the devices)
    const current = editing ? ownerIds(currentSpin()?.assignments.find((a) => a.task_id === id)) : [];
    // A new task: exactly who is checked. An existing one: only what changed, applied to the testers now.
    const chosen = ui.readTaskForm().owners;
    const ordered = editing ? applyTesterChanges(current, editor.opened ?? [], chosen) : chosen;
    ui.setTaskFormBusy(true, "Saving…");
    const outcome = await moderatorCall((snap) => backend.saveTask(snap.room.id, snap.room.spins_used, task, ordered, !editing), "moderator", id);
    if (state.editor !== editor) return;
    ui.setTaskFormBusy(false);
    if (outcome.ok) {
      closeEditor({ scope: "spin", taskId: id });
      ui.announce([editing ? "Task saved." : ordered.length ? `Task added and given to ${namesOf(ordered)}.` : "Task added. Nobody tests it yet.", ...outcome.others].join(" "));
    } else if (!outcome.stale) {
      ui.setTaskFormError(`Couldn't save the task: ${outcome.error}`);
    }
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
  if (scope === "spin") {
    const rowNeighbour = ui.adjacentRowTaskId(taskId);
    const outcome = await moderatorCall((snap) => backend.deleteTask(snap.room.id, snap.room.spins_used, taskId), "moderator", taskId);
    if (outcome.ok) {
      ui.focusRowControl(rowNeighbour, "edit-task");
      ui.announce([message, ...outcome.others].join(" "));
    } else if (!outcome.stale) {
      state.alert = `Couldn't delete the task: ${outcome.error}`;
      render();
    }
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

/** The Critical User Flows switch: leave the whole block out, or put the default one back. */
async function setCriticalFlows(scope, on) {
  const tasks = currentTasks(scope);
  const next = withCriticalFlows(tasks, on);
  if (next === tasks || !validateTaskList(next).ok) {
    if (scope === "draft") renderDraft(); else render();  // put the switch back where it was
    return;
  }
  const message = on
    ? `Added the ${CRITICAL_FLOW_COUNT} Critical User Flows tasks.`
    : `Left out the ${tasks.length - next.length} Critical User Flows tasks.`;
  if (scope === "draft") {
    state.draftTasks = next;
    renderDraft();
    ui.announce(message);
    return;
  }
  const outcome = await saveRoomTasks(next);
  if (outcome.ok) {
    ui.announce(message);
  } else if (!outcome.stale && !state.alert) {
    state.alert = `Couldn't update the tasks: ${outcome.error}`;
    render();
  }
  ui.focusCriticalFlows("room");
}

function onTaskAreaChange(scope) {
  return (event) => {
    const input = event.target.closest('[data-toggle="critical-flows"]');
    if (input) setCriticalFlows(scope, input.checked);
  };
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
ui.els.resultArea.addEventListener("click", onTakeoverClick);
ui.els.copyLink.addEventListener("click", onCopyLink);
ui.els.mineOnly.addEventListener("change", () => { state.mineOnly = ui.els.mineOnly.checked; render(); });
ui.els.showFirst.addEventListener("change", () => { state.showFirst = ui.els.showFirst.checked; render(); });

ui.els.formTasksToggle.addEventListener("click", () => { state.draftOpen = !state.draftOpen; renderDraft(); });
ui.els.formTasks.addEventListener("click", onTaskAreaClick("draft"));
ui.els.roomTasks.addEventListener("click", onTaskAreaClick("room"));
ui.els.formTasks.addEventListener("change", onTaskAreaChange("draft"));
// The create form's Critical User Flows switch sits inside the profile form: Enter toggles it
// instead of submitting the form (which would create the room).
ui.els.formTasks.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches?.('[data-toggle="critical-flows"]')) {
    event.preventDefault();
    if (!event.target.disabled) event.target.click();
  }
});
ui.els.roomTasks.addEventListener("change", onTaskAreaChange("room"));
ui.els.taskForm.addEventListener("submit", onTaskFormSubmit);
ui.els.taskForm.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-all]");
  if (button && button.getAttribute("aria-disabled") !== "true" && !ui.taskEditorBusy()) ui.selectAllChips(button.dataset.selectAll);
});
ui.els.taskForm.addEventListener("change", () => ui.syncTaskForm());
ui.els.taskCancel.addEventListener("click", () => closeEditor());
ui.els.taskDialog.addEventListener("cancel", (event) => { if (ui.taskEditorBusy()) event.preventDefault(); });
ui.els.taskDialog.addEventListener("close", onEditorClosed);
ui.els.testersForm.addEventListener("submit", onTestersSubmit);
ui.els.testersCancel.addEventListener("click", () => closeTesters());
ui.els.testersDialog.addEventListener("cancel", (event) => { if (ui.testersBusy()) event.preventDefault(); });
ui.els.testersDialog.addEventListener("close", onTestersClosed);
ui.els.formSettings.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-step]");
  if (button && !button.disabled) ui.stepValue(button.closest("[data-stepper]"), Number(button.dataset.step));
});
ui.els.roomSettings.addEventListener("click", onRoomSettingsClick);
ui.els.roomTasksPerPerson.addEventListener("change", onRoomSettingsChange);
ui.els.linksEdit.addEventListener("click", openLinksEditor);
ui.els.roomTasksToggle.addEventListener("click", () => { state.lobbyTasksOpen = !state.lobbyTasksOpen; render(); });
for (const container of [ui.els.formLinks, ui.els.roomLinks]) {
  container.addEventListener("click", (event) => {
    const add = event.target.closest("[data-link-add]");
    if (add && !add.disabled && ui.addLinkRow(container)) ui.announce("Link added. Fill in the label and the address.");
  });
}
ui.els.linksCancel.addEventListener("click", closeLinksEditor);
ui.els.linksForm.addEventListener("submit", onLinksSubmit);
ui.els.linksForm.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeLinksEditor(); } });

window.addEventListener("popstate", route);
window.addEventListener("offline", () => { if (subscription) onConnection("reconnecting", "Your device is offline."); });
window.addEventListener("online", () => {
  // Rejoin explicitly: "Connected" comes back only from a real SUBSCRIBED, followed by a re-fetch.
  if (subscription) subscription.reconnect();
});

route();
