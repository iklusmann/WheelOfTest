/** Application bootstrap/controller: coordinates domain, storage, transport, animation and safe UI rendering. */
import { APP_NAME, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./config.js";
import { TASKS } from "./tasks.js";
import {
  chooseEligiblePair,
  buildEligiblePairs,
  createRoomState,
  isValidRoomCode,
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
import { WebRTCPeerManager } from "./webrtc.js";
import { cancelWheel, revealCommittedResult } from "./wheel.js";
import { createUI } from "./ui.js";

const root = document.querySelector("#app");
const ui = createUI(root);
const storage = createStorageRepository();
const EMPTY_PROFILE = Object.freeze({ id: "", name: "", team: "AF", android: false, ios: false });

let screen = "landing";
let role = null;
let room = null;
let roomCode = null;
let hostProfile = null;
let guestProfile = null;
let guestSnapshot = null;
let guestSnapshotReceived = false;
let guestOnline = false;
let guestLiveParticipantIds = [];
let latestGuestSnapshotVersion = -1;
let guestTransportStatus = "";
let guestAnswerCode = "";
let guestOfferDraft = "";
let guestConnectionError = "";
let profileDraft = { ...EMPTY_PROFILE };
let hostDraft = { ...EMPTY_PROFILE };
let hostTesterEnabled = false;
let roomCodeDraft = "";
let error = "";
let notice = "";
let storageError = "";
let storageAvailable = true;
let storageWarnings = [];
let savedRoom = null;
let creatingRoom = false;
let creatingOffer = false;
let applyingAnswer = null;
let creatingAnswer = false;
let animationBusy = false;
let activeWheelElement = null;
let activeWheelCancel = null;
let signalingError = "";
let peerError = "";
let hub = null;
let livePoll = null;
let latestLivenessSignature = "";
let broadcastingSnapshot = false;
const acceptedByConnection = new Map();
const offers = [];
const answerDrafts = Object.create(null);
const peerStatuses = new Map();

const route = new URL(globalThis.location.href);
const initialRoomCode = route.searchParams.get("room");
const initialRole = route.searchParams.get("role");

function makeBrowserId(prefix = "p") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const bytes = new Uint8Array(ROOM_CODE_LENGTH);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    let code = "";
    for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
    if (!storage.hasRoomCode(code)) return code;
  }
  throw new Error("Could not generate a unique room code after 100 attempts. Check browser storage and try again.");
}

function setRoute(code, nextRole) {
  const url = new URL(globalThis.location.href);
  url.searchParams.set("room", code);
  url.searchParams.set("role", nextRole);
  globalThis.history.replaceState({}, "", url);
}

function clearRoute() {
  const url = new URL(globalThis.location.href);
  url.searchParams.delete("room");
  url.searchParams.delete("role");
  globalThis.history.replaceState({}, "", url);
}

function buildInviteUrl(code) {
  const url = new URL(globalThis.location.href);
  url.searchParams.set("room", code);
  url.searchParams.set("role", "guest");
  return url.href;
}

function resetMessages() {
  error = "";
  notice = "";
  storageError = "";
  signalingError = "";
  peerError = "";
}

function listSavedRooms() {
  const result = storage.listRooms();
  storageWarnings = result.warnings || [];
  if (result.error) {
    storageAvailable = false;
    storageError = result.error;
    savedRoom = null;
  } else {
    savedRoom = result.rooms[0] || null;
  }
}

function currentLiveProfiles() {
  if (!room || role !== "host") return [];
  const live = [];
  for (const participant of room.participants) {
    if (participant.hostTester) {
      live.push({ ...participant, connected: true });
      continue;
    }
    for (const [connectionId, participantId] of acceptedByConnection.entries()) {
      if (participantId === participant.id && hub?.isConnectionLive(connectionId)) {
        live.push({ ...participant, connected: true });
        break;
      }
    }
  }
  return live;
}

function currentLiveParticipantIds() {
  return currentLiveProfiles().map((participant) => participant.id).sort();
}

function livenessSignature() {
  return currentLiveParticipantIds().join("|");
}

