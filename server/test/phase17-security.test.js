// [GÜVENLİK — KOD İNCELEMESİ] Kod incelemesinde bulunan açıkların regresyon testleri:
//   1. Bozuk socket payload'ları sunucuyu çökertmiyor.
//   2. Koltuk ele geçirme: başkasının clientId'siyle reconnect/join reddediliyor.
//   3. Eşleşme kuyruğu: başkasının clientId'siyle kuyruğa girilemiyor / kuyruktan atılamıyor.
//   4. Oturum token'ları DB'de hash'li; bozuk cookie 500 vermiyor.
//   5. Bilinmeyen sayfa yolları 404 dönüyor.
const assert = require('assert');
const crypto = require('crypto');
const { server, db } = require('../src/index');
const { io: ioClient } = require('socket.io-client');

const PORT = 3983;
const BASE = `http://localhost:${PORT}`;

function connect() { return ioClient(BASE, { transports: ['websocket'] }); }
function once(socket, event) { return new Promise((resolve) => socket.once(event, resolve)); }
function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}
function emitAckTimeout(socket, event, payload, ms = 1500) {
  return Promise.race([emitAck(socket, event, payload), new Promise((r) => setTimeout(() => r({ timeout: true }), ms))]);
}
const secretOf = (id) => `seat-secret-${id}-0123456789`;

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test17] sunucu ayakta, port', PORT);

  // ---------- 1. Bozuk payload'lar ----------
  const evil = connect();
  await once(evil, 'connect');
  const malformed = [
    ['room:join', { clientId: 'x', clientSecret: secretOf('x'), code: 1 }],
    ['room:join', null],
    ['room:reconnect', { clientId: 'x', code: { toUpperCase: 1 } }],
    ['room:create', { clientId: 'y', clientSecret: secretOf('y'), name: 12345 }],
    ['room:create', 'string-payload'],
    ['draft:bid', { code: 7, amount: 'çok' }],
    ['lineup:submit', { code: [], assignment: null }],
    ['match:simulate', { code: {} }],
    ['trade:offer', { code: 5 }],
    ['room:rematch', { code: true }],
    ['room:leave', { code: 99 }],
    ['matchmaking:join', { clientId: 1, name: {} }],
  ];
  for (const [event, payload] of malformed) {
    // Bir kısmı ack döner, bir kısmı dönmeyebilir — önemli olan sürecin ayakta kalması.
    await emitAckTimeout(evil, event, payload, 300);
  }
  // Ack fonksiyonu yerine sayı göndermek (cb?.() sadece null/undefined'ı korur).
  evil.emit('room:join', { clientId: 'z', code: 'ABCDE' }, 5);
  await new Promise((r) => setTimeout(r, 200));
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  assert.strictEqual(health.ok, true, 'bozuk payload\'lardan sonra sunucu ayakta olmalı');
  const normalCreate = await emitAck(evil, 'room:create', { clientId: 'after-evil', clientSecret: secretOf('after-evil'), name: 'Normal' });
  assert(normalCreate.room && normalCreate.room.code, 'bozuk payload\'lardan sonra normal akış çalışmalı');
  // Sayı olarak gelen isim varsayılana düşmeli, string'e zorlanmamalı.
  const numName = await emitAck(connect(), 'room:create', { clientId: 'num-name', clientSecret: secretOf('num-name'), name: 12345 });
  assert.strictEqual(numName.room.players[0].name, 'Oyuncu');
  console.log('[test17] bozuk payload\'lar sunucuyu çökertmiyor ✅');

  // ---------- 2. Koltuk ele geçirme ----------
  const host = connect(); const guest = connect(); const attacker = connect();
  await Promise.all([once(host, 'connect'), once(guest, 'connect'), once(attacker, 'connect')]);
  const created = await emitAck(host, 'room:create', { clientId: 'sec-host', clientSecret: secretOf('sec-host'), name: 'Host' });
  const code = created.room.code;
  const joined = await emitAck(guest, 'room:join', { clientId: 'sec-guest', clientSecret: secretOf('sec-guest'), name: 'Guest', code });
  assert(!joined.error, 'misafir katılabilmeli');
  // Saldırgan, room:state'te herkese açık olan misafir clientId'sini biliyor.
  assert(joined.room.players.some((p) => p.clientId === 'sec-guest'));
  assert(!JSON.stringify(joined.room).includes('secret'), 'gizli anahtar/hash yayınlanmamalı');

  const hijackReconnect = await emitAck(attacker, 'room:reconnect', { clientId: 'sec-guest', clientSecret: secretOf('attacker'), code });
  assert.strictEqual(hijackReconnect.error, 'SEAT_TAKEN', 'yanlış anahtarla reconnect reddedilmeli: ' + JSON.stringify(hijackReconnect));
  const hijackNoSecret = await emitAck(attacker, 'room:reconnect', { clientId: 'sec-guest', code });
  assert.strictEqual(hijackNoSecret.error, 'SEAT_TAKEN', 'anahtarsız reconnect reddedilmeli');
  const hijackJoin = await emitAck(attacker, 'room:join', { clientId: 'sec-guest', clientSecret: secretOf('attacker'), name: 'X', code });
  assert.strictEqual(hijackJoin.error, 'SEAT_TAKEN', 'yanlış anahtarla var olan koltuğa join reddedilmeli');
  // Saldırganın socket'i misafirin kimliğine bürünmemiş olmalı: hazır oyu veremez.
  const attackerReady = await emitAck(attacker, 'draft:readyToggle', { code });
  assert.strictEqual(attackerReady.error, 'NOT_IN_ROOM', 'saldırgan odada oyuncu sayılmamalı');

  // Gerçek sahibi (yeni bir sekme/bağlantıyla) koltuğunu geri alabilmeli.
  const guest2 = connect();
  await once(guest2, 'connect');
  const legit = await emitAck(guest2, 'room:reconnect', { clientId: 'sec-guest', clientSecret: secretOf('sec-guest'), code });
  assert(!legit.error && legit.room, 'doğru anahtarla reconnect çalışmalı: ' + JSON.stringify(legit));
  console.log('[test17] başkasının koltuğu clientId ile ele geçirilemiyor, sahibi geri dönebiliyor ✅');

  // ---------- 3. Eşleşme kuyruğu ----------
  const victim = connect(); const thief = connect(); const partner = connect();
  await Promise.all([once(victim, 'connect'), once(thief, 'connect'), once(partner, 'connect')]);
  const vq = await emitAck(victim, 'matchmaking:join', { clientId: 'mm-victim', clientSecret: secretOf('mm-victim'), name: 'V', draftMode: 'blind', playerPool: 'super-lig' });
  assert.strictEqual(vq.queued, true);
  const steal = await emitAck(thief, 'matchmaking:join', { clientId: 'mm-victim', clientSecret: secretOf('thief'), name: 'T', draftMode: 'blind', playerPool: 'super-lig' });
  assert.strictEqual(steal.error, 'CLIENT_ID_TAKEN', 'başkasının clientId\'siyle kuyruğa girilememeli');
  await emitAck(thief, 'matchmaking:leave', { clientId: 'mm-victim' }); // sadece kendi kaydını silebilir
  const matched = once(victim, 'matchmaking:matched');
  await emitAck(partner, 'matchmaking:join', { clientId: 'mm-partner', clientSecret: secretOf('mm-partner'), name: 'P', draftMode: 'blind', playerPool: 'super-lig' });
  const m = await Promise.race([matched, new Promise((r) => setTimeout(() => r(null), 2000))]);
  assert(m && m.code, 'kurban kuyrukta kalmış ve eşleşmiş olmalı');
  console.log('[test17] eşleşme kuyruğu başkasının clientId\'siyle ezilemiyor/boşaltılamıyor ✅');

  // ---------- 4. Token hash'leme + bozuk cookie ----------
  const email = `sec-${Date.now()}@example.com`;
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', displayName: 'Sec' }),
  });
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const rawToken = decodeURIComponent(cookie.split('=')[1]);
  const rawRow = await db.get('SELECT 1 AS ok FROM sessions WHERE token = ?', rawToken);
  assert(!rawRow, 'oturum token\'ı DB\'de düz saklanmamalı');
  const hashedRow = await db.get('SELECT hashed FROM sessions WHERE token = ?', crypto.createHash('sha256').update(rawToken).digest('hex'));
  assert(hashedRow && Number(hashedRow.hashed) === 1, 'oturum token\'ının hash\'i saklanmalı');
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } }).then((r) => r.json());
  assert.strictEqual(me.user.email, email, 'hash\'li token ile oturum hâlâ çalışmalı');
  const badCookie = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: 'kk_session=%E0%A4%A' } });
  assert.strictEqual(badCookie.status, 200, 'bozuk cookie 500 vermemeli');
  assert.strictEqual((await badCookie.json()).user, null);
  console.log('[test17] oturum token\'ları hash\'li saklanıyor, bozuk cookie 500 vermiyor ✅');

  // Bilinmeyen e-postayla giriş de scrypt maliyeti ödemeli (zamanlama farkı yok).
  const t0 = Date.now();
  await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `yok-${Date.now()}@example.com`, password: 'password123' }) });
  const unknownMs = Date.now() - t0;
  const t1 = Date.now();
  await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'yanlis-parola' }) });
  const knownMs = Date.now() - t1;
  console.log(`[test17] login süreleri — kayıtsız: ${unknownMs}ms, kayıtlı: ${knownMs}ms`);
  assert(unknownMs >= knownMs * 0.4, 'kayıtsız e-posta belirgin şekilde daha hızlı yanıt almamalı');
  console.log('[test17] kayıtsız e-postayla giriş de aynı maliyette (zamanlama sızıntısı yok) ✅');

  // ---------- 5. 404 ----------
  const notFound = await fetch(`${BASE}/boyle-bir-sayfa-yok`);
  assert.strictEqual(notFound.status, 404, 'bilinmeyen yol 404 dönmeli');
  for (const p of ['/', '/players', '/gizlilik', '/nasil-oynanir', '/players/']) {
    assert.strictEqual((await fetch(`${BASE}${p}`)).status, 200, `${p} 200 dönmeli`);
  }
  console.log('[test17] bilinmeyen yollar 404, bilinen sayfalar 200 ✅');

  console.log('[test17] TÜM GÜVENLİK TESTLERİ GEÇTİ ✅');
  process.exit(0);
}

main().catch((e) => { console.error('[test17] HATA:', e); process.exit(1); });
