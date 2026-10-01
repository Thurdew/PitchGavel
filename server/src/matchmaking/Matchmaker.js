// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ SONRASI FAZ 4, "Yabancılarla Online
// Eşleşme"] Oda koduyla arkadaş daveti akışına HİÇ dokunmadan, yanına üçüncü bir seçenek: aynı
// draftMode+playerPool kombinasyonunu isteyen 2 kişi otomatik eşleşir, gerçek bir oda kurulur ve
// draft KENDİLİĞİNDEN başlar (host/hazır-mısın onayı YOK — eşleşmenin kendisi zaten "ikimiz de
// hazırız" demek). Yeni bir draft/oda motoru YAZILMADI — RoomManager/DraftEngine'in mevcut
// metodları birebir reuse ediliyor (bkz. claude.md).
class Matchmaker {
  constructor(io, roomManager, draftEngine) {
    this.io = io;
    this.roomManager = roomManager;
    this.draftEngine = draftEngine;
    this.queues = new Map(); // "draftMode:playerPool" -> [{clientId, name, socketId}]
  }

  _key(draftMode, playerPool) { return `${draftMode}:${playerPool}`; }

  join(clientId, name, socketId, draftMode, playerPool, secret) {
    // [GÜVENLİK] Aynı clientId kuyruktaysa sadece aynı gizli anahtarın sahibi (aynı sekme, ör.
    // yeniden bağlanmış) onun yerine geçebilir — başkası bu clientId ile kaydı ezemez.
    for (const q of this.queues.values()) {
      const existing = q.find((e) => e.clientId === clientId);
      if (existing && existing.secret !== secret) return { error: 'CLIENT_ID_TAKEN' };
    }
    this.leave(clientId); // olası eski/bayat kuyruk kaydı önce temizlenir
    // Çark Modu bütçesiz/kendi mekaniğine sahip olduğu için hızlı eşleşmede YOK (MVP kapsamı
    // dışı — v2 fikri); Kör Draft/Canlı Açık Arttırma ikisi de geçerli.
    const resolvedDraftMode = draftMode === 'blind' ? 'blind' : 'live';
    const resolvedPlayerPool = playerPool === 'super-lig' ? 'super-lig' : 'all';
    const key = this._key(resolvedDraftMode, resolvedPlayerPool);
    const q = this.queues.get(key) || [];
    q.push({ clientId, name, socketId, secret });
    this.queues.set(key, q);

    if (q.length >= 2) {
      const [a, b] = q.splice(0, 2);
      if (q.length === 0) this.queues.delete(key); // leave()'deki tidiness ile aynı — boş kuyruk Map'te kalmasın
      return this._pair(a, b, resolvedDraftMode, resolvedPlayerPool);
    }
    return null; // eşleşme yok, kuyrukta bekliyor
  }

  leave(clientId) {
    for (const [key, q] of this.queues) {
      const idx = q.findIndex((e) => e.clientId === clientId);
      if (idx !== -1) {
        q.splice(idx, 1);
        if (q.length === 0) this.queues.delete(key);
        return;
      }
    }
  }

  // Bir socket'in (bağlantı koptuğunda ya da istemci vazgeçtiğinde) kendi kuyruk kaydını siler.
  leaveBySocket(socketId) {
    for (const [key, q] of this.queues) {
      const idx = q.findIndex((e) => e.socketId === socketId);
      if (idx !== -1) {
        q.splice(idx, 1);
        if (q.length === 0) this.queues.delete(key);
        return;
      }
    }
  }

  _pair(a, b, draftMode, playerPool) {
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Rastgele bir yabancıyla otomatik eşleşen odada
    // prepWheel/tradeRound/bankedPerks hepsi KAPALI — bunlar host'un bilinçli seçimi, rastgele
    // bir eşleşmede otomatik açılması anlamlı olmaz. Sade/hızlı bir deneyim.
    const room = this.roomManager.createRoom(a.clientId, a.name, draftMode, playerPool, null, false, false, false, a.secret);
    this.roomManager.joinRoom(room.code, b.clientId, b.name, b.secret);
    for (const entry of [a, b]) {
      this.roomManager.bindSocket(room.code, entry.clientId, entry.socketId);
      const sock = this.io.sockets.sockets.get(entry.socketId);
      if (sock) {
        sock.join(room.code);
        sock.data.clientId = entry.clientId;
        sock.data.roomCode = room.code;
      }
    }
    // Host/hazır-mısın kontrolü YOK — draftEngine.startDraft zaten room:state/draft:update
    // broadcast'lerini io.to(room.code) üzerinden kendisi yapıyor; sockets yukarıda ÖNCE
    // room.code'a join edildiği için bu broadcast'ler otomatik ikisine de ulaşır.
    this.draftEngine.startDraft(room);
    for (const entry of [a, b]) {
      this.io.to(entry.socketId).emit('matchmaking:matched', { code: room.code });
    }
    return room;
  }
}

module.exports = { Matchmaker };