function renderModel() {
  if (screen === "landing") {
    return {
      screen,
      hostDraft,
      hostTesterEnabled,
      roomCodeDraft,
      savedRoom,
      storageWarnings,
      storageAvailable,
      storageError,
      creatingRoom,
      error,
      notice
    };
  }
  if (role === "guest" && (!guestSnapshotReceived || !room)) {
    return {
      screen,
      role,
      roomCode,
      room: room ? { roomCode: room.roomCode } : null,
      profileDraft,
      guestOfferDraft,
      guestAnswerCode,
      guestConnectionError: guestConnectionError || peerError,
      guestTransportStatus,
      creatingAnswer,
      guestOnline,
      inviteUrl: buildInviteUrl(roomCode),
      error,
      storageAvailable,
      warning: "Direct connectivity is best-effort without STUN/TURN. A fresh host snapshot is required after reconnecting."
    };
  }

  const effectiveRoom = room || guestSnapshot;
  const liveProfiles = role === "host" ? currentLiveProfiles() : (guestOnline && effectiveRoom
    ? effectiveRoom.participants.filter((participant) => guestLiveParticipantIds.includes(participant.id)).map((participant) => ({ ...participant, connected: true }))
    : []);
  const liveIds = new Set(liveProfiles.map((profile) => profile.id));
  const participantRows = (effectiveRoom?.participants || []).map((profile) => {
    const live = role === "host" ? liveIds.has(profile.id) : (guestOnline && guestLiveParticipantIds.includes(profile.id));
    return {
      profile,
      isHost: Boolean(profile.hostTester),
      stateLabel: live ? (profile.hostTester ? "Local tester" : "Connected live") : (role === "guest" && !guestOnline ? "Not live" : "Disconnected"),
      tone: live ? "success" : "neutral"
    };
  });
  const peerDiagnostics = role === "host" ? (hub?.getPeerInfo() || []).map((peer) => ({ ...peer })) : [];
  const offerRows = offers.map((offer) => {
    const peer = peerDiagnostics.find((entry) => entry.connectionId === offer.connectionId);
    const state = offer.state || (offer.answerApplied ? "answer-applied" : "offer-ready");
    let tone = "neutral";
    let stateLabel = "Pending";
    if (peer?.live) { tone = "success"; stateLabel = "Connected"; }
    else if (offer.closed || ["failed", "timeout", "heartbeat-stale", "channel-closed"].includes(state)) { tone = "danger"; stateLabel = "Offline"; }
    else if (offer.answerApplied) { tone = "warning"; stateLabel = "Connecting"; }
    else if (state === "offer-ready") { tone = "gold"; stateLabel = "Awaiting answer"; }
    return { ...offer, stateLabel, tone, statusLabel: peer?.profileAccepted ? `Profile accepted${peer.participantId ? ` · ${peer.participantId.slice(0, 8)}` : ""}` : offer.answerApplied ? "Answer applied · awaiting profile" : "Waiting for guest answer", answerApplied: Boolean(offer.answerApplied), closed: Boolean(offer.closed) };
  });
  const remainingTaskCount = TASKS.filter((task) => !effectiveRoom?.usedTaskIds.includes(task.id)).length;
  const livePairs = role === "host" ? buildEligiblePairs(effectiveRoom, liveProfiles) : buildEligiblePairs(effectiveRoom, liveProfiles);
  const pairResult = role === "host" ? chooseEligiblePair(effectiveRoom, liveProfiles) : { ok: true };
  const blocker = role === "host" && !pairResult.ok ? pairResult.error : null;
  let myParticipantId = null;
  let isMyParticipantLive = false;
  if (role === "host" && hostProfile) {
    myParticipantId = hostProfile.id;
    isMyParticipantLive = currentLiveProfiles().some((profile) => profile.id === hostProfile.id);
  } else if (role === "guest" && guestProfile) {
    myParticipantId = guestProfile.id;
    isMyParticipantLive = guestOnline && liveIds.has(guestProfile.id);
  }
  return {
    screen,
    role,
    room: effectiveRoom,
    roomCode: effectiveRoom?.roomCode || roomCode,
    inviteUrl: effectiveRoom ? buildInviteUrl(effectiveRoom.roomCode) : "",
    participantRows,
    liveCount: liveIds.size,
    liveParticipantIds: [...liveIds],
    pairCount: role === "host" ? livePairs.length : livePairs.length,
    preferredPairCount: pairResult.preferredPairs || 0,
    remainingTaskCount,
    blocker,
    replacementAvailable: effectiveRoom?.status === "challenged" && pairResult.ok,
    storageAvailable,
    storageError,
    error: error || peerError,
    notice,
    warning: "Offer and answer codes are not authentication. The host is authoritative only while its browser and peer connection remain active.",
    animationBusy,
    hostProfile,
    myParticipantId,
    isMyParticipantLive,
    peerDiagnostics,
    offers: offerRows,
    answerDrafts,
    creatingOffer,
    applyingAnswer,
    signalingError,
    guestOnline,
    guestHistorical: role === "guest" && !guestOnline,
    guestSnapshotReceived,
    guestLiveParticipantIds,
    guestTransportStatus,
    profileDraft,
    guestOfferDraft,
    guestAnswerCode,
    guestConnectionError,
    creatingAnswer
  };
}

