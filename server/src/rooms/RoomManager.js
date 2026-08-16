const { generateRoomCode } = require('../utils/ids');
const { STARTING_BUDGET, ROOM_TTL_MS, MAX_ROOM_PLAYERS } = require('../shared/gameConfig');

// Oda durum makinesi: lobby -> draft -> squad_select -> match -> finished
const STATUS = {
  LOBBY: 'lobby',
  DRAFT: 'draft',
  SQUAD_SELECT: 'squad_select',
  MATCH: 'match',
  FINISHED: 'finished',
};

class RoomManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.rooms = new Map();
    // clientId -> roomCode, hızlı reconnect lookup'ı için
    this.clientRoomIndex = new Map();

    // periyodik olarak uzun süredir dokunulmamış odaları temizle
    this._sweepInterval = setInterval(() => this.sweepStaleRooms(), 30 * 60 * 1000);
    this._sweepInterval.unref?.();
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kullanıcı oynayacağını lobide sorma, kaç kişi
  // gelirse gelsin" — host'a hedef bir sayı SORULMUYOR. Oda sadece dokümandaki N ≤ 8 sınırına
  // kadar (MAX_ROOM_PLAYERS) katılım kabul eder; draftı ne zaman/kaç kişiyle başlatacağına
  // (herkes hazır olduktan sonra) oda sahibi (hostClientId) kendisi karar verir.
  createRoom(hostClientId, hostName, draftMode, playerPool) {
    let code;
    do { code = generateRoomCode(); } while (this.rooms.has(code));

    const room = {
      code,
      status: STATUS.LOBBY,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      formation: null, // draft başlarken kura ile atanır (Faz 3)
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft modu — oda kurulurken host tarafından
      // seçilir, oda ömrü boyunca sabit kalır (katılan taraf modu değiştiremez, sadece görür).
      draftMode: draftMode === 'blind' ? 'blind' : 'live',
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Tek Lig Modu — draftMode'dan bağımsız ikinci bir
      // anahtar: havuzu sadece Süper Lig + Türk icon'lara daraltır (bkz. draft/pool.js).
      playerPool: playerPool === 'super-lig' ? 'super-lig' : 'all',
      // Katılım tavanı — hedef DEĞİL, sadece bir üst sınır (bkz. yukarıdaki not).
      maxPlayers: MAX_ROOM_PLAYERS,
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Odayı kuran kişi — draftı fiilen BAŞLATMA yetkisi
      // sadece bu kişide (bkz. draftSockets.js `draft:start`). Oda ömrü boyunca değişmez.
      hostClientId,
      players: [
        this._makePlayer(hostClientId, hostName),
      ],
      draft: null, // Faz 3
      squads: {}, // Faz 4: { [clientId]: { home: {...}, away: {...} } }
      matchState: null, // Faz 5
      // [KULLANICI İSTEĞİ] "Açık artırma/maç başlarken iki oyuncudan da onay al" — draftın
      // ve maçın başlaması için gereken "hazırım" oyları. Her faz geçişinde (draft başlayınca,
      // maç başlayınca) tüketilip sıfırlanır — bkz. draftSockets.js, matchSockets.js.
      readyVotes: new Set(),
    };

    this.rooms.set(code, room);
    this.clientRoomIndex.set(hostClientId, code);
    return room;
  }

  _makePlayer(clientId, name) {
    return {
      clientId,
      name: (name || 'Oyuncu').slice(0, 24),
      socketId: null,
      connected: false,
      budget: STARTING_BUDGET,
      squad: [], // draft sırasında/sonrasında kazanılan oyuncular
    };
  }

  joinRoom(code, clientId, name) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };

    const existing = room.players.find((p) => p.clientId === clientId);
    if (existing) {
      this.clientRoomIndex.set(clientId, code);
      return { room, player: existing };
    }

    if (room.players.length >= (room.maxPlayers || 2)) {
      return { error: 'ROOM_FULL' };
    }

    const player = this._makePlayer(clientId, name);
    room.players.push(player);
    room.updatedAt = Date.now();
    this.clientRoomIndex.set(clientId, code);
    return { room, player };
  }

  bindSocket(code, clientId, socketId) {
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player) return null;
    player.socketId = socketId;
    player.connected = true;
    room.updatedAt = Date.now();
    return room;
  }

  handleDisconnect(socketId) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (player) {
        player.connected = false;
        player.socketId = null;
        // Bağlantısı kopan oyuncunun "hazırım" oyu geçersiz olsun — aksi halde diğer taraf
        // tek başına draftı/maçı başlatmış gibi görünen (aslında asla tetiklenmeyecek) bir
        // oy kalır ortada.
        room.readyVotes?.delete(player.clientId);
        room.updatedAt = Date.now();
        return room;
      }
    }
    return null;
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  getRoomByClientId(clientId) {
    const code = this.clientRoomIndex.get(clientId);
    return code ? this.rooms.get(code) : null;
  }

  isRoomFull(room) {
    return room.players.length >= (room.maxPlayers || 2);
  }

  // [KULLANICI İSTEĞİ] "Maç bittikten sonra tekrar oyna butonu gelsin." — aynı oda kodu ve
  // aynı iki oyuncuyla, oda kodunu yeniden paylaşmaya gerek kalmadan sıfırdan bir draft
  // başlatılabilsin diye odayı LOBBY durumuna resetler (bütçe/kadro/draft/maç geçmişi silinir).
  resetForRematch(room) {
    room.status = STATUS.LOBBY;
    room.formation = null;
    room.draft = null;
    room.squads = {};
    room.matchState = null;
    room.readyVotes = new Set();
    room.updatedAt = Date.now();
    for (const p of room.players) {
      p.budget = STARTING_BUDGET;
      p.squad = [];
    }
    return room;
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kişi gelirse gelsin" — sabit bir hedefe ulaşma
  // ŞARTI yok, sadece en az 2 kişi olması ve hepsinin o an bağlı olması yeterli (host ne zaman
  // başlatacağına kendisi karar verir, bkz. draftSockets.js `draft:start`).
  allConnected(room) {
    return room.players.length >= 2 && room.players.every((p) => p.connected);
  }

  isHost(room, clientId) {
    return room.hostClientId === clientId;
  }

  sweepStaleRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (now - room.updatedAt > ROOM_TTL_MS) {
        for (const p of room.players) this.clientRoomIndex.delete(p.clientId);
        this.rooms.delete(code);
      }
    }
  }

  // Client'a görünecek güvenli/özet oda görünümü (Faz 3+ genişletilecek).
  toPublicState(room) {
    return {
      code: room.code,
      status: room.status,
      formation: room.formation,
      draftMode: room.draftMode || 'live',
      playerPool: room.playerPool || 'all',
      maxPlayers: room.maxPlayers || MAX_ROOM_PLAYERS,
      hostClientId: room.hostClientId,
      // [KULLANICI İSTEĞİ] "Açık artırma/maç başlarken iki oyuncudan da onay al" — o anki
      // fazın "hazırım" oyları (draft başlangıcı ya da maç başlangıcı, faza göre değişir).
      readyVotes: [...(room.readyVotes || [])],
      players: room.players.map((p) => ({
        clientId: p.clientId,
        name: p.name,
        connected: p.connected,
        budget: p.budget,
        squadCount: p.squad.length,
      })),
    };
  }
}

module.exports = { RoomManager, STATUS };
