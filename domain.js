// Pure domain logic: validation, compatibility, assignment.
// No DOM, network or storage access. Randomness is always passed in.

import { CONFIG } from "./config.js";
import { DEFAULT_TASKS, DEVICES, BROWSERS, MAC_BROWSER, USER_LEVELS, THEMES } from "./tasks.js";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export const ROOM_CODE_LENGTH = 6;
export const PHONES = ["android", "ios"];
export const UNASSIGNED_NO_PHONE = "No one online has an Android or iOS phone.";
export const UNASSIGNED_NO_MAC = "No one online has a Mac.";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const PHONE_LABELS = { android: "Android", ios: "iOS" };

// ---------------------------------------------------------------- validation

export function validateProfile(input, options = {}) {
  const teams = options.teams ?? CONFIG.teams;
  const maxName = options.nameMaxLength ?? CONFIG.nameMaxLength;
  const errors = {};

  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const nameLength = Array.from(name).length; // code points, like Postgres char_length
  if (nameLength === 0) errors.name = "Enter your name.";
  else if (nameLength > maxName) errors.name = `Use at most ${maxName} characters.`;
  else if (CONTROL_CHARS.test(name)) errors.name = "Your name contains characters that are not allowed.";

  const team = input?.team;
  if (typeof team !== "string" || !teams.includes(team)) errors.team = "Choose your team.";

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    // Desktop is implied: everyone has one. Mac, Android and iOS are what the tester can also test on.
    value: ok ? { name, team, mac: input?.mac === true, android: input?.android === true, ios: input?.ios === true } : null
  };
}

export function normalizeRoomCode(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

// ---------------------------------------------------------------- tasks

const strings = (value) => (Array.isArray(value) ? [...new Set(value.filter((v) => typeof v === "string"))] : []);

/**
 * Keep option values only, without duplicates, in the order the options are listed.
 * `keep` are values the task already had that aren't in the list; they may stay (after the known ones).
 */
function pickOptions(values, options, keep = []) {
  const chosen = new Set(strings(values));
  const known = options.map((o) => o.value);
  return [...new Set([...known, ...strings(keep)])].filter((v) => chosen.has(v));
}

/**
 * Any stored task → the current shape. Rooms created before tasks were editable stored
 * `platform` ("desktop" | "mobile") and `device` (the browser, or "mobile"); those are
 * converted, so an old room behaves exactly as it did.
 */
export function normalizeTask(task) {
  const t = task && typeof task === "object" ? task : {};
  let devices = strings(t.devices);
  let browsers = strings(t.browsers);
  if (!Array.isArray(t.devices)) {
    devices = t.platform === "mobile" ? [...PHONES] : ["desktop"];
    if (!Array.isArray(t.browsers)) {
      browsers = t.platform !== "mobile" && typeof t.device === "string" && t.device !== "mobile" ? [t.device] : [];
    }
  }
  return {
    id: String(t.id ?? ""),
    what: typeof t.what === "string" ? t.what : "",
    theme: typeof t.theme === "string" ? t.theme : "",
    team: typeof t.team === "string" ? t.team : null,
    devices,
    browsers,
    users: strings(t.users)
  };
}

/** The phones a task needs (the assignee must have at least one), in PHONES order. Empty = no phone needed. */
export function taskPhones(task) {
  const devices = normalizeTask(task).devices;
  return PHONES.filter((p) => devices.includes(p));
}

/** Whether a task needs a tester with a Mac. */
export function taskNeedsMac(task) {
  return normalizeTask(task).devices.includes("mac");
}

/** Browsers a task is tested in: the selected ones on Desktop, plus Safari on Mac. */
export function taskBrowsers(task) {
  const t = normalizeTask(task);
  const list = t.devices.includes("desktop") ? [...t.browsers] : [];
  if (t.devices.includes("mac") && !list.includes(MAC_BROWSER.value)) list.push(MAC_BROWSER.value);
  return list;
}

/** Same text as public._wot_unassigned_reason() in schema.sql. */
export function unassignedReason(task) {
  const phones = taskPhones(task);
  const mac = taskNeedsMac(task);
  const parts = [];
  if (mac) parts.push("a Mac");
  if (phones.length || !mac) parts.push(`an ${(phones.length ? phones : PHONES).map((p) => PHONE_LABELS[p]).join(" or ")} phone`);
  return `No one online has ${parts.join(" and ")}.`;
}

/**
 * Validate one task from the editor. Returns { ok, errors, value } where value has no id;
 * the caller keeps the existing id or makes a new one. Team "" or null means all teams.
 * options.keep: the task as it was before editing. A team, theme, browser or user level it
 * already had stays allowed even when it isn't in the option lists (e.g. TEAM_OPTIONS
 * leaves out a team), so editing never changes a field silently.
 */
export function validateTask(input, options = {}) {
  const keep = options.keep ? normalizeTask(options.keep) : null;
  const teams = [...(options.teams ?? CONFIG.teams), ...(keep?.team ? [keep.team] : [])];
  const maxName = options.taskNameMaxLength ?? CONFIG.taskNameMaxLength;
  const errors = {};

  const what = typeof input?.what === "string" ? input.what.trim() : "";
  const length = Array.from(what).length;
  if (length === 0) errors.what = "Give the task a name.";
  else if (length > maxName) errors.what = `Use at most ${maxName} characters.`;
  else if (CONTROL_CHARS.test(what)) errors.what = "The name contains characters that are not allowed.";

  const team = input?.team === "" || input?.team == null ? null : input.team;
  if (team !== null && (typeof team !== "string" || !teams.includes(team))) errors.team = "Choose a team or All teams.";

  const theme = input?.theme;
  if (!THEMES.some((t) => t.value === theme) && !(keep?.theme && theme === keep.theme)) errors.theme = "Choose a theme.";

  const devices = pickOptions(input?.devices, DEVICES);  // no extras: the database only knows these four
  if (devices.length === 0) errors.devices = "Select at least one device.";

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok
      ? {
          what, theme, team, devices,
          // Browsers belong to Desktop; without Desktop there is nothing to choose (Mac means Safari).
          browsers: devices.includes("desktop") ? pickOptions(input?.browsers, BROWSERS, keep?.browsers) : [],
          users: pickOptions(input?.users, USER_LEVELS, keep?.users)
        }
      : null
  };
}