function cancelActiveReveal(reason = "cancelled") {
  const wheelElement = activeWheelElement;
  const cancel = activeWheelCancel;
  activeWheelElement = null;
  activeWheelCancel = null;
  if (cancel) cancel();
  else if (wheelElement) cancelWheel(wheelElement, reason);
}

function render() {
  // createUI replaces the rendered tree; cancel the reveal on the old wheel before it detaches.
  if (activeWheelElement) {
    cancelActiveReveal("ui-rerender");
    return;
  }
  ui.render(renderModel(), actions);
}

function commitState(candidate, { assignmentToReveal = null } = {}) {
  if (!room || role !== "host") return false;
  if (!storageAvailable) {
    error = "State-changing actions are paused. Retry browser storage before trying again.";
    render();
    return false;
  }
  const validation = validateRoomState(candidate);
  if (!validation.ok) {
    error = `The proposed room update was rejected: ${validation.errors[0]}`;
    render();
    return false;
  }
  try {
    storage.saveRoomState(candidate);
  } catch (failure) {
    storageAvailable = false;
    storageError = failure.message || "Could not persist room state.";
    error = "The update was not committed because it could not be saved. The previous committed state remains active.";
    render();
    return false;
  }
  room = candidate;
  storageAvailable = true;
  storageError = "";
  error = "";
  notice = "Room update saved.";
  broadcastSnapshot();
  latestLivenessSignature = livenessSignature();
  if (assignmentToReveal) {
    animationBusy = true;
    render();
    requestAnimationFrame(() => {
      const wheel = root.querySelector(".reveal-wheel");
      if (!wheel) {
        animationBusy = false;
        render();
        return;
      }
      activeWheelElement = wheel;
      const cancel = revealCommittedResult(wheel, assignmentToReveal, {
        duration: 4800,
        onComplete: () => {
          activeWheelElement = null;
          activeWheelCancel = null;
          animationBusy = false;
          render();
        }
      });
      // Reduced-motion completion may run synchronously before the cancellation handle is returned.
      if (activeWheelElement === wheel) activeWheelCancel = cancel;
    });
  } else {
    render();
  }
  return true;
}

function buildSnapshot() {
  return {
    room,
    liveParticipantIds: currentLiveParticipantIds(),
    hostOnline: true,
    sentAt: Date.now()
  };
}

function broadcastSnapshot() {
  if (role !== "host" || !hub || !room || broadcastingSnapshot) return;
  broadcastingSnapshot = true;
  try {
    const result = hub.broadcast("snapshot", buildSnapshot());
    let failed = false;
    for (const peer of result) {
      if (!peer.sent) {
        failed = true;
        hub.closePeer(peer.connectionId, "send-failed");
        acceptedByConnection.delete(peer.connectionId);
      }
    }
    if (failed) {
      const updated = hub.broadcast("snapshot", buildSnapshot());
      for (const peer of updated) {
        if (!peer.sent) {
          hub.closePeer(peer.connectionId, "send-failed");
          acceptedByConnection.delete(peer.connectionId);
        }
      }
    }
    latestLivenessSignature = livenessSignature();
  } finally {
    broadcastingSnapshot = false;
  }
}

function commitDomainResult(result, options = {}) {
  if (!result?.ok) {
    error = result?.error || "The requested transition was rejected.";
    notice = "";
    render();
    return false;
  }
  return commitState(result.state, { assignmentToReveal: options.assignmentToReveal || null });
}

function currentPairStillValid(pair) {
  if (!room || !pair || room.usedTaskIds.includes(pair.task.id)) return false;
  const nowConnected = currentLiveProfiles();
  return buildEligiblePairs(room, nowConnected).some((candidate) => candidate.task.id === pair.task.id && candidate.developer.id === pair.developer.id);
}

function spin1() {
  if (role !== "host" || !room || animationBusy || !storageAvailable) return;
  const selected = chooseEligiblePair(room, currentLiveProfiles());
  if (!selected.ok) { error = selected.error; render(); return; }
  if (!currentPairStillValid(selected.pair)) { error = "The selected participant disconnected or the task became unavailable. Check the live roster and try again."; render(); return; }
  const result = transitionSpin1(room, selected.pair, Date.now());
  commitDomainResult(result, { assignmentToReveal: result.assignment });
}

