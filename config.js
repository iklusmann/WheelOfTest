/** Product configuration shared by pure domain logic and the UI. */
export const APP_NAME = "WheelOfTest";
export const PROTOCOL_VERSION = 1;
export const SCHEMA_VERSION = 1;

export const TEAMS = Object.freeze(["AF", "CYD", "PB"]);

/** Source task labels are intentionally preserved; CYD is the owning team. */
export const TEAM_RELEASE_MAPPING = Object.freeze({
  "AF Release": "AF",
  "PB Release": "PB",
  "CD Release": "CYD"
});

export const ROOM_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const ROOM_CODE_LENGTH = 6;
export const MAX_NAME_LENGTH = 40;
export const MAX_SIGNALING_CODE_LENGTH = 200 * 1024;
export const MAX_DATA_MESSAGE_BYTES = 64 * 1024;
export const MAX_PROFILE_ID_LENGTH = 80;
/** Keeps complete room snapshots comfortably below the 64 KiB protocol message limit. */
export const MAX_ROOM_PARTICIPANTS = 100;
export const OFFER_TTL_MS = 10 * 60 * 1000;
export const ICE_GATHERING_TIMEOUT_MS = 15_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_STALE_MS = 18_000;
export const PEER_CONNECT_TIMEOUT_MS = 30_000;
export const STORAGE_PREFIX = "wheelOfTest:room:";
export const PROFILE_STORAGE_KEY = "wheelOfTest:guestProfile:v1";

export const USER_TYPES = Object.freeze(["owner", "installer", "partner", "service"]);
export const TASK_PLATFORMS = Object.freeze(["desktop", "mobile"]);
export const TASK_DEVICES = Object.freeze(["edge", "firefox", "mobile", "chrome"]);

export function preferredTeamForTask(task) {
  if (!task) return null;
  if (Object.prototype.hasOwnProperty.call(TEAM_RELEASE_MAPPING, task.what)) return TEAM_RELEASE_MAPPING[task.what];
  return task.team || null;
}
