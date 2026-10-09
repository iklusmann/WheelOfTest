/** Best-effort manual-signaling WebRTC transport. It never applies domain assignments or owns room state. */
import {
  PROTOCOL_VERSION,
  MAX_SIGNALING_CODE_LENGTH,
  MAX_DATA_MESSAGE_BYTES,
  OFFER_TTL_MS,
  ICE_GATHERING_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_MS,
  PEER_CONNECT_TIMEOUT_MS
} from "./config.js";
import { isValidRoomCode, validateProfile } from "./domain.js";

const ALLOWED_TYPES = new Set(["profile", "complaint", "heartbeat", "snapshot", "ack", "error"]);
const HOST_INBOUND_TYPES = new Set(["profile", "complaint", "heartbeat"]);
const GUEST_INBOUND_TYPES = new Set(["snapshot", "ack", "error", "heartbeat"]);

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function makeId(prefix = "c") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function serializeSignalCode(wrapper) {
  const encoded = JSON.stringify(wrapper);
  if (byteLength(encoded) > MAX_SIGNALING_CODE_LENGTH) throw new Error("The signaling code is too large. Create a fresh connection code and try again.");
  return encoded;
}

export function validateAnswerCorrelation(parsed, expectedConnectionId) {
  if (typeof expectedConnectionId === "string" && expectedConnectionId && parsed?.connectionId !== expectedConnectionId) {
    throw new Error("This answer belongs to a different connection row. Paste the answer into the row that created its matching offer.");
  }
  return parsed;
}