function spin2() {
  if (role !== "host" || !room || animationBusy || !storageAvailable) return;
  const selected = chooseEligiblePair(room, currentLiveProfiles());
  if (!selected.ok) {
    error = selected.error;
    notice = "Spin 2 was not consumed. Reconnect or add an eligible participant and retry, or explicitly accept the original result.";
    render();
    return;
  }
  if (!currentPairStillValid(selected.pair)) {
    error = "The selected participant disconnected or the task became unavailable. Spin 2 remains available.";
    render();
    return;
  }
  const result = transitionSpin2(room, selected.pair, Date.now());
  commitDomainResult(result, { assignmentToReveal: result.assignment });
}

function acceptResult() {
  if (role !== "host" || !room || animationBusy || !storageAvailable) return;
  commitDomainResult(transitionAcceptResult(room, {}, Date.now()));
}

function acceptOriginalResult() {
  if (role !== "host" || !room || animationBusy || !storageAvailable || room.status !== "challenged") return;
  const message = `A complaint was filed by ${room.complaints.map((entry) => entry.participantName).join(", ")}. No compatible replacement pair is available right now. Accept the original Spin 1 assignment as final? The complaint will remain in the audit trail.`;
  if (!globalThis.confirm(message)) return;
  commitDomainResult(transitionAcceptResult(room, { overrideComplaint: true }, Date.now()));
}

function submitComplaint(participantId) {
  if (!participantId || !room || room.status === "completed") return;
  if (role === "host") {
    if (!hostProfile || hostProfile.id !== participantId) return;
    if (!currentLiveProfiles().some((profile) => profile.id === participantId)) {
      error = "The host tester profile is not currently eligible.";
      render();
      return;
    }
    commitDomainResult(transitionComplaint(room, participantId, Date.now()));
    return;
  }
  if (role === "guest") {
    if (!guestOnline || !hub || !hub.isConnectionLive([...hub.peers.keys()][0])) {
      error = "Reconnect to the host before filing a complaint.";
      render();
      return;
    }
    const sent = hub.sendTo([...hub.peers.keys()][0], "complaint", {});
    if (!sent) {
      error = "The complaint could not be sent. The host connection may have closed; reconnect and try again.";
      guestOnline = false;
      guestSnapshotReceived = false;
    } else {
      notice = "Complaint request sent to the host. It is recorded only after the host validates and confirms it.";
      error = "";
    }
    render();
  }
}

function createHostTransport() {
  hub?.destroy();
  acceptedByConnection.clear();
  peerStatuses.clear();
  hub = new WebRTCPeerManager({
    roomCode: room.roomCode,
    role: "host",
    onMessage: handleHostMessage,
    onPeerStatus: handlePeerStatus,
    onError: handlePeerError
  });
  latestLivenessSignature = livenessSignature();
  startLivenessPoll();
}

function createGuestTransport() {
  hub?.destroy();
  hub = new WebRTCPeerManager({
    roomCode,
    role: "guest",
    onMessage: handleGuestMessage,
    onPeerStatus: handlePeerStatus,
    onError: handlePeerError
  });
}

function closeHostConnection(connectionId, reason = "closed-by-user") {
  acceptedByConnection.delete(connectionId);
  hub?.closePeer(connectionId, reason);
  refreshHostLiveness(true);
}

function handleHostMessage({ connectionId, message }) {
  if (role !== "host" || !hub || !room) return;
  if (message.type === "profile") {
    acceptGuestProfile(connectionId, message.payload);
    return;
  }
  if (message.type === "complaint") {
    const participantId = acceptedByConnection.get(connectionId);
    if (!participantId || !hub.isConnectionLive(connectionId)) {
      hub.sendTo(connectionId, "error", { message: "Only your currently connected, accepted profile may complain." });
      return;
    }
    const result = transitionComplaint(room, participantId, Date.now());
    if (!result.ok) {
      hub.sendTo(connectionId, "error", { message: result.error });
      return;
    }
    commitDomainResult(result);
    if (room?.complaints.some((complaint) => complaint.participantId === participantId)) {
      hub.sendTo(connectionId, "ack", { kind: "complaint", accepted: true, stateVersion: room.stateVersion });
    }
  }
}

