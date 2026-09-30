// Faz 16 doğrulama scripti: Mağaza v2 — kozmetikler + tepkiler (bkz. claude.md).
//  (A) Birim: isValidCosmetic, setCosmetic, equippedCosmetics'in sahip olunmayanı süzmesi,
//      ownedReactionPacks, katalogdaki her ürünün satın alınabilmesi.
//  (B) Uçtan uca (HTTP + socket): sahip olunmayan kozmetik 403, satın al + tak, odaya bağlanınca
//      kozmetiğin herkese yayınlanması (sahiplik süzgecinden geçerek), misafirin ücretsiz tepki
//      gönderebilmesi ama paket tepkisini gönderememesi, paket sahibinin gönderebilmesi, tepkinin
//      odadaki diğer oyuncuya ulaşması, hız sınırı (3 birikir).
process.env.RESEND_API_KEY = ''; // bkz. phase14

const assert = require('assert');

async function unitTests() {
  const { DatabaseSync } = require('node:sqlite');
  const { wrapSqlite } = require('../src/db/adapter');
  const { initSchema } = require('../src/db/db');
  const { AuthService } = require('../src/auth/AuthService');
  const { CoinService } = require('../src/coins/CoinService');
  const { isValidCosmetic, COSMETIC_ITEMS, STORE_ITEMS } = require('../src/shared/economy');

  assert(isValidCosmetic('frame', 'gold'));
  assert(isValidCosmetic('frame', null), 'null = varsayılana dön');
  assert(!isValidCosmetic('frame', 'yok'));
  assert(!isValidCosmetic('reactions', 'market'), 'tepki paketi takılan bir slot değil');
  assert(!isValidCosmetic('title', 'gold'), 'başka slotun anahtarı geçersiz');
  assert(!isValidCosmetic('__proto__', null));
  console.log('[test16] isValidCosmetic ✅');

  const raw = new DatabaseSync(':memory:');
  const db = wrapSqlite(raw);
  await initSchema(db);
  const auth = new AuthService(db);
  clearInterval(auth._sweepTimer);
  const coins = new CoinService(db);
  const u = (await auth.register('cos@example.com', 'parola1234', 'Cos')).user;
  assert.deepStrictEqual(u.cosmetics, {}, 'yeni kullanıcıda kozmetik yok');

  raw.prepare('UPDATE users SET coins = 100000 WHERE id = ?').run(u.id);
  for (const item of STORE_ITEMS) assert((await coins.buy(u.id, item.id)).ok, `satın alınabilmeli: ${item.id}`);
  assert.strictEqual((await coins.ownedItemIds(u.id)).length, STORE_ITEMS.length);
  console.log('[test16] katalogdaki', STORE_ITEMS.length, 'ürünün hepsi satın alınabiliyor ✅');

  const v = (await auth.register('cos2@example.com', 'parola1234', 'Cos2')).user;
  await coins.db.run('UPDATE users SET coins = 5000 WHERE id = ?', v.id);
  await coins.buy(v.id, 'frame:neon');
  let user = await auth.setCosmetic(v.id, 'frame', 'neon');
  assert.strictEqual(user.cosmetics.frame, 'neon');
  // Sahip olunmayan anahtar DB'ye elle yazılsa bile odaya yansımamalı.
  raw.prepare('UPDATE users SET cosmetics = ? WHERE id = ?').run(JSON.stringify({ frame: 'neon', title: 'king', pitch: 'snow' }), v.id);
  user = await auth.getUserById(v.id);
  assert.deepStrictEqual(await coins.equippedCosmetics(v.id, user.cosmetics), { frame: 'neon' }, 'sadece sahip olunan kozmetik geçmeli');
  user = await auth.setCosmetic(v.id, 'frame', null);
  assert.strictEqual(user.cosmetics.frame, undefined, 'null ile çıkarılmalı');
  raw.prepare('UPDATE users SET cosmetics = ? WHERE id = ?').run('bozuk{json', v.id);
  assert.deepStrictEqual((await auth.getUserById(v.id)).cosmetics, {}, 'bozuk JSON boş obje olmalı');
  assert.deepStrictEqual(await coins.ownedReactionPacks(v.id), []);
  assert.deepStrictEqual(await coins.ownedReactionPacks(u.id), ['reactions:market']);
  assert(COSMETIC_ITEMS.every((i) => i.id === `${i.type}:${i.key}`), 'id = type:key olmalı');
  console.log('[test16] setCosmetic + sahiplik süzgeci + bozuk kayıt + tepki paketleri ✅');
}