/** Rules for a room's whole task list. Mirrors public._wot_clean_tasks(). */
export function validateTaskList(tasks, options = {}) {
  const max = options.maxTasks ?? CONFIG.maxTasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return { ok: false, error: "A room needs at least one task." };
  if (tasks.length > max) return { ok: false, error: `A room can have at most ${max} tasks.` };
  const ids = new Set(tasks.map((t) => t?.id));
  if (ids.size !== tasks.length || ids.has(undefined) || ids.has("")) return { ok: false, error: "Task ids must be unique." };
  return { ok: true, error: null };
}

/** A task id that is not in `existingIds`. */
export function newTaskId(existingIds, random) {
  const taken = new Set(existingIds);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let id = "task-";
    for (let i = 0; i < 8; i += 1) id += "abcdefghijkmnpqrstuvwxyz23456789"[pickIndex(32, random)];
    if (!taken.has(id)) return id;
  }
  let n = taken.size + 1; // a broken random source: fall back to a counter
  while (taken.has(`task-${n}`)) n += 1;
  return `task-${n}`;
}

/** Whether two task lists are the same, field by field and in order. */
export function sameTaskList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((t, i) => JSON.stringify(normalizeTask(t)) === JSON.stringify(normalizeTask(b[i])));
}

export const isDefaultTaskList = (tasks) => sameTaskList(tasks, DEFAULT_TASKS);

// ---- Critical User Flows: an optional block of default tasks (ids "cuf-…", also in old rooms)

export const isCriticalFlow = (task) => String(task?.id ?? "").startsWith("cuf-");
export const hasCriticalFlows = (tasks) => tasks.some(isCriticalFlow);
export const CRITICAL_FLOW_COUNT = DEFAULT_TASKS.filter(isCriticalFlow).length;

/**
 * Turn the Critical User Flows block on or off. Off removes every "cuf-" task (edited ones too);
 * on puts the default ones back at the top, where the defaults have them. No-op if already so.
 */