function acceptGuestProfile(connectionId, profile) {
  if (!hub || !room) return;
  const currentPeer = hub.getPeerInfo().find((peer) => peer.connectionId === connectionId);
  if (!currentPeer || !hub.isTransportLive(connectionId)) {
    hub.sendTo(connectionId, "error", { message: "The data channel is not live. Reconnect with a fresh offer/answer pair." });
    return;
  }
  const duplicate = [...acceptedByConnection.entries()].find(([otherConnectionId, participantId]) => participantId === profile.id && otherConnectionId !== connectionId && hub.isConnectionLive(otherConnectionId));
  if (duplicate) {
    hub.sendTo(connectionId, "error", { message: "This profile ID is already connected in another active session. Disconnect that session first." });
    closeHostConnection(connectionId, "duplicate-profile-rejected");
    return;
  }
  const stalePrevious = [...acceptedByConnection.entries()].find(([otherConnectionId, participantId]) => participantId === profile.id && otherConnectionId !== connectionId);
  const alreadyRegistered = room.participants.some((participant) => participant.id === profile.id);
  const reclaimedIdentity = Boolean(stalePrevious || alreadyRegistered);
  if (stalePrevious) {
    acceptedByConnection.delete(stalePrevious[0]);
    hub.closePeer(stalePrevious[0], "identity-reclaimed");
    notice = `${profile.name}'s disconnected browser identity was reclaimed. This tool does not strongly authenticate browser identities.`;
  }
  const result = transitionUpsertParticipant(room, profile, Date.now());
  if (!result.ok) {
    hub.sendTo(connectionId, "error", { message: result.error });
    return;
  }
  if (result.changed && !commitState(result.state)) {
    hub.sendTo(connectionId, "error", { message: "The host could not persist your profile. The profile was not accepted; ask the host to retry browser storage." });
    return;
  }
  try {
    hub.markProfileAccepted(connectionId, profile.id);
  } catch (failure) {
    peerError = failure.message;
    render();
    return;
  }
  acceptedByConnection.set(connectionId, profile.id);
  hub.sendTo(connectionId, "ack", { kind: "profile", accepted: true, participantId: profile.id, stateVersion: room.stateVersion });
  broadcastSnapshot();
  latestLivenessSignature = livenessSignature();
  notice = reclaimedIdentity
    ? `${profile.name} reconnected by reclaiming a disconnected browser identity. Browser identities are not strongly authenticated.`
    : `${profile.name} connected with ${profile.team}.`;
  render();
}

function handleGuestMessage({ connectionId, message }) {
  if (role !== "guest" || !hub) return;
  if (message.type === "snapshot") {
    const snapshot = message.payload;
    if (!snapshot || typeof snapshot !== "object" || !snapshot.room) {
      peerError = "The host sent an incomplete room snapshot.";
      render();
      return;
    }
    const validation = validateRoomState(snapshot.room);
    if (!validation.ok || snapshot.room.roomCode !== roomCode) {
      peerError = `The host snapshot failed validation: ${validation.errors?.[0] || "wrong room"}`;
      render();
      return;
    }
    if (!Array.isArray(snapshot.liveParticipantIds) || snapshot.liveParticipantIds.some((id) => typeof id !== "string")) {
      peerError = "The host snapshot contains invalid participant liveness data.";
      render();
      return;
    }
    if (!isSnapshotVersionAcceptable(snapshot.room.stateVersion, latestGuestSnapshotVersion)) return;
    latestGuestSnapshotVersion = snapshot.room.stateVersion;
    guestSnapshot = snapshot.room;
    room = snapshot.room;
    guestLiveParticipantIds = snapshot.liveParticipantIds;
    guestSnapshotReceived = true;
    guestOnline = hub.isConnectionLive(connectionId);
    if (!guestOnline) guestLiveParticipantIds = [];
    guestTransportStatus = "Authoritative host snapshot received.";
    guestConnectionError = "";
    peerError = "";
    error = "";
    render();
    return;
  }
  if (message.type === "ack") {
    if (message.payload.kind === "profile" && message.payload.accepted === true) {
      guestTransportStatus = "Profile accepted by the host. Waiting for the first/current room snapshot…";
    } else if (message.payload.kind === "complaint" && message.payload.accepted === true) {
      notice = "The host confirmed your complaint.";
    }
    render();
    return;
  }
  if (message.type === "error") {
    guestConnectionError = typeof message.payload.message === "string" ? message.payload.message.slice(0, 400) : "The host rejected a protocol request.";
    error = guestConnectionError;
    render();
  }
}

