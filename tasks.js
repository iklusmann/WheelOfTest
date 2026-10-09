/** Immutable, exact task catalog. No rendering, storage, or network code belongs here. */
export const TASKS = Object.freeze([
  { id: "cuf-e3dc-edge", what: "Critical User Flows", theme: "e3dc", device: "edge", platform: "desktop", team: null, users: ["owner", "installer", "partner", "service"] },
  { id: "cuf-flow-firefox", what: "Critical User Flows", theme: "flow", device: "firefox", platform: "desktop", team: null, users: ["owner", "installer", "service"] },
  { id: "cuf-e3dc-mobile", what: "Critical User Flows", theme: "e3dc", device: "mobile", platform: "mobile", team: null, users: ["owner", "installer", "partner", "service"] },
  { id: "cuf-flow-mobile", what: "Critical User Flows", theme: "flow", device: "mobile", platform: "mobile", team: null, users: ["owner", "installer", "service"] },
  { id: "af-e3dc-mobile", what: "AF Release", theme: "e3dc", device: "mobile", platform: "mobile", team: "AF", users: ["owner"] },
  { id: "af-e3dc-chrome", what: "AF Release", theme: "e3dc", device: "chrome", platform: "desktop", team: "AF", users: ["installer", "partner"] },
  { id: "af-e3dc-edge", what: "AF Release", theme: "e3dc", device: "edge", platform: "desktop", team: "AF", users: ["service"] },
  { id: "af-flow-mobile", what: "AF Release", theme: "flow", device: "mobile", platform: "mobile", team: "AF", users: ["owner"] },
  { id: "af-flow-firefox", what: "AF Release", theme: "flow", device: "firefox", platform: "desktop", team: "AF", users: ["installer"] },
  { id: "af-flow-edge", what: "AF Release", theme: "flow", device: "edge", platform: "desktop", team: "AF", users: ["service"] },
  { id: "pb-e3dc-mobile", what: "PB Release", theme: "e3dc", device: "mobile", platform: "mobile", team: "PB", users: ["owner"] },
  { id: "pb-e3dc-chrome", what: "PB Release", theme: "e3dc", device: "chrome", platform: "desktop", team: "PB", users: ["installer", "partner"] },
  { id: "pb-e3dc-edge", what: "PB Release", theme: "e3dc", device: "edge", platform: "desktop", team: "PB", users: ["service"] },
  { id: "pb-flow-mobile", what: "PB Release", theme: "flow", device: "mobile", platform: "mobile", team: "PB", users: ["owner"] },
  { id: "pb-flow-firefox", what: "PB Release", device: "firefox", theme: "flow", platform: "desktop", team: "PB", users: ["installer"] },
  { id: "pb-flow-edge", what: "PB Release", theme: "flow", device: "edge", platform: "desktop", team: "PB", users: ["service"] },
  { id: "cyd-e3dc-mobile", what: "CD Release", theme: "e3dc", device: "mobile", platform: "mobile", team: "CYD", users: ["owner"] },
  { id: "cyd-e3dc-chrome", what: "CD Release", theme: "e3dc", device: "chrome", platform: "desktop", team: "CYD", users: ["installer", "partner"] },
  { id: "cyd-e3dc-edge", what: "CD Release", theme: "e3dc", device: "edge", platform: "desktop", team: "CYD", users: ["service"] },
  { id: "cyd-flow-mobile", what: "CD Release", theme: "flow", device: "mobile", platform: "mobile", team: "CYD", users: ["owner"] },
  { id: "cyd-flow-firefox", what: "CD Release", device: "firefox", theme: "flow", platform: "desktop", team: "CYD", users: ["installer"] },
  { id: "cyd-flow-edge", what: "CD Release", theme: "flow", device: "edge", platform: "desktop", team: "CYD", users: ["service"] }
].map((task) => Object.freeze({ ...task, users: Object.freeze([...task.users]) })));

export const TASK_BY_ID = new Map(TASKS.map((task) => [task.id, task]));
