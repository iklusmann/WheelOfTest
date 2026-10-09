/**
 * WheelOfTest domain logic.
 * Keep assignment and lifecycle rules independent of the UI and WebRTC layer.
 */

// The task matrix labels CYD's release group as "CD Release". Adjust this mapping
// here if the team naming changes; task ids and source labels remain unchanged.
export const TEAM_MAPPING = Object.freeze({
  "AF Release": "AF",
  "PB Release": "PB",
  "CD Release": "CYD"
});

const releaseTeam = (label) => TEAM_MAPPING[label] ?? null;

export const TASKS = Object.freeze([
  { id: "cuf-e3dc-edge", what: "Critical User Flows", theme: "e3dc", device: "edge", platform: "desktop", team: null, users: ["owner", "installer", "partner", "service"] },
  { id: "cuf-flow-firefox", what: "Critical User Flows", theme: "flow", device: "firefox", platform: "desktop", team: null, users: ["owner", "installer", "service"] },
  { id: "cuf-e3dc-mobile", what: "Critical User Flows", theme: "e3dc", device: "mobile", platform: "mobile", team: null, users: ["owner", "installer", "partner", "service"] },
  { id: "cuf-flow-mobile", what: "Critical User Flows", theme: "flow", device: "mobile", platform: "mobile", team: null, users: ["owner", "installer", "service"] },

  { id: "af-e3dc-mobile", what: "AF Release", theme: "e3dc", device: "mobile", platform: "mobile", team: releaseTeam("AF Release"), users: ["owner"] },
  { id: "af-e3dc-chrome", what: "AF Release", theme: "e3dc", device: "chrome", platform: "desktop", team: releaseTeam("AF Release"), users: ["installer", "partner"] },
  { id: "af-e3dc-edge", what: "AF Release", theme: "e3dc", device: "edge", platform: "desktop", team: releaseTeam("AF Release"), users: ["service"] },
  { id: "af-flow-mobile", what: "AF Release", theme: "flow", device: "mobile", platform: "mobile", team: releaseTeam("AF Release"), users: ["owner"] },
  { id: "af-flow-firefox", what: "AF Release", theme: "flow", device: "firefox", platform: "desktop", team: releaseTeam("AF Release"), users: ["installer"] },
  { id: "af-flow-edge", what: "AF Release", theme: "flow", device: "edge", platform: "desktop", team: releaseTeam("AF Release"), users: ["service"] },

  { id: "pb-e3dc-mobile", what: "PB Release", theme: "e3dc", device: "mobile", platform: "mobile", team: releaseTeam("PB Release"), users: ["owner"] },
  { id: "pb-e3dc-chrome", what: "PB Release", theme: "e3dc", device: "chrome", platform: "desktop", team: releaseTeam("PB Release"), users: ["installer", "partner"] },
  { id: "pb-e3dc-edge", what: "PB Release", theme: "e3dc", device: "edge", platform: "desktop", team: releaseTeam("PB Release"), users: ["service"] },
  { id: "pb-flow-mobile", what: "PB Release", theme: "flow", device: "mobile", platform: "mobile", team: releaseTeam("PB Release"), users: ["owner"] },
  { id: "pb-flow-firefox", what: "PB Release", theme: "flow", device: "firefox", platform: "desktop", team: releaseTeam("PB Release"), users: ["installer"] },
  { id: "pb-flow-edge", what: "PB Release", theme: "flow", device: "edge", platform: "desktop", team: releaseTeam("PB Release"), users: ["service"] },

  { id: "cyd-e3dc-mobile", what: "CD Release", theme: "e3dc", device: "mobile", platform: "mobile", team: releaseTeam("CD Release"), users: ["owner"] },
  { id: "cyd-e3dc-chrome", what: "CD Release", theme: "e3dc", device: "chrome", platform: "desktop", team: releaseTeam("CD Release"), users: ["installer", "partner"] },
  { id: "cyd-e3dc-edge", what: "CD Release", theme: "e3dc", device: "edge", platform: "desktop", team: releaseTeam("CD Release"), users: ["service"] },
  { id: "cyd-flow-mobile", what: "CD Release", theme: "flow", device: "mobile", platform: "mobile", team: releaseTeam("CD Release"), users: ["owner"] },
  { id: "cyd-flow-firefox", what: "CD Release", theme: "flow", device: "firefox", platform: "desktop", team: releaseTeam("CD Release"), users: ["installer"] },
  { id: "cyd-flow-edge", what: "CD Release", theme: "flow", device: "edge", platform: "desktop", team: releaseTeam("CD Release"), users: ["service"] }
].map((task) => Object.freeze({ ...task, users: Object.freeze([...task.users]) })));

export function createRoom(roomCode, hostId, now = Date.now()) {
  return {
    roomCode,
    hostId,
    status: "waiting",
    spinsUsed: 0,
    maxSpins: 2,
    participants: [],
    assignments: [],
    usedTaskIds: [],
    complaints: [],
    version: 0,
    createdAt: now,
    updatedAt: now
  };
}

export function canReceiveTask(task, developer) {
  if (task.platform === "mobile") return Boolean(developer.android || developer.ios);
  return true;
}