function handlePeerStatus(detail) {
  const { connectionId, state } = detail;
  peerStatuses.set(connectionId, detail);
  const offer = offers.find((entry) => entry.connectionId === connectionId);
  if (offer) {
    offer.state = state;
    if (["closed-by-user", "offer-creation-failed", "answer-creation-failed", "send-failed", "duplicate-profile-rejected", "identity-reclaimed", "transport-destroyed"].includes(state) || state === "closed") offer.closed = true;
    if (state === "answer-applied") offer.answerApplied = true;
  }
  if (role === "host") {
    if (["channel-closed", "closed-by-user", "send-failed", "duplicate-profile-rejected", "identity-reclaimed", "transport-destroyed", "failed"].includes(state) || detail.connectionState === "closed") {
      acceptedByConnection.delete(connectionId);
    }
    refreshHostLiveness();
  } else if (role === "guest") {
    guestTransportStatus = peerStatusLabel(state);
    if (["channel-closed", "heartbeat-stale", "failed", "closed-by-user", "timeout", "transport-destroyed"].includes(state) || detail.connectionState === "closed") {
      guestOnline = false;
      guestSnapshotReceived = false;
      guestLiveParticipantIds = [];
      guestConnectionError = "The host connection is no longer live. Exchange a fresh offer and answer to reconnect.";
    } else if (state === "channel-open") {
      guestConnectionError = "";
    }
    render();
  }
}

function peerStatusLabel(state) {
  const labels = {
    "creating-offer": "Creating the host offer…",
    "gathering-ice": "Gathering local ICE candidates…",
    "offer-ready": "Offer ready; send it to one guest.",
    "answer-ready": "Answer ready; return it to the host.",
    "applying-offer": "Applying the host offer…",
    "answer-applied": "Answer applied; waiting for guest profile…",
    "channel-open": "Data channel open; exchanging profile and snapshot…",
    "profile-accepted": "Profile accepted by the host.",
    "heartbeat-stale": "Heartbeat is stale; this connection is not eligible.",
    "channel-closed": "Data channel closed.",
    "failed": "Peer connection failed.",
    "timeout": "Connection timed out.",
    "connected": "Peer connected.",
    "disconnected": "Peer may be reconnecting.",
    "closed-by-user": "Connection closed."
  };
  return labels[state] || String(state || "Waiting for connection state…");
}

function handlePeerError({ connectionId, error: message }) {
  peerError = message || "Unexpected peer connection error.";
  const offer = offers.find((entry) => entry.connectionId === connectionId);
  if (offer) offer.lastError = peerError;
  if (role === "guest") guestConnectionError = peerError;
  render();
}

function refreshHostLiveness(force = false) {
  if (role !== "host" || !room) return;
  const signature = livenessSignature();
  if (force || signature !== latestLivenessSignature) {
    latestLivenessSignature = signature;
    if (!broadcastingSnapshot) broadcastSnapshot();
    render();
  }
}

function startLivenessPoll() {
  clearInterval(livePoll);
  livePoll = setInterval(() => refreshHostLiveness(), 2_000);
}

function stopTransport() {
  cancelActiveReveal("transport-stopped");
  clearInterval(livePoll);
  livePoll = null;
  if (hub) hub.destroy();
  hub = null;
  acceptedByConnection.clear();
  peerStatuses.clear();
  offers.splice(0, offers.length);
  for (const key of Object.keys(answerDrafts)) delete answerDrafts[key];
  creatingOffer = false;
  applyingAnswer = null;
}

async function startNewRoom() {
  resetMessages();
  if (!storageAvailable) {
    error = "Browser storage is not writable. Retry storage before creating a room.";
    render();
    return;
  }
  creatingRoom = true;
  render();
  try {
    const code = generateRoomCode();
    let tester = null;
    if (hostTesterEnabled) {
      const checked = validateProfile({ ...hostDraft, id: makeBrowserId("hostp"), hostTester: true }, { allowHostTester: true });
      if (!checked.ok) throw new Error(checked.error);
      tester = checked.profile;
    }
    const hostId = makeBrowserId("host");
    const candidate = createRoomState(code, hostId, tester, Date.now());
    storage.saveRoomState(candidate);
    stopTransport();
    room = candidate;
    roomCode = code;
    role = "host";
    screen = "room";
    hostProfile = tester;
    guestProfile = null;
    guestSnapshot = null;
    guestSnapshotReceived = false;
    guestOnline = false;
    guestLiveParticipantIds = [];
    latestGuestSnapshotVersion = -1;
    setRoute(code, "host");
    createHostTransport();
    notice = "New room created. Its initial state is saved; invitees still need a unique offer/answer exchange.";
    error = "";
    listSavedRooms();
  } catch (failure) {
    error = failure.message || "Could not create a room.";
    if (/storage|quota|writ|access denied/i.test(error)) {
      storageAvailable = false;
      storageError = error;
    }
  } finally {
    creatingRoom = false;
    render();
  }
}

