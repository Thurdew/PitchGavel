// Faz 15 doğrulama scripti: Oyun İçi Para (coin) + Mağaza (bkz. claude.md).
//  (A) Saf birim testleri (CoinService, bellek içi DB, gerçek initSchema):
//      - maç ödülü tutarları (galibiyet/beraberlik/mağlubiyet + günün ilk galibiyet bonusu),
//      - kasma önlemleri: misafir rakip, doğrulanmamış e-posta, aynı hesap/Gmail varyantı,
//        aynı iki hesap arasında günlük maç sınırı, aynı IP'de sadece galibiyet, günlük tavan,
//      - mağaza: yetersiz bakiye, satın alma, tekrar alma, eşzamanlı çift satın alma, ownsKit.
//  (B) Uçtan uca testi (gerçek HTTP + socket): odaya hesap bağlama (bilet tek kullanımlık, aynı
//      hesap iki oyuncuya bağlanamaz, takım/forma DB'den gelir), premium forma sahiplik kontrolü,
//      tam bir draft + maç sonunda `coins:awarded` event'i ve bakiyenin gerçekten artması.
process.env.RESEND_API_KEY = ''; // bkz. phase14 — boş string, server/.env'deki gerçek anahtarı engeller
process.env.DRAFT_AUCTION_SECONDS = '1';
process.env.DRAFT_ROUND_DELAY_MS = '150';
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = '250';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = '250';

const assert = require('assert');

function fixture(homeId, awayId, g1, g2) {
  // match1: home=homeId; match2: home=awayId (lig usulü ev+deplasman)
  return {
    aClientId: homeId, bClientId: awayId,
    match1: { homeClientId: homeId, awayClientId: awayId, goalsHome: g1[0], goalsAway: g1[1] },
    match2: { homeClientId: awayId, awayClientId: homeId, goalsHome: g2[0], goalsAway: g2[1] },
  };
}