export function withCriticalFlows(tasks, on) {
  if (!on) return tasks.filter((t) => !isCriticalFlow(t));
  if (hasCriticalFlows(tasks)) return tasks;
  const block = DEFAULT_TASKS.filter(isCriticalFlow)
    .map((t) => ({ ...t, devices: [...t.devices], browsers: [...t.browsers], users: [...t.users] }));
  return [...block, ...tasks];
}

// ------------------------------------------------------------- compatibility

/**
 * Who can take a task. Desktop: anyone. Mac: someone with a Mac. Android/iOS: someone with
 * at least one of the selected phones (they test the same app). A task with Mac and phones
 * needs both.
 */
export function canReceiveTask(task, participant) {
  if (taskNeedsMac(task) && !participant.mac) return false;
  const phones = taskPhones(task);
  return phones.length === 0 || phones.some((p) => Boolean(participant[p]));
}

// ---------------------------------------------------------------- randomness

/** Deterministic PRNG for tests. Returns a function yielding floats in [0, 1). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndex(length, random) {
  const r = Number(random());
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.min(length - 1, Math.floor(r * length));
}

export function shuffle(items, random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1, random);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------- testers
// A task can have several testers. An assignment is { task_id, task, owners: [...], reason };
// reason only says why nobody has the task.

/** One tester as stored on an assignment (the database stores its own copy). */
export function ownerOf(participant, task) {
  const t = normalizeTask(task);
  return {
    user_id: participant.user_id,
    name: participant.name,
    team: participant.team,
    mac: Boolean(participant.mac),
    android: Boolean(participant.android),
    ios: Boolean(participant.ios),
    team_match: t.team == null ? null : participant.team === t.team
  };
}

/**
 * Any stored assignment → { task_id, task, owners, reason }. Spins stored before a task could
 * have several testers have participant_id / participant (and took_over_* on the entry); they
 * become a one-person list, so an old room reads exactly as it did.
 */
export function normalizeAssignment(a) {
  const x = a && typeof a === "object" ? a : {};
  let owners = [];
  if (Array.isArray(x.owners)) {
    const seen = new Set();
    for (const o of x.owners) {
      if (!o || typeof o.user_id !== "string" || seen.has(o.user_id)) continue;
      seen.add(o.user_id);
      owners.push({ ...o, mac: o.mac === true, android: o.android === true, ios: o.ios === true, team_match: o.team_match ?? null });
    }
  } else if (typeof x.participant_id === "string" && x.participant_id) {
    const p = x.participant && typeof x.participant === "object" ? x.participant : {};
    const owner = {
      user_id: x.participant_id, name: typeof p.name === "string" ? p.name : "", team: p.team ?? null,
      mac: p.mac === true, android: p.android === true, ios: p.ios === true, team_match: x.team_match ?? null
    };
    if (x.took_over_at) Object.assign(owner, { took_over_from: x.took_over_from ?? null, took_over_by: x.took_over_by ?? null, took_over_at: x.took_over_at });
    owners = [owner];
  }
  return {
    task_id: String(x.task_id ?? ""),
    task: normalizeTask(x.task),
    owners,
    reason: owners.length === 0 && typeof x.reason === "string" ? x.reason : null
  };
}

export const ownerIds = (assignment) => (assignment?.owners ?? []).map((o) => o.user_id);
export const isOwner = (assignment, userId) => userId != null && (assignment?.owners ?? []).some((o) => o.user_id === userId);
/** The assignments `userId` tests. */
export const tasksOf = (assignments, userId) => (Array.isArray(assignments) ? assignments : []).filter((a) => isOwner(a, userId));

// ---------------------------------------------------------------- assignment

const taskSnapshot = normalizeTask;
const perPersonOf = (value) => Math.max(1, Math.trunc(Number(value)) || 1);

/** Why a task nobody got stays empty when people could take it. Same text as public._wot_full_reason(). */
export function fullReason(tasksPerPerson) {
  const n = perPersonOf(tasksPerPerson);
  return `Everyone online who can take it already has ${n} task${n === 1 ? "" : "s"}.`;
}

/** Whether a task is one of the person's own team's (all-teams tasks count as cross-team). */
export const isOwnTeamTask = (task, participant) => task.team != null && task.team === participant.team;