function resumeRoom(code) {
  resetMessages();
  const loaded = storage.loadRoomState(code);
  if (!loaded.state) {
    error = loaded.error || "The saved room could not be found.";
    render();
    return;
  }
  stopTransport();
  room = loaded.state;
  roomCode = room.roomCode;
  role = "host";
  screen = "room";
  hostProfile = room.participants.find((participant) => participant.hostTester) || null;
  guestProfile = null;
  guestSnapshot = null;
  guestSnapshotReceived = false;
  guestOnline = false;
  guestLiveParticipantIds = [];
  latestGuestSnapshotVersion = -1;
  setRoute(roomCode, "host");
  createHostTransport();
  if (loaded.warning) storageError = loaded.warning;
  notice = "Room restored from this browser. All remote peers start disconnected and must reconnect with fresh codes.";
  error = "";
  latestLivenessSignature = livenessSignature();
  render();
}

function openGuestRoom(code) {
  if (!isValidRoomCode(code)) {
    error = "Enter a valid six-character room code.";
    render();
    return;
  }
  stopTransport();
  roomCode = code;
  role = "guest";
  screen = "room";
  room = null;
  guestSnapshot = null;
  guestSnapshotReceived = false;
  guestOnline = false;
  guestLiveParticipantIds = [];
  latestGuestSnapshotVersion = -1;
  guestAnswerCode = "";
  guestConnectionError = "";
  guestTransportStatus = "Paste the host offer to begin.";
  const restored = storage.loadGuestProfile();
  guestProfile = restored.profile || null;
  profileDraft = guestProfile ? { ...guestProfile } : { ...EMPTY_PROFILE };
  guestOfferDraft = "";
  setRoute(code, "guest");
  createGuestTransport();
  if (restored.error) storageError = restored.error;
  error = "";
  render();
}

async function createOffer() {
  if (role !== "host" || !hub || creatingOffer) return;
  creatingOffer = true;
  signalingError = "";
  peerError = "";
  render();
  try {
    const created = await hub.createHostOffer();
    offers.unshift({ connectionId: created.connectionId, code: created.code, createdAt: created.createdAt, state: "offer-ready", answerApplied: false, closed: false });
    answerDrafts[created.connectionId] = "";
    notice = "Offer created. Share it with exactly one intended guest, then paste that guest's matching answer in this row.";
  } catch (failure) {
    signalingError = failure.message || "Could not create a connection offer.";
  } finally {
    creatingOffer = false;
    render();
  }
}

async function applyAnswer(connectionId) {
  if (role !== "host" || !hub || applyingAnswer) return;
  const draft = answerDrafts[connectionId] || "";
  applyingAnswer = connectionId;
  signalingError = "";
  render();
  try {
    await hub.acceptHostAnswer(draft, connectionId);
    const offer = offers.find((entry) => entry.connectionId === connectionId);
    if (offer) {
      offer.answerApplied = true;
      offer.state = "answer-applied";
    }
    notice = "The answer was applied. The profile is accepted only after the data channel opens and the host persists it.";
  } catch (failure) {
    signalingError = failure.message || "Could not apply the answer.";
  } finally {
    applyingAnswer = null;
    render();
  }
}

async function connectGuest() {
  if (role !== "guest" || !hub || creatingAnswer) return;
  creatingAnswer = true;
  guestConnectionError = "";
  guestAnswerCode = "";
  guestOnline = false;
  guestSnapshotReceived = false;
  guestLiveParticipantIds = [];
  error = "";
  render();
  try {
    const candidate = {
      id: guestProfile?.id || makeBrowserId("guestp"),
      name: profileDraft.name,
      team: profileDraft.team,
      android: Boolean(profileDraft.android),
      ios: Boolean(profileDraft.ios)
    };
    const checked = validateProfile(candidate);
    if (!checked.ok) throw new Error(checked.error);
    guestProfile = checked.profile;
    profileDraft = { ...checked.profile };
    storage.saveGuestProfile(guestProfile);
    const answer = await hub.acceptGuestOffer(guestOfferDraft, guestProfile);
    guestAnswerCode = answer.code;
    guestTransportStatus = "Answer ready. Send it to the host's matching connection row and keep this page open.";
    guestConnectionError = "";
  } catch (failure) {
    guestConnectionError = failure.message || "Could not create an answer.";
    if (/storage|quota|writ|access denied/i.test(guestConnectionError)) storageAvailable = false;
  } finally {
    creatingAnswer = false;
    render();
  }
}

