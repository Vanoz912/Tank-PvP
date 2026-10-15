/**
 * network.js — Модуль мережевої взаємодії PvP через WebRTC (PeerJS)
 *
 * Відповідає за:
 * 1. P2P підключення без бекенду та баз даних за допомогою бібліотеки PeerJS.
 * 2. Генерацію унікальних кімнат та розбір URL (?room=ID).
 * 3. Глобальний P2P-реєстр активних лобі (WebRTC Hub + BroadcastChannel + localStorage).
 * 4. Синхронізацію карти (Хост -> Клієнт передає повні дані карти при підключенні).
 * 5. Передачу авторитетного стану від Хоста (Гравець 1) до Клієнтів (Гравці 2..4).
 * 6. Передачу натискань клавіш від Клієнта до Хоста та обробку подій.
 */

const LOBBY_HUB_PEER_ID = 'tank-p2p-lobby-hub-2026-v17';

const Network = {
  peer: null,
  conn: null,
  connections: new Map(), // slotId (2, 3, 4) -> DataConnection для Хоста (Star Topology)
  isHost: false,
  myPlayerId: 1, // 1 = Хост, 2..4 = Підключені гравці
  currentRoomId: '',
  connectionActive: false,
  isGuestInLobbySetup: false,
  peerWaitingForGuestReady: false,
  pingMs: 0,
  _pingTimer: null,
  _heartbeatTimer: null,
  _broadcastChannel: null,

  // Поля для глобального P2P-хабу списку лобі (працює між різними ПК та браузерами)
  _hubPeer: null,
  _hubClientConn: null,
  _isHubLeader: false,
  _hubRooms: new Map(),
  _hubSubscribers: new Set(),
  _lastPublishedLobby: null,

  // Колбеки для взаємодії з ігровим рушієм (game.js / netSync.js / ui.js)
  callbacks: {
    onConnected: null,
    onDisconnected: null,
    onGuestJoined: null,
    onGuestLeft: null,
    onSlotAssign: null,
    onLobbyUpdate: null,
    onSlotUpdate: null,
    onMapReceived: null,
    onMapsCatalogReceived: null,
    onStateReceived: null,
    onInputReceived: null,
    onLoadoutReceived: null,
    onEventReceived: null,
    onRematchReceived: null,
    onPerkSelected: null,
    onPerkReroll: null,
    onPingUpdate: null,
    onStatusChange: null,
    onError: null
  },

  init(cbs = {}) {
    this.callbacks = { ...this.callbacks, ...cbs };
  },

  generateRoomId() {
    return 'tank-' + Math.random().toString(36).substring(2, 7) + Math.random().toString(36).substring(2, 4);
  },

  extractRoomId(val) {
    if (!val) return '';
    val = val.trim();
    if (val.includes('room=')) {
      try {
        const url = new URL(val, window.location.href);
        return url.searchParams.get('room') || val;
      } catch (e) {
        const match = val.match(/room=([a-zA-Z0-9_-]+)/);
        if (match) return match[1];
      }
    }
    return val;
  },

  /**
   * СТВОРЕННЯ ГРИ (ХОСТ / ГРАВЕЦЬ 1)
   */
  hostGame(onRoomReady) {
    this.disconnect();
    this.isHost = true;
    this.myPlayerId = 1;
    this.isGuestInLobbySetup = false;
    this.peerWaitingForGuestReady = false;
    this.connections = new Map();

    const roomId = this.generateRoomId();
    this.currentRoomId = roomId;

    const baseUrl = window.location.href.split('?')[0].split('#')[0];
    const initialInviteUrl = baseUrl + '?room=' + roomId;
    if (typeof onRoomReady === 'function') {
      onRoomReady(roomId, initialInviteUrl);
    }

    this.peer = new Peer(roomId);
    this._updateStatus('waiting', '🟡 ОЧІКУВАННЯ...');

    this.peer.on('open', (id) => {
      this.currentRoomId = id;
      const inviteUrl = baseUrl + '?room=' + id;
      if (typeof onRoomReady === 'function') {
        onRoomReady(id, inviteUrl);
      }
    });

    this.peer.on('connection', (connection) => {
      let assignedSlot = null;
      for (let s = 2; s <= 4; s++) {
        if (!this.connections.has(s)) {
          assignedSlot = s;
          break;
        }
      }
      if (!assignedSlot) {
        connection.on('open', () => {
          connection.send({ type: 'error', message: 'Кімната заповнена (4/4 гравців)' });
          setTimeout(() => { try { connection.close(); } catch (e) {} }, 500);
        });
        return;
      }

      this.connections.set(assignedSlot, connection);
      this.conn = connection;
      connection.slotId = assignedSlot;
      this._setupDataChannel(connection, assignedSlot);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Host Error:', err);
      this._emitError('Помилка хоста: ' + err.type);
    });
  },

  /**
   * ПРИЄДНАННЯ ДО ГРИ (КЛІЄНТ / ГРАВЦІ 2..4)
   */
  joinGame(targetRoomId, options = {}) {
    if (typeof Peer === 'undefined') return;
    if (this.peer && !this.peer.destroyed && this.connectingRoomId === targetRoomId) {
      return;
    }
    this.disconnect();
    this.isHost = false;
    this.myPlayerId = 2;
    this.connectingRoomId = targetRoomId;
    this.isGuestInLobbySetup = Boolean(options && options.lobbyPreview);

    this._updateStatus('waiting', '🟡 ПІДКЛЮЧЕННЯ...');

    this.peer = new Peer();

    this.peer.on('open', () => {
      this.conn = this.peer.connect(targetRoomId, {
        reliable: true,
        metadata: { lobbyPreview: Boolean(options && options.lobbyPreview) }
      });
      this._setupDataChannel(this.conn, 2);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Guest Error:', err);
      this._updateStatus('offline', '🔴 ПОМИЛКА');
      this._emitError('Не вдалося підключитися. Перевірте ID кімнати.');
    });
  },

  _setupDataChannel(conn = this.conn, slotId = (this.isHost ? (conn.slotId || 2) : 2)) {
    if (!conn) return;

    const handleOpen = () => {
      this.connectionActive = true;
      this._updateStatus('online', '🟢 ОНЛАЙН (P2P)');
      this._startPingLoop();

      if (this.isHost) {
        conn.send({
          type: 'slotAssign',
          slotId: slotId,
          myPlayerId: slotId
        });
        if (typeof this.callbacks.onGuestJoined === 'function') {
          this.callbacks.onGuestJoined(slotId);
        }
      }

      if (typeof this.callbacks.onConnected === 'function') {
        this.callbacks.onConnected({
          isHost: this.isHost,
          myPlayerId: this.myPlayerId,
          slotId: slotId,
          lobbyPreview: Boolean(this.isHost || this.isGuestInLobbySetup || this.peerWaitingForGuestReady)
        });
      }
    };

    if (conn.open) {
      handleOpen();
    } else {
      conn.on('open', handleOpen);
    }

    conn.on('data', (packet) => {
      if (!packet || !packet.type) return;

      if (packet.type === 'ping') {
        if (conn && conn.open) {
          conn.send({ type: 'pong', ts: packet.ts });
        }
        return;
      }
      if (packet.type === 'pong') {
        const sentTs = Number(packet.ts);
        if (Number.isFinite(sentTs)) {
          this.pingMs = Math.max(0, Math.round(Date.now() - sentTs));
          if (typeof this.callbacks.onPingUpdate === 'function') {
            this.callbacks.onPingUpdate(this.pingMs);
          }
        }
        return;
      }
      if (packet.type === 'mapsCatalog') {
        if (typeof this.callbacks.onMapsCatalogReceived === 'function') {
          this.callbacks.onMapsCatalogReceived(packet.maps || []);
        }
        return;
      }

      if (this.isHost) {
        const fromSlot = conn.slotId || slotId || 2;
        if (packet.type === 'input') {
          if (typeof this.callbacks.onInputReceived === 'function') {
            this.callbacks.onInputReceived(packet.input, fromSlot);
          }
        } else if (packet.type === 'loadout') {
          if (typeof this.callbacks.onLoadoutReceived === 'function') {
            this.callbacks.onLoadoutReceived(packet.loadout, fromSlot);
          }
        } else if (packet.type === 'slotUpdate') {
          if (typeof this.callbacks.onSlotUpdate === 'function') {
            this.callbacks.onSlotUpdate(packet.slotData, fromSlot);
          }
        } else if (packet.type === 'initMap') {
          if (typeof this.callbacks.onMapReceived === 'function') {
            this.callbacks.onMapReceived(packet.map);
          }
        } else if (packet.type === 'rematch') {
          if (typeof this.callbacks.onRematchReceived === 'function') {
            this.callbacks.onRematchReceived(packet.data || {}, fromSlot);
          }
        } else if (packet.type === 'perkSelect') {
          if (typeof this.callbacks.onPerkSelected === 'function') {
            this.callbacks.onPerkSelected(packet.perkId, fromSlot);
          }
        } else if (packet.type === 'perkReroll') {
          if (typeof this.callbacks.onPerkReroll === 'function') {
            this.callbacks.onPerkReroll(fromSlot);
          }
        }
      } else {
        if (packet.type === 'slotAssign') {
          this.myPlayerId = packet.slotId || 2;
          if (typeof this.callbacks.onSlotAssign === 'function') {
            this.callbacks.onSlotAssign(this.myPlayerId);
          }
        } else if (packet.type === 'lobbyUpdate') {
          if (typeof this.callbacks.onLobbyUpdate === 'function') {
            this.callbacks.onLobbyUpdate(packet.lobbyState);
          }
        } else if (packet.type === 'initMap') {
          if (typeof this.callbacks.onMapReceived === 'function') {
            this.callbacks.onMapReceived(packet.map);
          }
        } else if (packet.type === 'loadout') {
          if (typeof this.callbacks.onLoadoutReceived === 'function') {
            this.callbacks.onLoadoutReceived(packet.loadout, packet.fromSlot || 1);
          }
        } else if (packet.type === 'stateSync') {
          if (typeof this.callbacks.onStateReceived === 'function') {
            this.callbacks.onStateReceived(packet.state);
          }
        } else if (packet.type === 'sfx') {
          if (typeof this.callbacks.onEventReceived === 'function') {
            this.callbacks.onEventReceived(packet.name, packet.data);
          }
        } else if (packet.type === 'rematch') {
          if (typeof this.callbacks.onRematchReceived === 'function') {
            this.callbacks.onRematchReceived(packet.data || {});
          }
        }
      }
    });

    conn.on('close', () => {
      if (this.isHost) {
        const fromSlot = conn.slotId || slotId;
        this.connections.delete(fromSlot);
        if (this.conn === conn) {
          const firstRemaining = this.connections.values().next().value || null;
          this.conn = firstRemaining;
        }
        if (typeof this.callbacks.onGuestLeft === 'function') {
          this.callbacks.onGuestLeft(fromSlot);
        }
        if (this.connections.size === 0) {
          this.connectionActive = false;
          this._stopPingLoop();
          this.pingMs = 0;
          this._updateStatus('waiting', '🟡 ОЧІКУВАННЯ...');
          if (typeof this.callbacks.onDisconnected === 'function') {
            this.callbacks.onDisconnected(fromSlot);
          }
        }
      } else {
        this._stopPingLoop();
        this.connectionActive = false;
        this.pingMs = 0;
        this._updateStatus('offline', '🔴 СУПЕРНИК ВІДКЛЮЧИВСЯ');
        if (typeof this.callbacks.onDisconnected === 'function') {
          this.callbacks.onDisconnected();
        }
      }
    });
  },

  /* =========================================================================
     МЕРЕЖЕВИЙ СТИК: ВІДПРАВКА ДАНИХ (OUTGOING PACKETS)
     ========================================================================= */

  broadcast(packet) {
    if (this.connections && this.connections.size > 0) {
      for (const [slotId, conn] of this.connections) {
        if (conn && conn.open) {
          try {
            conn.send(packet);
          } catch (e) {
            console.error('Помилка надсилання пакета в broadcast для слота', slotId, e);
          }
        }
      }
    } else if (this.conn && this.conn.open) {
      try {
        this.conn.send(packet);
      } catch (e) {
        console.error('Помилка надсилання пакета в broadcast:', e);
      }
    }
  },

  sendTo(slotId, packet) {
    const conn = this.connections ? this.connections.get(slotId) : null;
    if (conn && conn.open) {
      try {
        conn.send(packet);
      } catch (e) {
        console.error('Помилка надсилання пакета для слота', slotId, e);
      }
    }
  },

  sendMap(mapData) {
    this.broadcast({
      type: 'initMap',
      map: mapData
    });
  },

  sendMapsCatalog(mapsList) {
    if (Array.isArray(mapsList)) {
      this.broadcast({
        type: 'mapsCatalog',
        maps: mapsList
      });
    }
  },

  sendLoadout(loadout) {
    const fromSlot = this.myPlayerId || (this.isHost ? 1 : 2);
    if (this.isHost) {
      this.broadcast({
        type: 'loadout',
        loadout: loadout,
        fromSlot: 1
      });
    } else if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'loadout',
        loadout: loadout,
        fromSlot: fromSlot
      });
    }
  },

  sendInput(input) {
    if (this.conn && this.conn.open && !this.isHost) {
      this.conn.send({
        type: 'input',
        input: input
      });
    }
  },

  sendSlotUpdate(slotData) {
    if (this.conn && this.conn.open && !this.isHost) {
      this.conn.send({
        type: 'slotUpdate',
        slotData: slotData
      });
    }
  },

  sendLobbyUpdate(lobbyState) {
    this.broadcast({
      type: 'lobbyUpdate',
      lobbyState: lobbyState
    });
  },

  sendPerkChoice(perkId) {
    if (this.conn && this.conn.open && !this.isHost) {
      this.conn.send({
        type: 'perkSelect',
        perkId: perkId
      });
    }
  },

  sendPerkReroll() {
    if (this.conn && this.conn.open && !this.isHost) {
      this.conn.send({
        type: 'perkReroll'
      });
    }
  },

  sendState(state) {
    if (this.isHost) {
      this.broadcast({
        type: 'stateSync',
        state: state
      });
    }
  },

  sendEvent(eventName, eventData = null) {
    if (this.isHost) {
      this.broadcast({
        type: 'sfx',
        name: eventName,
        data: eventData
      });
    }
  },

  sendRematch(data = {}) {
    if (data && data.action === 'lobbyGameStart') {
      // Коли матч починається, прибираємо кімнату з публічного списку очікування
      this._stopLobbyHeartbeat(true);
    }
    if (this.isHost) {
      this.broadcast({
        type: 'rematch',
        data: data
      });
    } else if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'rematch',
        data: data
      });
    }
  },

  sendSurrender(playerId) {
    const payload = {
      action: 'surrender',
      surrenderingPlayerId: playerId,
      playerId
    };
    if (this.isHost) {
      this.broadcast({
        type: 'rematch',
        data: payload
      });
    } else if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'rematch',
        data: payload
      });
    }
  },

  /* =========================================================================
     ГЛОБАЛЬНИЙ P2P-РЕЄСТР ЛОБІ (PeerJS Hub + BroadcastChannel + localStorage)
     ========================================================================= */

  _pruneHubRooms() {
    const now = Date.now();
    for (const [rid, lob] of this._hubRooms) {
      if (now - (lob.timestamp || 0) > 15000) {
        this._hubRooms.delete(rid);
      }
    }
  },

  _broadcastHubRoomsToSubscribers() {
    if (!this._isHubLeader) return;
    this._pruneHubRooms();
    const list = Array.from(this._hubRooms.values());
    for (const subConn of this._hubSubscribers) {
      if (subConn && subConn.open) {
        try {
          subConn.send({ type: 'lobbiesList', lobbies: list });
        } catch (e) {}
      } else {
        this._hubSubscribers.delete(subConn);
      }
    }
  },

  _initHostHubConnection() {
    if (typeof Peer === 'undefined') return;
    if (this._hubPeer && !this._hubPeer.destroyed) {
      if (this._isHubLeader || (this._hubClientConn && this._hubClientConn.open)) {
        return;
      }
    }

    this._cleanupHostHubPeer(false);

    try {
      const candidateHub = new Peer(LOBBY_HUB_PEER_ID);
      this._hubPeer = candidateHub;

      candidateHub.on('open', () => {
        if (this._hubPeer !== candidateHub) return;
        this._isHubLeader = true;
        this._hubRooms = new Map();
        this._hubSubscribers = new Set();
        if (this._lastPublishedLobby && this._lastPublishedLobby.roomId) {
          this._hubRooms.set(this._lastPublishedLobby.roomId, {
            ...this._lastPublishedLobby,
            timestamp: Date.now()
          });
        }
      });

      candidateHub.on('connection', (conn) => {
        if (this._hubPeer !== candidateHub) return;
        conn.on('open', () => {
          this._pruneHubRooms();
          try {
            conn.send({ type: 'lobbiesList', lobbies: Array.from(this._hubRooms.values()) });
          } catch (e) {}
        });

        conn.on('data', (msg) => {
          if (!msg || !msg.type) return;
          if (msg.type === 'heartbeat' && msg.lobby && msg.lobby.roomId) {
            this._hubRooms.set(msg.lobby.roomId, {
              ...msg.lobby,
              timestamp: Date.now()
            });
            this._broadcastHubRoomsToSubscribers();
          } else if (msg.type === 'closed' && msg.roomId) {
            this._hubRooms.delete(msg.roomId);
            this._broadcastHubRoomsToSubscribers();
          } else if (msg.type === 'subscribe' || msg.type === 'requestLobbies') {
            this._hubSubscribers.add(conn);
            this._pruneHubRooms();
            try {
              conn.send({ type: 'lobbiesList', lobbies: Array.from(this._hubRooms.values()) });
            } catch (e) {}
          }
        });

        conn.on('close', () => {
          this._hubSubscribers.delete(conn);
        });
      });

      candidateHub.on('error', (err) => {
        if (this._hubPeer !== candidateHub) return;
        if (err && err.type === 'unavailable-id') {
          // Інший Хост вже є лідером P2P-хабу — підключаємося до нього як клієнт-хост
          this._isHubLeader = false;
          try { candidateHub.destroy(); } catch (e) {}
          const clientPeer = new Peer();
          this._hubPeer = clientPeer;

          clientPeer.on('open', () => {
            if (this._hubPeer !== clientPeer) return;
            const c = clientPeer.connect(LOBBY_HUB_PEER_ID, { reliable: true });
            this._hubClientConn = c;
            c.on('open', () => {
              if (this._lastPublishedLobby) {
                try { c.send({ type: 'heartbeat', lobby: this._lastPublishedLobby }); } catch (e) {}
              }
            });
            c.on('close', () => {
              if (this._hubClientConn === c) {
                this._hubClientConn = null;
                try { clientPeer.destroy(); } catch (e) {}
                this._hubPeer = null;
              }
            });
          });

          clientPeer.on('error', () => {
            if (this._hubPeer === clientPeer) {
              try { clientPeer.destroy(); } catch (e) {}
              this._hubPeer = null;
              this._hubClientConn = null;
            }
          });
        }
      });
    } catch (e) {}
  },

  _cleanupHostHubPeer(notifyClose = true) {
    if (notifyClose && this._lastPublishedLobby && this._lastPublishedLobby.roomId) {
      const rid = this._lastPublishedLobby.roomId;
      if (this._isHubLeader) {
        this._hubRooms.delete(rid);
        this._broadcastHubRoomsToSubscribers();
      } else if (this._hubClientConn && this._hubClientConn.open) {
        try {
          this._hubClientConn.send({ type: 'closed', roomId: rid });
        } catch (e) {}
      }
    }
    this._isHubLeader = false;
    this._hubRooms.clear();
    this._hubSubscribers.clear();
    if (this._hubClientConn) {
      try { this._hubClientConn.close(); } catch (e) {}
      this._hubClientConn = null;
    }
    if (this._hubPeer) {
      try { this._hubPeer.destroy(); } catch (e) {}
      this._hubPeer = null;
    }
  },

  getActiveLobbies() {
    if (typeof this._requestRemoteLobbies === 'function') {
      this._requestRemoteLobbies();
    }
    const result = [];
    const now = Date.now();
    try {
      const raw = localStorage.getItem('TANK_ACTIVE_LOBBIES');
      if (raw) {
        const lobbies = JSON.parse(raw);
        for (const k in lobbies) {
          if (now - (lobbies[k].timestamp || 0) <= 25000) {
            result.push(lobbies[k]);
          }
        }
      }
    } catch (e) {}
    if (this._activeLobbiesMap) {
      for (const [rid, lob] of this._activeLobbiesMap) {
        if (now - (lob.timestamp || 0) <= 25000) {
          if (!result.some(r => r.roomId === rid)) {
            result.push(lob);
          }
        }
      }
    }
    return result;
  },

  unsubscribeLobbies() {
    if (typeof this._lobbiesUnsubscribe === 'function') {
      this._lobbiesUnsubscribe();
      this._lobbiesUnsubscribe = null;
    }
    this._requestRemoteLobbies = null;
  },

  startLobbyHeartbeat(roomId, getMetadata) {
    this._startLobbyHeartbeat(roomId, getMetadata);
  },

  stopLobbyHeartbeat() {
    this._stopLobbyHeartbeat(true);
  },

  _startLobbyHeartbeat(roomId, getMetadata) {
    this._stopLobbyHeartbeat(false);
    this.currentRoomId = roomId;

    if (!this._broadcastChannel) {
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          this._broadcastChannel = new BroadcastChannel('tank_lobbies_channel');
        }
      } catch (e) {
        this._broadcastChannel = null;
      }
    }

    let hubCheckCounter = 0;

    const publish = () => {
      const meta = typeof getMetadata === 'function' ? getMetadata() : {};
      const lobbyInfo = {
        roomId,
        hostName: meta.hostName || 'Гравець 1',
        mapName: meta.mapName || 'Класична',
        playersCount: meta.playersCount || (1 + (this.connections ? this.connections.size : 0)),
        maxPlayers: 4,
        timestamp: Date.now()
      };
      this._lastPublishedLobby = lobbyInfo;

      // 1. Локальний BroadcastChannel (між вкладками одного браузера)
      if (this._broadcastChannel) {
        try {
          this._broadcastChannel.postMessage({ type: 'heartbeat', lobby: lobbyInfo });
        } catch (e) {}
      }

      // 2. Локальний localStorage
      try {
        const raw = localStorage.getItem('TANK_ACTIVE_LOBBIES');
        const lobbies = raw ? JSON.parse(raw) : {};
        lobbies[roomId] = lobbyInfo;
        const now = Date.now();
        for (const k in lobbies) {
          if (now - (lobbies[k].timestamp || 0) > 25000) {
            delete lobbies[k];
          }
        }
        localStorage.setItem('TANK_ACTIVE_LOBBIES', JSON.stringify(lobbies));
      } catch (e) {}

      // 3. Глобальний P2P Hub через PeerJS (між різними ПК, браузерами та Інкогніто)
      if (typeof Peer !== 'undefined') {
        if (!this._hubPeer || this._hubPeer.destroyed || (!this._isHubLeader && (!this._hubClientConn || !this._hubClientConn.open))) {
          if (hubCheckCounter % 2 === 0) {
            this._initHostHubConnection();
          }
          hubCheckCounter++;
        } else if (this._isHubLeader) {
          this._hubRooms.set(roomId, lobbyInfo);
          this._broadcastHubRoomsToSubscribers();
        } else if (this._hubClientConn && this._hubClientConn.open) {
          try {
            this._hubClientConn.send({ type: 'heartbeat', lobby: lobbyInfo });
          } catch (e) {}
        }
      }
    };

    if (this._broadcastChannel) {
      this._broadcastChannel.onmessage = (event) => {
        if (event && event.data && event.data.type === 'requestLobbies') {
          publish();
        }
      };
    }

    this._initHostHubConnection();
    publish();
    this._heartbeatTimer = setInterval(publish, 1000);
  },

  _stopLobbyHeartbeat(force = false) {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (force && this.currentRoomId) {
      try {
        if (this._broadcastChannel) {
          this._broadcastChannel.postMessage({ type: 'closed', roomId: this.currentRoomId });
        }
        const raw = localStorage.getItem('TANK_ACTIVE_LOBBIES');
        if (raw) {
          const lobbies = JSON.parse(raw);
          delete lobbies[this.currentRoomId];
          localStorage.setItem('TANK_ACTIVE_LOBBIES', JSON.stringify(lobbies));
        }
      } catch (e) {}
      this._cleanupHostHubPeer(true);
      this._lastPublishedLobby = null;
      this.currentRoomId = '';
    }
    if (force && this._broadcastChannel) {
      try { this._broadcastChannel.close(); } catch (e) {}
      this._broadcastChannel = null;
    }
  },

  subscribeLobbies(onUpdate) {
    this.unsubscribeLobbies();

    let bc = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('tank_lobbies_channel');
      }
    } catch (e) {}

    const memoryLobbies = new Map();
    this._activeLobbiesMap = memoryLobbies;

    const getActive = () => {
      const result = [];
      const now = Date.now();
      try {
        const raw = localStorage.getItem('TANK_ACTIVE_LOBBIES');
        if (raw) {
          const lobbies = JSON.parse(raw);
          let changed = false;
          for (const k in lobbies) {
            if (now - (lobbies[k].timestamp || 0) <= 25000) {
              result.push(lobbies[k]);
              memoryLobbies.set(k, lobbies[k]);
            } else {
              delete lobbies[k];
              changed = true;
            }
          }
          if (changed) {
            localStorage.setItem('TANK_ACTIVE_LOBBIES', JSON.stringify(lobbies));
          }
        }
      } catch (e) {}

      for (const [rid, lob] of memoryLobbies) {
        if (now - (lob.timestamp || 0) <= 25000) {
          if (!result.some(r => r.roomId === rid)) {
            result.push(lob);
          }
        } else {
          memoryLobbies.delete(rid);
        }
      }
      return result;
    };

    const handler = () => {
      if (typeof onUpdate === 'function') {
        onUpdate(getActive());
      }
    };

    if (bc) {
      bc.onmessage = (event) => {
        if (event && event.data) {
          if (event.data.type === 'heartbeat' && event.data.lobby && event.data.lobby.roomId) {
            memoryLobbies.set(event.data.lobby.roomId, event.data.lobby);
          } else if (event.data.type === 'closed' && event.data.roomId) {
            memoryLobbies.delete(event.data.roomId);
          }
        }
        handler();
      };
      try {
        bc.postMessage({ type: 'requestLobbies' });
      } catch (e) {}
    }

    // Підключення до глобального P2P Hub через PeerJS для отримання списку кімнат з інших браузерів/ПК
    let browserPeer = null;
    let hubConn = null;
    let isUnsubscribed = false;

    const connectToRemoteHub = () => {
      if (isUnsubscribed || typeof Peer === 'undefined') return;
      if (hubConn && hubConn.open) {
        try { hubConn.send({ type: 'requestLobbies' }); } catch (e) {}
        return;
      }
      if (browserPeer && !browserPeer.destroyed) {
        try { browserPeer.destroy(); } catch (e) {}
      }
      try {
        browserPeer = new Peer();
        browserPeer.on('open', () => {
          if (isUnsubscribed) return;
          hubConn = browserPeer.connect(LOBBY_HUB_PEER_ID, { reliable: true });
          hubConn.on('open', () => {
            if (isUnsubscribed) return;
            try { hubConn.send({ type: 'subscribe' }); } catch (e) {}
          });
          hubConn.on('data', (data) => {
            if (isUnsubscribed || !data) return;
            if (data.type === 'lobbiesList' && Array.isArray(data.lobbies)) {
              const incomingIds = new Set();
              const now = Date.now();
              data.lobbies.forEach(lob => {
                if (lob && lob.roomId) {
                  incomingIds.add(lob.roomId);
                  memoryLobbies.set(lob.roomId, { ...lob, timestamp: now });
                }
              });
              // Видаляємо закриті віддалені кімнати
              for (const [rid, lob] of memoryLobbies) {
                if (!incomingIds.has(rid) && (now - (lob.timestamp || 0) > 3000)) {
                  memoryLobbies.delete(rid);
                }
              }
              handler();
            }
          });
          hubConn.on('close', () => {
            hubConn = null;
          });
        });
        browserPeer.on('error', () => {
          // Якщо жодного активного Хоста ще немає на сервері PeerJS — ігноруємо помилку
        });
      } catch (e) {}
    };

    this._requestRemoteLobbies = connectToRemoteHub;
    connectToRemoteHub();

    const storageHandler = (e) => {
      if (!e || e.key === 'TANK_ACTIVE_LOBBIES' || !e.key) {
        handler();
      }
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', storageHandler);
    }

    const timer = setInterval(() => {
      connectToRemoteHub();
      handler();
    }, 1500);
    handler();

    this._lobbiesUnsubscribe = () => {
      isUnsubscribed = true;
      if (timer) clearInterval(timer);
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('storage', storageHandler);
      }
      if (bc) {
        try { bc.close(); } catch (e) {}
      }
      if (hubConn) {
        try { hubConn.close(); } catch (e) {}
        hubConn = null;
      }
      if (browserPeer) {
        try { browserPeer.destroy(); } catch (e) {}
        browserPeer = null;
      }
      this._activeLobbiesMap = null;
    };

    return this._lobbiesUnsubscribe;
  },

  sendPing() {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'ping',
        ts: Date.now()
      });
    }
  },

  _startPingLoop() {
    this._stopPingLoop();
    this.sendPing();
    if (typeof setInterval === 'function') {
      this._pingTimer = setInterval(() => {
        if (this.connectionActive && this.conn && this.conn.open) {
          this.sendPing();
        }
      }, 1000);
    }
  },

  _stopPingLoop() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  },

  disconnect() {
    this._stopPingLoop();
    this._stopLobbyHeartbeat(true);
    this.unsubscribeLobbies();
    this.connectionActive = false;
    this.connectingRoomId = '';
    this.isGuestInLobbySetup = false;
    this.peerWaitingForGuestReady = false;
    this.pingMs = 0;
    if (this.connections) {
      for (const [s, c] of this.connections) {
        try { c.close(); } catch (e) {}
      }
      this.connections.clear();
    }
    if (this.conn) {
      try { this.conn.close(); } catch (e) {}
      this.conn = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
    this._updateStatus('offline', '⚪ ОФЛАЙН');
  },

  _updateStatus(status, text) {
    if (typeof this.callbacks.onStatusChange === 'function') {
      this.callbacks.onStatusChange(status, text);
    }
  },

  _emitError(msg) {
    if (typeof this.callbacks.onError === 'function') {
      this.callbacks.onError(msg);
    }
  }
};

if (typeof window !== 'undefined') {
  window.Network = Network;
}

export { Network };
export default Network;