/** How many of these tasks a participant has the devices for. */
export const compatibleCount = (tasks, participant) => tasks.filter((t) => canReceiveTask(t, participant)).length;

// ---- a small min-cost flow with lexicographic costs
// A cost is a vector compared component by component, so every component outweighs all the
// ones after it, whatever the numbers. That keeps the rules in a strict order without weights.
const FAIR = 0;     // -1 for a person's first task: as many people as possible get one
const COUNT = 1;    // -1 per task: everyone gets as close to tasks-per-person as the tasks allow
const BALANCE = 2;  // +k for a person's k-th task: even loads (only matters above 2 per person)
const MIX = 3;      // +1 for each task beyond "one own team's, one cross-team"
const COVER = 4;    // -1 for a task's first tester: as many tasks as possible get someone
const NOISE = 5;    // random tie-break, so equally good assignments come up at random
const DIMS = 6;

const costOf = (parts) => {
  const c = new Array(DIMS).fill(0);
  for (const [i, x] of parts) c[i] = x;
  return c;
};
const isNegative = (c) => {
  for (let i = 0; i < DIMS; i += 1) if (c[i] !== 0) return c[i] < 0;
  return false;
};
/** (a + b) < c, lexicographically, without allocating. */
function sumLess(a, b, c) {
  for (let i = 0; i < DIMS; i += 1) {
    const x = a[i] + b[i];
    if (x !== c[i]) return x < c[i];
  }
  return false;
}

class UnitFlow {
  constructor(size) {
    this.adj = Array.from({ length: size }, () => []);
    this.to = [];
    this.cap = [];
    this.cost = [];
  }

  /** One unit of capacity from u to v; returns the edge index (its reverse is index ^ 1). */
  add(u, v, cost) {
    const e = this.to.length;
    this.adj[u].push(e);
    this.to.push(v); this.cap.push(1); this.cost.push(cost);
    this.adj[v].push(e + 1);
    this.to.push(u); this.cap.push(0); this.cost.push(cost.map((x) => -x));
    return e;
  }

  /** Send units from s to t along cheapest paths while that still lowers the total cost. */
  run(s, t) {
    const n = this.adj.length;
    for (;;) {
      // Bellman-Ford with a queue (the residual graph has negative edges but no negative cycles)
      const dist = new Array(n).fill(null);
      const via = new Int32Array(n).fill(-1);
      const queued = new Uint8Array(n);
      const queue = [s];
      dist[s] = new Array(DIMS).fill(0);
      queued[s] = 1;
      for (let head = 0; head < queue.length; head += 1) {
        const u = queue[head];
        queued[u] = 0;
        for (const e of this.adj[u]) {
          if (this.cap[e] === 0) continue;
          const v = this.to[e];
          if (dist[v] !== null && !sumLess(dist[u], this.cost[e], dist[v])) continue;
          dist[v] = dist[u].map((x, i) => x + this.cost[e][i]);
          via[v] = e;
          if (!queued[v]) { queued[v] = 1; queue.push(v); }
        }
      }
      if (dist[t] === null || !isNegative(dist[t])) return;
      for (let v = t; v !== s; v = this.to[via[v] ^ 1]) {
        this.cap[via[v]] -= 1;
        this.cap[via[v] ^ 1] += 1;
      }
    }
  }
}

/**
 * Assign the tasks to the people online.
 *
 * tasks: room tasks (current or legacy shape)
 * participants: [{ user_id, name, team, mac, android, ios, online }]
 * random: () => number in [0, 1)
 * options.tasksPerPerson: the most tasks anyone gets (default CONFIG.defaultTasksPerPerson)
 * options.maxTesters: the most testers a task gets (default CONFIG.maxTestersPerTask)
 *
 * Hard rules: the device rule (canReceiveTask), nobody above tasksPerPerson, no task above
 * maxTesters, nobody twice on a task. Within them, in this order (an earlier rule always wins):
 *   1. as many people as possible get a task;
 *   2. as many tasks as possible are handed out, so everyone gets tasksPerPerson if the tasks allow;
 *   3. loads are even;
 *   4. each person's first task is their own team's and the second a cross-team one (another
 *      team's or an all-teams task); with 1 per person, their own team's or an all-teams task;
 *      beyond 2, either;
 *   5. as many tasks as possible get a tester; a second tester only where nothing else is left;
 *   6. among equally good results, chance decides.
 * This is solved exactly (a min-cost flow), so the counts never depend on luck; only who gets
 * which of equally good tasks does.
 *
 * Returns { ok: true, assignments } with one entry per task, in the order of `tasks`:
 * { task_id, task, owners: [{ user_id, name, team, mac, android, ios, team_match }], reason },
 * or { ok: false, error } when nobody is online. A task nobody got has a reason: the Mac or
 * phone nobody online has (unassignedReason), or that everyone who could take it is full (fullReason).
 */
