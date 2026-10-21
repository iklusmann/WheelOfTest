// The default test tasks and the options the task editor offers. Data only.
//
// Every new room starts with a copy of DEFAULT_TASKS. The moderator can edit, add and
// delete tasks for that one room until the first spin; the defaults here never change.
// Values are intentional and must not be renamed or "fixed"
// (e.g. "CD Release" tasks belong to team "CYD").
//
// Task shape:
//   id        unique within a room
//   what      the task name
//   theme     one of THEMES
//   team      one team, or null for all teams
//   devices   one or more of DEVICES. Android and iOS decide who can take the task:
//             the assignee needs at least one of the selected phones (see domain.js).
//   browsers  any of BROWSERS (display only)
//   users     user levels, any of USER_LEVELS (display only)

export const DEVICES = Object.freeze([
  { value: "desktop", label: "Desktop" },
  { value: "android", label: "Android" },
  { value: "ios", label: "iOS" }
]);

export const BROWSERS = Object.freeze([
  { value: "chrome", label: "Chrome" },
  { value: "edge", label: "Edge" },
  { value: "firefox", label: "Firefox" },
  { value: "safari", label: "Safari" }
]);

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

const DESKTOP = ["desktop"];
const PHONE = ["android", "ios"];

const TASKS = [
  { id: "cuf-e3dc-edge", what: "Critical User Flows", theme: "e3dc", team: null, devices: DESKTOP, browsers: ["edge"], users: ["owner", "installer", "partner", "service"] },
  { id: "cuf-flow-firefox", what: "Critical User Flows", theme: "flow", team: null, devices: DESKTOP, browsers: ["firefox"], users: ["owner", "installer", "service"] },
  { id: "cuf-e3dc-mobile", what: "Critical User Flows", theme: "e3dc", team: null, devices: PHONE, browsers: [], users: ["owner", "installer", "partner", "service"] },
  { id: "cuf-flow-mobile", what: "Critical User Flows", theme: "flow", team: null, devices: PHONE, browsers: [], users: ["owner", "installer", "service"] },
  { id: "af-e3dc-mobile", what: "AF Release", theme: "e3dc", team: "AF", devices: PHONE, browsers: [], users: ["owner"] },
  { id: "af-e3dc-chrome", what: "AF Release", theme: "e3dc", team: "AF", devices: DESKTOP, browsers: ["chrome"], users: ["installer", "partner"] },
  { id: "af-e3dc-edge", what: "AF Release", theme: "e3dc", team: "AF", devices: DESKTOP, browsers: ["edge"], users: ["service"] },
  { id: "af-flow-mobile", what: "AF Release", theme: "flow", team: "AF", devices: PHONE, browsers: [], users: ["owner"] },
  { id: "af-flow-firefox", what: "AF Release", theme: "flow", team: "AF", devices: DESKTOP, browsers: ["firefox"], users: ["installer"] },
  { id: "af-flow-edge", what: "AF Release", theme: "flow", team: "AF", devices: DESKTOP, browsers: ["edge"], users: ["service"] },
  { id: "pb-e3dc-mobile", what: "PB Release", theme: "e3dc", team: "PB", devices: PHONE, browsers: [], users: ["owner"] },
  { id: "pb-e3dc-chrome", what: "PB Release", theme: "e3dc", team: "PB", devices: DESKTOP, browsers: ["chrome"], users: ["installer", "partner"] },
  { id: "pb-e3dc-edge", what: "PB Release", theme: "e3dc", team: "PB", devices: DESKTOP, browsers: ["edge"], users: ["service"] },
  { id: "pb-flow-mobile", what: "PB Release", theme: "flow", team: "PB", devices: PHONE, browsers: [], users: ["owner"] },
  { id: "pb-flow-firefox", what: "PB Release", theme: "flow", team: "PB", devices: DESKTOP, browsers: ["firefox"], users: ["installer"] },
  { id: "pb-flow-edge", what: "PB Release", theme: "flow", team: "PB", devices: DESKTOP, browsers: ["edge"], users: ["service"] },
  { id: "cyd-e3dc-mobile", what: "CD Release", theme: "e3dc", team: "CYD", devices: PHONE, browsers: [], users: ["owner"] },
  { id: "cyd-e3dc-chrome", what: "CD Release", theme: "e3dc", team: "CYD", devices: DESKTOP, browsers: ["chrome"], users: ["installer", "partner"] },
  { id: "cyd-e3dc-edge", what: "CD Release", theme: "e3dc", team: "CYD", devices: DESKTOP, browsers: ["edge"], users: ["service"] },
  { id: "cyd-flow-mobile", what: "CD Release", theme: "flow", team: "CYD", devices: PHONE, browsers: [], users: ["owner"] },
  { id: "cyd-flow-firefox", what: "CD Release", theme: "flow", team: "CYD", devices: DESKTOP, browsers: ["firefox"], users: ["installer"] },
  { id: "cyd-flow-edge", what: "CD Release", theme: "flow", team: "CYD", devices: DESKTOP, browsers: ["edge"], users: ["service"] }
];

const copyTask = (t) => ({ ...t, devices: [...t.devices], browsers: [...t.browsers], users: [...t.users] });

/** The 22 default tasks, deep-frozen so nothing can change them by accident. */
export const DEFAULT_TASKS = Object.freeze(TASKS.map((t) => {
  const c = copyTask(t);
  Object.freeze(c.devices); Object.freeze(c.browsers); Object.freeze(c.users);
  return Object.freeze(c);
}));

/** A fresh, editable copy of the defaults (what a new room starts with). */
export function defaultTasks() {
  return DEFAULT_TASKS.map(copyTask);
}
