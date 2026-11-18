// The default test tasks and the options the task editor offers. Data only.
//
// Every new room starts with a copy of DEFAULT_TASKS. The moderator can edit, add and
// delete tasks for that one room until the first spin; the defaults here never change.
// Values are intentional and must not be renamed or "fixed"
// (e.g. "CD Release" tasks belong to team "CYD").
//
// Each tester covers every browser and every user level of a task, so a task is one
// release + theme + device. (Earlier versions had a copy per browser/user level.)
//
// Task shape:
//   id        unique within a room
//   what      the task name
//   theme     one of THEMES
//   team      one team, or null for all teams
//   team_only true: the spin gives it only to members of `team` (after the spin anyone can
//             still assign themselves, and the moderator can give it to anyone). Default false.
//   devices   one or more of DEVICES. Mac, Android and iOS decide who can take the task
//             (see canReceiveTask in domain.js). Desktop can go to anyone.
//   browsers  any of BROWSERS; they apply to Desktop. Mac is always tested in Safari
//             (MAC_BROWSER), so Safari is not stored or offered as an option.
//   users     user levels, any of USER_LEVELS (display only)

export const DEVICES = Object.freeze([
  { value: "desktop", label: "Desktop" },
  { value: "mac", label: "Mac" },
  { value: "android", label: "Android" },
  { value: "ios", label: "iOS" }
]);

export const BROWSERS = Object.freeze([
  { value: "chrome", label: "Chrome" },
  { value: "edge", label: "Edge" },
  { value: "firefox", label: "Firefox" }
]);

/** The browser a Mac task is tested in. Not an editor option: selecting Mac implies it. */
export const MAC_BROWSER = Object.freeze({ value: "safari", label: "Safari" });

export const USER_LEVELS = Object.freeze([
  { value: "owner", label: "Owner" },
  { value: "installer", label: "Installer" },
  { value: "partner", label: "Partner" },
  { value: "service", label: "Service" }
]);

export const THEMES = Object.freeze([
  { value: "e3dc", label: "E3DC" },
  { value: "flow", label: "Flow" }
]);

const ALL_BROWSERS = BROWSERS.map((o) => o.value);
const ALL_USERS = USER_LEVELS.map((o) => o.value);

// One task per release × theme × device. Desktop lists every desktop browser; Mac is tested
// in Safari (implied); Android and iOS test the app. Every task covers every user level.
const RELEASES = [
  { prefix: "cuf", what: "Critical User Flows", team: null },
  { prefix: "af", what: "AF Release", team: "AF" },
  { prefix: "pb", what: "PB Release", team: "PB" },
  { prefix: "cyd", what: "CD Release", team: "CYD" }
];
const RELEASE_TASKS = RELEASES.flatMap(({ prefix, what, team }) =>
  THEMES.flatMap(({ value: theme }) =>
    DEVICES.map(({ value: device }) => ({
      id: `${prefix}-${theme}-${device}`,
      what,
      theme,
      team,
      team_only: false,
      devices: [device],
      browsers: device === "desktop" ? ALL_BROWSERS : [],
      users: ALL_USERS
    }))));

// Visual regression, one per theme, on Desktop: the spin gives these only to UI/UX
const VISUAL_TASKS = THEMES.map(({ value: theme }) => ({
  id: `vr-${theme}-desktop`,
  what: "Visual Regression Check",
  theme,
  team: "UI/UX",
  team_only: true,
  devices: ["desktop"],
  browsers: ALL_BROWSERS,
  users: ALL_USERS
}));

const TASKS = [...RELEASE_TASKS, ...VISUAL_TASKS];

const copyTask = (t) => ({ ...t, devices: [...t.devices], browsers: [...t.browsers], users: [...t.users] });

/**
 * The 34 default tasks: 4 releases × 2 themes × 4 devices, plus Visual Regression Check per theme
 * (UI/UX only). Deep-frozen so nothing can change them by accident.
 */
export const DEFAULT_TASKS = Object.freeze(TASKS.map((t) => {
  const c = copyTask(t);
  Object.freeze(c.devices); Object.freeze(c.browsers); Object.freeze(c.users);
  return Object.freeze(c);
}));

/** A fresh, editable copy of the defaults (what a new room starts with). */
export function defaultTasks() {
  return DEFAULT_TASKS.map(copyTask);
}
