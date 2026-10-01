// [GÜVENLİK SERTLEŞTİRME — KOD İNCELEMESİ] Socket event handler'ları için ortak güvenlik ağı.
//
// Neden: socket.io v4 bir handler'ın fırlattığı hatayı YAKALAMIYOR — hata doğrudan Node sürecine
// kadar çıkıp sunucuyu çökertiyordu (ör. `room:join`'e `code: 1` göndermek `code.toUpperCase is
// not a function` ile tüm süreci kapatıyordu; odalar bellekte tutulduğu için o an oynanan TÜM
// maçlar siliniyordu). Async handler'larda reddedilen bir promise de (Node 15+ varsayılanı) aynı
// şekilde süreci kapatır.
//
// Bu modül her socket'in `on` metodunu sarar:
//   1. Payload düz bir obje değilse (null, sayı, dizi, string...) `{}` yapılır — handler'lardaki
//      `({ code } = {})` destructuring'i null'da patlamasın.
//   2. `cb` fonksiyon değilse yok sayılır — `cb?.()` sadece null/undefined'ı korur, `cb = 5`
//      gönderilirse "cb is not a function" fırlatırdı.
//   3. Senkron hata ve async reddedilme yakalanır, loglanır, istemciye SERVER_ERROR döner.
// Rezerve socket.io event'leri (disconnect vb.) sarılmaz — onların argümanları sunucudan gelir.

const RESERVED_EVENTS = new Set(['disconnect', 'disconnecting', 'error', 'newListener', 'removeListener']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function makeSafe(event, handler) {
  return function safeHandler(payload, cb, ...rest) {
    const safePayload = isPlainObject(payload) ? payload : {};
    const safeCb = typeof cb === 'function' ? cb : undefined;
    const fail = (err) => {
      console.error(`[socket] '${event}' handler hatası:`, err && err.stack ? err.stack : err);
      try { safeCb?.({ error: 'SERVER_ERROR' }); } catch (e) { /* istemci ack'i bir kez kullanılabilir */ }
    };
    try {
      const result = handler.call(this, safePayload, safeCb, ...rest);
      if (result && typeof result.then === 'function') result.catch(fail);
      return result;
    } catch (err) {
      fail(err);
      return undefined;
    }
  };
}

function hardenSocket(socket) {
  const originalOn = socket.on.bind(socket);
  socket.on = (event, handler) => {
    if (RESERVED_EVENTS.has(event) || typeof handler !== 'function') return originalOn(event, handler);
    return originalOn(event, makeSafe(event, handler));
  };
  return socket;
}

// Socket payload'ından gelen bir değeri güvenle string'e çevirir — string değilse ''.
function str(v) { return typeof v === 'string' ? v : ''; }

// Oda kodu: string değilse ya da çok uzunsa ''. Büyük harfe çevrilmiş döner.
function roomCode(v) {
  const s = str(v);
  return s.length > 0 && s.length <= 12 ? s.toUpperCase() : '';
}

module.exports = { hardenSocket, makeSafe, isPlainObject, str, roomCode };
