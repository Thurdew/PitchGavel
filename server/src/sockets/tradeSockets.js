// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] Socket katmanı — tüm kural/doğrulama
// TradeEngine'de (sunucu asıl otorite); burada sadece oda/oyuncu çözümleme ve ack dönüşü var.
const { STATUS } = require('../rooms/RoomManager');

function registerTradeSockets(io, socket, ctx) {
  const { roomManager, tradeEngine } = ctx;

  function getRoom(code) {
    return roomManager.getRoom((code || socket.data.roomCode || '').toUpperCase());
  }
  function resolve(code, cb) {
    const room = getRoom(code);
    if (!room) { cb?.({ error: 'ROOM_NOT_FOUND' }); return null; }
    if (!socket.data.clientId || !room.players.find((p) => p.clientId === socket.data.clientId)) {
      cb?.({ error: 'NOT_IN_ROOM' }); return null;
    }
    return room;
  }

  // İstemci takas ekranına girdiğinde (ya da sayfayı yenileyip yeniden bağlandığında) kendi
  // görünümünü ister — pazarlık gizli olduğu için state her oyuncuya ayrı gönderiliyor.
  socket.on('trade:sync', ({ code } = {}, cb) => {
    const room = resolve(code, cb);
    if (!room) return;
    if (room.status !== STATUS.TRADE) return cb?.({ error: 'TRADE_ROUND_NOT_ACTIVE' });
    tradeEngine.emitTrade(room);
    cb?.({ ok: true });
  });

  socket.on('trade:offer', ({ code, toClientId, givePlayerId, getPlayerId } = {}, cb) => {
    const room = resolve(code, cb);
    if (!room) return;
    cb?.(tradeEngine.createOffer(room, socket.data.clientId, { toClientId, givePlayerId, getPlayerId }));
  });

  socket.on('trade:accept', ({ code, offerId } = {}, cb) => {
    const room = resolve(code, cb);
    if (!room) return;
    cb?.(tradeEngine.acceptOffer(room, socket.data.clientId, offerId));
  });

  // Reddet (alıcı) ve geri çek (gönderen) aynı işlem — teklifi listeden düşürür.
  socket.on('trade:cancel', ({ code, offerId } = {}, cb) => {
    const room = resolve(code, cb);
    if (!room) return;
    cb?.(tradeEngine.cancelOffer(room, socket.data.clientId, offerId));
  });

  socket.on('trade:doneToggle', ({ code } = {}, cb) => {
    const room = resolve(code, cb);
    if (!room) return;
    cb?.(tradeEngine.toggleDone(room, socket.data.clientId));
  });
}

module.exports = { registerTradeSockets };
