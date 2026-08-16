const { STATUS } = require('../rooms/RoomManager');
const { playRoundRobin } = require('../match/orchestrate');

function registerMatchSockets(io, socket, ctx) {
  const { roomManager } = ctx;

  // [KULLANICI İSTEĞİ] "Maç başlarken de iki oyuncuda hazır versin." — status FINISHED ise
  // (sonuç zaten var) her zaman olduğu gibi cache'ten döner (reconnect senaryosu). Aksi halde
  // artık tek çağrı maçı BAŞLATMIYOR — her çağrı caller'ın "hazırım" oyunu açıp/kapatıyor,
  // sadece iki oy da varken gerçek simülasyon tetiklenir (draft:start ile aynı desen).
  socket.on('match:simulate', ({ code } = {}, cb) => {
    const room = roomManager.getRoom((code || socket.data.roomCode || '').toUpperCase());
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const isMember = room.players.some((p) => p.clientId === socket.data.clientId);
    if (!isMember) return cb?.({ error: 'NOT_IN_ROOM' });

    if (room.status === STATUS.FINISHED && room.matchState) {
      cb?.({ ok: true, result: room.matchState, cached: true });
      return;
    }
    if (room.status !== STATUS.MATCH) return cb?.({ error: 'NOT_READY_FOR_MATCH' });

    const clientId = socket.data.clientId;
    if (room.readyVotes.has(clientId)) room.readyVotes.delete(clientId);
    else room.readyVotes.add(clientId);
    io.to(room.code).emit('room:state', roomManager.toPublicState(room));

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — eşik odadaki TÜM oyuncu sayısı.
    if (room.readyVotes.size < room.players.length) {
      return cb?.({ ok: true, waiting: true });
    }
    room.readyVotes = new Set();

    const result = playRoundRobin(room);
    if (result.error) return cb?.({ error: result.error });

    room.matchState = result;
    room.status = STATUS.FINISHED;
    room.updatedAt = Date.now();

    cb?.({ ok: true, result });
    // room.status değişikliğini yay (bkz. lineupSockets.js'deki aynı desen) — aksi halde
    // istemcideki eski 'match' durumu güncellenmez ve sonuç ekranına geçilmez.
    io.to(room.code).emit('room:state', roomManager.toPublicState(room));
    io.to(room.code).emit('match:result', result);
  });
}

module.exports = { registerMatchSockets };
