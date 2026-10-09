import { TASKS, TASK_BY_ID } from "./tasks.js";
import { MAX_ROOM_PARTICIPANTS, STORAGE_PREFIX } from "./config.js";
import {
  buildEligiblePairs,
  canReceiveTask,
  chooseEligiblePair,
  createRoomState,
  isActionAllowed,
  isSnapshotVersionAcceptable,
  transitionAcceptResult,
  transitionComplaint,
  transitionSpin1,
  transitionSpin2,
  transitionUpsertParticipant,
  validateProfile,
  validateRoomState
} from "./domain.js";
import { createStorageRepository } from "./storage.js";
import { parseSignalCode, validateAnswerCorrelation } from "./webrtc.js";

const resultsNode = document.querySelector("#test-results");
const statusNode = document.querySelector("#test-status");
const summaryNode = document.querySelector("#test-summary");
const detailsNode = document.querySelector("#test-details");
let cases = [];

function assert(condition, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message = "Values are not equal") {
  assert(Object.is(actual, expected), `${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
}
function includes(actual, expected, message = "Expected value to be included") {
  assert(actual.includes(expected), `${message}: ${String(expected)}`);
}
function test(name, fn) { cases.push({ name, fn }); }

const validRoomCode = "ABC123";
const af = { id: "developer-af-0001", name: "Alex", team: "AF", android: false, ios: false };
const pb = { id: "developer-pb-0002", name: "Taylor", team: "PB", android: true, ios: false };
const cyd = { id: "developer-cyd-003", name: "Jordan", team: "CYD", android: false, ios: true };
const desktopTask = TASK_BY_ID.get("af-e3dc-chrome");
const mobileTask = TASK_BY_ID.get("af-e3dc-mobile");
const neutralDesktopTask = TASK_BY_ID.get("cuf-e3dc-edge");

function addProfile(room, profile) {
  const result = transitionUpsertParticipant(room, profile, room.updatedAt + 1);
  assert(result.ok, result.error || "Could not add fixture profile");
  return result.state;
}

function setupRoom(profiles = [af, pb, cyd]) {
  let room = createRoomState(validRoomCode, "host-identity-0001", null, 1_000);
  for (const profile of profiles) room = addProfile(room, profile);
  return room;
}

function chooseFirstTask(room, profile, preferredTaskIds = null) {
  const candidateTasks = preferredTaskIds ? preferredTaskIds.map((id) => TASK_BY_ID.get(id)) : TASKS;
  const result = chooseEligiblePair(room, [{ ...profile, connected: true }], () => 0, candidateTasks);
  return result;
}

class MemoryStorage {
  constructor() { this.map = new Map(); this.failWrites = false; }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error("QuotaExceededError: simulated storage quota failure");
    this.map.set(String(key), String(value));
  }
  removeItem(key) { this.map.delete(key); }
}

// Catalog and compatibility
test("Task catalog contains exactly 22 immutable tasks", () => {
  equal(TASKS.length, 22);
  equal(new Set(TASKS.map((task) => task.id)).size, 22);
  assert(Object.isFrozen(TASKS) && Object.isFrozen(TASKS[0]) && Object.isFrozen(TASKS[0].users));
  for (const task of TASKS) for (const key of ["id", "what", "theme", "device", "platform", "team", "users"]) assert(Object.hasOwn(task, key), `Missing ${key} on ${task.id}`);
});
test("Device compatibility: no phone can receive a desktop task", () => equal(canReceiveTask(desktopTask, af), true));
test("Device compatibility: no phone cannot receive a mobile task", () => equal(canReceiveTask(mobileTask, af), false));
test("Device compatibility: Android-only developer can receive mobile task", () => equal(canReceiveTask(mobileTask, { ...af, android: true }), true));
test("Device compatibility: iOS-only developer can receive mobile task", () => equal(canReceiveTask(mobileTask, { ...af, ios: true }), true));
test("Device compatibility: both phones can receive mobile task", () => equal(canReceiveTask(mobileTask, { ...af, android: true, ios: true }), true));
test("Disconnected participant is excluded from eligible pairs", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const pairs = buildEligiblePairs(room, [{ ...pb, connected: false }], [desktopTask]);
  equal(pairs.length, 0);
});
test("Guest profile validation trims names and requires a team and boolean phone flags", () => {
  const valid = validateProfile({ ...af, name: " Alex " });
  assert(valid.ok); equal(valid.profile.name, "Alex");
  assert(!validateProfile({ ...af, team: "OPS" }).ok);
  assert(!validateProfile({ ...af, android: "yes" }).ok);
  assert(!validateProfile({ ...af, name: " ".repeat(2) }).ok);
});

// Team-first rules
test("AF release prefers an AF developer", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const result = chooseEligiblePair(room, [{ ...af, connected: true }, { ...pb, connected: true }], () => 0, [desktopTask]);
  assert(result.ok); equal(result.pair.developer.team, "AF"); equal(result.pair.task.team, "AF");
});
test("PB release prefers a PB developer", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const task = TASK_BY_ID.get("pb-e3dc-chrome");
  const result = chooseEligiblePair(room, [{ ...af, connected: true }, { ...pb, connected: true }], () => 0.99, [task]);
  assert(result.ok); equal(result.pair.developer.team, "PB");
});
test("CD Release / CYD task prefers a CYD developer", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const task = TASK_BY_ID.get("cyd-e3dc-edge");
  const result = chooseEligiblePair(room, [{ ...af, connected: true }, { ...cyd, connected: true }], () => 0.99, [task]);
  assert(result.ok); equal(result.pair.developer.team, "CYD"); equal(result.pair.task.what, "CD Release");
});
test("Critical User Flows tasks stay neutral", () => {
  equal(neutralDesktopTask.team, null);
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const result = chooseEligiblePair(room, [{ ...af, connected: true }], () => 0, [neutralDesktopTask]);
  assert(result.ok); equal(result.preferredPairs, 0); equal(result.usedPreferredPool, false);
});
test("When same-team pairs exist, selected index comes only from preferred pool", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const allTeams = [desktopTask, TASK_BY_ID.get("pb-e3dc-chrome"), neutralDesktopTask];
  const result = chooseEligiblePair(room, [{ ...af, connected: true }, { ...pb, connected: true }], () => 0.99999, allTeams);
  assert(result.ok); assert(result.usedPreferredPool); assert(result.pair.task.team === result.pair.developer.team);
});
test("With no preferred pair, selection falls back to any valid neutral/cross-team pair", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const result = chooseEligiblePair(room, [{ ...pb, connected: true }], () => 0, [neutralDesktopTask]);
  assert(result.ok); equal(result.usedPreferredPool, false); equal(result.pair.task.id, neutralDesktopTask.id);
});
test("Device compatibility is enforced while building pairs", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const pairs = buildEligiblePairs(room, [{ ...af, connected: true }], [mobileTask]);
  equal(pairs.length, 0);
});
test("Multiple participants and tasks create all valid pairs", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const result = buildEligiblePairs(room, [{ ...af, connected: true }, { ...pb, connected: true }], [desktopTask, neutralDesktopTask]);
  equal(result.length, 4);
});
test("Random choice is injectable and clamps boundary values safely", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const neutralTaskTwo = TASK_BY_ID.get("cuf-flow-firefox");
  const first = chooseEligiblePair(room, [{ ...af, connected: true }], () => 0, [neutralDesktopTask, neutralTaskTwo]);
  const last = chooseEligiblePair(room, [{ ...af, connected: true }], () => 1, [neutralDesktopTask, neutralTaskTwo]);
  assert(first.ok && last.ok); equal(first.pair.task.id, neutralDesktopTask.id); equal(last.pair.task.id, neutralTaskTwo.id);
});
test("Pair pool size documents weighting when one task has more eligible developers", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  const desktopTasks = [desktopTask, TASK_BY_ID.get("af-e3dc-edge")];
  const result = chooseEligiblePair(room, [{ ...af, connected: true }, { ...pb, connected: true }], () => 0, desktopTasks);
  assert(result.ok); equal(result.totalPairs, 4); equal(result.preferredPairs, 2); equal(result.poolSize, 2);
});

// Room lifecycle
test("New room starts with zero spins, no assignments, tasks or complaints", () => {
  const room = createRoomState(validRoomCode, "host-identity-0001");
  equal(room.spinsUsed, 0); equal(room.assignments.length, 0); equal(room.usedTaskIds.length, 0); equal(room.complaints.length, 0); equal(room.status, "waiting"); equal(room.stateVersion, 0);
});
test("Spin 1 requires a valid registered connected pair and increments version once", () => {
  const room = setupRoom([af]);
  const selected = chooseFirstTask(room, af);
  assert(selected.ok);
  const next = transitionSpin1(room, selected.pair, 2_000);
  assert(next.ok, next.error); equal(next.state.spinsUsed, 1); equal(next.state.stateVersion, room.stateVersion + 1); equal(next.state.status, "result");
});
test("Spin 1 cannot be repeated", () => {
  let room = setupRoom([af]);
  const selected = chooseFirstTask(room, af);
  room = transitionSpin1(room, selected.pair, 2_000).state;
  const again = transitionSpin1(room, selected.pair, 3_000);
  assert(!again.ok); equal(again.state, room); equal(room.spinsUsed, 1);
});
test("Complaint is rejected before Spin 1", () => {
  const room = setupRoom([af]);
  const result = transitionComplaint(room, af.id, 3_000);
  assert(!result.ok); equal(result.state, room);
});
test("A valid complaint challenges Spin 1 and increments version once", () => {
  let room = setupRoom([af]);
  const selected = chooseFirstTask(room, af);
  room = transitionSpin1(room, selected.pair, 2_000).state;
  const complaint = transitionComplaint(room, af.id, 3_000);
  assert(complaint.ok); equal(complaint.state.status, "challenged"); equal(complaint.state.complaints.length, 1); equal(complaint.state.stateVersion, room.stateVersion + 1);
});
test("Duplicate complaint from the same participant is rejected", () => {
  let room = setupRoom([af]);
  room = transitionSpin1(room, chooseFirstTask(room, af).pair, 2_000).state;
  room = transitionComplaint(room, af.id, 3_000).state;
  const duplicate = transitionComplaint(room, af.id, 4_000);
  assert(!duplicate.ok); equal(duplicate.state, room); equal(room.complaints.length, 1);
});
test("Only host may start Spin 2, and it requires a complaint and replacement pair", () => {
  let room = setupRoom([af]);
  assert(!isActionAllowed(room, "spin2", { role: "host", replacementAvailable: true }));
  room = transitionSpin1(room, chooseFirstTask(room, af).pair, 2_000).state;
  assert(!isActionAllowed(room, "spin2", { role: "guest", replacementAvailable: true }));
  room = transitionComplaint(room, af.id, 3_000).state;
  assert(isActionAllowed(room, "spin2", { role: "host", replacementAvailable: true }));
  assert(!isActionAllowed(room, "spin2", { role: "host", replacementAvailable: false }));
});
test("Spin 2 cannot repeat Spin 1 task and marks the original void/final replacement", () => {
  let room = setupRoom([af]);
  const firstChoice = chooseFirstTask(room, af);
  room = transitionSpin1(room, firstChoice.pair, 2_000).state;
  room = transitionComplaint(room, af.id, 3_000).state;
  const replacement = chooseFirstTask(room, af);
  assert(replacement.ok); assert(!room.usedTaskIds.includes(replacement.pair.task.id));
  const result = transitionSpin2(room, replacement.pair, 4_000);
  assert(result.ok, result.error); equal(result.state.status, "completed"); equal(result.state.spinsUsed, 2); equal(result.state.stateVersion, room.stateVersion + 1);
  const original = result.state.assignments.find((assignment) => assignment.spinNumber === 1);
  const final = result.state.assignments.find((assignment) => assignment.spinNumber === 2);
  assert(original.void && original.challenged && !original.final); assert(final.final); assert(original.task.id !== final.task.id);
});
test("No replacement pair keeps room challenged and does not consume Spin 2", () => {
  let room = setupRoom([af]);
  const firstChoice = chooseEligiblePair(room, [{ ...af, connected: true }], () => 0, [desktopTask]);
  assert(firstChoice.ok); room = transitionSpin1(room, firstChoice.pair, 2_000).state;
  room = transitionComplaint(room, af.id, 3_000).state;
  const noAlternative = chooseEligiblePair(room, [{ ...af, connected: true }], () => 0, [desktopTask]);
  assert(!noAlternative.ok);
  const invalidAttempt = transitionSpin2(room, { task: desktopTask, developer: { ...af, connected: true } }, 4_000);
  assert(!invalidAttempt.ok); equal(invalidAttempt.state, room); equal(room.status, "challenged"); equal(room.spinsUsed, 1); assert(!room.assignments[0].void);
});
test("Accepting Spin 1 finalizes it without consuming Spin 2", () => {
  let room = setupRoom([af]);
  room = transitionSpin1(room, chooseFirstTask(room, af).pair, 2_000).state;
  const result = transitionAcceptResult(room, {}, 3_000);
  assert(result.ok); equal(result.state.status, "completed"); equal(result.state.spinsUsed, 1); equal(result.state.stateVersion, room.stateVersion + 1); assert(result.state.assignments[0].final);
});
test("Explicit complaint override finalizes original result only when requested", () => {
  let room = setupRoom([af]);
  room = transitionSpin1(room, chooseFirstTask(room, af).pair, 2_000).state;
  room = transitionComplaint(room, af.id, 3_000).state;
  assert(!transitionAcceptResult(room, {}, 4_000).ok);
  const accepted = transitionAcceptResult(room, { overrideComplaint: true }, 4_000);
  assert(accepted.ok); equal(accepted.state.status, "completed"); equal(accepted.state.spinsUsed, 1); assert(accepted.state.assignments[0].final && accepted.state.assignments[0].challenged && !accepted.state.assignments[0].void);
});
test("Completed room rejects spins and complaints", () => {
  let room = setupRoom([af]);
  room = transitionSpin1(room, chooseFirstTask(room, af).pair, 2_000).state;
  room = transitionAcceptResult(room, {}, 3_000).state;
  const spin = transitionSpin1(room, chooseFirstTask(room, af).pair, 4_000);
  const complaint = transitionComplaint(room, af.id, 4_000);
  assert(!spin.ok && !complaint.ok); equal(spin.state, room); equal(complaint.state, room);
});
test("Every accepted domain transition increments stateVersion exactly once", () => {
  let room = createRoomState(validRoomCode, "host-identity-0001");
  const added = transitionUpsertParticipant(room, af, 1_001); assert(added.ok); equal(added.state.stateVersion, room.stateVersion + 1); room = added.state;
  const spin = transitionSpin1(room, chooseFirstTask(room, af).pair, 2_000); assert(spin.ok); equal(spin.state.stateVersion, room.stateVersion + 1); room = spin.state;
  const complaint = transitionComplaint(room, af.id, 3_000); assert(complaint.ok); equal(complaint.state.stateVersion, room.stateVersion + 1);
});
test("State validation rejects stale persisted connected flags", () => {
  const room = setupRoom([af]);
  const invalid = { ...room, participants: room.participants.map((entry) => ({ ...entry, connected: true })) };
  assert(!validateRoomState(invalid).ok);
});
test("Stale snapshots are ignored while equal/newer versions are accepted", () => {
  equal(isSnapshotVersionAcceptable(3, 4), false); equal(isSnapshotVersionAcceptable(4, 4), true); equal(isSnapshotVersionAcceptable(5, 4), true); equal(isSnapshotVersionAcceptable(-1, 4), false);
});

// Storage and signaling
test("Versioned storage round-trips validated state", () => {
  const fake = new MemoryStorage(); const repo = createStorageRepository(() => fake); const room = setupRoom([af]);
  repo.saveRoomState(room); const loaded = repo.loadRoomState(room.roomCode);
  assert(loaded.state); equal(loaded.state.stateVersion, room.stateVersion); equal(loaded.state.participants[0].id, af.id); assert(!Object.hasOwn(loaded.state.participants[0], "connected"));
});
test("Malformed nested room state is rejected without throwing", () => {
  const base = setupRoom([af]);
  const brokenAssignment = { ...base, assignments: [null], spinsUsed: 1, status: "result", usedTaskIds: [desktopTask.id] };
  let result;
  try { result = validateRoomState(brokenAssignment); } catch (error) { throw new Error(`Validation must not throw for corrupt data: ${error.message}`); }
  assert(!result.ok); assert(result.errors.length > 0);
  const brokenComplaint = { ...base, complaints: [null] };
  try { result = validateRoomState(brokenComplaint); } catch (error) { throw new Error(`Complaint validation must not throw: ${error.message}`); }
  assert(!result.ok);
});
test("Room validation enforces exact used-task and lifecycle consistency", () => {
  let room = setupRoom([af]);
  const first = chooseFirstTask(room, af);
  room = transitionSpin1(room, first.pair, 2_000).state;
  const inconsistentUsedTasks = { ...room, usedTaskIds: [...room.usedTaskIds, "pb-e3dc-chrome"] };
  assert(!validateRoomState(inconsistentUsedTasks).ok);
  const inconsistentFlags = { ...room, assignments: [{ ...room.assignments[0], final: true }] };
  assert(!validateRoomState(inconsistentFlags).ok);
});
test("Malformed persisted JSON is rejected with a visible error", () => {
  const fake = new MemoryStorage(); const repo = createStorageRepository(() => fake); fake.setItem(`${STORAGE_PREFIX}${validRoomCode}`, "{bad json");
  const loaded = repo.loadRoomState(validRoomCode); assert(!loaded.state); includes(loaded.error, "invalid JSON");
});
test("Room migration strips stale connected flags and writes normalized state", () => {
  const fake = new MemoryStorage(); const repo = createStorageRepository(() => fake); const room = setupRoom([af]);
  fake.setItem(`${STORAGE_PREFIX}${room.roomCode}`, JSON.stringify({ ...room, participants: [{ ...af, connected: true, connectedAt: 50, connectionState: "connected", connectionId: "old", lastHeartbeatAt: 60, channelReadyState: "open" }] }));
  const loaded = repo.loadRoomState(room.roomCode); assert(loaded.state); for (const key of ["connected", "connectedAt", "connectionState", "connectionId", "lastHeartbeatAt", "channelReadyState"]) assert(!Object.hasOwn(loaded.state.participants[0], key));
  const raw = JSON.parse(fake.getItem(`${STORAGE_PREFIX}${room.roomCode}`)); assert(!Object.hasOwn(raw.participants[0], "connected"));
});
test("Storage quota failure is surfaced instead of pretending persistence succeeded", () => {
  const fake = new MemoryStorage(); const repo = createStorageRepository(() => fake); const room = setupRoom([af]); fake.failWrites = true;
  let threw = false; try { repo.saveRoomState(room); } catch (error) { threw = /quota failure/i.test(error.message); }
  assert(threw);
});
test("Room participant cap keeps snapshots within protocol resource limits", () => {
  let room = createRoomState(validRoomCode, "host-identity-0001");
  for (let index = 0; index < MAX_ROOM_PARTICIPANTS; index += 1) {
    const id = `user-${String(index).padStart(8, "0")}`;
    const result = transitionUpsertParticipant(room, { id, name: `User ${index}`, team: "AF", android: false, ios: false }, 1_000 + index);
    assert(result.ok, result.error || "Profile should fit below the room limit"); room = result.state;
  }
  const denied = transitionUpsertParticipant(room, { id: "user-over-limit-1", name: "Overflow", team: "AF", android: false, ios: false }, 2_000);
  assert(!denied.ok); includes(denied.error, String(MAX_ROOM_PARTICIPANTS));
});
test("Guest profile persistence stores only a validated local profile", () => {
  const fake = new MemoryStorage(); const repo = createStorageRepository(() => fake); repo.saveGuestProfile(af);
  const loaded = repo.loadGuestProfile(); assert(loaded.profile); equal(loaded.profile.name, af.name); equal(fake.length, 1);
});
test("Signaling parser rejects malformed, wrong-room, expired and oversized codes", () => {
  let threw = false; try { parseSignalCode("not json", { roomCode: validRoomCode, expectedType: "offer" }); } catch { threw = true; } assert(threw);
  const wrapper = { protocolVersion: 1, roomCode: "ZZZZZZ", connectionId: "c-12345678", type: "offer", createdAt: Date.now(), sdp: { type: "offer", sdp: "v=0" } };
  threw = false; try { parseSignalCode(JSON.stringify(wrapper), { roomCode: validRoomCode, expectedType: "offer" }); } catch { threw = true; } assert(threw);
  const expired = { ...wrapper, roomCode: validRoomCode, createdAt: Date.now() - 11 * 60 * 1000 };
  threw = false; try { parseSignalCode(JSON.stringify(expired), { roomCode: validRoomCode, expectedType: "offer" }); } catch { threw = true; } assert(threw);
  threw = false; try { parseSignalCode("x".repeat(200 * 1024 + 1), { roomCode: validRoomCode, expectedType: "offer" }); } catch { threw = true; } assert(threw);
});
test("Signaling answer must be correlated to the offer row that initiated it", () => {
  const answer = { protocolVersion: 1, roomCode: validRoomCode, connectionId: "c-12345678", type: "answer", createdAt: Date.now(), sdp: { type: "answer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1" } };
  const parsed = parseSignalCode(JSON.stringify(answer), { roomCode: validRoomCode, expectedType: "answer" });
  equal(validateAnswerCorrelation(parsed, "c-12345678").connectionId, "c-12345678");
  let error = ""; try { validateAnswerCorrelation(parsed, "c-87654321"); } catch (failure) { error = failure.message; }
  includes(error, "different connection row");
});
test("Signaling parser accepts a well-formed fresh offer for the exact room", () => {
  const wrapper = { protocolVersion: 1, roomCode: validRoomCode, connectionId: "c-12345678", type: "offer", createdAt: Date.now(), sdp: { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1" } };
  const parsed = parseSignalCode(JSON.stringify(wrapper), { roomCode: validRoomCode, expectedType: "offer" }); equal(parsed.connectionId, wrapper.connectionId);
});
test("Room refresh keeps persisted spin count and audit history", () => {
  const fake = new MemoryStorage(); const repo = createStorageRepository(() => fake); let room = setupRoom([af]);
  room = transitionSpin1(room, chooseFirstTask(room, af).pair, 2_000).state; room = transitionComplaint(room, af.id, 3_000).state; repo.saveRoomState(room);
  const reloaded = repo.loadRoomState(room.roomCode).state; equal(reloaded.spinsUsed, 1); equal(reloaded.assignments.length, 1); equal(reloaded.complaints.length, 1); equal(reloaded.status, "challenged");
});

async function run() {
  resultsNode.replaceChildren(); summaryNode.replaceChildren(); detailsNode.replaceChildren();
  let passed = 0;
  const failures = [];
  for (const item of cases) {
    try {
      await item.fn();
      passed += 1;
      addResult(item.name, true, "Assertion passed.");
    } catch (failure) {
      failures.push({ name: item.name, error: failure?.stack || failure?.message || String(failure) });
      addResult(item.name, false, failure?.message || String(failure));
    }
  }
  summaryNode.append(stat(`${passed}`, "passed"), stat(`${failures.length}`, "failed"), stat(`${cases.length}`, "total"));
  statusNode.textContent = failures.length ? "Some assertions failed. Review the results below." : "All executed assertions passed.";
  statusNode.className = failures.length ? "notice notice-danger" : "notice notice-success";
  if (failures.length) {
    const pre = document.createElement("pre"); pre.className = "textarea"; pre.textContent = failures.map((failure) => `${failure.name}\n${failure.error}`).join("\n\n"); detailsNode.append(pre);
  }
}

function stat(value, label) {
  const item = document.createElement("div"); item.className = "hero-stat";
  const number = document.createElement("strong"); number.textContent = value;
  const caption = document.createElement("span"); caption.textContent = label;
  item.append(number, caption); return item;
}
function addResult(name, passed, detail) {
  const item = document.createElement("li"); item.className = `test-row ${passed ? "pass" : "fail"}`;
  const mark = document.createElement("span"); mark.className = "test-mark"; mark.textContent = passed ? "✓" : "×";
  const copy = document.createElement("div"); const title = document.createElement("strong"); title.textContent = name;
  const description = document.createElement("p"); description.textContent = detail;
  copy.append(title, description); item.append(mark, copy); resultsNode.append(item);
}

document.querySelector("#run-tests").addEventListener("click", run);
await run();
