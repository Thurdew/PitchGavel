// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ SONRASI FAZ 4] bkz. claude.md
// "Yabancılarla Online Eşleşme". Mevcut roomSockets.js/draftSockets.js ile AYNI
// registerXSockets(io, socket, ctx) deseni.
const { isValidSecret } = require('../rooms/RoomManager');
const { str } = require('./safeHandlers');

function registerMatchmakingSockets(io, socket, ctx) {
  const { matchmaker } = ctx;

  socket.on('matchmaking:join', ({ clientId, clientSecret, name, draftMode, playerPool } = {}, cb) => {
    if (!clientId || !name) return cb?.({ error: 'MISSING_FIELDS' });
    if (typeof clientId !== 'string' || clientId.length > 100 || !isValidSecret(clientSecret)) return cb?.({ error: 'INVALID_IDENTITY' });
    // Eşleşme olursa matchmaking:matched ZATEN Matchmaker.join içinden ayrıca emit edilir.
    const result = matchmaker.join(clientId, str(name), socket.id, str(draftMode), str(playerPool), clientSecret);
    if (result && result.error) return cb?.({ error: result.error });
    cb?.({ queued: true });
  });

  // [GÜVENLİK] Sadece bu socket'in kendi kuyruk kaydı silinebilir — başkasının clientId'sini
  // göndererek onu kuyruktan atmak artık mümkün değil.
  socket.on('matchmaking:leave', (_payload, cb) => {
    matchmaker.leaveBySocket(socket.id);
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    matchmaker.leaveBySocket(socket.id);
  });
}

module.exports = { registerMatchmakingSockets };
