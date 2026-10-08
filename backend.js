// Supabase client, anonymous sign-in, RPC calls, realtime + presence.
// The supabase-js UMD bundle (pinned in index.html) exposes `window.supabase`.

import { CONFIG, isConfigured } from "./config.js";

export class BackendError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "BackendError";
    this.code = code;
  }
}

let client = null;

function getClient() {
  if (client) return client;
  if (!isConfigured()) throw new BackendError("Supabase is not configured.", "not_configured");
  const lib = globalThis.supabase;
  if (!lib || typeof lib.createClient !== "function") {
    throw new BackendError("Could not load the Supabase library. Check your connection and reload the page.", "sdk_missing");
  }
  client = lib.createClient(CONFIG.supabaseUrl.trim(), CONFIG.supabasePublishableKey.trim(), {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  return client;
}

function toBackendError(error, fallbackCode) {
  if (error instanceof BackendError) return error;
  const message = String(error?.message ?? "");
  if (error?.name === "AuthRetryableFetchError" || /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(message)) {
    return new BackendError("Can't reach the server. Check your connection and try again.", "network");
  }
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return new BackendError("Anonymous sign-ins are disabled for this Supabase project. Enable them in the Supabase dashboard (see README).", "anonymous_disabled");
  }
  if (error?.code === "PGRST202") {
    return new BackendError("The database functions are missing. Run supabase/schema.sql in the Supabase SQL editor.", "schema_missing");
  }
  return new BackendError(message || "Something went wrong. Please try again.", error?.hint || error?.code || fallbackCode);
}

// ------------------------------------------------------------------ auth

/** Returns the current user id, signing in anonymously (silently) if needed. */
export async function ensureSession() {
  const sb = getClient();
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session?.user?.id) return data.session.user.id;
    const { data: signedIn, error } = await sb.auth.signInAnonymously();
    if (error || !signedIn?.user?.id) throw error ?? new Error("Sign-in returned no user.");
    return signedIn.user.id;
  } catch (error) {
    throw toBackendError(error, "sign_in_failed");
  }
}

// ------------------------------------------------------------------ RPCs

async function rpc(fn, args) {
  const sb = getClient();
  let result;
  try {
    result = await sb.rpc(fn, args);
  } catch (error) {
    throw toBackendError(error, "network");
  }
  if (result.error) throw toBackendError(result.error, "rpc_failed");
  return result.data;
}

export const createRoom = (profile, tasks) => rpc("create_room", { p_profile: profile, p_tasks: tasks });
export const joinRoom = (code, profile) => rpc("join_room", { p_code: code, p_profile: profile });
export const getRoom = (code) => rpc("get_room", { p_code: code });
export const commitSpin = (roomId, spinNumber, assignments) =>
  rpc("commit_spin", { p_room_id: roomId, p_spin_number: spinNumber, p_assignments: assignments });
export const complain = (roomId) => rpc("complain", { p_room_id: roomId });

// ------------------------------------------------------------------ realtime

/**
 * One channel per room: Postgres changes on the room row + Presence keyed by user id.
 * onChange()             — the room row changed; re-fetch the snapshot.
 * onPresence(Set<id>)    — who is online right now.
 * onStatus("subscribed" | "reconnecting", detail?)
 * realtime-js rejoins by itself after errors and timeouts; an unexpected CLOSED is
 * handled here by opening a fresh channel with backoff.
 */
export function subscribeRoom({ roomId, userId, onChange, onPresence, onStatus }) {
  const sb = getClient();
  let channel = null;
  let stopped = false;
  let reopenTimer = null;
  let reopenDelay = 1000;

  const open = () => {
    const current = sb.channel(`room:${roomId}`, {
      config: {
        presence: { key: userId },
        // Hold SUBSCRIBED until the server confirms postgres_changes is streaming, so the
        // re-fetch we do on SUBSCRIBED cannot miss a change committed in between.
        postgres_changes_options: { wait: true }
      }
    });
    channel = current;
    current
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, () => {
        if (!stopped && channel === current) onChange();
      })
      .on("presence", { event: "sync" }, () => {
        if (!stopped && channel === current) onPresence(new Set(Object.keys(current.presenceState())));
      })
      .subscribe(async (status, error) => {
        if (stopped || channel !== current) return;
        if (status === "SUBSCRIBED") {
          reopenDelay = 1000;
          onStatus("subscribed");
          try {
            await current.track({ user_id: userId, online_at: new Date().toISOString() });
          } catch (trackError) {
            console.warn("[WheelOfTest] presence track failed", trackError);
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (error) console.warn(`[WheelOfTest] realtime ${status}`, error);
          onStatus("reconnecting", error?.message);
        } else if (status === "CLOSED") {
          onStatus("reconnecting");
          scheduleReopen();
        }
      });
  };

  const scheduleReopen = (delay = reopenDelay) => {
    clearTimeout(reopenTimer);
    reopenTimer = setTimeout(async () => {
      if (stopped) return;
      const old = channel;
      channel = null;
      if (old) {
        try { await sb.removeChannel(old); } catch { /* already gone */ }
      }
      if (!stopped) open();
    }, delay);
    reopenDelay = Math.min(reopenDelay * 2, 30000);
  };

  open();

  return {
    /** Tear the channel down and join again (e.g. after the device comes back online). */
    reconnect() {
      if (stopped) return;
      reopenDelay = 1000;
      scheduleReopen(0);
    },
    async unsubscribe() {
      stopped = true;
      clearTimeout(reopenTimer);
      const old = channel;
      channel = null;
      if (old) {
        try { await sb.removeChannel(old); } catch { /* ignore */ }
      }
    }
  };
}
