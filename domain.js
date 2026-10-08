// Pure domain logic: validation, compatibility, assignment.
// No DOM, network or storage access. Randomness is always passed in.

import { CONFIG } from "./config.js";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export const ROOM_CODE_LENGTH = 6;
export const UNASSIGNED_NO_PHONE = "No one online has an Android or iOS phone.";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

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

// ------------------------------------------------------------- compatibility

export function canReceiveTask(task, participant) {
  if (task.platform === "mobile") return Boolean(participant.android || participant.ios);
  return true;
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

function taskSnapshot(task) {
  return {
    id: task.id,
    what: task.what,
    theme: task.theme,
    device: task.device,
    platform: task.platform,
    team: task.team ?? null,
    users: Array.isArray(task.users) ? task.users.slice() : []
  };
}

/**
 * Assign every task to an online participant.
 *
 * participants: [{ user_id, name, team, android, ios, online }]
 * random: () => number in [0, 1)
 *
 * Returns { ok: true, assignments } with one entry per task, in the order of `tasks`,
 * or { ok: false, error } when nobody is online.
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
        reason: UNASSIGNED_NO_PHONE
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