export function assignTasks(tasks, participants, random, options = {}) {
  if (!Array.isArray(tasks) || !Array.isArray(participants)) throw new TypeError("tasks and participants must be arrays");
  if (typeof random !== "function") throw new TypeError("random must be a function");
  const perPerson = perPersonOf(options.tasksPerPerson ?? CONFIG.defaultTasksPerPerson);
  const maxTesters = Math.max(1, Math.trunc(Number(options.maxTesters ?? CONFIG.maxTestersPerTask)) || 1);

  const online = participants.filter((p) => p && p.online === true);
  if (online.length === 0) {
    return { ok: false, error: "Nobody is online, so there is no one to assign tasks to.", assignments: [] };
  }

  // Shuffled, so the order the graph is built in doesn't favour anyone either
  const people = shuffle(online, random);
  const order = shuffle(tasks.map((t, i) => ({ t, i })), random);
  const S = 0;
  const T = 1;
  const nodeP = (i) => 2 + 3 * i;   // the person
  const nodeO = (i) => 3 + 3 * i;   // their own-team slot
  const nodeC = (i) => 4 + 3 * i;   // their cross-team slot
  const nodeTask = (j) => 2 + 3 * people.length + j;
  const g = new UnitFlow(2 + 3 * people.length + tasks.length);

  const picks = [];   // [edge, person, task index]
  people.forEach((p, i) => {
    for (let k = 1; k <= perPerson; k += 1) {
      g.add(S, nodeP(i), costOf([[FAIR, k === 1 ? -1 : 0], [COUNT, -1], [BALANCE, k]]));
    }
    const able = order.filter(({ t }) => canReceiveTask(t, p));
    // With a single task each there is no cross-team slot: all-teams tasks are as good as their own
    const ownSlot = ({ t }) => isOwnTeamTask(t, p) || (perPerson === 1 && t.team == null);
    const own = able.filter(ownSlot);
    const cross = able.filter((x) => !ownSlot(x));
    // The first own-team task is free, and so is the first cross-team one when there are 2+ per person
    for (let k = 1; k <= Math.min(perPerson, own.length); k += 1) g.add(nodeP(i), nodeO(i), costOf([[MIX, k === 1 ? 0 : 1]]));
    for (let k = 1; k <= Math.min(perPerson, cross.length); k += 1) g.add(nodeP(i), nodeC(i), costOf([[MIX, k === 1 && perPerson >= 2 ? 0 : 1]]));
    for (const { i: j } of own) picks.push([g.add(nodeO(i), nodeTask(j), costOf([[NOISE, pickIndex(1000, random)]])), p, j]);
    for (const { i: j } of cross) picks.push([g.add(nodeC(i), nodeTask(j), costOf([[NOISE, pickIndex(1000, random)]])), p, j]);
  });
  tasks.forEach((_, j) => {
    for (let k = 1; k <= maxTesters; k += 1) g.add(nodeTask(j), T, costOf([[COVER, k === 1 ? -1 : 0]]));
  });
  g.run(S, T);

  const testers = tasks.map(() => []);
  for (const [e, p, j] of picks) if (g.cap[e] === 0) testers[j].push(p);
  const rank = new Map(online.map((p, i) => [p.user_id, i]));
  return {
    ok: true,
    error: null,
    assignments: tasks.map((task, j) => {
      // Own team first, then in the order people joined
      const chosen = testers[j].sort((a, b) => Number(isOwnTeamTask(task, b)) - Number(isOwnTeamTask(task, a)) || rank.get(a.user_id) - rank.get(b.user_id));
      const reason = chosen.length ? null
        : online.some((p) => canReceiveTask(task, p)) ? fullReason(perPerson) : unassignedReason(task);
      return { task_id: task.id, task: taskSnapshot(task), owners: chosen.map((p) => ownerOf(p, task)), reason };
    })
  };
}

