import {
  TASKS,
  TEAM_MAPPING,
  acceptInitialResult,
  canAcceptInitialResult,
  canComplain,
  canReceiveTask,
  canStartSpin1,
  canStartSpin2,
  chooseAssignmentPair,
  commitSpin,
  createRoom,
  getAssignmentCandidates,
  getEligiblePairs,
  recordComplaint
} from "./logic.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function participant(id, team = "AF", options = {}) {
  return {
    id,
    name: id,
    team,
    android: Boolean(options.android),
    ios: Boolean(options.ios),
    connected: options.connected !== false
  };
}

function freshRoom(participants, code = "TEST42") {
  const room = createRoom(code, "host-test", 1000);
  room.participants = participants;
  return room;
}

const cases = [
  {
    name: "Task catalog preserves 22 unique task IDs and the configurable CYD mapping",
    run() {
      assert(TASKS.length === 22, `Expected 22 tasks, got ${TASKS.length}`);
      assert(new Set(TASKS.map((task) => task.id)).size === 22, "Task IDs must be unique");
      assert(TEAM_MAPPING["CD Release"] === "CYD", "CD Release must map to CYD by default");
      assert(TASKS.filter((task) => task.what === "Critical User Flows").every((task) => task.team === null), "Critical User Flows must be team-neutral");
    }
  },
  {
    name: "No-phone tester can receive desktop work but never mobile work",
    run() {
      const tester = participant("NoPhone", "AF");
      assert(canReceiveTask(TASKS.find((task) => task.platform === "desktop"), tester), "Desktop should be eligible");
      assert(!canReceiveTask(TASKS.find((task) => task.platform === "mobile"), tester), "Mobile should be ineligible");
      const pairs = getEligiblePairs(freshRoom([tester]));
      assert(pairs.length > 0, "Desktop task pairs should exist");
      assert(pairs.every((pair) => pair.task.platform === "desktop"), "A no-phone tester must only receive desktop tasks");
    }
  },
  {
    name: "Android-only, iOS-only and dual-phone testers can receive mobile tasks",
    run() {
      const mobile = TASKS.find((task) => task.platform === "mobile");
      assert(canReceiveTask(mobile, participant("Android", "AF", { android: true })), "Android-only should be eligible");
      assert(canReceiveTask(mobile, participant("iOS", "AF", { ios: true })), "iOS-only should be eligible");
      assert(canReceiveTask(mobile, participant("Both", "AF", { android: true, ios: true })), "Dual-phone should be eligible");
    }
  },
  {
    name: "Disconnected participants are excluded from the candidate pool",
    run() {
      const room = freshRoom([participant("Live", "AF", { android: true }), participant("Away", "AF", { android: true, connected: false })]);
      const pairs = getEligiblePairs(room);
      assert(pairs.length > 0, "Live tester should create candidate pairs");
      assert(pairs.every((pair) => pair.participant.id === "Live"), "Disconnected tester must not appear in candidate pairs");
    }
  },
  {
    name: "Matching AF, PB and CYD pairs take priority over team-neutral tasks",
    run() {
      for (const team of ["AF", "PB", "CYD"]) {
        const room = freshRoom([participant(`tester-${team}`, team, { android: true })]);
        const candidates = getAssignmentCandidates(room);
        assert(candidates.length > 0, `${team} should have preferred candidates`);
        assert(candidates.every(({ task, participant: tester }) => task.team === tester.team), `${team} should receive only matching-team candidates when matches exist`);
      }
    }
  },
  {
    name: "Cross-team fallback occurs only when no compatible matching pair exists",
    run() {
      const pbTask = TASKS.filter((task) => task.team === "PB");
      const room = freshRoom([participant("AF-only", "AF", { android: true })]);
      const candidates = getAssignmentCandidates(room, pbTask);
      assert(candidates.length > 0, "Fallback pool should be available");
      assert(candidates.every(({ task, participant: tester }) => task.team !== tester.team), "Cross-team pairs should be included when no matching pair exists");
      assert(candidates.every(({ task, participant: tester }) => canReceiveTask(task, tester)), "Team fallback must still enforce device compatibility");
    }
  },
  {
    name: "Spin 1 commits a provisional result and consumes its task",
    run() {
      const room = freshRoom([participant("AFTester", "AF", { android: true })]);
      assert(canStartSpin1(room), "A fresh room with an eligible pair should spin");
      const pair = chooseAssignmentPair(room, TASKS, () => 0);
      const result = commitSpin(room, pair, 2000);
      assert(result.ok, "Spin 1 should commit");
      assert(result.room.spinsUsed === 1 && result.room.status === "result", "Room state should be provisional after Spin 1");
      assert(result.room.usedTaskIds.includes(result.assignment.taskId), "The chosen task should be marked used");
      assert(!canStartSpin2(result.room), "Spin 2 must be unavailable before a complaint");
      assert(!canAcceptInitialResult({ ...result.room, complaints: [{ participantId: "x" }] }), "Cannot use acceptance to bypass a complaint");
    }
  },
  {
    name: "A connected participant can complain once; a duplicate complaint is rejected",
    run() {
      const start = freshRoom([participant("AFTester", "AF", { android: true })]);
      const first = commitSpin(start, chooseAssignmentPair(start, TASKS, () => 0), 3000);
      assert(first.ok, "Spin 1 setup failed");
      assert(canComplain(first.room, "AFTester"), "Connected participant should be able to complain");
      const complaint = recordComplaint(first.room, "AFTester", 3100);
      assert(complaint.ok, "First complaint should be accepted");
      assert(complaint.room.status === "challenged", "A complaint should move the room to challenged state");
      assert(!canComplain(complaint.room, "AFTester"), "The same participant cannot complain twice");
      assert(!recordComplaint(complaint.room, "AFTester", 3200).ok, "Duplicate complaint should be rejected");
      assert(canStartSpin2(complaint.room), "Complaint should unlock Spin 2 when a replacement exists");
    }
  },
  {
    name: "Spin 2 uses a different task and finalizes the replacement",
    run() {
      const room = freshRoom([participant("AFTester", "AF", { android: true }), participant("PBTester", "PB", { ios: true })]);
      const firstPair = chooseAssignmentPair(room, TASKS, () => 0);
      const first = commitSpin(room, firstPair, 4000);
      assert(first.ok, "Spin 1 should commit");
      const complainResult = recordComplaint(first.room, firstPair.participant.id, 4100);
      assert(complainResult.ok, "Complaint setup failed");
      const secondPair = chooseAssignmentPair(complainResult.room, TASKS, () => 0.4);
      assert(secondPair.task.id !== first.assignment.taskId, "Spin 2 candidates must exclude the first task");
      const second = commitSpin(complainResult.room, secondPair, 4200);
      assert(second.ok, "Spin 2 should commit");
      assert(second.room.spinsUsed === 2 && second.room.status === "completed", "Spin 2 should complete the room");
      assert(second.room.assignments[0].isChallenged, "Initial assignment should be marked challenged");
      assert(second.room.assignments[1].isFinal, "Replacement assignment should be final");
      assert(!canStartSpin1(second.room) && !canStartSpin2(second.room), "No further spin should be possible");
      assert(!canComplain(second.room, firstPair.participant.id), "No complaint should be allowed after completion");
    }
  },
  {
    name: "Accepting Spin 1 closes the room without a second spin",
    run() {
      const start = freshRoom([participant("PBTester", "PB", { ios: true })]);
      const first = commitSpin(start, chooseAssignmentPair(start, TASKS, () => 0), 5000);
      assert(first.ok, "Spin 1 should commit");
      assert(canAcceptInitialResult(first.room), "Unchallenged initial result should be acceptable");
      const accepted = acceptInitialResult(first.room, 5100);
      assert(accepted.ok, "Accept result should succeed");
      assert(accepted.room.status === "completed", "Accept result should complete the room");
      assert(accepted.room.spinsUsed === 1 && accepted.room.assignments[0].isFinal, "Acceptance should finalize Spin 1 without incrementing spin count");
    }
  },
  {
    name: "No eligible participants means no spin can start",
    run() {
      const room = freshRoom([participant("Offline", "AF", { android: true, connected: false })]);
      assert(getAssignmentCandidates(room).length === 0, "No candidates should be present");
      assert(!canStartSpin1(room), "Spin 1 should be disabled without connected testers");
    }
  }
];

export function runTests() {
  const results = [];
  for (const testCase of cases) {
    try {
      testCase.run();
      results.push({ name: testCase.name, passed: true, message: "Passed" });
    } catch (error) {
      results.push({ name: testCase.name, passed: false, message: error?.message || String(error) });
    }
  }
  return results;
}

if (typeof document !== "undefined") {
  const output = document.querySelector("#test-results");
  const summary = document.querySelector("#test-summary");
  if (output && summary) {
    const results = runTests();
    const passed = results.filter((result) => result.passed).length;
    summary.textContent = `${passed} of ${results.length} tests passed`;
    output.innerHTML = results.map((result) => `<li class="${result.passed ? "passed" : "failed"}"><strong>${result.passed ? "PASS" : "FAIL"}</strong> ${result.name}${result.passed ? "" : ` — ${result.message}`}</li>`).join("");
  }
}

if (typeof process !== "undefined" && process.versions?.node && typeof document === "undefined") {
  const results = runTests();
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}${result.passed ? "" : ` — ${result.message}`}`);
  }
  const passed = results.filter((result) => result.passed).length;
  console.log(`${passed}/${results.length} tests passed`);
  if (passed !== results.length) process.exitCode = 1;
}
