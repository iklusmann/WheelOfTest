(() => {
  "use strict";

  const STORAGE_KEYS = {
    assignments: "qaRoulette.assignments.v1",
    developer: "qaRoulette.developer.v1"
  };

  /**
   * Source data taken from the provided task matrix.
   * Mobile rows require Android OR iOS.
   * Desktop browser rows do not require a phone.
   */
  const tasks = [
    { id: "cuf-e3dc-edge",      what: "Critical User Flows", theme: "e3dc", device: "edge",    platform: "desktop", users: ["owner", "installer", "partner", "service"] },
    { id: "cuf-flow-firefox",   what: "Critical User Flows", theme: "flow", device: "firefox", platform: "desktop", users: ["owner", "installer", "service"] },
    { id: "cuf-e3dc-mobile",    what: "Critical User Flows", theme: "e3dc", device: "mobile",  platform: "mobile",  users: ["owner", "installer", "partner", "service"] },
    { id: "cuf-flow-mobile",    what: "Critical User Flows", theme: "flow", device: "mobile",  platform: "mobile",  users: ["owner", "installer", "service"] },

    { id: "af-e3dc-mobile",     what: "AF Release", theme: "e3dc", device: "mobile",  platform: "mobile",  users: ["owner"] },
    { id: "af-e3dc-chrome",     what: "AF Release", theme: "e3dc", device: "chrome",  platform: "desktop", users: ["installer", "partner"] },
    { id: "af-e3dc-edge",       what: "AF Release", theme: "e3dc", device: "edge",    platform: "desktop", users: ["service"] },
    { id: "af-flow-mobile",     what: "AF Release", theme: "flow", device: "mobile",  platform: "mobile",  users: ["owner"] },
    { id: "af-flow-firefox",    what: "AF Release", theme: "flow", device: "firefox", platform: "desktop", users: ["installer"] },
    { id: "af-flow-edge",       what: "AF Release", theme: "flow", device: "edge",    platform: "desktop", users: ["service"] },

    { id: "pb-e3dc-mobile",     what: "PB Release", theme: "e3dc", device: "mobile",  platform: "mobile",  users: ["owner"] },
    { id: "pb-e3dc-chrome",     what: "PB Release", theme: "e3dc", device: "chrome",  platform: "desktop", users: ["installer", "partner"] },
    { id: "pb-e3dc-edge",       what: "PB Release", theme: "e3dc", device: "edge",    platform: "desktop", users: ["service"] },
    { id: "pb-flow-mobile",     what: "PB Release", theme: "flow", device: "mobile",  platform: "mobile",  users: ["owner"] },
    { id: "pb-flow-firefox",    what: "PB Release", theme: "flow", device: "firefox", platform: "desktop", users: ["installer"] },
    { id: "pb-flow-edge",       what: "PB Release", theme: "flow", device: "edge",    platform: "desktop", users: ["service"] },

    { id: "cd-e3dc-mobile",     what: "CD Release", theme: "e3dc", device: "mobile",  platform: "mobile",  users: ["owner"] },
    { id: "cd-e3dc-chrome",     what: "CD Release", theme: "e3dc", device: "chrome",  platform: "desktop", users: ["installer", "partner"] },
    { id: "cd-e3dc-edge",       what: "CD Release", theme: "e3dc", device: "edge",    platform: "desktop", users: ["service"] },
    { id: "cd-flow-mobile",     what: "CD Release", theme: "flow", device: "mobile",  platform: "mobile",  users: ["owner"] },
    { id: "cd-flow-firefox",    what: "CD Release", theme: "flow", device: "firefox", platform: "desktop", users: ["installer"] },
    { id: "cd-flow-edge",       what: "CD Release", theme: "flow", device: "edge",    platform: "desktop", users: ["service"] }
  ];

  const state = {
    rotation: 0,
    spinning: false,
    lastResultId: null
  };

  const elements = {
    developerName: document.getElementById("developerName"),
    android: document.getElementById("androidCheckbox"),
    ios: document.getElementById("iosCheckbox"),
    eligibilityMessage: document.getElementById("eligibilityMessage"),
    spinBtn: document.getElementById("spinBtn"),
    spinAgainBtn: document.getElementById("spinAgainBtn"),
    clearDeveloperBtn: document.getElementById("clearDeveloperBtn"),
    resetAssignmentsBtn: document.getElementById("resetAssignmentsBtn"),

    wheel: document.getElementById("wheel"),
    wheelCounter: document.getElementById("eligibleCount"),

    emptyResult: document.getElementById("emptyResult"),
    resultCard: document.getElementById("resultCard"),
    resultWhat: document.getElementById("resultWhat"),
    resultTheme: document.getElementById("resultTheme"),
    resultDevice: document.getElementById("resultDevice"),
    resultDeviceBadge: document.getElementById("resultDeviceBadge"),
    resultDeveloper: document.getElementById("resultDeveloper"),
    resultUsers: document.getElementById("resultUsers"),
    resultTimestamp: document.getElementById("resultTimestamp"),
    resultPlatform: document.getElementById("resultPlatform"),

    taskCount: document.getElementById("taskCount"),
    remainingCount: document.getElementById("remainingCount"),
    mobileReadyCount: document.getElementById("mobileReadyCount"),

    historyCount: document.getElementById("historyCount"),
    historyEmpty: document.getElementById("historyEmpty"),
    historyList: document.getElementById("historyList"),

    toast: document.getElementById("toast"),
    storageStatus: document.getElementById("storageStatus")
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn(`Unable to read ${key}`, error);
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    elements.storageStatus.textContent = "Saved locally";
  }

  function getAssignments() {
    return readJson(STORAGE_KEYS.assignments, []);
  }

  function setAssignments(assignments) {
    writeJson(STORAGE_KEYS.assignments, assignments);
  }

  function getSavedDeveloper() {
    return readJson(STORAGE_KEYS.developer, {
      name: "",
      android: false,
      ios: false
    });
  }

  function saveDeveloper() {
    writeJson(STORAGE_KEYS.developer, {
      name: elements.developerName.value.trim(),
      android: elements.android.checked,
      ios: elements.ios.checked
    });
  }

  function getDeveloper() {
    return {
      name: elements.developerName.value.trim(),
      android: elements.android.checked,
      ios: elements.ios.checked
    };
  }

  function loadDeveloper() {
    const saved = getSavedDeveloper();
    elements.developerName.value = saved.name || "";
    elements.android.checked = Boolean(saved.android);
    elements.ios.checked = Boolean(saved.ios);
  }

  function taskIsAssigned(taskId) {
    return getAssignments().some(assignment => assignment.taskId === taskId);
  }

  function isEligible(task, developer) {
    if (task.platform === "mobile") {
      return developer.android || developer.ios;
    }

    return true;
  }

  function getUnassignedTasks() {
    const assignments = getAssignments();
    const assignedIds = new Set(assignments.map(item => item.taskId));
    return tasks.filter(task => !assignedIds.has(task.id));
  }

  function getEligibleTasks(developer) {
    return getUnassignedTasks().filter(task => isEligible(task, developer));
  }

  function formatDevice(device) {
    const labels = {
      mobile: "Mobile",
      edge: "Edge",
      firefox: "Firefox",
      chrome: "Chrome"
    };

    return labels[device] || device;
  }

  function formatPlatform(platform) {
    const labels = {
      mobile: "Phone required: Android or iOS",
      desktop: "No phone required"
    };

    return labels[platform] || platform;
  }

  function formatDate(isoDate) {
    const date = new Date(isoDate);

    return new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function pluralize(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");

    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => {
      elements.toast.classList.remove("show");
    }, 2800);
  }

  function validateDeveloper({ silent = false } = {}) {
    const developer = getDeveloper();

    if (!developer.name) {
      setInfo("Enter a name and select the phone(s) you have.", "default");
      if (!silent) showToast("Please enter a developer name.");
      return { valid: false, developer };
    }

    setInfo(
      developer.android || developer.ios
        ? "Mobile tasks are eligible for this developer."
        : "No phone selected. Desktop tasks are still available.",
      developer.android || developer.ios ? "success" : "warning"
    );

    return { valid: true, developer };
  }

  function setInfo(message, tone = "default") {
    elements.eligibilityMessage.textContent = message;
    elements.eligibilityMessage.className = "info-box";

    if (tone !== "default") {
      elements.eligibilityMessage.classList.add(tone);
    }
  }

  function updateStats() {
    const assignments = getAssignments();
    const remaining = getUnassignedTasks();
    const developer = getDeveloper();
    const mobileReady = developer.android || developer.ios ? remaining.filter(task => task.platform === "mobile").length : 0;

    elements.taskCount.textContent = `${assignments.length} / ${tasks.length}`;
    elements.remainingCount.textContent = remaining.length;
    elements.mobileReadyCount.textContent = mobileReady;
  }

  function updateEligibilityUi() {
    const developer = getDeveloper();
    const eligible = developer.name ? getEligibleTasks(developer) : [];

    elements.wheelCounter.textContent = eligible.length;
    elements.spinBtn.disabled = state.spinning || eligible.length === 0;
    elements.spinAgainBtn.disabled = state.spinning || eligible.length === 0;

    if (!developer.name) {
      setInfo("Enter a name and select the phone(s) you have.", "default");
    } else if (eligible.length === 0 && getUnassignedTasks().length > 0) {
      setInfo("No tasks match this developer's device setup. Try another developer or enable a phone.", "error");
    } else if (eligible.length === 0) {
      setInfo("All tasks have already been assigned.", "success");
    } else if (developer.android || developer.ios) {
      setInfo(
        `${eligible.length} ${eligible.length === 1 ? "task is" : "tasks are"} eligible. Mobile tasks included.`,
        "success"
      );
    } else {
      setInfo(
        `${eligible.length} desktop ${eligible.length === 1 ? "task is" : "tasks are"} eligible. Select a phone to unlock mobile tasks.`,
        "warning"
      );
    }

    updateStats();
  }

  function buildWheelLabels(eligibleTasks) {
    const oldLabels = elements.wheel.querySelector(".wheel-segment-labels");
    if (oldLabels) oldLabels.remove();

    const layer = document.createElement("div");
    layer.className = "wheel-segment-labels";

    const count = Math.min(eligibleTasks.length, 22);
    const slice = 360 / count;

    eligibleTasks.slice(0, count).forEach((task, index) => {
      const label = document.createElement("div");
      label.className = "wheel-label";

      const angle = index * slice + slice / 2;
      const radius = window.innerWidth <= 520 ? 30 : 32;

      label.style.transform = `rotate(${angle}deg) translateY(-${radius}%)`;

      const shortWhat = task.what.replace("Critical User Flows", "Critical Flows");
      label.innerHTML = `
        <span>${escapeHtml(shortWhat)}</span>
        <span class="sub">${escapeHtml(task.theme)} · ${escapeHtml(task.device)}</span>
      `;

      layer.appendChild(label);
    });

    elements.wheel.appendChild(layer);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function chooseRandomTask(eligibleTasks) {
    return eligibleTasks[Math.floor(Math.random() * eligibleTasks.length)];
  }

  function calculateTargetRotation(winnerIndex, itemCount) {
    const slice = 360 / itemCount;
    const winnerCenter = winnerIndex * slice + slice / 2;

    // Pointer is at 12 o'clock. To bring the selected segment center there:
    // rotation = -winnerCenter, plus many full rotations for the animation.
    const fullTurns = 6 + Math.floor(Math.random() * 3);
    const jitter = (Math.random() - 0.5) * Math.min(10, slice * 0.2);

    return state.rotation + (fullTurns * 360) - winnerCenter + jitter;
  }

  function revealResult(task, developer) {
    const assignment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id,
      developer: developer.name,
      android: developer.android,
      ios: developer.ios,
      assignedAt: new Date().toISOString()
    };

    const assignments = getAssignments();
    assignments.unshift(assignment);
    setAssignments(assignments);

    state.lastResultId = assignment.id;

    elements.emptyResult.classList.add("hidden");
    elements.resultCard.classList.remove("hidden");
    elements.spinAgainBtn.classList.remove("hidden");

    elements.resultWhat.textContent = task.what;
    elements.resultTheme.textContent = task.theme;
    elements.resultDevice.textContent = formatDevice(task.device);
    elements.resultDeviceBadge.textContent = task.device;
    elements.resultDeveloper.textContent = developer.name;
    elements.resultUsers.innerHTML = task.users
      .map(user => `<span class="tag">${escapeHtml(user)}</span>`)
      .join("");
    elements.resultTimestamp.textContent = formatDate(assignment.assignedAt);
    elements.resultPlatform.textContent = formatPlatform(task.platform);

    renderHistory();
    updateEligibilityUi();
  }

  function spin() {
    if (state.spinning) return;

    const validation = validateDeveloper();
    if (!validation.valid) return;

    const eligibleTasks = getEligibleTasks(validation.developer);

    if (eligibleTasks.length === 0) {
      updateEligibilityUi();
      return;
    }

    state.spinning = true;
    document.body.classList.add("is-spinning");
    elements.spinBtn.disabled = true;
    elements.spinAgainBtn.disabled = true;

    buildWheelLabels(eligibleTasks);

    const winner = chooseRandomTask(eligibleTasks);
    const winnerIndex = eligibleTasks.findIndex(task => task.id === winner.id);

    // Keep the actual wheel position bounded while preserving the visible movement.
    const rawTarget = calculateTargetRotation(winnerIndex, eligibleTasks.length);
    const target = rawTarget;

    state.rotation = target;
    elements.wheel.style.transform = `rotate(${target}deg)`;

    const onTransitionEnd = (event) => {
      if (event.propertyName !== "transform") return;

      elements.wheel.removeEventListener("transitionend", onTransitionEnd);
      state.spinning = false;
      document.body.classList.remove("is-spinning");

      revealResult(winner, validation.developer);
      showToast(`${winner.what} · ${winner.theme} · ${formatDevice(winner.device)}`);
    };

    elements.wheel.addEventListener("transitionend", onTransitionEnd, { once: false });
  }

  function clearDeveloper() {
    elements.developerName.value = "";
    elements.android.checked = false;
    elements.ios.checked = false;
    saveDeveloper();
    elements.emptyResult.classList.remove("hidden");
    elements.resultCard.classList.add("hidden");
    elements.spinAgainBtn.classList.add("hidden");
    state.lastResultId = null;
    setInfo("Enter a name and select the phone(s) you have.", "default");
    updateEligibilityUi();
    elements.developerName.focus();
  }

  function resetAssignments() {
    if (getAssignments().length === 0) {
      showToast("There are no assignments to reset.");
      return;
    }

    const confirmed = window.confirm(
      "Reset the assignment history? All tasks will become available again."
    );

    if (!confirmed) return;

    setAssignments([]);
    state.lastResultId = null;

    elements.emptyResult.classList.remove("hidden");
    elements.resultCard.classList.add("hidden");
    elements.spinAgainBtn.classList.add("hidden");

    updateEligibilityUi();
    renderHistory();
    showToast("Assignment history has been reset.");
  }

  function renderHistory() {
    const assignments = getAssignments();
    const countText = pluralize(assignments.length, "assignment");

    elements.historyCount.textContent = countText;
    elements.historyEmpty.classList.toggle("hidden", assignments.length > 0);

    elements.historyList.innerHTML = "";

    assignments.forEach((assignment, index) => {
      const task = tasks.find(item => item.id === assignment.taskId);
      if (!task) return;

      const item = document.createElement("article");
      item.className = "history-item";
      item.innerHTML = `
        <div class="history-index">${String(index + 1).padStart(2, "0")}</div>
        <div class="history-main">
          <strong>${escapeHtml(assignment.developer)} → ${escapeHtml(task.what)}</strong>
          <span>${escapeHtml(task.theme)} · ${escapeHtml(formatDevice(task.device))} · ${escapeHtml(task.users.join(", "))}</span>
        </div>
        <div class="history-meta">
          <strong>${escapeHtml(task.platform === "mobile" ? "📱 Mobile" : "🖥 Desktop")}</strong>
          <span>${escapeHtml(formatDate(assignment.assignedAt))}</span>
        </div>
      `;

      elements.historyList.appendChild(item);
    });
  }

  function setupEvents() {
    elements.developerName.addEventListener("input", () => {
      saveDeveloper();
      updateEligibilityUi();
    });

    [elements.android, elements.ios].forEach(input => {
      input.addEventListener("change", () => {
        saveDeveloper();
        updateEligibilityUi();
      });
    });

    elements.spinBtn.addEventListener("click", spin);
    elements.spinAgainBtn.addEventListener("click", spin);
    elements.clearDeveloperBtn.addEventListener("click", clearDeveloper);
    elements.resetAssignmentsBtn.addEventListener("click", resetAssignments);

    document.addEventListener("keydown", event => {
      if (
        event.key === "Enter" &&
        document.activeElement !== elements.developerName &&
        !state.spinning
      ) {
        spin();
      }
    });
  }

  function init() {
    loadDeveloper();
    setupEvents();
    buildWheelLabels(getEligibleTasks(getDeveloper()));
    updateEligibilityUi();
    renderHistory();

    // Make an empty wheel feel intentional.
    elements.wheel.style.transform = "rotate(0deg)";
  }

  init();
})();