/**
 * What a spin would give the people online now, for the moderator's warning before spinning.
 * The counts are the same for every spin (assignTasks maximizes them); who exactly is short
 * may differ. Returns null when nobody is online, else
 * { perPerson, online, short: [{ participant, got, able, why: "devices" | "places" }], noDevice, full }:
 * short = people who get fewer than tasks per person, because they have the devices for only
 * `able` tasks ("devices") or every task they could take already has its testers ("places");
 * noDevice = tasks nobody online has the Mac or phone for; full = tasks left over because
 * everyone who could take them is at tasks per person.
 */
export function spinPreview(tasks, participants, tasksPerPerson, options = {}) {
  const perPerson = perPersonOf(tasksPerPerson);
  const result = assignTasks(tasks, participants, () => 0, { ...options, tasksPerPerson: perPerson });
  if (!result.ok) return null;
  const online = participants.filter((p) => p && p.online === true);
  const short = online.map((p) => {
    const got = tasksOf(result.assignments, p.user_id).length;
    const able = compatibleCount(tasks, p);
    return { participant: p, got, able, why: got >= perPerson ? null : got >= able ? "devices" : "places" };
  }).filter((x) => x.why);
  const empty = result.assignments.filter((a) => a.owners.length === 0);
  const noDevice = empty.filter((a) => !online.some((p) => canReceiveTask(a.task, p))).length;
  return { perPerson, online: online.length, short, noDevice, full: empty.length - noDevice };
}

/**
 * Who to suggest as the tester of a task the moderator adds after the spin: someone online
 * with the devices it needs and the fewest tasks, from the task's team if possible. Null if
 * nobody online can take it.
 */
export function suggestOwner(task, participants, assignments, isOnline = () => true) {
  const able = participants.filter((p) => isOnline(p.user_id) && canReceiveTask(task, p));
  if (able.length === 0) return null;
  const team = normalizeTask(task).team;
  const own = team == null ? [] : able.filter((p) => p.team === team);
  const pool = own.length ? own : able;
  const count = (p) => tasksOf(assignments, p.user_id).length;
  return pool.reduce((best, p) => (count(p) < count(best) ? p : best), pool[0]).user_id;
}

// ---------------------------------------------------------------- room settings

/** Tasks per person: a whole number from 1 to CONFIG.maxTasksPerPerson. Mirrors _wot_clean_tasks_per_person(). */
export function validateTasksPerPerson(input, max = CONFIG.maxTasksPerPerson) {
  const text = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim() : "";
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) return { ok: false, error: `Enter a whole number from 1 to ${max}.`, value: null };
  return { ok: true, error: null, value: n };
}

/**
 * Session links from the form: [{ label, url }] rows; a row with neither is skipped. Mirrors
 * _wot_clean_links(): at most 4, label up to 40 characters, url http(s) up to 500, no spaces.
 * Returns { ok, errors: [{ label?, url? } per row], value: [{ label, url }] }.
 */
export function validateLinks(rows, options = {}) {
  const maxLinks = options.maxLinks ?? CONFIG.maxLinks;
  const list = Array.isArray(rows) ? rows : [];
  const errors = list.map(() => ({}));
  const value = [];
  list.forEach((row, i) => {
    const label = typeof row?.label === "string" ? row.label.trim() : "";
    const url = typeof row?.url === "string" ? row.url.trim() : "";
    if (!label && !url) return;
    if (Array.from(label).length > 40) errors[i].label = "Use at most 40 characters.";
    else if (CONTROL_CHARS.test(label)) errors[i].label = "The label contains characters that are not allowed.";
    let parsed = null;
    try { parsed = new URL(url); } catch { /* not a URL */ }
    if (!url) errors[i].url = "Add the address, or clear the label.";
    else if (url.length > 500) errors[i].url = "Use at most 500 characters.";
    else if (!parsed || !/^https?:$/.test(parsed.protocol) || /\s/.test(url) || !/^https?:\/\/[^\s/]+/i.test(url)) {
      errors[i].url = "Enter an address that starts with https:// or http://.";
    }
    if (!errors[i].label && !errors[i].url) value.push({ label, url });
  });
  const ok = errors.every((e) => !e.label && !e.url) && value.length <= maxLinks;
  return { ok, errors, value: ok ? value : null };
}

