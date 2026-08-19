const { STATUS } = require('../rooms/RoomManager');

function registerDraftSockets(io, socket, ctx) {
  const { roomManager, draftEngine } = ctx;

  function getRoom(code) {
    return roomManager.getRoom((code || socket.data.roomCode || '').toUpperCase());
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kişi gelirse gelsin, herkes hazır verdikten
  // sonra oda sahibi başlatsın" — ready oyu vermek ARTIK draftı kendiliğinden başlatmıyor
  // (eskiden son oyu veren kişi kimse draftı o tetikliyordu). Herkes sadece kendi "hazırım"
  // durumunu açıp/kapatıyor; fiilen başlatmak ayrı ve host'a özel bir aksiyon (bkz. draft:start).
  socket.on('draft:readyToggle', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    if (room.status !== STATUS.LOBBY) return cb?.({ error: 'DRAFT_ALREADY_STARTED' });
    const isMember = room.players.some((p) => p.clientId === socket.data.clientId);
    if (!isMember) return cb?.({ error: 'NOT_IN_ROOM' });

    const clientId = socket.data.clientId;
    if (room.readyVotes.has(clientId)) room.readyVotes.delete(clientId);
    else room.readyVotes.add(clientId);
    io.to(room.code).emit('room:state', roomManager.toPublicState(room));
    cb?.({ ok: true, ready: room.readyVotes.has(clientId) });
  });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Draftı fiilen başlatmak SADECE oda sahibinin (host)
  // elinde — o an odada kim varsa (2-8 kişi) hepsi bağlı ve hepsi "hazırım" demiş olmalı.
  // Host da kendi "hazırım" oyunu vermeden başlatamaz (adil olsun diye, kendini istisna tutmaz).
  socket.on('draft:start', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    if (room.status !== STATUS.LOBBY) return cb?.({ error: 'DRAFT_ALREADY_STARTED' });
    const clientId = socket.data.clientId;
    if (!roomManager.isHost(room, clientId)) return cb?.({ error: 'ONLY_HOST_CAN_START' });
    if (!roomManager.allConnected(room)) return cb?.({ error: 'NOT_ENOUGH_PLAYERS' });
    if (room.readyVotes.size < room.players.length) return cb?.({ error: 'NOT_EVERYONE_READY' });

    room.readyVotes = new Set(); // bir sonraki faz (maç başlama onayı) için temiz başlasın
    const result = draftEngine.startDraft(room);
    cb?.(result);
  });

  socket.on('draft:bid', ({ code, amount } = {}, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const result = draftEngine.submitBid(room, socket.data.clientId, amount);
    cb?.(result);
  });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çark Modu — sırası gelen katılımcı çarkı çevirir
  // (sonuç sunucuda belirlenir, bkz. DraftEngine.spinWheel), sonra o bandın içinden bir oyuncu
  // seçer (bkz. draft:wheelPick).
  socket.on('draft:spinWheel', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const result = draftEngine.spinWheel(room, socket.data.clientId);
    cb?.(result);
  });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Rakipten istediğin oyuncuyu al" segmenti
  // için `ownerClientId` de gerekiyor (hangi rakibin kadrosundan çalındığı) — diğer segment
  // türlerinde bu alan sunucu tarafında yok sayılır (bkz. DraftEngine.submitWheelPick).
  socket.on('draft:wheelPick', ({ code, playerId, ownerClientId } = {}, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const result = draftEngine.submitWheelPick(room, socket.data.clientId, { playerId, ownerClientId });
    cb?.(result);
  });

  // [KULLANICI İSTEĞİ] "Açık arttırmada durdurma gelsin, iki oyuncu da onayladığında oyun
  // duraklatılsın" — bkz. DraftEngine.togglePauseVote.
  socket.on('draft:pauseToggle', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const result = draftEngine.togglePauseVote(room, socket.data.clientId);
    cb?.(result);
  });
}

module.exports = { registerDraftSockets };
