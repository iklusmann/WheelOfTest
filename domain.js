/** Pure product rules. This module must remain free of DOM, storage and WebRTC APIs. */
import { MAX_NAME_LENGTH, MAX_PROFILE_ID_LENGTH, MAX_ROOM_PARTICIPANTS, ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET, SCHEMA_VERSION, TEAMS, USER_TYPES, preferredTeamForTask } from "./config.js";
import { TASKS, TASK_BY_ID } from "./tasks.js";

const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const ROOM_STATUSES = new Set(["waiting", "result", "challenged", "completed"]);

export function canReceiveTask(task, developer) {
  if (task.platform === "mobile") return Boolean(developer.android || developer.ios);
  return true;
}

export function validateProfile(input, { allowHostTester = false } = {}) {
  if (!input || typeof input !== "object") return { ok: false, error: "Enter a participant profile." };
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!PROFILE_ID_PATTERN.test(id) || id.length > MAX_PROFILE_ID_LENGTH) {
    return { ok: false, error: "This browser profile ID is invalid. Refresh the profile and try again." };
  }
  if (!name) return { ok: false, error: "Enter your name." };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  if (!TEAMS.includes(input.team)) return { ok: false, error: "Choose exactly one team: AF, CYD or PB." };
  if (typeof input.android !== "boolean" || typeof input.ios !== "boolean") {
    return { ok: false, error: "Select Android and iOS availability. Both may be unchecked." };
  }
  if (input.hostTester === true && !allowHostTester) return { ok: false, error: "A guest profile cannot claim the host-tester role." };
  return {
    ok: true,
    profile: {
      id,
      name,
      team: input.team,
      android: input.android,
      ios: input.ios,
      ...(allowHostTester && input.hostTester === true ? { hostTester: true } : {})
    }
  };
}

export function createRoomState(roomCode, hostId, hostProfile = null, now = Date.now()) {
  if (typeof roomCode !== "string" || !ROOM_CODE_PATTERN.test(roomCode)) throw new Error("Invalid room code.");
  if (typeof hostId !== "string" || !PROFILE_ID_PATTERN.test(hostId)) throw new Error("Invalid host ID.");
  let participants = [];
  if (hostProfile) {
    const checked = validateProfile({ ...hostProfile, hostTester: true }, { allowHostTester: true });
    if (!checked.ok) throw new Error(checked.error);
    participants = [{ ...checked.profile, hostTester: true }];
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    roomCode,
    hostId,
    status: "waiting",
    stateVersion: 0,
    spinsUsed: 0,
    maxSpins: 2,
    participants,
    assignments: [],
    usedTaskIds: [],
    complaints: [],
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Only participants passed as live by the transport controller are eligible.
 * `connected` is an ephemeral argument, never a persisted profile property.
 */
export function buildEligiblePairs(room, connectedParticipants, tasks = TASKS) {
  if (!room || !Array.isArray(connectedParticipants)) return [];
  const unusedTasks = tasks.filter((task) => !room.usedTaskIds.includes(task.id));
  const liveDevelopers = connectedParticipants.filter((developer) => developer && developer.connected === true);
  const pairs = [];
  for (const task of unusedTasks) {
    for (const developer of liveDevelopers) {
      if (!canReceiveTask(task, developer)) continue;
      pairs.push({ task, developer });
    }
  }
  return pairs;
}

export function splitPreferredPairs(pairs) {
  return {
    preferred: pairs.filter(({ task, developer }) => Boolean(preferredTeamForTask(task)) && preferredTeamForTask(task) === developer.team),
    all: pairs
  };
}

/** Uniform over task/developer pairs; this intentionally weights tasks with more eligible developers. */
export function chooseEligiblePair(room, connectedParticipants, random = Math.random, tasks = TASKS) {
  const all = buildEligiblePairs(room, connectedParticipants, tasks);
  const { preferred } = splitPreferredPairs(all);
  const pool = preferred.length ? preferred : all;
  if (!pool.length) {
    return { ok: false, pair: null, error: "No unused task has a compatible, currently connected tester.", totalPairs: all.length, preferredPairs: preferred.length };
  }
  let randomValue;
  try {
    randomValue = Number(random());
  } catch {
    return { ok: false, pair: null, error: "The random selection function failed.", totalPairs: all.length, preferredPairs: preferred.length };
  }
  if (!Number.isFinite(randomValue)) randomValue = 0;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(Math.max(0, Math.min(0.999999999999, randomValue)) * pool.length)));
  return {
    ok: true,
    pair: pool[index],
    totalPairs: all.length,
    preferredPairs: preferred.length,
    usedPreferredPool: preferred.length > 0,
    poolSize: pool.length
  };
}