async function retryStorage() {
  try {
    storage.verifyWritable(role === "host" ? room : null);
    storageAvailable = true;
    storageError = "";
    error = "";
    notice = "Browser storage is writable again. State-changing actions are re-enabled.";
  } catch (failure) {
    storageAvailable = false;
    storageError = failure.message || "Browser storage is still unavailable.";
  }
  render();
}

async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      notice = "Copied to clipboard.";
      error = "";
      render();
      return true;
    }
  } catch { /* continue to selection fallback */ }
  const temporary = document.createElement("textarea");
  temporary.value = text;
  temporary.readOnly = true;
  temporary.style.position = "fixed";
  temporary.style.opacity = "0";
  temporary.style.pointerEvents = "none";
  document.body.append(temporary);
  temporary.focus();
  temporary.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch { copied = false; }
  temporary.remove();
  notice = copied ? "Copied to clipboard." : "Clipboard access failed. Select the visible code field and copy it manually.";
  error = "";
  render();
  return copied;
}

function goToDashboard({ confirmClose = true } = {}) {
  if (role === "host" && room && confirmClose && room.status !== "completed") {
    const accepted = globalThis.confirm("Leaving the room closes its live peer connections. The saved room and its history remain in this browser. Continue?");
    if (!accepted) return;
  }
  stopTransport();
  screen = "landing";
  role = null;
  room = null;
  roomCode = null;
  hostProfile = null;
  guestProfile = null;
  guestSnapshot = null;
  guestSnapshotReceived = false;
  guestOnline = false;
  clearRoute();
  resetMessages();
  listSavedRooms();
  render();
}

const actions = {
  onCreateRoom: () => startNewRoom(),
  onHostTesterToggle: (checked) => { hostTesterEnabled = checked; error = ""; render(); },
  onHostDraft: (key, value) => { hostDraft = { ...hostDraft, [key]: value }; },
  onRoomCodeDraft: (value) => { roomCodeDraft = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH); },
  onJoinRoom: () => openGuestRoom(roomCodeDraft.trim().toUpperCase()),
  onResumeRoom: (code) => resumeRoom(code),
  onRetryStorage: () => retryStorage(),
  onDashboard: () => goToDashboard(),
  onNewRoom: () => goToDashboard(),
  onCopyInvite: () => copyText(buildInviteUrl(room?.roomCode || roomCode)),
  onCreateOffer: () => createOffer(),
  onAnswerDraft: (connectionId, value) => { answerDrafts[connectionId] = value; },
  onApplyAnswer: (connectionId) => applyAnswer(connectionId),
  onCopyOffer: (connectionId) => {
    const offer = offers.find((entry) => entry.connectionId === connectionId);
    return copyText(offer?.code || "");
  },
  onClosePeer: (connectionId) => {
    closeHostConnection(connectionId, "closed-by-user");
    const offer = offers.find((entry) => entry.connectionId === connectionId);
    if (offer) offer.closed = true;
    render();
  },
  onSpin1: () => spin1(),
  onSpin2: () => spin2(),
  onAcceptResult: () => acceptResult(),
  onAcceptOriginal: () => acceptOriginalResult(),
  onComplain: () => submitComplaint(role === "host" ? hostProfile?.id : guestProfile?.id),
  onProfileDraft: (key, value) => { profileDraft = { ...profileDraft, [key]: value }; },
  onGuestOfferDraft: (value) => { guestOfferDraft = value; },
  onGuestConnect: () => connectGuest(),
  onCopyGuestAnswer: () => copyText(guestAnswerCode)
};

function bootstrap() {
  document.title = APP_NAME;
  try {
    storage.verifyWritable(null);
    storageAvailable = true;
  } catch (failure) {
    storageAvailable = false;
    storageError = failure.message || "Browser localStorage is not writable.";
  }
  const storedGuest = storage.loadGuestProfile();
  if (storedGuest.profile) {
    guestProfile = storedGuest.profile;
    profileDraft = { ...storedGuest.profile };
  }
  if (initialRole === "host" && initialRoomCode && isValidRoomCode(initialRoomCode)) {
    resumeRoom(initialRoomCode);
    return;
  }
  if (initialRole === "guest" && initialRoomCode && isValidRoomCode(initialRoomCode)) {
    openGuestRoom(initialRoomCode);
    return;
  }
  if (initialRoomCode && initialRole && !isValidRoomCode(initialRoomCode)) error = "The room code in this URL is invalid.";
  listSavedRooms();
  render();
}

window.addEventListener("pagehide", () => {
  cancelActiveReveal("page-hidden");
  stopTransport();
});

bootstrap();
