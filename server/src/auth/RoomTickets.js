// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Bir odadaki oyuncuyu GÜVENİLİR
// şekilde bir hesaba bağlamak için kısa ömürlü, tek kullanımlık bilet.
//
// Neden doğrudan socket cookie'si değil: socket'in handshake cookie'si bağlantı kurulduğu ANKİ
// durumu yansıtır — sayfa yenilenmeden giriş yapılırsa bayat kalır (bkz. Faz 3 "kimlik doğrulama
// tasarımı" notu). Neden HTTP'ye clientId gönderip orada bağlamak değil: clientId'ler odadaki
// herkese açık (toPublicState) — biri başkasının oyuncusunu kendi hesabına bağlayıp onun
// kazandığı coin'i alabilirdi. Bilet ikisini birleştiriyor: HTTP (güncel cookie) → bilet,
// socket (kim olduğu sunucuca bilinen bağlantı) → bileti kullanır.
const crypto = require('crypto');

const TICKET_TTL_MS = 60 * 1000;

class RoomTickets {
  constructor() {
    this.tickets = new Map(); // ticket → { userId, ip, expiresAt }
  }

  issue(userId, ip) {
    this._sweep();
    const ticket = crypto.randomBytes(24).toString('hex');
    this.tickets.set(ticket, { userId, ip: ip || null, expiresAt: Date.now() + TICKET_TTL_MS });
    return ticket;
  }

  // Tek kullanımlık — geçerli olsa da olmasa da silinir.
  consume(ticket) {
    const entry = typeof ticket === 'string' ? this.tickets.get(ticket) : null;
    if (!entry) return null;
    this.tickets.delete(ticket);
    return entry.expiresAt > Date.now() ? entry : null;
  }

  _sweep() {
    const now = Date.now();
    for (const [t, e] of this.tickets) if (e.expiresAt <= now) this.tickets.delete(t);
  }
}

module.exports = { RoomTickets, TICKET_TTL_MS };