function nextVersion(room, patch, now = Date.now()) {
  return { ...room, ...patch, stateVersion: room.stateVersion + 1, updatedAt: now };
}

function snapshotDeveloper(developer) {
  return {
    id: developer.id,
    name: developer.name,
    team: developer.team,
    android: Boolean(developer.android),
    ios: Boolean(developer.ios),
    ...(developer.hostTester === true ? { hostTester: true } : {})
  };
}

function validatePairForCommit(room, pair) {
  if (!pair || !pair.task || !pair.developer) return "A task and developer must be selected.";
  const task = TASK_BY_ID.get(pair.task.id);
  if (!task) return "The selected task is not part of the official catalog.";
  if (room.usedTaskIds.includes(task.id)) return "This task has already been used in this room.";
  const profileCheck = validateProfile(snapshotDeveloper(pair.developer), { allowHostTester: true });
  if (!profileCheck.ok) return profileCheck.error;
  if (!room.participants.some((participant) => participant.id === pair.developer.id)) return "The selected developer is not registered in this room.";
  if (!canReceiveTask(task, pair.developer)) return "The selected developer does not have a phone available for this mobile task.";
  return null;
}

function makeAssignment(pair, spinNumber, now) {
  const task = TASK_BY_ID.get(pair.task.id);
  const developer = snapshotDeveloper(pair.developer);
  return {
    id: `assignment-${spinNumber}-${now.toString(36)}-${developer.id.slice(0, 8)}`,
    spinNumber,
    task: {
      id: task.id,
      what: task.what,
      theme: task.theme,
      device: task.device,
      platform: task.platform,
      team: preferredTeamForTask(task),
      users: [...task.users]
    },
    developer,
    teamsMatched: Boolean(preferredTeamForTask(task) && preferredTeamForTask(task) === developer.team),
    timestamp: now,
    challenged: false,
    void: false,
    final: false
  };
}

export function transitionUpsertParticipant(room, inputProfile, now = Date.now()) {
  const checked = validateProfile(inputProfile, { allowHostTester: true });
  if (!checked.ok) return { ok: false, state: room, error: checked.error };
  const profile = checked.profile;
  const existing = room.participants.find((participant) => participant.id === profile.id);
  if (existing?.hostTester && profile.hostTester !== true) {
    return { ok: false, state: room, error: "This browser ID belongs to the host's local tester profile." };
  }
  if (room.status === "completed" && !existing) {
    return { ok: false, state: room, error: "This room is complete and no longer accepts new participants." };
  }
  if (!existing && room.participants.length >= MAX_ROOM_PARTICIPANTS) {
    return { ok: false, state: room, error: `This room has reached its limit of ${MAX_ROOM_PARTICIPANTS} participants.` };
  }
  const normalized = { ...profile, ...(existing?.hostTester ? { hostTester: true } : {}) };
  if (existing && existing.name === normalized.name && existing.team === normalized.team && existing.android === normalized.android && existing.ios === normalized.ios) {
    return { ok: true, state: room, participant: existing, changed: false };
  }
  const participants = existing
    ? room.participants.map((participant) => participant.id === profile.id ? normalized : participant)
    : [...room.participants, normalized];
  const state = nextVersion(room, { participants }, now);
  const validation = validateRoomState(state);
  if (!validation.ok) return { ok: false, state: room, error: validation.errors[0] };
  return { ok: true, state, participant: normalized, changed: true };
}

