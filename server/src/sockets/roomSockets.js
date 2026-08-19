const { STATUS } = require('../rooms/RoomManager');

function registerRoomSockets(io, socket, ctx) {
  const { roomManager } = ctx;

  function broadcastState(room) {
    io.to(room.code).emit('room:state', roomManager.toPublicState(room));
  }

  socket.on('room:create', ({ clientId, name, draftMode, playerPool } = {}, cb) => {
    if (!clientId) return cb?.({ error: 'CLIENT_ID_REQUIRED' });
    const room = roomManager.createRoom(clientId, name, draftMode, playerPool);
    roomManager.bindSocket(room.code, clientId, socket.id);
    socket.join(room.code);
    socket.data.clientId = clientId;
    socket.data.roomCode = room.code;
    const state = roomManager.toPublicState(room);
    cb?.({ room: state });
    broadcastState(room);
  });

  socket.on('room:join', ({ clientId, name, code } = {}, cb) => {
    if (!clientId || !code) return cb?.({ error: 'MISSING_FIELDS' });
    const result = roomManager.joinRoom(code.toUpperCase(), clientId, name);
    if (result.error) return cb?.({ error: result.error });

    const { room } = result;
    roomManager.bindSocket(room.code, clientId, socket.id);
    socket.join(room.code);
    socket.data.clientId = clientId;
    socket.data.roomCode = room.code;

    const state = roomManager.toPublicState(room);
    cb?.({ room: state });
    broadcastState(room);

    // En az 2 kişi olup hepsi bağlandıysa (draft artık başlatılabilir durumda) bir sinyal —
    // "oda doldu" değil, sadece "host isterse başlatabilir" anlamında (bkz. RoomManager.allConnected).
    if (roomManager.allConnected(room) && room.status === STATUS.LOBBY) {
      io.to(room.code).emit('room:ready');
    }
  });

  // Sayfa yenilemesi/ağ kopması sonrası aynı clientId ile yeniden bağlanma.
  socket.on('room:reconnect', ({ clientId, code } = {}, cb) => {
    if (!clientId || !code) return cb?.({ error: 'MISSING_FIELDS' });
    const room = roomManager.getRoom(code.toUpperCase());
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player) return cb?.({ error: 'PLAYER_NOT_IN_ROOM' });

    roomManager.bindSocket(room.code, clientId, socket.id);
    socket.join(room.code);
    socket.data.clientId = clientId;
    socket.data.roomCode = room.code;

    cb?.({ room: roomManager.toPublicState(room) });
    broadcastState(room);
  });

  // [KULLANICI İSTEĞİ] "Maç bittikten sonra tekrar oyna butonu gelsin." — maç bittiyse,
  // taraflardan biri odayı (aynı kod, aynı iki oyuncu) LOBBY'ye resetleyip yeni bir draft
  // başlatılabilir hale getirebilir. Maç zaten bittiği için (kaybedecek bir şey olmadığından)
  // tek taraflı onay yeterli — draft/açık arttırmadaki gibi iki taraflı bir onaya gerek yok.
  socket.on('room:rematch', ({ code } = {}, cb) => {
    const room = roomManager.getRoom((code || socket.data.roomCode || '').toUpperCase());
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const isMember = room.players.some((p) => p.clientId === socket.data.clientId);
    if (!isMember) return cb?.({ error: 'NOT_IN_ROOM' });
    if (room.status !== STATUS.FINISHED) return cb?.({ error: 'MATCH_NOT_FINISHED' });

    roomManager.resetForRematch(room);
    cb?.({ ok: true, room: roomManager.toPublicState(room) });
    io.to(room.code).emit('room:rematch');
    broadcastState(room);
  });

  // [KULLANICI İSTEĞİ] "Header'a ana sayfaya dönmek için buton, oyundayken de oyundan çıkmak
  // için bir şey ekle" — istemci tarafı zaten yerel state.room'u sıfırlayıp lobiye dönüyordu
  // ama socket bu odaya HÂLÂ join'li kalıyordu (bkz. socket.join(room.code) yukarıda) — bu
  // yüzden odadaki başka bir olay (ör. rakip "Tekrar Oyna"ya basınca) yayınlanan room:state/
  // room:rematch, ayrılmış istemciye de ulaşıp onu sessizce odaya geri sürükleyebiliyordu. Bu
  // event, gerçek bir socket kopması (disconnect) ile AYNI etkiyi (handleDisconnect — oyuncu
  // "bağlı değil" işaretlenir, hazırım oyu düşer, draft/maç durumu DOKUNULMAZ — rakip
  // reconnect'te olduğu gibi devam edebilir) kasıtlı/istemci tetiklemeli olarak uygular, ARTI
  // socket'i o odanın broadcast grubundan gerçekten çıkarır (socket.leave).
  socket.on('room:leave', ({ code } = {}, cb) => {
    const targetCode = (code || socket.data.roomCode || '').toUpperCase();
    const room = roomManager.getRoom(targetCode);
    if (room) {
      const changed = roomManager.handleDisconnect(socket.id);
      socket.leave(room.code);
      if (changed) broadcastState(changed);
    }
    if (socket.data.roomCode === targetCode) socket.data.roomCode = null;
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const room = roomManager.handleDisconnect(socket.id);
    if (room) broadcastState(room);
  });
}

module.exports = { registerRoomSockets };
