// frontend/collab-client.js
// Lightweight Socket.IO collaboration helper wired to Cognito auth

(() => {
  const Collab = {
    socket: null,
    room: null,
    projectId: null,
    listeners: { bpm: new Set(), presence: new Set(), state: new Set(), status: new Set() },

    init(projectId) {
      this.projectId = projectId;
      this.room = `beat-room-${projectId}`;
      const token = localStorage.getItem('idToken');
      if (!token) {
        console.warn('[Collab] Missing idToken — user not authenticated');
      }

      // Use Socket.IO client served by the backend at /socket.io/socket.io.js
      this.socket = window.io?.('/', {
        auth: { token },
        transports: ['websocket']
      });

      if (!this.socket) {
        console.error('[Collab] socket.io client not loaded');
        return;
      }

      this.socket.on('connect', () => this._emit('status', { status: 'connected' }));
      this.socket.on('disconnect', () => this._emit('status', { status: 'disconnected' }));

      // Join the per-project room
      this.socket.emit('join-room', this.room);

      // Initial state
      this.socket.on('project-state', ({ state }) => {
        // State shape: { bpm, version, updatedAt }
        if (state?.bpm) this._emit('bpm', state.bpm);
        this._emit('state', state);
      });

      // Remote ops
      this.socket.on('project-op', ({ op }) => {
        if (op?.type === 'set-bpm' && op?.payload?.bpm) {
          this._emit('bpm', Number(op.payload.bpm));
        }
      });

      // Presence from others
      this.socket.on('presence-update', (evt) => {
        this._emit('presence', evt);
      });

      // Someone joined
      this.socket.on('user-joined', (evt) => {
        this._emit('presence', { ...evt, joined: true });
      });
    },

    setBpm(bpm) {
      if (!this.socket || !this.room) return;
      this.socket.emit('project-op', {
        room: this.room,
        op: { type: 'set-bpm', payload: { bpm } }
      });
    },

    updatePresence(presence) {
      if (!this.socket || !this.room) return;
      this.socket.emit('presence-update', { room: this.room, presence });
    },

    on(event, cb) {
      if (!this.listeners[event]) this.listeners[event] = new Set();
      this.listeners[event].add(cb);
      return () => this.listeners[event].delete(cb);
    },

    _emit(event, payload) {
      const ls = this.listeners[event];
      if (!ls) return;
      for (const cb of ls) {
        try { cb(payload); } catch (e) { /* noop */ }
      }
    },

    destroy() {
      try { this.socket?.disconnect(); } catch {}
      this.socket = null;
      this.room = null;
      this.projectId = null;
      Object.keys(this.listeners).forEach(k => this.listeners[k]?.clear?.());
    }
  };

  window.Collab = Collab;
})();