export function transitionSpin1(room, pair, now = Date.now()) {
  if (room.status !== "waiting" || room.spinsUsed !== 0) return { ok: false, state: room, error: "Spin 1 is only available in a waiting room." };
  const pairError = validatePairForCommit(room, pair);
  if (pairError) return { ok: false, state: room, error: pairError };
  const assignment = makeAssignment(pair, 1, now);
  const state = nextVersion(room, {
    status: "result",
    spinsUsed: 1,
    assignments: [...room.assignments, assignment],
    usedTaskIds: [...room.usedTaskIds, assignment.task.id]
  }, now);
  const validation = validateRoomState(state);
  return validation.ok ? { ok: true, state, assignment } : { ok: false, state: room, error: validation.errors[0] };
}

export function transitionComplaint(room, participantId, now = Date.now()) {
  if (room.status !== "result" && room.status !== "challenged") return { ok: false, state: room, error: "Complaints are accepted only after Spin 1 and before the room is completed." };
  if (room.spinsUsed !== 1 || !room.assignments.some((assignment) => assignment.spinNumber === 1)) return { ok: false, state: room, error: "There is no provisional assignment to complain about." };
  const participant = room.participants.find((entry) => entry.id === participantId);
  if (!participant) return { ok: false, state: room, error: "The participant is not registered in this room." };
  if (room.complaints.some((complaint) => complaint.participantId === participantId)) return { ok: false, state: room, error: "Each participant may complain only once per room." };
  const complaint = { id: `complaint-${now.toString(36)}-${participantId.slice(0, 8)}`, participantId, participantName: participant.name, timestamp: now };
  const state = nextVersion(room, { status: "challenged", complaints: [...room.complaints, complaint] }, now);
  const validation = validateRoomState(state);
  return validation.ok ? { ok: true, state, complaint } : { ok: false, state: room, error: validation.errors[0] };
}

export function transitionSpin2(room, pair, now = Date.now()) {
  if (room.status !== "challenged" || room.spinsUsed !== 1 || room.complaints.length < 1) {
    return { ok: false, state: room, error: "Spin 2 requires a provisional result and at least one valid complaint." };
  }
  const pairError = validatePairForCommit(room, pair);
  if (pairError) return { ok: false, state: room, error: pairError };
  const original = room.assignments.find((assignment) => assignment.spinNumber === 1);
  if (!original) return { ok: false, state: room, error: "The original Spin 1 assignment is missing." };
  const assignments = room.assignments.map((assignment) => assignment.id === original.id
    ? { ...assignment, challenged: true, void: true, final: false }
    : assignment);
  const replacement = { ...makeAssignment(pair, 2, now), final: true };
  const state = nextVersion(room, {
    status: "completed",
    spinsUsed: 2,
    assignments: [...assignments, replacement],
    usedTaskIds: [...room.usedTaskIds, replacement.task.id]
  }, now);
  const validation = validateRoomState(state);
  return validation.ok ? { ok: true, state, assignment: replacement } : { ok: false, state: room, error: validation.errors[0] };
}

/** `overrideComplaint` is only set by the explicit, warned host action after no replacement pair exists. */
export function transitionAcceptResult(room, { overrideComplaint = false } = {}, now = Date.now()) {
  if (room.status === "result" && room.spinsUsed === 1 && room.complaints.length === 0) {
    const assignments = room.assignments.map((assignment) => assignment.spinNumber === 1 ? { ...assignment, final: true } : assignment);
    const state = nextVersion(room, { status: "completed", assignments }, now);
    const validation = validateRoomState(state);
    return validation.ok ? { ok: true, state } : { ok: false, state: room, error: validation.errors[0] };
  }
  if (room.status === "challenged" && room.spinsUsed === 1 && room.complaints.length > 0 && overrideComplaint === true) {
    const assignments = room.assignments.map((assignment) => assignment.spinNumber === 1 ? { ...assignment, final: true, challenged: true, void: false } : assignment);
    const state = nextVersion(room, { status: "completed", assignments }, now);
    const validation = validateRoomState(state);
    return validation.ok ? { ok: true, state } : { ok: false, state: room, error: validation.errors[0] };
  }
  return { ok: false, state: room, error: "The current room state does not allow accepting this result." };
}

