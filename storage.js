/** Versioned browser persistence. This repository never stores WebRTC or live-connection objects. */
import { PROFILE_STORAGE_KEY, SCHEMA_VERSION, STORAGE_PREFIX } from "./config.js";
import { validateProfile, validateRoomState } from "./domain.js";

function getBrowserStorage() {
  try {
    return globalThis.localStorage;
  } catch (error) {
    throw new Error(`Browser storage is unavailable: ${error?.message || "access denied"}`);
  }
}

function roomKey(roomCode) {
  return `${STORAGE_PREFIX}${roomCode}`;
}

function safeParse(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} contains invalid JSON. It was not loaded.`);
  }
}

function normalizeLegacyRoom(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Saved room must be a JSON object.");
  }
  const migrated = { ...candidate };
  if (migrated.schemaVersion == null || migrated.schemaVersion === 0) {
    migrated.schemaVersion = SCHEMA_VERSION;
    migrated.maxSpins = 2;
    migrated.stateVersion = Number.isInteger(migrated.stateVersion) ? migrated.stateVersion : 0;
    migrated.createdAt = Number.isFinite(migrated.createdAt) ? migrated.createdAt : Date.now();
    migrated.updatedAt = Number.isFinite(migrated.updatedAt) ? migrated.updatedAt : migrated.createdAt;
    migrated.participants = Array.isArray(migrated.participants) ? migrated.participants : [];
    migrated.assignments = Array.isArray(migrated.assignments) ? migrated.assignments : [];
    migrated.usedTaskIds = Array.isArray(migrated.usedTaskIds) ? migrated.usedTaskIds : [];
    migrated.complaints = Array.isArray(migrated.complaints) ? migrated.complaints : [];
  }
  let removedConnectionFlags = false;
  if (Array.isArray(migrated.participants)) {
    migrated.participants = migrated.participants.map((participant) => {
      if (!participant || typeof participant !== "object") return participant;
      const volatileFields = ["connected", "connectedAt", "connectionState", "connectionId", "lastHeartbeatAt", "channelReadyState"];
      if (volatileFields.some((field) => Object.prototype.hasOwnProperty.call(participant, field))) removedConnectionFlags = true;
      const {
        connected,
        connectedAt,
        connectionState,
        connectionId,
        lastHeartbeatAt,
        channelReadyState,
        ...profile
      } = participant;
      return profile;
    });
  }
  return { state: migrated, migrated: candidate.schemaVersion !== SCHEMA_VERSION, removedConnectionFlags };
}

export function createStorageRepository(storageProvider = getBrowserStorage) {
  function withStorage(action) {
    let storage;
    try {
      storage = storageProvider();
      if (!storage) throw new Error("Browser storage is unavailable.");
      return action(storage);
    } catch (error) {
      throw new Error(error?.message || "Browser storage operation failed.");
    }
  }

  return {
    saveRoomState(room) {
      const validation = validateRoomState(room);
      if (!validation.ok) throw new Error(`Refusing to save invalid room state: ${validation.errors[0]}`);
      const serialized = JSON.stringify(room);
      withStorage((storage) => storage.setItem(roomKey(room.roomCode), serialized));
      return true;
    },

    loadRoomState(roomCode) {
      try {
        return withStorage((storage) => {
          const raw = storage.getItem(roomKey(roomCode));
          if (raw == null) return { state: null, error: null, warning: null };
          const parsed = safeParse(raw, "Saved room");
          const normalized = normalizeLegacyRoom(parsed);
          const validation = validateRoomState(normalized.state);
          if (!validation.ok) return { state: null, error: `Saved room failed validation: ${validation.errors[0]}`, warning: null };
          let warning = null;
          if (normalized.migrated || normalized.removedConnectionFlags) {
            try {
              storage.setItem(roomKey(roomCode), JSON.stringify(normalized.state));
            } catch {
              warning = "The recovered room was normalized in memory, but the cleaned version could not be written back to storage.";
            }
          }
          return { state: normalized.state, error: null, warning };
        });
      } catch (error) {
        return { state: null, error: error.message, warning: null };
      }
    },

    listRooms() {
      try {
        return withStorage((storage) => {
          const keys = [];
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (typeof key === "string" && key.startsWith(STORAGE_PREFIX)) keys.push(key);
          }
          const rooms = [];
          const warnings = [];
          for (const key of keys) {
            const code = key.slice(STORAGE_PREFIX.length);
            const loaded = this.loadRoomState(code);
            if (loaded.state) rooms.push(loaded.state);
            else if (loaded.error) warnings.push(`${code}: ${loaded.error}`);
          }
          rooms.sort((a, b) => b.updatedAt - a.updatedAt);
          return { rooms, warnings, error: null };
        });
      } catch (error) {
        return { rooms: [], warnings: [], error: error.message };
      }
    },

    hasRoomCode(roomCode) {
      return withStorage((storage) => storage.getItem(roomKey(roomCode)) !== null);
    },

    saveGuestProfile(profileInput) {
      const checked = validateProfile(profileInput);
      if (!checked.ok) throw new Error(checked.error);
      withStorage((storage) => storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(checked.profile)));
      return checked.profile;
    },

    loadGuestProfile() {
      try {
        return withStorage((storage) => {
          const raw = storage.getItem(PROFILE_STORAGE_KEY);
          if (raw == null) return { profile: null, error: null };
          const parsed = safeParse(raw, "Saved guest profile");
          const checked = validateProfile(parsed);
          if (!checked.ok) return { profile: null, error: checked.error };
          return { profile: checked.profile, error: null };
        });
      } catch (error) {
        return { profile: null, error: error.message };
      }
    },

    /** Retry hook used to re-enable committed state transitions after a quota/storage failure. */
    verifyWritable(room) {
      return withStorage((storage) => {
        if (room) {
          const validation = validateRoomState(room);
          if (!validation.ok) throw new Error(validation.errors[0]);
          storage.setItem(roomKey(room.roomCode), JSON.stringify(room));
        } else {
          const probe = `wheelOfTest:probe:${Date.now()}`;
          storage.setItem(probe, "1");
          storage.removeItem(probe);
        }
        return true;
      });
    }
  };
}

export function migrateRoomData(candidate) {
  return normalizeLegacyRoom(candidate);
}