// ---------- (A) Birim testleri ----------
async function unitTests() {
  const { DatabaseSync } = require('node:sqlite');
  const { wrapSqlite } = require('../src/db/adapter');
  const { initSchema } = require('../src/db/db');
  const { AuthService } = require('../src/auth/AuthService');
  const { CoinService, canonicalEmail } = require('../src/coins/CoinService');
  const { COIN_REWARDS } = require('../src/shared/economy');

  const raw = new DatabaseSync(':memory:');
  const db = wrapSqlite(raw);
  await initSchema(db);
  const auth = new AuthService(db);
  clearInterval(auth._sweepTimer);
  const coins = new CoinService(db);

  const mk = async (email, verified = true) => {
    const r = await auth.register(email, 'parola1234', email.split('@')[0]);
    if (verified) raw.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(Date.now(), r.user.id);
    return { userId: r.user.id, canonicalEmail: canonicalEmail(email), verified, ip: null };
  };
  const bal = (acc) => coins.balance(acc.userId);

  // --- canonicalEmail ---
  assert.strictEqual(canonicalEmail('A.Hmet+pg@GoogleMail.com'), 'ahmet@gmail.com');
  assert.strictEqual(canonicalEmail('a.hmet+x@outlook.com'), 'a.hmet@outlook.com');
  console.log('[test15] Gmail nokta/+etiket varyantları aynı adres sayılıyor ✅');

  // --- temel ödül: A 2-0 kazanır (+100 +100 bonus), 1-1 beraberlik (+40) ---
  const A = { ...(await mk('a@example.com')), ip: '1.1.1.1' };
  const B = { ...(await mk('b@example.com')), ip: '2.2.2.2' };
  let out = await coins.awardRoomResult([fixture('ca', 'cb', [2, 0], [1, 1])], { ca: A, cb: B }, ['ca', 'cb']);
  assert.strictEqual(out.ca.earned, COIN_REWARDS.win + COIN_REWARDS.firstWinBonus + COIN_REWARDS.draw);
  assert.strictEqual(out.cb.earned, COIN_REWARDS.loss + COIN_REWARDS.draw);
  assert.strictEqual(await bal(A), out.ca.earned);
  assert.strictEqual(out.ca.balance, out.ca.earned);
  assert(out.ca.lines.some((l) => l.outcome === 'first_win'), 'bonus satırı olmalı');
  console.log('[test15] galibiyet/beraberlik/mağlubiyet + günün ilk galibiyet bonusu doğru ✅', out.ca.earned, out.cb.earned);

  // --- ikinci galibiyette bonus YOK; aynı çiftle 3. maçtan sonra PAIR_LIMIT ---
  out = await coins.awardRoomResult([fixture('ca', 'cb', [1, 0], [0, 3])], { ca: A, cb: B }, ['ca', 'cb']);
  // Bu çiftin bugünkü 3. maçı ödüllü (ev), 4. (deplasman) sınırda kalır.
  assert.strictEqual(out.ca.earned, COIN_REWARDS.win, 'sadece 3. maç ödüllü, bonus tekrar verilmez: ' + JSON.stringify(out.ca));
  assert.strictEqual(out.cb.earned, COIN_REWARDS.loss);
  assert(out.ca.notes.includes('PAIR_LIMIT') && out.cb.notes.includes('PAIR_LIMIT'));
  console.log('[test15] aynı iki hesap arasında günde en fazla', COIN_REWARDS.pairDailyLimit, 'ödüllü maç ✅');

  // --- misafir rakip ---
  const C = { ...(await mk('c@example.com')), ip: '3.3.3.3' };
  out = await coins.awardRoomResult([fixture('cc', 'guest', [3, 0], [0, 1])], { cc: C }, ['cc', 'guest']);
  assert.strictEqual(out.cc.earned, 0);
  assert(out.cc.notes.includes('OPPONENT_GUEST') && out.guest.notes.includes('GUEST'));
  assert.strictEqual(out.guest.balance, null);
  console.log('[test15] misafirle oynanan maç kimseye coin vermiyor ✅');

  // --- doğrulanmamış e-posta ---
  const U = { ...(await mk('u@example.com', false)), ip: '4.4.4.4' };
  out = await coins.awardRoomResult([fixture('cc', 'cu', [3, 0], [0, 1])], { cc: C, cu: U }, ['cc', 'cu']);
  assert.strictEqual(out.cc.earned, 0);
  assert.strictEqual(out.cu.earned, 0);
  assert(out.cc.notes.includes('UNVERIFIED'));
  console.log('[test15] doğrulanmamış hesapla oynanan maç coin vermiyor ✅');

  // --- aynı kişinin Gmail varyantı ile ikinci hesabı ---
  const G1 = { ...(await mk('ahmet@gmail.com')), ip: '5.5.5.5' };
  const G2 = { ...(await mk('a.hmet+2@gmail.com')), ip: '6.6.6.6' };
  out = await coins.awardRoomResult([fixture('g1', 'g2', [2, 0], [0, 2])], { g1: G1, g2: G2 }, ['g1', 'g2']);
  assert.strictEqual(out.g1.earned + out.g2.earned, 0, 'aynı gelen kutusunun iki hesabı birbirinden coin kasamamalı');
  console.log('[test15] Gmail varyantıyla açılmış ikinci hesap kasma yapamıyor ✅');

  // --- aynı IP: sadece galibiyet ---
  const D = { ...(await mk('d@example.com')), ip: '9.9.9.9' };
  const E = { ...(await mk('e@example.com')), ip: '9.9.9.9' };
  out = await coins.awardRoomResult([fixture('cd', 'ce', [2, 1], [1, 1])], { cd: D, ce: E }, ['cd', 'ce']);
  assert.strictEqual(out.cd.earned, COIN_REWARDS.win + COIN_REWARDS.firstWinBonus, 'aynı ağda sadece galibiyet (+bonus)');
  assert.strictEqual(out.ce.earned, 0, 'aynı ağda mağlubiyet ve beraberlik coin vermemeli');
  assert(out.ce.notes.includes('SAME_NETWORK'));
  console.log('[test15] aynı IP\'den oynayan hesaplarda sadece galibiyet ödüllü ✅');

  // --- günlük tavan: F birçok farklı rakibi yenerse 500'de durur ---
  const F = { ...(await mk('f@example.com')), ip: '7.7.7.1' };
  let total = 0;
  for (let i = 0; i < 6; i++) {
    const O = { ...(await mk(`o${i}@example.com`)), ip: `7.7.8.${i}` };
    const r = await coins.awardRoomResult([fixture('cf', `co${i}`, [3, 0], [0, 3])], { cf: F, [`co${i}`]: O }, ['cf', `co${i}`]);
    total += r.cf.earned;
    if (i === 5) assert(r.cf.notes.includes('DAILY_CAP'), 'tavan notu olmalı');
  }
  assert.strictEqual(total, COIN_REWARDS.dailyCap, 'günlük kazanç tavanı aşılmamalı: ' + total);
  assert.strictEqual(await coins.todayEarned(F.userId), COIN_REWARDS.dailyCap);
  console.log('[test15] günlük tavan', COIN_REWARDS.dailyCap, 'coin\'de duruyor ✅');

  // --- mağaza ---
  assert.strictEqual((await coins.buy(B.userId, 'kit:plain')).error, 'INSUFFICIENT_COINS', 'B\'nin bakiyesi yetmemeli');
  assert.strictEqual((await coins.buy(F.userId, 'kit:yok')).error, 'UNKNOWN_ITEM');
  assert.strictEqual(await coins.ownsKit(F.userId, 'retro'), false);
  assert.strictEqual(await coins.ownsKit(F.userId, 'home'), true, 'ücretsiz formalar herkeste');
  const buy = await coins.buy(F.userId, 'kit:plain');
  assert(buy.ok, JSON.stringify(buy));
  assert.strictEqual(buy.balance, COIN_REWARDS.dailyCap - 500);
  assert.strictEqual(await coins.ownsKit(F.userId, 'plain'), true);
  assert.strictEqual((await coins.buy(F.userId, 'kit:plain')).error, 'ALREADY_OWNED');
  console.log('[test15] satın alma: yetersiz bakiye, başarılı alım, tekrar alma korumaları ✅');

  // Eşzamanlı çift satın alma: bakiye bir kez düşmeli.
  raw.prepare('UPDATE users SET coins = 2000 WHERE id = ?').run(A.userId);
  const [p1, p2] = await Promise.all([coins.buy(A.userId, 'kit:night'), coins.buy(A.userId, 'kit:night')]);
  assert.strictEqual([p1, p2].filter((p) => p.ok).length, 1, 'sadece biri başarmalı');
  assert.strictEqual(await coins.balance(A.userId), 1000);
  const ledger = raw.prepare("SELECT SUM(amount) AS s FROM coin_ledger WHERE user_id = ? AND reason = 'purchase'").get(A.userId);
  assert.strictEqual(Number(ledger.s), -1000);
  console.log('[test15] eşzamanlı çift satın almada ödeme bir kez alınıyor ✅');

  const store = await coins.storeFor(F.userId);
  assert(store.items.find((i) => i.id === 'kit:plain').owned);
  assert.strictEqual(store.rewards.win, COIN_REWARDS.win);
  console.log('[test15] (A) birim testleri tamam');
}