export function validateRoomState(room) {
  const errors = [];
  if (!room || typeof room !== "object" || Array.isArray(room)) {
    return { ok: false, errors: ["Room data must be an object."] };
  }

  if (room.schemaVersion !== SCHEMA_VERSION) errors.push("Unsupported room schema version.");
  if (typeof room.roomCode !== "string" || !ROOM_CODE_PATTERN.test(room.roomCode)) errors.push("Invalid room code in room data.");
  if (typeof room.hostId !== "string" || !PROFILE_ID_PATTERN.test(room.hostId)) errors.push("Invalid host ID in room data.");
  if (!ROOM_STATUSES.has(room.status)) errors.push("Invalid room status.");
  if (!Number.isInteger(room.stateVersion) || room.stateVersion < 0) errors.push("Invalid state version.");
  if (![0, 1, 2].includes(room.spinsUsed) || room.maxSpins !== 2) errors.push("Invalid spin count.");

  const arrayFields = ["participants", "assignments", "usedTaskIds", "complaints"];
  for (const field of arrayFields) {
    if (!Array.isArray(room[field])) errors.push(`${field} must be an array.`);
  }
  if (arrayFields.some((field) => !Array.isArray(room[field]))) return { ok: false, errors };

  const participantIds = new Set();
  room.participants.forEach((participant) => {
    if (!participant || typeof participant !== "object" || Array.isArray(participant)) {
      errors.push("Invalid participant profile.");
      return;
    }
    const checked = validateProfile(participant, { allowHostTester: true });
    if (!checked.ok) errors.push(`Invalid participant: ${checked.error}`);
    if (participantIds.has(participant.id)) errors.push("Participant IDs must be unique.");
    participantIds.add(participant.id);
    for (const volatileField of ["connected", "connectedAt", "connectionState", "connectionId", "lastHeartbeatAt", "channelReadyState"]) {
      if (Object.prototype.hasOwnProperty.call(participant, volatileField)) {
        errors.push(`Durable participants must not contain ${volatileField} connection state.`);
      }
    }
  });

  if (new Set(room.usedTaskIds).size !== room.usedTaskIds.length) errors.push("Used task IDs must be unique.");
  if (room.usedTaskIds.some((id) => typeof id !== "string" || !TASK_BY_ID.has(id))) errors.push("Unknown task ID in used-task history.");
  if (room.assignments.length > 2) errors.push("There may be at most two assignment history entries.");

  const assignmentsBySpin = new Map();
  const assignedTaskIds = [];
  const assignmentIds = new Set();
  room.assignments.forEach((assignment) => {
    if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) {
      errors.push("Invalid assignment history entry.");
      return;
    }
    if (!Number.isInteger(assignment.spinNumber) || ![1, 2].includes(assignment.spinNumber)) {
      errors.push("Invalid assignment spin number.");
    } else if (assignmentsBySpin.has(assignment.spinNumber)) {
      errors.push("Assignment spin numbers must be unique.");
    } else {
      assignmentsBySpin.set(assignment.spinNumber, assignment);
    }
    if (typeof assignment.id !== "string" || !assignment.id.trim() || assignment.id.length > 160) errors.push("Invalid assignment ID.");
    else if (assignmentIds.has(assignment.id)) errors.push("Assignment IDs must be unique.");
    else assignmentIds.add(assignment.id);

    const taskSnapshot = assignment.task;
    const taskId = taskSnapshot && typeof taskSnapshot === "object" && !Array.isArray(taskSnapshot) ? taskSnapshot.id : null;
    const catalogTask = typeof taskId === "string" ? TASK_BY_ID.get(taskId) : null;
    if (!catalogTask) {
      errors.push("Assignment references an unknown task.");
    } else {
      assignedTaskIds.push(taskId);
      const canonicalTeam = preferredTeamForTask(catalogTask);
      const expectedUsers = catalogTask.users;
      if (taskSnapshot.what !== catalogTask.what || taskSnapshot.theme !== catalogTask.theme || taskSnapshot.device !== catalogTask.device || taskSnapshot.platform !== catalogTask.platform || taskSnapshot.team !== canonicalTeam) {
        errors.push("Assignment task snapshot does not match the official catalog.");
      }
      if (!Array.isArray(taskSnapshot.users) || taskSnapshot.users.length !== expectedUsers.length || taskSnapshot.users.some((user, index) => user !== expectedUsers[index])) {
        errors.push("Assignment role metadata does not match the official catalog.");
      }
    }

    const developer = assignment.developer;
    const developerCheck = validateProfile(developer, { allowHostTester: true });
    if (!developerCheck.ok) {
      errors.push(`Assignment has an invalid developer snapshot: ${developerCheck.error}`);
    } else if (!participantIds.has(developer.id)) {
      errors.push("Assignment developer is not registered in the room.");
    }
    if (catalogTask && developerCheck.ok && !canReceiveTask(catalogTask, developer)) {
      errors.push("A mobile task was assigned without phone availability.");
    }
    if (typeof assignment.timestamp !== "number" || !Number.isFinite(assignment.timestamp)) errors.push("Invalid assignment timestamp.");
    for (const flag of ["teamsMatched", "challenged", "void", "final"]) {
      if (typeof assignment[flag] !== "boolean") errors.push(`Assignment ${flag} flag must be boolean.`);
    }
    if (catalogTask && developerCheck.ok && typeof assignment.teamsMatched === "boolean") {
      const expectedMatch = Boolean(preferredTeamForTask(catalogTask) && preferredTeamForTask(catalogTask) === developer.team);
      if (assignment.teamsMatched !== expectedMatch) errors.push("Assignment team-match flag is inconsistent.");
    }
  });

  if (assignedTaskIds.length !== room.usedTaskIds.length || room.usedTaskIds.some((id) => !assignedTaskIds.includes(id))) {
    errors.push("Used task history must exactly match the recorded assignments.");
  }
  if (new Set(assignedTaskIds).size !== assignedTaskIds.length) errors.push("An unused task cannot be assigned twice in one room.");

  const complaintIds = new Set();
  const complaintParticipantIds = new Set();
  room.complaints.forEach((complaint) => {
    if (!complaint || typeof complaint !== "object" || Array.isArray(complaint)) {
      errors.push("Invalid complaint history entry.");
      return;
    }
    if (typeof complaint.id !== "string" || !complaint.id.trim() || complaint.id.length > 160) errors.push("Invalid complaint ID.");
    else if (complaintIds.has(complaint.id)) errors.push("Complaint IDs must be unique.");
    else complaintIds.add(complaint.id);
    if (typeof complaint.participantId !== "string" || !participantIds.has(complaint.participantId)) errors.push("Complaint references an unknown participant.");
    if (complaintParticipantIds.has(complaint.participantId)) errors.push("A participant may complain only once.");
    complaintParticipantIds.add(complaint.participantId);
    if (typeof complaint.participantName !== "string" || !complaint.participantName.trim() || complaint.participantName.length > MAX_NAME_LENGTH) errors.push("Invalid complaint participant name.");
    if (typeof complaint.timestamp !== "number" || !Number.isFinite(complaint.timestamp)) errors.push("Invalid complaint timestamp.");
  });

  const first = assignmentsBySpin.get(1);
  const second = assignmentsBySpin.get(2);
  if (room.spinsUsed !== room.assignments.length) errors.push("Spin count and assignment history do not match.");
  if (room.status === "waiting") {
    if (room.spinsUsed !== 0 || room.assignments.length !== 0 || room.usedTaskIds.length !== 0 || room.complaints.length !== 0) {
      errors.push("Waiting room must not have assignments, used tasks or complaints.");
    }
  }
  if (room.status === "result") {
    if (room.spinsUsed !== 1 || room.assignments.length !== 1 || !first || room.complaints.length !== 0) errors.push("Result state must contain one Spin 1 provisional assignment and no complaints.");
    if (first && (first.final || first.void || first.challenged)) errors.push("A provisional Spin 1 assignment cannot be final, void or challenged.");
  }
  if (room.status === "challenged") {
    if (room.spinsUsed !== 1 || room.assignments.length !== 1 || !first || room.complaints.length < 1) errors.push("Challenged state must keep the provisional Spin 1 assignment and at least one complaint.");
    if (first && (first.final || first.void || first.challenged)) errors.push("The original assignment remains provisional until Spin 2 or explicit host acceptance.");
  }
  if (room.status === "completed" && room.spinsUsed === 1) {
    if (room.assignments.length !== 1 || !first || !first.final || first.void || first.challenged !== (room.complaints.length > 0)) {
      errors.push("Spin 1 completion must finalize the original result and preserve any complaint marker.");
    }
  }
  if (room.status === "completed" && room.spinsUsed === 2) {
    if (room.assignments.length !== 2 || !first || !second || room.complaints.length < 1) {
      errors.push("Spin 2 completion must retain both assignments and at least one complaint.");
    }
    if (first && (!first.void || !first.challenged || first.final)) errors.push("Spin 1 must be marked challenged/void after replacement.");
    if (second && (!second.final || second.void || second.challenged)) errors.push("Spin 2 must be the final, non-void assignment.");
    if (first && second && first.task?.id === second.task?.id) errors.push("Spin 2 cannot repeat the Spin 1 task.");
  }
  if (room.status === "completed" && ![1, 2].includes(room.spinsUsed)) errors.push("A completed room must have one or two spins.");
  if (typeof room.createdAt !== "number" || !Number.isFinite(room.createdAt)) errors.push("Invalid room creation timestamp.");
  if (typeof room.updatedAt !== "number" || !Number.isFinite(room.updatedAt)) errors.push("Invalid room update timestamp.");
  return { ok: errors.length === 0, errors };
}
export function isValidRoomCode(code) {
  return typeof code === "string" && ROOM_CODE_PATTERN.test(code);
}

