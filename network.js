/**
 * network.js — Модуль мережевої взаємодії PvP через WebRTC (PeerJS)
 *
 * Відповідає за:
 * 1. P2P підключення без бекенду та баз даних за допомогою бібліотеки PeerJS.
 * 2. Генерацію унікальних кімнат та розбір URL (?room=ID).
 * 3. Синхронізацію карти (Хост -> Клієнт передає повні дані карти при підключенні).
 * 4. Передачу авторитетного стану від Хоста (Гравець 1) до Клієнта (Гравець 2).
 * 5. Передачу натискань клавіш від Клієнта до Хоста.
 * 6. Обробку подій (звуки, реванш, розрив з'єднання).
 */

const Network = {
  peer: null,
  conn: null,
  isHost: false,
  myPlayerId: 1, // 1 = Хост (Жовтий танк), 2 = Гість (Зелений танк)
  connectionActive: false,
  pingMs: 0,
  _pingTimer: null,

  // Колбеки для взаємодії з ігровим рушієм (game.js)
  callbacks: {
    onConnected: null,       // Викликається при успішному з'єднанні обох гравців
    onDisconnected: null,    // Викликається при втраті з'єднання
    onMapReceived: null,     // Клієнт отримує дані карти від Хоста (або Хост від Клієнта)
    onMapsCatalogReceived: null, // Обмін списком карт між Хостом та Клієнтом
    onStateReceived: null,   // Клієнт отримує авторитетний стан гри від Хоста
    onInputReceived: null,   // Хост отримує введення клавіш від Клієнта
    onLoadoutReceived: null, // Отримання вибору спорядження (корпус/дуло)
    onEventReceived: null,   // Отримання звукових/візуальних тригерів (постріл, вибух)
    onRematchReceived: null, // Отримання запиту на реванш
    onPerkSelected: null,    // Хост отримує обраний клієнтом перк після раунду
    onPerkReroll: null,      // Хост отримує запит клієнта на рерол здібностей
    onPingUpdate: null,      // Оновлення показника пінгу (RTT у мс)
    onStatusChange: null,    // Оновлення текстового статусу підключення в UI
    onError: null            // Помилки мережі
  },

  /**
   * Ініціалізація мережевого модуля з реєстрацією слухачів ігрового циклу
   * @param {Object} cbs - Об'єкт із функціями зворотного виклику від game.js
   */
  init(cbs = {}) {
    this.callbacks = { ...this.callbacks, ...cbs };
  },

  /**
   * Генерація випадкового унікального ID кімнати
   */
  generateRoomId() {
    return 'tank-' + Math.random().toString(36).substring(2, 7) + Math.random().toString(36).substring(2, 4);
  },

  /**
   * Вилучення чистого Room ID із рядка або повного URL-посилання
   * @param {string} val 
   */
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
   * Хост виступає авторитетним ігровим сервером
   */
  hostGame(onRoomReady) {
    this.isHost = true;
    this.myPlayerId = 1;

    const roomId = this.generateRoomId();
    this.peer = new Peer(roomId);

    this._updateStatus('waiting', '🟡 ОЧІКУВАННЯ...');

    this.peer.on('open', (id) => {
      const baseUrl = window.location.href.split('?')[0].split('#')[0];
      const inviteUrl = baseUrl + '?room=' + id;
      if (typeof onRoomReady === 'function') {
        onRoomReady(id, inviteUrl);
      }
    });

    // Очікування вхідного з'єднання від Гравця 2
    this.peer.on('connection', (connection) => {
      this.conn = connection;
      this._setupDataChannel();
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Host Error:', err);
      this._emitError('Помилка хоста: ' + err.type);
    });
  },

  /**
   * ПРИЄДНАННЯ ДО ГРИ (КЛІЄНТ / ГРАВЕЦЬ 2)
   * Клієнт підключається до хоста за ID кімнати
   * @param {string} targetRoomId 
   */
  joinGame(targetRoomId) {
    this.isHost = false;
    this.myPlayerId = 2;

    this._updateStatus('waiting', '🟡 ПІДКЛЮЧЕННЯ...');

    this.peer = new Peer();

    this.peer.on('open', () => {
      // Підключення до дата-каналу хоста
      this.conn = this.peer.connect(targetRoomId, { reliable: true });
      this._setupDataChannel();
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Guest Error:', err);
      this._updateStatus('offline', '🔴 ПОМИЛКА');
      this._emitError('Не вдалося підключитися. Перевірте ID кімнати.');
    });
  },

  /**
   * Налаштування слухачів DataChannel після створення P2P каналу
   * @private
   */
  _setupDataChannel() {
    const handleOpen = () => {
      this.connectionActive = true;
      this._updateStatus('online', '🟢 ОНЛАЙН (P2P)');
      this._startPingLoop();

      if (typeof this.callbacks.onConnected === 'function') {
        this.callbacks.onConnected({
          isHost: this.isHost,
          myPlayerId: this.myPlayerId
        });
      }
    };

    if (this.conn.open) {
      handleOpen();
    } else {
      this.conn.on('open', handleOpen);
    }

    /* =========================================================================
       МЕРЕЖЕВИЙ СТИК: ПРИЙОМ ДАНИХ (INCOMING PACKETS)
       - Клієнт отримує мапу та авторитетний стан від хоста
       - Хост отримує клавіші керування (Input) від клієнта
       ========================================================================= */
    this.conn.on('data', (packet) => {
      if (!packet || !packet.type) return;

      // Обмін пакетами вимірювання пінгу (RTT) між Хостом та Клієнтом
      if (packet.type === 'ping') {
        if (this.conn && this.conn.open) {
          this.conn.send({ type: 'pong', ts: packet.ts });
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
        // [ХОСТ СТИК] Обробка пакетів, надісланих клієнтом
        if (packet.type === 'input') {
          if (typeof this.callbacks.onInputReceived === 'function') {
            this.callbacks.onInputReceived(packet.input);
          }
        } else if (packet.type === 'loadout') {
          if (typeof this.callbacks.onLoadoutReceived === 'function') {
            this.callbacks.onLoadoutReceived(packet.loadout);
          }
        } else if (packet.type === 'initMap') {
          if (typeof this.callbacks.onMapReceived === 'function') {
            this.callbacks.onMapReceived(packet.map);
          }
        } else if (packet.type === 'rematch') {
          if (typeof this.callbacks.onRematchReceived === 'function') {
            this.callbacks.onRematchReceived(packet.data || {});
          }
        } else if (packet.type === 'perkSelect') {
          if (typeof this.callbacks.onPerkSelected === 'function') {
            this.callbacks.onPerkSelected(packet.perkId);
          }
        } else if (packet.type === 'perkReroll') {
          if (typeof this.callbacks.onPerkReroll === 'function') {
            this.callbacks.onPerkReroll();
          }
        }
      } else {
        // [КЛІЄНТ СТИК] Обробка пакетів, надісланих хостом
        if (packet.type === 'initMap') {
          // Клієнт приймає динамічну карту від хоста
          if (typeof this.callbacks.onMapReceived === 'function') {
            this.callbacks.onMapReceived(packet.map);
          }
        } else if (packet.type === 'loadout') {
          if (typeof this.callbacks.onLoadoutReceived === 'function') {
            this.callbacks.onLoadoutReceived(packet.loadout);
          }
        } else if (packet.type === 'stateSync') {
          // Клієнт отримує авторитетний стан світу
          if (typeof this.callbacks.onStateReceived === 'function') {
            this.callbacks.onStateReceived(packet.state);
          }
        } else if (packet.type === 'sfx') {
          // Відтворення звуку та візуальних подій у клієнта
          if (typeof this.callbacks.onEventReceived === 'function') {
            this.callbacks.onEventReceived(packet.name, packet.data);
          }
        } else if (packet.type === 'rematch') {
          // Клієнт отримує сповіщення про реванш від хоста
          if (typeof this.callbacks.onRematchReceived === 'function') {
            this.callbacks.onRematchReceived(packet.data || {});
          }
        }
      }
    });

    this.conn.on('close', () => {
      this._stopPingLoop();
      this.connectionActive = false;
      this.pingMs = 0;
      this._updateStatus('offline', '🔴 СУПЕРНИК ВІДКЛЮЧИВСЯ');
      if (typeof this.callbacks.onDisconnected === 'function') {
        this.callbacks.onDisconnected();
      }
    });
  },

  /* =========================================================================
     МЕРЕЖЕВИЙ СТИК: ВІДПРАВКА ДАНИХ (OUTGOING PACKETS)
     ========================================================================= */

  /**
   * Передача карти на старті або при зміні під час реваншу
   * @param {Object} mapData - { name, width, height, p1Spawn, p2Spawn, grid }
   */
  sendMap(mapData) {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'initMap',
        map: mapData
      });
    }
  },

  /**
   * Передача каталогу всіх доступних карт між Хостом та Клієнтом
   * @param {Array} mapsList
   */
  sendMapsCatalog(mapsList) {
    if (this.conn && this.conn.open && Array.isArray(mapsList)) {
      this.conn.send({
        type: 'mapsCatalog',
        maps: mapsList
      });
    }
  },

  /**
   * Обмін обраним спорядженням танків між гравцями (Hull & Turret)
   * @param {Object} loadout - { hull, turret }
   */
  sendLoadout(loadout) {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'loadout',
        loadout: loadout
      });
    }
  },

  /**
   * [КЛІЄНТ -> ХОСТ] Відправка натискань клавіш та положення миші
   * @param {Object} input - { up, down, left, right, shoot, placeMine, turretAngle }
   */
  sendInput(input) {
    if (this.conn && this.conn.open && !this.isHost) {
      this.conn.send({
        type: 'input',
        input: input
      });
    }
  },

  /**
   * [КЛІЄНТ -> ХОСТ] Відправка обраного бонусу (перка) після раунду
   * @param {string} perkId
   */
  sendPerkChoice(perkId) {
    if (this.conn && this.conn.open && !this.isHost) {
      this.conn.send({
        type: 'perkSelect',
        perkId: perkId
      });
    }
  },

  /**
   * [КЛІЄНТ -> ХОСТ] Запит на рерол здібностей під час вибору перків
   */
  sendPerkReroll() {
    if (this.conn && this.conn.open && !this.isHost) {
      this.conn.send({
        type: 'perkReroll'
      });
    }
  },

  /**
   * [ХОСТ -> КЛІЄНТ] Трансляція стану світу на кожному такті
   * @param {Object} state - Повний стан світу
   */
  sendState(state) {
    if (this.conn && this.conn.open && this.isHost) {
      this.conn.send({
        type: 'stateSync',
        state: state
      });
    }
  },

  /**
   * [ХОСТ -> КЛІЄНТ] Трансляція подій (звуки, постріли, дебрис)
   * @param {string} eventName 
   * @param {Object} [eventData]
   */
  sendEvent(eventName, eventData = null) {
    if (this.conn && this.conn.open && this.isHost) {
      this.conn.send({
        type: 'sfx',
        name: eventName,
        data: eventData
      });
    }
  },

  /**
   * Запит або оновлення статусу готовності до реваншу
   * @param {Object} [data] - { playerId, ready, action, loadout, map }
   */
  sendRematch(data = {}) {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'rematch',
        data: data
      });
    }
  },

  /**
   * Дострокова здача матчу ("Здатись")
   * @param {number} playerId - ID гравця, який здався (1 або 2)
   */
  sendSurrender(playerId) {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: 'rematch',
        data: {
          action: 'surrender',
          surrenderingPlayerId: playerId,
          playerId
        }
      });
    }
  },

  /**
   * Відправка одиничного ping-запиту для вимірювання RTT (мс)
   */
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

  /**
   * Закриття поточного P2P з'єднання та вихід у головне меню
   */
  disconnect() {
    this._stopPingLoop();
    this.connectionActive = false;
    this.pingMs = 0;
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