// ---------------------------------------------------------------- room rules

/**
 * What the moderator may do next. Mirrors the checks in commit_spin; the
 * database remains the authority.
 */
export function spinRule(room, complaintCount, threshold = CONFIG.complaintThreshold) {
  if (room.status === "lobby" && room.spins_used === 0) {
    return { spinNumber: 1, allowed: true, reason: null };
  }
  if (room.status === "spun" && room.spins_used === 1) {
    if (complaintCount >= threshold) return { spinNumber: 2, allowed: true, reason: null };
    const missing = threshold - complaintCount;
    return {
      spinNumber: 2,
      allowed: false,
      reason: `Unlocks after ${missing} more complaint${missing === 1 ? "" : "s"}.`
    };
  }
  return { spinNumber: null, allowed: false, reason: "The result is final." };
}

/** Tasks can change until the first spin. Mirrors the check in update_tasks. */
export function tasksEditable(room) {
  return room?.status === "lobby" && room?.spins_used === 0;
}

// ---------------------------------------------------------------- takeovers
// After a spin, a member may ask to take over a task of the latest spin: one tester's place,
// or the task itself while nobody has it. The moderator or that tester answers. These mirror
// the checks in request_takeover and resolve_takeover; the database remains the authority.

/** Requests are possible once the wheel has spun, and still after the final spin. */
export function takeoversOpen(room) {
  return room?.status === "spun" || room?.status === "final";
}

/**
 * Whether `me` (a participant: { user_id, mac, android, ios }) may ask for a place on this
 * assignment's task: they don't test it already, and they have the Mac or phone it needs.
 * Unassigned tasks can be asked for too.
 */
export function canRequestTakeover(assignment, me) {
  if (!assignment || !me) return false;
  if (isOwner(assignment, me.user_id)) return false;
  return canReceiveTask(assignment.task, me);
}

/**
 * Whether `me` may add themselves to this task with "Assign me": they don't test it yet, have
 * the devices, and it has fewer than `max` testers. Tasks per person doesn't limit this: it only
 * shapes the spin. Mirrors join_task().
 */
export function canJoinTask(assignment, me, max = CONFIG.maxTestersPerTask) {
  if (!assignment || !me) return false;
  return !isOwner(assignment, me.user_id) && canReceiveTask(assignment.task, me) && assignment.owners.length < max;
}

/** Whether `userId` may leave this task: they added themselves to it. Mirrors leave_task(). */
export function canLeaveTask(assignment, userId) {
  return Boolean(assignment?.owners.find((o) => o.user_id === userId)?.joined_at);
}

/**
 * Who may approve or decline `request` for this assignment: the moderator, or the tester whose
 * place it asks for (while they still have it). A request for an unassigned task: the moderator.
 */
export function canResolveTakeover(assignment, room, userId, request) {
  if (!assignment || !room || !userId) return false;
  if (userId === room.host_user_id) return true;
  return request?.from_user_id != null && request.from_user_id === userId && isOwner(assignment, userId);
}

/** The request `userId` made for `taskId` in this spin (whatever its status), or null. One per person and task. */
export function requestFor(requests, taskId, userId) {
  return (Array.isArray(requests) ? requests : []).find((r) => r.task_id === taskId && r.user_id === userId) ?? null;
}

/** The requests still waiting for an answer, in the order they were made. */
export function pendingRequests(requests) {
  return (Array.isArray(requests) ? requests : []).filter((r) => r.status === "pending");
}