export function isActionAllowed(room, action, { role = "host", connected = true, alreadyComplained = false, replacementAvailable = true } = {}) {
  if (!room || role !== "host" && action !== "complain") return false;
  if (room.status === "completed") return false;
  if (action === "spin1") return role === "host" && room.status === "waiting" && room.spinsUsed === 0 && replacementAvailable;
  if (action === "spin2") return role === "host" && room.status === "challenged" && room.spinsUsed === 1 && room.complaints.length > 0 && replacementAvailable;
  if (action === "complain") return connected && !alreadyComplained && room.spinsUsed === 1 && (room.status === "result" || room.status === "challenged");
  if (action === "accept") return role === "host" && room.status === "result" && room.spinsUsed === 1 && room.complaints.length === 0;
  if (action === "accept-original") return role === "host" && room.status === "challenged" && room.spinsUsed === 1 && room.complaints.length > 0 && !replacementAvailable;
  return false;
}

export function isSnapshotVersionAcceptable(incomingVersion, currentVersion) {
  return Number.isInteger(incomingVersion) && incomingVersion >= 0 && Number.isInteger(currentVersion) && incomingVersion >= currentVersion;
}

export function getRoomBlocker(room, connectedParticipants) {
  const choice = chooseEligiblePair(room, connectedParticipants);
  return choice.ok ? null : choice.error;
}

export function getRoleLabels(assignment) {
  return Array.isArray(assignment?.task?.users) ? assignment.task.users.filter((role) => USER_TYPES.includes(role)) : [];
}
