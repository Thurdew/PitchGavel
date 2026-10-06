// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ARKADAŞLAR] "Arkadaşım şu an nerede?" — tamamen bellekte,
// DB'ye yazılmaz (odalar da bellekte; deploy anında ikisi birlikte sıfırlanır).
//  - Çevrimiçi: hesabı `presence:hello` ile (tek kullanımlık RoomTickets bileti) bu sürece bağlı
//    en az bir socket'i var.
//  - Oda: oyuncusu o hesaba bağlı (room:bindAccount) ve bağlı olan bir oda. Oda bilgisi her
//    sorguda RoomManager'dan türetilir, ayrı bir kopya tutulmaz (eskiyemez).
const { STATUS } = require('../rooms/RoomManager');

class Presence {
  constructor(roomManager) {
    this.roomManager = roomManager;
    this.userSockets = new Map(); // userId → Set<socketId>
    this.socketUser = new Map(); // socketId → userId
  }

  attach(userId, socketId) {
    this.detach(socketId);
    if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
    this.userSockets.get(userId).add(socketId);
    this.socketUser.set(socketId, userId);
  }

  detach(socketId) {
    const userId = this.socketUser.get(socketId);
    if (userId == null) return;
    this.socketUser.delete(socketId);
    const set = this.userSockets.get(userId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) this.userSockets.delete(userId);
    }
  }

  socketsOf(userId) {
    return [...(this.userSockets.get(userId) || [])];
  }

  // İstenen kullanıcılar için tek geçişte userId → oda haritası.
  _roomsByUser(userIds) {
    const want = new Set(userIds);
    const out = new Map();
    for (const room of this.roomManager.rooms.values()) {
      for (const p of room.players) {
        const uid = p.account && p.account.userId;
        if (uid != null && want.has(uid) && p.connected && !p.isBot) out.set(uid, room);
      }
    }
    return out;
  }

  // userId → { online, room: { code|null, status, draftMode, players, maxPlayers, joinable } | null }.
  // Oda kodu sadece katılınabilir (lobi, yer var) iken verilir — başlamış bir odanın kodu işe
  // yaramaz (yeni kişi giremez) ve gereksiz yere dolaşmasın.
  statusFor(userIds) {
    const rooms = this._roomsByUser(userIds);
    const out = new Map();
    for (const uid of userIds) {
      const room = rooms.get(uid);
      let roomInfo = null;
      if (room) {
        const max = room.maxPlayers || 2;
        const joinable = room.status === STATUS.LOBBY && room.players.length < max;
        roomInfo = {
          code: joinable ? room.code : null,
          status: room.status,
          draftMode: room.draftMode,
          players: room.players.length,
          maxPlayers: max,
          joinable,
        };
      }
      out.set(uid, { online: !!room || this.userSockets.has(uid), room: roomInfo });
    }
    return out;
  }
}

module.exports = { Presence };
