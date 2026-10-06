// Faz 19 doğrulama scripti: Arkadaşlar + presence (bkz. claude.md).
//  (A) Birim (bellek içi DB, gerçek initSchema): arkadaş kodu üretimi/normalizasyonu, istek →
//      kabul/red, karşılıklı istek = otomatik kabul, tekrar istek, kendine istek, engelleme
//      (engellenen NOT_FOUND görür, arkadaşlık silinir), geri çekme/çıkarma, limitler.
//  (B) Uçtan uca (gerçek HTTP + socket): doğrulanmamış hesap 403, istek → `friends:changed`
//      sinyali, kabul, presence:hello ile çevrimiçi, lobide oda kodu + joinable, oyun başlayınca
//      kod gizlenir, "durumumu gizle" ayarı, misafir 401.
process.env.RESEND_API_KEY = '';

const assert = require('assert');

async function unitTests() {
  const { DatabaseSync } = require('node:sqlite');
  const { wrapSqlite } = require('../src/db/adapter');
  const { initSchema } = require('../src/db/db');
  const { AuthService } = require('../src/auth/AuthService');
  const { FriendService, FRIEND_LIMITS, normalizeCode } = require('../src/friends/FriendService');

  const raw = new DatabaseSync(':memory:');
  const db = wrapSqlite(raw);
  await initSchema(db);
  await initSchema(db); // guard'lı ALTER/index iki kez çalışınca bozulmamalı
  const auth = new AuthService(db);
  clearInterval(auth._sweepTimer);
  const fs = new FriendService(db);
  const mk = async (name) => (await auth.register(`${name}@example.com`, 'parola1234', name)).user.id;
  const codeOf = async (id) => (await fs.overview(id)).code;

  const A = await mk('ali');
  const B = await mk('berk');
  const C = await mk('cem');

  const codeA = await codeOf(A);
  assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codeA), codeA);
  assert.strictEqual(await codeOf(A), codeA, 'kod sabit kalmalı');
  assert.notStrictEqual(await codeOf(B), codeA);
  assert.strictEqual(normalizeCode(codeA.toLowerCase().replace('-', ' ')), codeA.replace('-', ''));
  assert.strictEqual(normalizeCode('ABC'), null);
  assert.strictEqual(normalizeCode('0OOO-1III'), null, 'karışan karakterler alfabede yok');
  console.log('[test19] arkadaş kodu üretimi + normalizasyon ✅', codeA);

  assert.strictEqual((await fs.request(A, 'ZZZZ-ZZZZ')).error, 'NOT_FOUND');
  assert.strictEqual((await fs.request(A, 'xx')).error, 'INVALID_CODE');
  assert.strictEqual((await fs.request(A, codeA)).error, 'SELF');

  const codeB = await codeOf(B);
  let r = await fs.request(A, codeB);
  assert.strictEqual(r.status, 'pending');
  assert.strictEqual(r.user.displayName, 'berk');
  assert.strictEqual((await fs.request(A, codeB)).error, 'ALREADY_REQUESTED');
  let ovA = await fs.overview(A);
  let ovB = await fs.overview(B);
  assert.strictEqual(ovA.outgoing.length, 1);
  assert.strictEqual(ovB.incoming.length, 1);
  assert.strictEqual(ovB.incoming[0].id, A);
  assert.strictEqual((await fs.respond(A, B, true)).error, 'NO_REQUEST', 'kendi isteğini kabul edemez');
  assert.strictEqual((await fs.respond(B, A, true)).status, 'accepted');
  assert(await fs.areFriends(A, B));
  assert.deepStrictEqual(await fs.friendIds(A), [B]);
  assert.strictEqual((await fs.request(B, codeA)).error, 'ALREADY_FRIENDS');
  console.log('[test19] istek → kabul ✅');

  // Karşılıklı istek: C → A bekliyorken A → C atarsa doğrudan arkadaş olurlar.
  assert.strictEqual((await fs.request(C, codeA)).status, 'pending');
  assert.strictEqual((await fs.request(A, await codeOf(C))).status, 'accepted');
  assert(await fs.areFriends(A, C));
  console.log('[test19] karşılıklı istek = otomatik kabul ✅');

  // Red ve geri çekme.
  const D = await mk('deniz');
  await fs.request(D, codeA);
  assert.strictEqual((await fs.respond(A, D, false)).status, 'rejected');
  assert.strictEqual((await fs.overview(A)).incoming.length, 0);
  await fs.request(D, codeA);
  assert((await fs.remove(D, A)).ok, 'gönderen isteğini geri çekebilmeli');
  assert.strictEqual((await fs.overview(A)).incoming.length, 0);
  console.log('[test19] red + geri çekme ✅');

  // Engelleme: arkadaşlık silinir; engellenen istek atamaz ve engellendiğini öğrenemez.
  assert((await fs.block(B, A)).ok);
  assert(!(await fs.areFriends(A, B)));
  assert.strictEqual((await fs.request(A, codeB)).error, 'NOT_FOUND');
  assert.strictEqual((await fs.request(B, codeA)).error, 'YOU_BLOCKED');
  ovB = await fs.overview(B);
  assert.deepStrictEqual(ovB.blocked.map((x) => x.id), [A]);
  await fs.unblock(B, A);
  assert.strictEqual((await fs.request(A, codeB)).status, 'pending');
  console.log('[test19] engelle / engeli kaldır ✅');

  // Çıkarma.
  assert((await fs.remove(A, C)).ok);
  assert(!(await fs.areFriends(A, C)));
  assert.strictEqual((await fs.remove(A, C)).error, 'NOT_FOUND');

  // Bekleyen giden istek limiti.
  const spammer = await mk('spam');
  const targets = [];
  for (let i = 0; i < FRIEND_LIMITS.maxOutgoingPending + 1; i += 1) targets.push(await mk(`t${i}`));
  for (let i = 0; i < FRIEND_LIMITS.maxOutgoingPending; i += 1) {
    assert.strictEqual((await fs.request(spammer, await codeOf(targets[i]))).status, 'pending');
  }
  assert.strictEqual((await fs.request(spammer, await codeOf(targets[FRIEND_LIMITS.maxOutgoingPending]))).error, 'PENDING_LIMIT');
  console.log('[test19] bekleyen istek limiti ✅');

  ovA = await fs.overview(A);
  assert.strictEqual(ovA.presenceHidden, false);
  await fs.setPresenceHidden(A, true);
  assert.strictEqual((await fs.overview(A)).presenceHidden, true);
  console.log('[test19] (A) birim testleri tamam');
}

