// Pure domain logic: validation, compatibility, assignment.
// No DOM, network or storage access. Randomness is always passed in.

import { CONFIG } from "./config.js";
import { DEFAULT_TASKS, DEVICES, BROWSERS, USER_LEVELS, THEMES } from "./tasks.js";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export const ROOM_CODE_LENGTH = 6;
export const PHONES = ["android", "ios"];
export const UNASSIGNED_NO_PHONE = "No one online has an Android or iOS phone.";

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
    value: ok ? { name, team, android: input?.android === true, ios: input?.ios === true } : null
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

export function unassignedReason(task) {
  const phones = taskPhones(task);
  const names = (phones.length ? phones : PHONES).map((p) => PHONE_LABELS[p]);
  return `No one online has an ${names.join(" or ")} phone.`;
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

  const devices = pickOptions(input?.devices, DEVICES);  // no extras: the database only knows these
  if (devices.length === 0) errors.devices = "Select at least one device.";

  const ok = Object.keys(errors).length === 0;
  // Mac without Desktop is Safari only, so there is no browser to pick.
  const macOnly = devices.includes("mac") && !devices.includes("desktop");
  return {
    ok,
    errors,
    value: ok
      ? {
          what, theme, team, devices,
          browsers: macOnly ? [] : pickOptions(input?.browsers, BROWSERS, keep?.browsers),
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

// ------------------------------------------------------------- compatibility

export function canReceiveTask(task, participant) {
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

// ---------------------------------------------------------------- assignment

const taskSnapshot = normalizeTask;

/**
 * Assign every task to an online participant.
 *
 * tasks: room tasks (current or legacy shape)
 * participants: [{ user_id, name, team, android, ios, online }]
 * random: () => number in [0, 1)
 *
 * Returns { ok: true, assignments } with one entry per task, in the order of `tasks`,
 * or { ok: false, error } when nobody is online. A task that needs a phone nobody online
 * has is returned unassigned with a reason.
 */
export function assignTasks(tasks, participants, random) {
  if (!Array.isArray(tasks) || !Array.isArray(participants)) throw new TypeError("tasks and participants must be arrays");
  if (typeof random !== "function") throw new TypeError("random must be a function");

  const online = participants.filter((p) => p && p.online === true);
  if (online.length === 0) {
    return { ok: false, error: "Nobody is online, so there is no one to assign tasks to.", assignments: [] };
  }

  const load = new Map(online.map((p) => [p.user_id, 0]));
  const teamTasks = shuffle(tasks.filter((t) => t.team != null), random);
  const neutralTasks = shuffle(tasks.filter((t) => t.team == null), random);
  const byTaskId = new Map();

  for (const task of [...teamTasks, ...neutralTasks]) {
    const candidates = online.filter((p) => canReceiveTask(task, p));
    if (candidates.length === 0) {
      byTaskId.set(task.id, {
        task_id: task.id,
        task: taskSnapshot(task),
        participant_id: null,
        participant: null,
        team_match: null,
        reason: unassignedReason(task)
      });
      continue;
    }

    const preferred = task.team == null ? [] : candidates.filter((p) => p.team === task.team);
    const pool = preferred.length > 0 ? preferred : candidates;
    const fewest = Math.min(...pool.map((p) => load.get(p.user_id)));
    const tied = pool.filter((p) => load.get(p.user_id) === fewest);
    const chosen = tied[pickIndex(tied.length, random)];
    load.set(chosen.user_id, fewest + 1);

    byTaskId.set(task.id, {
      task_id: task.id,
      task: taskSnapshot(task),
      participant_id: chosen.user_id,
      participant: { name: chosen.name, team: chosen.team, android: Boolean(chosen.android), ios: Boolean(chosen.ios) },
      team_match: task.team == null ? null : chosen.team === task.team,
      reason: null
    });
  }

  return { ok: true, error: null, assignments: tasks.map((t) => byTaskId.get(t.id)) };
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
