// client/js/session.js — THE SESSION SEAM.
//
// Every UI module reads `session.view` and calls `session.send()`. None of them
// know whether a socket is involved. That is the whole point: V2 multiplayer,
// spectators and replays all arrive behind this interface rather than through
// the UI. It is the cheapest investment in the stack and it is made on day one.
//
// This file is the REMOTE implementation. A local/offline session would
// implement the same three members and the UI would not notice.

export function createRemoteSession({ url, token }) {
  const listeners = new Set();
  let socket = null;
  let backoff = 500;

  const session = {
    view: null,
    firmId: null,
    briefing: null,
    connected: false,
    recoveryCode: null,
    dropZones: null,
    autoZone: null,
    tiles: null,

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    send(command) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "command", command }));
      }
    },

    requestDropZones() {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "dropZones" }));
      }
    },

    claim(code) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "claim", code }));
      }
    },
  };

  const emit = (events = []) => { for (const fn of listeners) fn(session, events); };

  function connect() {
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      backoff = 500;
      session.connected = true;
      socket.send(JSON.stringify({ type: "hello", token: localStorage.getItem("sm.token") }));
    });
    socket.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case "welcome":
          session.firmId = msg.firmId;
          session.briefing = msg.briefing;
          session.view = msg.view;
          if (msg.token) localStorage.setItem("sm.token", msg.token);
          // Shown once, and only once — after this the server only has a hash.
          if (msg.recoveryCode) session.recoveryCode = msg.recoveryCode;
          emit();
          break;
        case "view":
          session.view = msg.view;
          emit(msg.events ?? []);
          break;
        case "dropZones":
          session.dropZones = msg.zones;
          session.autoZone = msg.auto;
          session.tiles = msg.tiles;
          emit([{ type: "dropZonesReady" }]);
          break;
        case "claimed":
          localStorage.setItem("sm.token", msg.token);
          location.reload();
          break;
        case "error":
          emit([{ type: "serverError", reason: msg.reason }]);
          break;
        default: break;
      }
    });
    socket.addEventListener("close", () => {
      session.connected = false;
      emit([{ type: "disconnected" }]);
      // Reconnect with backoff: D31 gives 120s of grace, so a blip must not
      // cost the deployment. The world keeps running either way.
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 8000);
    });
  }

  connect();
  return session;
}