async function e2e() {
  const { server, db } = require('../src/index');
  const { io: ioClient } = require('socket.io-client');
  const PORT = 3984;
  const BASE = `http://localhost:${PORT}`;
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test16] sunucu ayakta, port', PORT);

  const connect = () => ioClient(BASE, { transports: ['websocket'] });
  const once = (s, ev) => new Promise((resolve) => s.once(ev, resolve));
  const emitAck = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));
  async function http(method, path, cookie, body) {
    const res = await fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, json: await res.json(), cookie: setCookie ? setCookie.split(';')[0] : null };
  }
  const stamp = Date.now();
  const r = await http('POST', '/api/auth/register', null, { email: `cos-${stamp}@example.com`, password: 'parola1234', displayName: 'Kozmetik' });
  const H = { cookie: r.cookie, id: r.json.user.id };
  await db.run('UPDATE users SET email_verified_at = ?, coins = 3000 WHERE id = ?', Date.now(), H.id);

  assert.strictEqual((await http('POST', '/api/auth/cosmetic', H.cookie, { slot: 'frame', key: 'gold' })).status, 403, 'sahip olmadan takılamaz');
  assert.strictEqual((await http('POST', '/api/auth/cosmetic', H.cookie, { slot: 'frame', key: 'olmayan' })).status, 400);
  assert.strictEqual((await http('POST', '/api/auth/cosmetic', null, { slot: 'frame', key: null })).status, 401);
  assert((await http('POST', '/api/store/buy', H.cookie, { itemId: 'frame:gold' })).json.ok);
  assert((await http('POST', '/api/store/buy', H.cookie, { itemId: 'reactions:market' })).json.ok);
  const eq = await http('POST', '/api/auth/cosmetic', H.cookie, { slot: 'frame', key: 'gold' });
  assert.strictEqual(eq.json.user.cosmetics.frame, 'gold');
  assert.strictEqual(eq.json.user.coins, 3000 - 1200 - 400);
  console.log('[test16] kozmetik satın al + tak, sahiplik 403 ✅');

  const host = connect();
  const guest = connect();
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);
  const created = await emitAck(host, 'room:create', { clientId: `cos-h-${stamp}`, name: 'Host' });
  const code = created.room.code;
  await emitAck(guest, 'room:join', { clientId: `cos-g-${stamp}`, name: 'Misafir', code });

  const statePromise = new Promise((resolve) => guest.on('room:state', (s) => { if (s.players.some((p) => p.cosmetics && p.cosmetics.frame === 'gold')) resolve(s); }));
  const ticket = (await http('POST', '/api/rooms/ticket', H.cookie)).json.ticket;
  assert((await emitAck(host, 'room:bindAccount', { ticket })).ok);
  const seen = await statePromise;
  const hostPub = seen.players.find((p) => p.name === 'Host');
  assert.deepStrictEqual(hostPub.cosmetics, { frame: 'gold' }, 'misafir, host\'un çerçevesini görmeli');
  assert(!('reactionPacks' in hostPub) && !('reactBucket' in hostPub), 'tepki paketleri/kovası yayınlanmamalı');
  console.log('[test16] odaya bağlanınca kozmetik herkese yayınlanıyor ✅');

  // Tepkiler: misafir ücretsizi gönderebilir, paketi gönderemez.
  const got = once(host, 'room:reaction');
  assert((await emitAck(guest, 'room:react', { reactionId: 'fire' })).ok);
  const msg = await got;
  assert.strictEqual(msg.reactionId, 'fire');
  assert.strictEqual((await emitAck(guest, 'room:react', { reactionId: 'robbery' })).error, 'REACTION_NOT_OWNED');
  assert.strictEqual((await emitAck(guest, 'room:react', { reactionId: 'toString' })).error, 'UNKNOWN_REACTION', 'prototip anahtarları geçmemeli');
  assert((await emitAck(host, 'room:react', { reactionId: 'robbery' })).ok, 'paket sahibi gönderebilmeli');
  // Hız sınırı: kovada 3 hak — misafir 1 harcadı (reddedilenler harcamaz), 2 daha gider, 4. reddedilir.
  assert((await emitAck(guest, 'room:react', { reactionId: 'clap' })).ok);
  assert((await emitAck(guest, 'room:react', { reactionId: 'clap' })).ok);
  assert.strictEqual((await emitAck(guest, 'room:react', { reactionId: 'clap' })).error, 'RATE_LIMITED');
  console.log('[test16] tepkiler: ücretsiz/paket ayrımı, yayın, hız sınırı ✅');

  host.close(); guest.close();
  server.close();
  console.log('[test16] (B) uçtan uca testi tamam');
}

(async () => {
  try {
    await unitTests();
    await e2e();
    console.log('[test16] TÜM TESTLER GEÇTİ ✅');
    process.exit(0);
  } catch (e) {
    console.error('[test16] BAŞARISIZ ❌', e);
    process.exit(1);
  }
})();
