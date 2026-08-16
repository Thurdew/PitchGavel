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

  socket.on('disconnect', () => {
    const room = roomManager.handleDisconnect(socket.id);
    if (room) broadcastState(room);
  });
}

module.exports = { registerRoomSockets };