/**
 * What other people changed for `me` between two snapshots of the same spin, so the app can
 * say it out loud. Nothing is reported across a spin (the reveal covers that). Kinds:
 *   asked     a request now waits for me: for my place, or any request if I am the moderator
 *   approved  my request was approved (or I got the task some other way while asking)
 *   declined  my request was declined
 *   dropped   my request no longer applies (the testers changed, or the task was deleted)
 *   given     the moderator put me on a task
 *   joined    someone assigned themselves to a task I test (by)
 *   added     the moderator added a task and put me on it
 *   lost      I am no longer a tester of a task (to: who took my place, if someone did)
 *   removed   the moderator deleted a task I tested
 * Returns [{ kind, task, by?, from?, to?, mine? }].
 */
export function takeoverChanges(prev, next, me) {
  if (!prev?.room || !next?.room || !me) return [];
  if (next.room.spins_used === 0 || prev.room.spins_used !== next.room.spins_used) return [];
  const spinOf = (snap) => (snap.spins ?? []).find((s) => s.spin_number === snap.room.spins_used);
  const before = spinOf(prev);
  const after = spinOf(next);
  if (!before || !after) return [];
  const isHost = next.room.host_user_id === me;
  const ownersBefore = new Map(before.assignments.map((a) => [a.task_id, new Set(ownerIds(a))]));
  const afterById = new Map(after.assignments.map((a) => [a.task_id, a]));
  const beforeById = new Map(before.assignments.map((a) => [a.task_id, a]));
  const requestsBefore = Array.isArray(prev.requests) ? prev.requests : [];
  const requestsAfter = Array.isArray(next.requests) ? next.requests : [];
  const changes = [];

  // Requests now waiting for me: new ones (or re-made, or moved to my place)
  const key = (r) => `${r.id}|${r.created_at}|${r.from_user_id ?? ""}`;
  const seen = new Set(pendingRequests(requestsBefore).map(key));
  for (const r of pendingRequests(requestsAfter)) {
    if (r.user_id === me || seen.has(key(r))) continue;
    const a = afterById.get(r.task_id);
    if (!a) continue;
    const mine = r.from_user_id != null && r.from_user_id === me && isOwner(a, me);
    if (mine || isHost) changes.push({ kind: "asked", task: a.task, by: r.user_id, from: r.from_user_id ?? null, mine });
  }
  // My requests that were answered or dropped (a declined one can still be approved later)
  const approvedTasks = new Set();
  for (const r of requestsAfter) {
    if (r.user_id !== me || r.status === "pending") continue;
    const was = requestsBefore.find((p) => p.id === r.id);
    if (!was || was.status === r.status || !["pending", "declined"].includes(was.status)) continue;
    const a = afterById.get(r.task_id) ?? beforeById.get(r.task_id);
    if (!a) continue;
    if (r.status === "approved") { approvedTasks.add(r.task_id); changes.push({ kind: "approved", task: a.task }); }
    else if (r.status === "declined") changes.push({ kind: "declined", task: a.task, by: r.resolved_by ?? null });
    else if (r.status === "superseded" && was.status === "pending") changes.push({ kind: "dropped", task: a.task, deleted: !afterById.has(r.task_id) });
  }
  // Tasks I was put on, taken off, that were added or deleted
  for (const a of after.assignments) {
    const had = ownersBefore.get(a.task_id);
    const hasNow = isOwner(a, me);
    if (!had) {
      if (hasNow) changes.push({ kind: "added", task: a.task });
      continue;
    }
    if (had.has(me) && !hasNow) {
      const successor = a.owners.find((o) => o.took_over_from?.user_id === me);
      changes.push({ kind: "lost", task: a.task, to: successor?.user_id ?? null });
    } else if (!had.has(me) && hasNow && !approvedTasks.has(a.task_id) && !a.owners.find((o) => o.user_id === me)?.joined_at) {
      changes.push({ kind: "given", task: a.task });
    }
    if (had.has(me) && hasNow) {
      for (const o of a.owners) if (o.joined_at && o.user_id !== me && !had.has(o.user_id)) changes.push({ kind: "joined", task: a.task, by: o.user_id });
    }
  }
  for (const a of before.assignments) {
    if (!afterById.has(a.task_id) && isOwner(a, me)) changes.push({ kind: "removed", task: a.task });
  }
  return changes;
}