export function parseSignalCode(code, { roomCode, expectedType, now = Date.now() } = {}) {
  if (typeof code !== "string" || !code.trim()) throw new Error("Paste the complete connection code first.");
  if (code.length > MAX_SIGNALING_CODE_LENGTH || byteLength(code) > MAX_SIGNALING_CODE_LENGTH) throw new Error("This connection code exceeds the 200 KiB limit.");
  let parsed;
  try { parsed = JSON.parse(code); } catch { throw new Error("The connection code is not valid JSON. Copy the entire code without extra text."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The connection code must be a JSON object.");
  if (parsed.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Unsupported signaling protocol version. Expected ${PROTOCOL_VERSION}.`);
  if (!isValidRoomCode(parsed.roomCode) || parsed.roomCode !== roomCode) throw new Error("This code belongs to a different room or has an invalid room code.");
  if (parsed.type !== expectedType) throw new Error(`Expected a ${expectedType} code, but received ${String(parsed.type || "unknown")}.`);
  if (typeof parsed.connectionId !== "string" || !/^c-[A-Za-z0-9-]{8,100}$/.test(parsed.connectionId)) throw new Error("The connection code has an invalid connection ID.");
  if (!Number.isFinite(parsed.createdAt) || parsed.createdAt > now + 60_000 || now - parsed.createdAt > OFFER_TTL_MS) {
    throw new Error("This connection code is older than 10 minutes or has an invalid timestamp. Create a fresh code.");
  }
  if (!parsed.sdp || typeof parsed.sdp !== "object" || parsed.sdp.type !== expectedType || typeof parsed.sdp.sdp !== "string" || !parsed.sdp.sdp.trim()) {
    throw new Error("The code contains an incomplete or malformed SDP description.");
  }
  if (parsed.sdp.sdp.length > MAX_SIGNALING_CODE_LENGTH) throw new Error("The SDP description exceeds the supported size limit.");
  return parsed;
}

function validateEnvelope(raw, roomCode, allowedTypes) {
  if (typeof raw !== "string") throw new Error("Only text protocol messages are accepted.");
  if (raw.length > MAX_DATA_MESSAGE_BYTES || byteLength(raw) > MAX_DATA_MESSAGE_BYTES) throw new Error("Protocol message exceeds the 64 KiB limit.");
  let message;
  try { message = JSON.parse(raw); } catch { throw new Error("Malformed protocol message JSON."); }
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Protocol message must be an object.");
  if (message.protocolVersion !== PROTOCOL_VERSION) throw new Error("Unsupported protocol version.");
  if (message.roomCode !== roomCode) throw new Error("Protocol message belongs to another room.");
  if (typeof message.type !== "string" || !ALLOWED_TYPES.has(message.type) || !allowedTypes.has(message.type)) {
    throw new Error("This message type is not permitted from this peer.");
  }
  if (message.requestId != null && (typeof message.requestId !== "string" || message.requestId.length > 120)) throw new Error("Invalid request ID.");
  if (!message.payload || typeof message.payload !== "object" || Array.isArray(message.payload)) throw new Error("Protocol payload must be an object.");
  return message;
}

function waitForIceGathering(pc, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      if (error) reject(error); else resolve();
    };
    const onChange = () => { if (pc.iceGatheringState === "complete") finish(); };
    const timer = setTimeout(() => finish(new Error("ICE gathering timed out. Retry with a fresh connection code; no external STUN/TURN service is available.")), timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
    if (pc.iceGatheringState === "complete") finish();
  });
}

export class WebRTCPeerManager {
  constructor({ roomCode, role, onMessage = () => {}, onPeerStatus = () => {}, onError = () => {} }) {
    if (!isValidRoomCode(roomCode)) throw new Error("A valid room code is required for WebRTC.");
    if (!new Set(["host", "guest"]).has(role)) throw new Error("Transport role must be host or guest.");
    this.roomCode = roomCode;
    this.role = role;
    this.onMessage = onMessage;
    this.onPeerStatus = onPeerStatus;
    this.onError = onError;
    this.peers = new Map();
    this.guestProfile = null;
    this.destroyed = false;
    this.heartbeatTimer = setInterval(() => this._heartbeatTick(), HEARTBEAT_INTERVAL_MS);
  }

  _newPeer(connectionId, createdAt = Date.now()) {
    if (typeof RTCPeerConnection !== "function") throw new Error("This browser does not support RTCPeerConnection.");
    if (this.peers.has(connectionId)) throw new Error("This connection ID is already active. Create a fresh connection code.");
    const pc = new RTCPeerConnection({ iceServers: [] });
    const peer = {
      connectionId,
      createdAt,
      pc,
      channel: null,
      participantId: null,
      profileAccepted: false,
      answerApplied: false,
      lastHeartbeatAt: Date.now(),
      transportState: "creating",
      staleNotified: false,
      closed: false,
      connectTimer: null,
      iceState: pc.iceConnectionState,
      connectionState: pc.connectionState
    };
    this.peers.set(connectionId, peer);
    peer.connectTimer = setTimeout(() => {
      if (!peer.closed && !this._channelOpen(peer)) {
        this.onPeerStatus({ connectionId, state: "timeout", details: "No data channel opened within 30 seconds." });
      }
    }, PEER_CONNECT_TIMEOUT_MS);

    pc.addEventListener("connectionstatechange", () => {
      if (peer.closed) return;
      peer.connectionState = pc.connectionState;
      this.onPeerStatus({ connectionId, state: pc.connectionState, connectionState: pc.connectionState, iceState: pc.iceConnectionState });
      if (pc.connectionState === "failed") {
        this.onError({ connectionId, error: "Peer connection failed. Close this peer and exchange a fresh code." });
      }
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      if (peer.closed) return;
      peer.iceState = pc.iceConnectionState;
      this.onPeerStatus({ connectionId, state: pc.iceConnectionState, connectionState: pc.connectionState, iceState: pc.iceConnectionState });
    });
    pc.addEventListener("icegatheringstatechange", () => {
      if (!peer.closed) this.onPeerStatus({ connectionId, state: `ice-${pc.iceGatheringState}`, connectionState: pc.connectionState, iceState: pc.iceConnectionState });
    });
    pc.addEventListener("datachannel", (event) => this._attachChannel(peer, event.channel));
    return peer;
  }

  _attachChannel(peer, channel) {
    if (peer.closed) { try { channel.close(); } catch {} return; }
    if (peer.channel && peer.channel !== channel) {
      try { channel.close(); } catch {}
      this.onError({ connectionId: peer.connectionId, error: "Unexpected second data channel was rejected." });
      return;
    }
    peer.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", () => {
      if (peer.closed) return;
      clearTimeout(peer.connectTimer);
      peer.transportState = "channel-open";
      peer.lastHeartbeatAt = Date.now();
      peer.staleNotified = false;
      this.onPeerStatus({ connectionId: peer.connectionId, state: "channel-open", connectionState: peer.pc.connectionState, iceState: peer.pc.iceConnectionState });
      this._send(peer, "heartbeat", {});
      if (this.role === "guest" && this.guestProfile) {
        this._send(peer, "profile", this.guestProfile);
      }
    });
    channel.addEventListener("message", (event) => this._receive(peer, event.data));
    channel.addEventListener("close", () => {
      if (peer.closed) return;
      peer.transportState = "channel-closed";
      this.onPeerStatus({ connectionId: peer.connectionId, state: "channel-closed", connectionState: peer.pc.connectionState, iceState: peer.pc.iceConnectionState });
    });
    channel.addEventListener("error", () => this.onError({ connectionId: peer.connectionId, error: "The data channel reported an error." }));
  }

  _receive(peer, raw) {
    if (peer.closed) return;
    const allowed = this.role === "host" ? HOST_INBOUND_TYPES : GUEST_INBOUND_TYPES;
    let message;
    try {
      message = validateEnvelope(raw, this.roomCode, allowed);
      if (message.type === "heartbeat") {
        peer.lastHeartbeatAt = Date.now();
        peer.staleNotified = false;
        return;
      }
      if (this.role === "host" && message.type === "profile") {
        const checked = validateProfile(message.payload);
        if (!checked.ok) throw new Error(checked.error);
        message = { ...message, payload: checked.profile };
      }
      if (this.role === "host" && message.type === "complaint" && Object.keys(message.payload).length !== 0) {
        throw new Error("Complaint messages must not contain a participant ID or mutable room fields.");
      }
      this.onMessage({ connectionId: peer.connectionId, message });
    } catch (error) {
      this.onError({ connectionId: peer.connectionId, error: error.message || "Invalid protocol message." });
      this._send(peer, "error", { message: error.message || "Invalid protocol message." });
    }
  }

  _send(peer, type, payload, requestId = makeId("r")) {
    if (!peer || peer.closed || !peer.channel || peer.channel.readyState !== "open") return false;
    if (!ALLOWED_TYPES.has(type)) throw new Error("Attempted to send an unsupported protocol message.");
    try {
      const message = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, roomCode: this.roomCode, type, requestId, payload });
      if (typeof message !== "string" || byteLength(message) > MAX_DATA_MESSAGE_BYTES) {
        this.onError({ connectionId: peer.connectionId, error: "Outgoing message exceeds the 64 KiB protocol limit." });
        return false;
      }
      peer.channel.send(message);
      return true;
    } catch (error) {
      this.onError({ connectionId: peer.connectionId, error: `Could not send message: ${error?.message || "channel unavailable"}` });
      return false;
    }
  }

  _heartbeatTick() {
    if (this.destroyed) return;
    const now = Date.now();
    for (const peer of this.peers.values()) {
      if (peer.closed) continue;
      if (this._channelOpen(peer)) {
        this._send(peer, "heartbeat", {});
        if (now - peer.lastHeartbeatAt > HEARTBEAT_STALE_MS && !peer.staleNotified) {
          peer.staleNotified = true;
          this.onPeerStatus({ connectionId: peer.connectionId, state: "heartbeat-stale", connectionState: peer.pc.connectionState, iceState: peer.pc.iceConnectionState });
        }
      }
    }
  }

  _channelOpen(peer) {
    return Boolean(peer && !peer.closed && peer.channel && peer.channel.readyState === "open");
  }

  isTransportLive(connectionId) {
    const peer = this.peers.get(connectionId);
    return Boolean(this._channelOpen(peer) && Date.now() - peer.lastHeartbeatAt <= HEARTBEAT_STALE_MS && peer.pc.connectionState !== "failed" && peer.pc.connectionState !== "closed");
  }

  isConnectionLive(connectionId) {
    const peer = this.peers.get(connectionId);
    return Boolean(this.isTransportLive(connectionId) && (this.role === "guest" || peer.profileAccepted));
  }

  getPeerInfo() {
    return [...this.peers.values()].map((peer) => ({
      connectionId: peer.connectionId,
      participantId: peer.participantId,
      state: peer.closed ? "closed" : !this._channelOpen(peer) ? peer.transportState : (Date.now() - peer.lastHeartbeatAt > HEARTBEAT_STALE_MS ? "heartbeat-stale" : "channel-open"),
      connectionState: peer.pc.connectionState,
      iceState: peer.pc.iceConnectionState,
      profileAccepted: peer.profileAccepted,
      live: this.isConnectionLive(peer.connectionId),
      createdAt: peer.createdAt
    }));
  }

  markProfileAccepted(connectionId, participantId) {
    const peer = this.peers.get(connectionId);
    if (!peer || peer.closed || !this._channelOpen(peer)) throw new Error("Cannot accept a profile on a closed data channel.");
    peer.participantId = participantId;
    peer.profileAccepted = true;
    peer.lastHeartbeatAt = Date.now();
    this.onPeerStatus({ connectionId, state: "profile-accepted", participantId, connectionState: peer.pc.connectionState, iceState: peer.pc.iceConnectionState });
  }

  createHostOffer() {
    if (this.role !== "host") throw new Error("Only the host can create offers.");
    return this._createHostOffer();
  }

  async _createHostOffer() {
    const connectionId = makeId("c");
    const createdAt = Date.now();
    const peer = this._newPeer(connectionId, createdAt);
    try {
      const channel = peer.pc.createDataChannel("wheelOfTest", { ordered: true });
      this._attachChannel(peer, channel);
      this.onPeerStatus({ connectionId, state: "creating-offer" });
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.onPeerStatus({ connectionId, state: "gathering-ice" });
      await waitForIceGathering(peer.pc);
      const sdp = peer.pc.localDescription;
      if (!sdp?.sdp || sdp.type !== "offer") throw new Error("The browser did not produce a complete offer description.");
      const code = serializeSignalCode({ protocolVersion: PROTOCOL_VERSION, roomCode: this.roomCode, connectionId, type: "offer", createdAt, sdp: { type: sdp.type, sdp: sdp.sdp } });
      this.onPeerStatus({ connectionId, state: "offer-ready" });
      return { connectionId, code, createdAt };
    } catch (error) {
      this.closePeer(connectionId, "offer-creation-failed");
      throw error;
    }
  }

  acceptHostAnswer(code, expectedConnectionId = null) {
    if (this.role !== "host") throw new Error("Only the host can accept answers.");
    const parsed = parseSignalCode(code, { roomCode: this.roomCode, expectedType: "answer" });
    validateAnswerCorrelation(parsed, expectedConnectionId);
    const peer = this.peers.get(parsed.connectionId);
    if (!peer || peer.closed || peer.answerApplied || !peer.channel) throw new Error("This answer does not match a pending offer, or it has already been used. Select the matching pending connection and try again.");
    if (Date.now() - peer.createdAt > OFFER_TTL_MS) throw new Error("The pending offer expired. Create a fresh connection code.");
    return peer.pc.setRemoteDescription({ type: "answer", sdp: parsed.sdp.sdp }).then(() => {
      peer.answerApplied = true;
      peer.transportState = "answer-applied";
      this.onPeerStatus({ connectionId: peer.connectionId, state: "answer-applied", connectionState: peer.pc.connectionState, iceState: peer.pc.iceConnectionState });
      return { connectionId: peer.connectionId };
    }).catch((error) => {
      throw new Error(`Could not apply this answer: ${error?.message || "invalid SDP"}`);
    });
  }

  acceptGuestOffer(code, profileInput) {
    if (this.role !== "guest") throw new Error("Only guests can accept offers.");
    const parsed = parseSignalCode(code, { roomCode: this.roomCode, expectedType: "offer" });
    const checkedProfile = validateProfile(profileInput);
    if (!checkedProfile.ok) throw new Error(checkedProfile.error);
    this.closeAll("guest-retry");
    this.guestProfile = checkedProfile.profile;
    return this._createGuestAnswer(parsed);
  }

  async _createGuestAnswer(offer) {
    const peer = this._newPeer(offer.connectionId, offer.createdAt);
    try {
      this.onPeerStatus({ connectionId: peer.connectionId, state: "applying-offer" });
      await peer.pc.setRemoteDescription({ type: "offer", sdp: offer.sdp.sdp });
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.onPeerStatus({ connectionId: peer.connectionId, state: "gathering-ice" });
      await waitForIceGathering(peer.pc);
      const sdp = peer.pc.localDescription;
      if (!sdp?.sdp || sdp.type !== "answer") throw new Error("The browser did not produce a complete answer description.");
      const code = serializeSignalCode({ protocolVersion: PROTOCOL_VERSION, roomCode: this.roomCode, connectionId: peer.connectionId, type: "answer", createdAt: offer.createdAt, sdp: { type: sdp.type, sdp: sdp.sdp } });
      this.onPeerStatus({ connectionId: peer.connectionId, state: "answer-ready" });
      return { connectionId: peer.connectionId, code, createdAt: offer.createdAt };
    } catch (error) {
      this.closePeer(peer.connectionId, "answer-creation-failed");
      throw error;
    }
  }

  sendTo(connectionId, type, payload = {}) {
    const peer = this.peers.get(connectionId);
    if (!peer || !this._channelOpen(peer)) return false;
    return this._send(peer, type, payload);
  }

  broadcast(type, payload) {
    const results = [];
    for (const peer of this.peers.values()) {
      if (!this._channelOpen(peer) || (this.role === "host" && (!peer.profileAccepted || !this.isConnectionLive(peer.connectionId)))) continue;
      results.push({ connectionId: peer.connectionId, sent: this._send(peer, type, payload) });
    }
    return results;
  }

  closePeer(connectionId, reason = "closed-by-user") {
    const peer = this.peers.get(connectionId);
    if (!peer || peer.closed) return;
    peer.closed = true;
    peer.transportState = "closed";
    clearTimeout(peer.connectTimer);
    try { peer.channel?.close(); } catch {}
    try { peer.pc.close(); } catch {}
    this.peers.delete(connectionId);
    this.onPeerStatus({ connectionId, state: reason, connectionState: "closed", iceState: peer.pc.iceConnectionState });
  }

  closeAll(reason = "closed-by-user") {
    for (const connectionId of [...this.peers.keys()]) this.closePeer(connectionId, reason);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.heartbeatTimer);
    this.closeAll("transport-destroyed");
  }
}

export const SIGNALING_LIMITS = Object.freeze({ MAX_SIGNALING_CODE_LENGTH, MAX_DATA_MESSAGE_BYTES, OFFER_TTL_MS, ICE_GATHERING_TIMEOUT_MS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_MS, PEER_CONNECT_TIMEOUT_MS });