export function getEligiblePairs(room, tasks = TASKS) {
  const used = new Set(room.usedTaskIds ?? []);
  const participants = (room.participants ?? []).filter((participant) => participant.connected);
  const pairs = [];

  for (const task of tasks) {
    if (used.has(task.id)) continue;
    for (const participant of participants) {
      if (!canReceiveTask(task, participant)) continue;
      pairs.push({ task, participant });
    }
  }

  return pairs;
}

/**
 * Returns the candidate pairs displayed on the wheel and used for selection.
 * Team preference is soft: if a matching pair exists, only matching pairs enter
 * this spin's pool. Otherwise every compatible unused pair is eligible.
 */
export function getAssignmentCandidates(room, tasks = TASKS) {
  const eligible = getEligiblePairs(room, tasks);
  const matching = eligible.filter(({ task, participant }) => task.team && task.team === participant.team);
  return matching.length ? matching : eligible;
}

export function chooseAssignmentPair(room, tasks = TASKS, random = Math.random) {
  const candidates = getAssignmentCandidates(room, tasks);
  if (!candidates.length) return null;
  const raw = Number(random());
  const normalized = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1 - Number.EPSILON) : 0;
  return candidates[Math.floor(normalized * candidates.length)];
}

export function canStartSpin1(room, tasks = TASKS) {
  return room.status === "waiting" && room.spinsUsed === 0 && getAssignmentCandidates(room, tasks).length > 0;
}

export function canStartSpin2(room, tasks = TASKS) {
  return room.spinsUsed === 1 && room.complaints.length > 0 && room.status !== "completed" && getAssignmentCandidates(room, tasks).length > 0;
}

export function canComplain(room, participantId) {
  if (!["result", "challenged"].includes(room.status) || room.spinsUsed !== 1) return false;
  const participant = room.participants.find((item) => item.id === participantId && item.connected);
  if (!participant) return false;
  return !room.complaints.some((complaint) => complaint.participantId === participantId);
}

export function recordComplaint(room, participantId, timestamp = Date.now()) {
  if (!canComplain(room, participantId)) {
    return { ok: false, reason: "A complaint is not allowed for this participant or room state." };
  }
  const participant = room.participants.find((item) => item.id === participantId);
  room.complaints.push({
    participantId,
    name: participant.name,
    timestamp
  });
  room.status = "challenged";
  room.version += 1;
  room.updatedAt = timestamp;
  return { ok: true, room };
}

function makeAssignment(room, pair, spinNumber, timestamp) {
  const { task, participant } = pair;
  return {
    id: `${room.roomCode}-${spinNumber}-${timestamp}`,
    spinNumber,
    taskId: task.id,
    taskWhat: task.what,
    theme: task.theme,
    device: task.device,
    platform: task.platform,
    taskTeam: task.team,
    users: [...task.users],
    participantId: participant.id,
    participantName: participant.name,
    participantTeam: participant.team,
    selectedDevices: { android: Boolean(participant.android), ios: Boolean(participant.ios) },
    teamMatched: Boolean(task.team && task.team === participant.team),
    timestamp,
    isChallenged: false,
    isFinal: false,
    resultStatus: "provisional"
  };
}

export function commitSpin(room, pair, timestamp = Date.now(), tasks = TASKS) {
  const isFirst = room.status === "waiting" && room.spinsUsed === 0;
  const isSecond = canStartSpin2(room, tasks);
  if (!isFirst && !isSecond) {
    return { ok: false, reason: "The room is not eligible for another spin." };
  }

  const candidates = getAssignmentCandidates(room, tasks);
  const validPair = candidates.some(({ task, participant }) =>
    task.id === pair?.task?.id && participant.id === pair?.participant?.id
  );
  if (!validPair) {
    return { ok: false, reason: "The selected task/developer pair is no longer eligible." };
  }

  const next = structuredCloneSafe(room);
  const spinNumber = next.spinsUsed + 1;
  const assignment = makeAssignment(next, pair, spinNumber, timestamp);

  if (spinNumber === 1) {
    next.assignments.push(assignment);
    next.spinsUsed = 1;
    next.usedTaskIds.push(assignment.taskId);
    next.status = "result";
  } else {
    const firstAssignment = next.assignments.find((item) => item.spinNumber === 1);
    if (!firstAssignment || firstAssignment.taskId === assignment.taskId) {
      return { ok: false, reason: "Spin 2 must replace Spin 1 with a different task." };
    }
    firstAssignment.isChallenged = true;
    firstAssignment.resultStatus = "challenged";
    assignment.isFinal = true;
    assignment.resultStatus = "final";
    next.assignments.push(assignment);
    next.spinsUsed = 2;
    next.usedTaskIds.push(assignment.taskId);
    next.status = "completed";
  }

  next.version += 1;
  next.updatedAt = timestamp;
  return { ok: true, room: next, assignment, spinNumber };
}

export function canAcceptInitialResult(room) {
  return room.status === "result" && room.spinsUsed === 1 && room.complaints.length === 0;
}

export function acceptInitialResult(room, timestamp = Date.now()) {
  if (!canAcceptInitialResult(room)) {
    return { ok: false, reason: "The initial result cannot be accepted in the current room state." };
  }
  const next = structuredCloneSafe(room);
  const assignment = next.assignments.find((item) => item.spinNumber === 1);
  if (!assignment) return { ok: false, reason: "The initial assignment is missing." };
  assignment.isFinal = true;
  assignment.resultStatus = "final";
  next.status = "completed";
  next.version += 1;
  next.updatedAt = timestamp;
  return { ok: true, room: next };
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
