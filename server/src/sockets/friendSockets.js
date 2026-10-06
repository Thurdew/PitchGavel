// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ARKADAŞLAR] Socket'i bir hesaba bağlar ki arkadaşları onu
// "çevrimiçi" görsün ve arkadaşlık değişikliklerinden (`friends:changed`) anında haberi olsun.
// Kimlik room:bindAccount ile AYNI yoldan gelir: HTTP'den tek kullanımlık bilet (güncel cookie),
// socket'ten kullanılır — bkz. auth/RoomTickets.js.
function registerFriendSockets(io, socket, ctx) {
  const { presence } = ctx;

  socket.on('presence:hello', ({ ticket } = {}, cb) => {
    const entry = ctx.roomTickets.consume(ticket);
    if (!entry) return cb?.({ error: 'INVALID_TICKET' });
    presence.attach(entry.userId, socket.id);
    socket.data.userId = entry.userId;
    cb?.({ ok: true });
  });

  // Çıkış yapınca istemci bunu gönderir — socket açık kalsa da artık o hesap adına görünmez.
  socket.on('presence:bye', (_payload, cb) => {
    presence.detach(socket.id);
    socket.data.userId = null;
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    presence.detach(socket.id);
  });
}

module.exports = { registerFriendSockets };
