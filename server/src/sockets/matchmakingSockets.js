// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ SONRASI FAZ 4] bkz. claude.md
// "Yabancılarla Online Eşleşme". Mevcut roomSockets.js/draftSockets.js ile AYNI
// registerXSockets(io, socket, ctx) deseni.
function registerMatchmakingSockets(io, socket, ctx) {
  const { matchmaker } = ctx;

  socket.on('matchmaking:join', ({ clientId, name, draftMode, playerPool } = {}, cb) => {
    if (!clientId || !name) return cb?.({ error: 'MISSING_FIELDS' });
    // Eşleşme olursa matchmaking:matched ZATEN Matchmaker.join içinden ayrıca emit edilir.
    matchmaker.join(clientId, name, socket.id, draftMode, playerPool);
    cb?.({ queued: true });
  });

  socket.on('matchmaking:leave', ({ clientId } = {}, cb) => {
    matchmaker.leave(clientId);
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    if (socket.data.clientId) matchmaker.leave(socket.data.clientId);
  });
}

module.exports = { registerMatchmakingSockets };