// ---------- (B) Uçtan uca ----------
async function e2e() {
  const { server, roomManager, db } = require('../src/index');
  const { io: ioClient } = require('socket.io-client');
  const { MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');
  const PORT = 3985;
  const BASE = `http://localhost:${PORT}`;
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test15] sunucu ayakta, port', PORT);

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
  async function account(tag, team) {
    const email = `coins-${tag}-${stamp}@example.com`;
    const r = await http('POST', '/api/auth/register', null, { email, password: 'parola1234', displayName: tag, favoriteTeam: team });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
    await db.run('UPDATE users SET email_verified_at = ? WHERE id = ?', Date.now(), r.json.user.id);
    return { cookie: r.cookie, user: r.json.user };
  }
  const H = await account('host', 'besiktas');
  const G = await account('guest', 'galatasaray');
  const X = await account('extra', null);

  // Premium forma: sahip değilken seçilemez.
  const denied = await http('POST', '/api/auth/kit', H.cookie, { kitId: 'retro' });
  assert.strictEqual(denied.status, 403);
  assert.strictEqual(denied.json.error, 'KIT_NOT_OWNED');
  assert.strictEqual((await http('POST', '/api/auth/kit', H.cookie, { kitId: 'away' })).status, 200, 'ücretsiz forma seçilebilmeli');
  const storeGuest = await http('GET', '/api/store');
  assert.strictEqual(storeGuest.status, 200);
  assert.strictEqual(storeGuest.json.balance, null);
  assert(storeGuest.json.items.length >= 4);
  assert.strictEqual((await http('POST', '/api/store/buy', null, { itemId: 'kit:plain' })).status, 401);
  assert.strictEqual((await http('POST', '/api/store/buy', H.cookie, { itemId: 'kit:plain' })).json.error, 'INSUFFICIENT_COINS');
  console.log('[test15] premium forma sahiplik kontrolü + mağaza uç noktaları ✅');

  const host = connect();
  const guest = connect();
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);
  const hostId = `coins-h-${stamp}`;
  const guestId = `coins-g-${stamp}`;
  const created = await emitAck(host, 'room:create', { clientId: hostId, name: 'Host' });
  const code = created.room.code;
  await emitAck(guest, 'room:join', { clientId: guestId, name: 'Guest', code });

  const ticket = async (acc) => (await http('POST', '/api/rooms/ticket', acc.cookie)).json.ticket;
  assert.strictEqual((await http('POST', '/api/rooms/ticket')).status, 401, 'misafir bilet alamaz');
  const t1 = await ticket(H);
  assert((await emitAck(host, 'room:bindAccount', { ticket: t1 })).ok);
  assert.strictEqual((await emitAck(guest, 'room:bindAccount', { ticket: t1 })).error, 'INVALID_TICKET', 'bilet tek kullanımlık');
  assert.strictEqual((await emitAck(guest, 'room:bindAccount', { ticket: await ticket(H) })).error, 'ACCOUNT_ALREADY_IN_ROOM', 'aynı hesap iki oyuncuya bağlanamaz');
  assert((await emitAck(guest, 'room:bindAccount', { ticket: await ticket(G) })).ok);
  assert.strictEqual((await emitAck(host, 'room:bindAccount', { ticket: await ticket(X) })).error, 'ALREADY_LINKED', 'bağlı oyuncu başka hesaba devredilemez');
  const room = roomManager.getRoom(code);
  const pub = roomManager.toPublicState(room);
  assert(pub.players.every((p) => p.accountLinked), 'iki oyuncu da bağlı görünmeli');
  assert(!JSON.stringify(pub).includes('canonicalEmail'), 'hesap bilgisi yayınlanmamalı');
  const hp = room.players.find((p) => p.clientId === hostId);
  assert.strictEqual(hp.teamId, 'besiktas');
  assert.strictEqual(hp.kitId, 'away', 'forma DB\'den gelmeli');
  console.log('[test15] odaya hesap bağlama: tek kullanımlık bilet, çift bağlama/devir engeli, takım+forma DB\'den ✅');

  // Tam draft + dizilim + maç.
  let latest = null;
  const onUpdate = (msg) => { latest = msg; };
  host.on('draft:update', onUpdate);
  let done = 0;
  host.on('draft:complete', () => done++);
  guest.on('draft:complete', () => done++);
  await emitAck(host, 'draft:readyToggle', { code });
  await emitAck(guest, 'draft:readyToggle', { code });
  await emitAck(host, 'draft:start', { code });
  let lastKey = null;
  const started = Date.now();
  while (done < 2 && Date.now() - started < 90000) {
    if (latest && latest.round && latest.round.kind === 'auction') {
      const key = latest.round.main.id + '@' + latest.round.deadline;
      if (key !== lastKey) {
        lastKey = key;
        for (const s of [host, guest]) if (Math.random() < 0.8) await emitAck(s, 'draft:bid', { code, amount: MIN_PLAYER_PRICE + Math.floor(Math.random() * 20) });
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.strictEqual(done, 2, 'draft bitmeli');
  const submit = async (s) => {
    const opts = await emitAck(s, 'lineup:options', { code });
    const o = opts.options.find((x) => x.formation === room.formation) || opts.options[0];
    const assignment = o.suggestedLineup.map((l) => l.squadIndex);
    await emitAck(s, 'lineup:submit', { code, matchSide: 'home', formation: o.formation, assignment });
    await emitAck(s, 'lineup:submit', { code, matchSide: 'away', formation: o.formation, assignment });
  };
  const ready = once(host, 'match:ready');
  await submit(host);
  await submit(guest);
  await ready;

  const awardH = once(host, 'coins:awarded');
  const awardG = once(guest, 'coins:awarded');
  await emitAck(host, 'match:simulate', { code });
  const res = await emitAck(guest, 'match:simulate', { code });
  assert(res.ok && res.result && res.result.resultId, 'sonuç + resultId gelmeli');
  const [aH, aG] = await Promise.all([awardH, awardG]);
  assert.strictEqual(aH.resultId, res.result.resultId);
  // Testte iki istemci de localhost — aynı ağ kuralı: sadece galibiyet coin verir.
  const winsOf = (id) => res.result.fixtures.flatMap((fx) => [fx.match1, fx.match2]).filter((m) =>
    (m.homeClientId === id && m.goalsHome > m.goalsAway) || (m.awayClientId === id && m.goalsAway > m.goalsHome)).length;
  const { COIN_REWARDS } = require('../src/shared/economy');
  const expected = (w) => (w > 0 ? w * COIN_REWARDS.win + COIN_REWARDS.firstWinBonus : 0);
  assert.strictEqual(aH.earned, expected(winsOf(hostId)), `host: ${JSON.stringify(aH)}`);
  assert.strictEqual(aG.earned, expected(winsOf(guestId)), `guest: ${JSON.stringify(aG)}`);
  const me = await http('GET', '/api/auth/me', H.cookie);
  assert.strictEqual(me.json.user.coins, aH.balance, 'bakiye DB\'de de güncel olmalı');
  console.log('[test15] maç sonu coins:awarded + bakiye ✅ host:', aH.earned, 'guest:', aG.earned, 'notlar:', aH.notes);

  host.close(); guest.close();
  server.close();
  console.log('[test15] (B) uçtan uca testi tamam');
}

(async () => {
  try {
    await unitTests();
    await e2e();
    console.log('[test15] TÜM TESTLER GEÇTİ ✅');
    process.exit(0);
  } catch (e) {
    console.error('[test15] BAŞARISIZ ❌', e);
    process.exit(1);
  }
})();