async function e2e() {
  const { server, db } = require('../src/index');
  const { io: ioClient } = require('socket.io-client');
  const PORT = 3982;
  const BASE = `http://localhost:${PORT}`;
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test19] sunucu ayakta, port', PORT);

  const connect = () => ioClient(BASE, { transports: ['websocket'] });
  const once = (s, ev) => new Promise((resolve) => s.once(ev, resolve));
  const emitAck = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));
  const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`zaman aşımı: ${label}`)), ms))]);
  async function http(method, path, cookie, body) {
    const res = await fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, json: await res.json(), cookie: setCookie ? setCookie.split(';')[0] : null };
  }
  const stamp = Date.now();
  async function account(tag, verified = true) {
    const r = await http('POST', '/api/auth/register', null, { email: `friends-${tag}-${stamp}@example.com`, password: 'parola1234', displayName: tag });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    if (verified) await db.run('UPDATE users SET email_verified_at = ? WHERE id = ?', Date.now(), r.json.user.id);
    return { cookie: r.cookie, user: r.json.user };
  }
  const H = await account('Hakan');
  const E = await account('Ece');
  const U = await account('Ufuk', false);

  assert.strictEqual((await http('GET', '/api/friends')).status, 401, 'misafir');
  assert.strictEqual((await http('GET', '/api/friends', U.cookie)).json.error, 'EMAIL_NOT_VERIFIED');
  const ovH = await http('GET', '/api/friends', H.cookie);
  assert.strictEqual(ovH.status, 200);
  const codeH = ovH.json.code;

  // Hakan'ın socket'i hesaba bağlanır → Ece istek atınca `friends:changed` alır.
  const hs = connect();
  const es = connect();
  await Promise.all([once(hs, 'connect'), once(es, 'connect')]);
  const ticket = async (acc) => (await http('POST', '/api/rooms/ticket', acc.cookie)).json.ticket;
  assert.strictEqual((await emitAck(hs, 'presence:hello', { ticket: 'yok' })).error, 'INVALID_TICKET');
  assert((await emitAck(hs, 'presence:hello', { ticket: await ticket(H) })).ok);
  const changed = withTimeout(once(hs, 'friends:changed'), 3000, 'friends:changed');
  const req = await http('POST', '/api/friends/request', E.cookie, { code: codeH.toLowerCase() });
  assert.strictEqual(req.status, 200, JSON.stringify(req.json));
  assert.strictEqual(req.json.status, 'pending');
  await changed;
  console.log('[test19] istek + anlık friends:changed sinyali ✅');

  const inc = (await http('GET', '/api/friends', H.cookie)).json.incoming;
  assert.strictEqual(inc.length, 1);
  assert.strictEqual(inc[0].displayName, 'Ece');
  assert.strictEqual((await http('POST', '/api/friends/respond', H.cookie, { userId: 'x', accept: true })).status, 400);
  assert.strictEqual((await http('POST', '/api/friends/respond', H.cookie, { userId: E.user.id, accept: true })).json.status, 'accepted');

  // Ece Hakan'ı çevrimiçi görür, odası yok.
  let f = (await http('GET', '/api/friends', E.cookie)).json.friends;
  assert.strictEqual(f.length, 1);
  assert.deepStrictEqual(f[0].presence, { online: true, room: null });
  console.log('[test19] kabul + çevrimiçi presence ✅');

  // Hakan oda kurup hesabını bağlar → Ece oda kodunu ve "katılabilir" bilgisini görür.
  const hostId = `fr-h-${stamp}`;
  const created = await emitAck(hs, 'room:create', { clientId: hostId, clientSecret: `seat-secret-${hostId}`, name: 'Hakan' });
  const code = created.room.code;
  assert((await emitAck(hs, 'room:bindAccount', { ticket: await ticket(H) })).ok);
  f = (await http('GET', '/api/friends', E.cookie)).json.friends;
  assert.strictEqual(f[0].presence.room.code, code);
  assert.strictEqual(f[0].presence.room.joinable, true);
  assert.strictEqual(f[0].presence.room.status, 'lobby');

  // Ece o kodla katılır, oda dolmadığı sürece hâlâ katılınabilir.
  const guestId = `fr-g-${stamp}`;
  assert(!(await emitAck(es, 'room:join', { clientId: guestId, clientSecret: `seat-secret-${guestId}`, name: 'Ece', code })).error);
  assert.strictEqual((await http('GET', '/api/friends', E.cookie)).json.friends[0].presence.room.players, 2);
  console.log('[test19] arkadaşın lobisi görünüyor, kodla katılınıyor ✅');

  // "Durumumu gizle": Hakan artık çevrimdışı ve odasız görünür.
  assert.strictEqual((await http('POST', '/api/friends/settings', H.cookie, { presenceHidden: 'evet' })).status, 400);
  assert((await http('POST', '/api/friends/settings', H.cookie, { presenceHidden: true })).json.ok);
  f = (await http('GET', '/api/friends', E.cookie)).json.friends;
  assert.strictEqual(f[0].presence, null);
  await http('POST', '/api/friends/settings', H.cookie, { presenceHidden: false });

  // Bağlantı kopunca odası görünmez, presence:hello da düşer.
  hs.close();
  await new Promise((r) => setTimeout(r, 200));
  f = (await http('GET', '/api/friends', E.cookie)).json.friends;
  assert.deepStrictEqual(f[0].presence, { online: false, room: null });
  console.log('[test19] gizleme ayarı + kopunca çevrimdışı ✅');

  // Çıkarma: Hakan'ın listesi boşalır.
  assert((await http('POST', '/api/friends/remove', E.cookie, { userId: H.user.id })).json.ok);
  assert.strictEqual((await http('GET', '/api/friends', H.cookie)).json.friends.length, 0);

  es.close();
  server.close();
  console.log('[test19] (B) uçtan uca testi tamam');
}

(async () => {
  try {
    await unitTests();
    await e2e();
    console.log('[test19] TÜM TESTLER GEÇTİ ✅');
    process.exit(0);
  } catch (e) {
    console.error('[test19] BAŞARISIZ ❌', e);
    process.exit(1);
  }
})();
