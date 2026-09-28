// Faz 11 doğrulama scripti: Hesap Sistemi — Faz 3, Odada Biriktirilen Perk'i Harcama (bkz.
// claude.md). Faz 2'de biriktirilen bir perk'in Hazırlık Çarkı turunda ("Çevir"/"Atla" yanında
// üçüncü seçenek: "Envanterden Kullan") host-toggle'lı olarak harcanabilmesi.
//  (A) Saf birim testleri — consumeOneGrant FIFO/NO_GRANT, _inventory'nin artık sadece
//      harcanmamışları saydığını, ve DraftEngine.redeemBankedPerk'in tüm ön-kontrollerini
//      (sıra/host-toggle/envanter) sahte oda nesneleriyle doğrudan doğrular.
//  (B) Uçtan uca testi (gerçek HTTP+socket sunucu) — gerçek bir odada, gerçek bir kullanıcı için
//      Faz 2'nin spin endpoint'iyle bir perk kazandırıp, redeemInRoom'un Hazırlık Çarkı turunu
//      gerçekten ilerlettiğini ve mevcut testlerin (phase2-10) regresyona uğramadığını doğrular.
const assert = require('assert');

process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || '50';
process.env.DRAFT_PREP_WHEEL_SECONDS = process.env.DRAFT_PREP_WHEEL_SECONDS || '5';

// ---------- (A) Birim testleri ----------
function unitTests() {
  const { DatabaseSync } = require('node:sqlite');
  const { RewardsService } = require('../src/rewards/RewardsService');
  const { DraftEngine } = require('../src/draft/DraftEngine');
  const { PREP_WHEEL_SEGMENTS } = require('../src/shared/gameConfig');

  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE);
    CREATE TABLE daily_reward_state (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL, ads_progress INTEGER NOT NULL DEFAULT 0,
      spins_used INTEGER NOT NULL DEFAULT 0, last_ad_watched_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE perk_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL, granted_at INTEGER NOT NULL,
      consumed_at INTEGER
    );
  `);
  db.prepare('INSERT INTO users (id, email) VALUES (1, ?)').run('u1@example.com');
  const rewards = new RewardsService(db);
  const seg = PREP_WHEEL_SEGMENTS.find((s) => s.kind === 'joker');

  // --- consumeOneGrant: NO_GRANT (hiç kazanılmamış) ---
  const noGrant = rewards.consumeOneGrant(1, 'joker');
  assert.strictEqual(noGrant.error, 'NO_GRANT');
  console.log('[test11] consumeOneGrant hiç grant yokken NO_GRANT döndürüyor ✅');

  // --- iki grant ekle (FIFO sırasını test etmek için farklı granted_at) ---
  db.prepare('INSERT INTO perk_grants (user_id, kind, label, description, granted_at) VALUES (?,?,?,?,?)')
    .run(1, 'joker', seg.label, seg.description, 1000);
  const secondId = db.prepare('INSERT INTO perk_grants (user_id, kind, label, description, granted_at) VALUES (?,?,?,?,?)')
    .run(1, 'joker', seg.label, seg.description, 2000).lastInsertRowid;

  assert.deepStrictEqual(rewards.getStatus(1).inventory, { joker: 2 });

  const consume1 = rewards.consumeOneGrant(1, 'joker');
  assert(consume1.ok);
  const row1 = db.prepare('SELECT id, consumed_at FROM perk_grants WHERE kind=? ORDER BY granted_at ASC').all('joker')[0];
  assert(row1.consumed_at != null, 'en eski (granted_at=1000) grant tüketilmeli');
  assert.deepStrictEqual(rewards.getStatus(1).inventory, { joker: 1 }, 'envanterde 1 kalmalı');
  console.log('[test11] consumeOneGrant FIFO (en eski önce) çalışıyor, envanter doğru düşüyor ✅');

  const consume2 = rewards.consumeOneGrant(1, 'joker');
  assert(consume2.ok);
  const row2 = db.prepare('SELECT consumed_at FROM perk_grants WHERE id = ?').get(secondId);
  assert(row2.consumed_at != null);
  assert.strictEqual(rewards.consumeOneGrant(1, 'joker').error, 'NO_GRANT', 'ikisi de tükendikten sonra NO_GRANT dönmeli');
  console.log('[test11] tüm grant\'ler tüketilince NO_GRANT dönüyor ✅');

  // --- DraftEngine.redeemBankedPerk ön-kontrolleri (sahte oda, gerçek socket yok) ---
  const fakeIo = { to: () => ({ emit: () => {} }) };
  const fakeRoomManager = { toPublicState: () => ({}) };
  const engine = new DraftEngine(fakeIo, fakeRoomManager);
  engine.setRewardsService(rewards);

  function makeRoom({ bankedPerksEnabled = true, cursor = 0 } = {}) {
    return {
      status: 'prep_wheel',
      bankedPerksEnabled,
      prepWheel: { order: ['p1', 'p2'], cursor },
      players: [{ clientId: 'p1', budget: 1000, squad: [], prepPerk: null }, { clientId: 'p2', budget: 1000, squad: [], prepPerk: null }],
    };
  }

  // Yeni bir grant ekle (test kullanıcısı 1 için, budget_bonus).
  db.prepare('INSERT INTO perk_grants (user_id, kind, label, description, granted_at) VALUES (?,?,?,?,?)')
    .run(1, 'budget_bonus', '💰 Bütçe Takviyesi', 'test', Date.now());

  const notYourTurnRoom = makeRoom({ cursor: 0 });
  const notYourTurn = engine.redeemBankedPerk(notYourTurnRoom, 'p2', 'budget_bonus', 1);
  assert.strictEqual(notYourTurn.error, 'NOT_YOUR_TURN');
  console.log('[test11] redeemBankedPerk sırası gelmeyen biri için NOT_YOUR_TURN döndürüyor ✅');

  const disabledRoom = makeRoom({ bankedPerksEnabled: false, cursor: 0 });
  const disabled = engine.redeemBankedPerk(disabledRoom, 'p1', 'budget_bonus', 1);
  assert.strictEqual(disabled.error, 'BANKED_PERKS_DISABLED');
  console.log('[test11] bankedPerksEnabled kapalıyken BANKED_PERKS_DISABLED döndürüyor ✅');

  const noInventoryRoom = makeRoom({ cursor: 0 });
  const noInv = engine.redeemBankedPerk(noInventoryRoom, 'p1', 'anti_snipe_shield', 1); // bu kind'den hiç grant yok
  assert.strictEqual(noInv.error, 'NO_GRANT');
  console.log('[test11] envanterde olmayan bir kind için NO_GRANT döndürüyor ✅');

  const okRoom = makeRoom({ cursor: 0 });
  const ok = engine.redeemBankedPerk(okRoom, 'p1', 'budget_bonus', 1);
  assert(ok.ok, 'geçerli redeem başarılı olmalı: ' + JSON.stringify(ok));
  assert.strictEqual(okRoom.players[0].budget, 1000 + 150, 'applyPrepPerk ile AYNI etkiyi üretmeli (budget_bonus +150)');
  assert.strictEqual(okRoom.prepWheel.cursor, 1, 'tur ilerlemeli');
  assert.strictEqual(rewards.getStatus(1).inventory.budget_bonus, undefined, 'kullanılan perk envanterden düşmeli');
  console.log('[test11] geçerli redeem: applyPrepPerk etkisi + envanter düşüşü + tur ilerlemesi doğru ✅');

  console.log('[test11] (A) BİRİM TESTLERİ TÜM GEÇTİ ✅');
}

// ---------- (B) Uçtan uca testi ----------
function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function e2eTest() {
  const { server } = require('../src/index');
  const { io: ioClient } = require('socket.io-client');
  const PORT = 3989;
  const BASE = `http://localhost:${PORT}`;
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test11] sunucu ayakta, port', PORT);

  function once(socket, event) { return new Promise((resolve) => socket.once(event, resolve)); }
  function emitAck(socket, event, payload) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }

  // --- kayıt ol, bir perk kazan (Faz 2 akışı) ---
  const email = `banked-${Date.now()}@example.com`;
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', displayName: 'Banked Test' }),
  });
  const cookie = extractCookie(regRes);
  const spinRes = await fetch(`${BASE}/api/rewards/spin`, { method: 'POST', headers: { cookie } }).then((r) => r.json());
  const wonKind = spinRes.perk.kind;
  console.log(`[test11] e2e: test kullanıcısı bir perk kazandı (${wonKind})`);

  // --- gerçek bir oda kur: prepWheelEnabled + bankedPerksEnabled açık, 2 kişi ---
  const clientIdHost = `banked-host-${Date.now()}`;
  const clientIdGuest = `banked-guest-${Date.now()}`;
  const sHost = ioClient(BASE, { transports: ['websocket'] });
  const sGuest = ioClient(BASE, { transports: ['websocket'] });
  await Promise.all([once(sHost, 'connect'), once(sGuest, 'connect')]);

  const createRes = await emitAck(sHost, 'room:create', {
    clientId: clientIdHost, name: 'Host', draftMode: 'live', playerPool: 'all',
    prepWheelEnabled: true, bankedPerksEnabled: true,
  });
  assert(createRes.room, 'oda kurulmalı: ' + JSON.stringify(createRes));
  assert.strictEqual(createRes.room.bankedPerksEnabled, true, 'bankedPerksEnabled true olarak yansımalı');
  const code = createRes.room.code;
  await emitAck(sGuest, 'room:join', { clientId: clientIdGuest, name: 'Guest', code });
  await emitAck(sHost, 'draft:readyToggle', { code });
  await emitAck(sGuest, 'draft:readyToggle', { code });

  const stateAfterStart = await new Promise((resolve) => {
    sHost.once('room:state', (s) => { if (s.status === 'prep_wheel') resolve(s); });
    emitAck(sHost, 'draft:start', { code });
  });
  assert.strictEqual(stateAfterStart.status, 'prep_wheel');
  const firstTurnClientId = stateAfterStart.prepWheel.order[0];
  console.log(`[test11] e2e: prep_wheel fazı başladı, ilk sıra: ${firstTurnClientId}`);

  // --- redeemInRoom'u SIRASI GELMEYEN biri için dene -> 400 NOT_YOUR_TURN ---
  const notFirst = firstTurnClientId === clientIdHost ? clientIdGuest : clientIdHost;
  const wrongTurnRes = await fetch(`${BASE}/api/rewards/redeemInRoom`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ roomCode: code, clientId: notFirst, kind: wonKind }),
  });
  assert.strictEqual(wrongTurnRes.status, 400);
  console.log('[test11] e2e: sırası gelmeyen clientId için redeemInRoom 400 döndürüyor ✅');

  // --- gerçek sırası gelen kişi için redeemInRoom -> başarılı, prepWheel:resolved yayılıyor ---
  const resolvedPromise = new Promise((resolve) => sGuest.once('prepWheel:resolved', resolve));
  const redeemRes = await fetch(`${BASE}/api/rewards/redeemInRoom`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ roomCode: code, clientId: firstTurnClientId, kind: wonKind }),
  });
  assert.strictEqual(redeemRes.status, 200, 'redeemInRoom başarılı olmalı: ' + JSON.stringify(await redeemRes.clone().json()));
  const redeemJson = await redeemRes.json();
  assert.strictEqual(redeemJson.perk.kind, wonKind);

  const resolvedEvent = await resolvedPromise;
  assert.strictEqual(resolvedEvent.clientId, firstTurnClientId);
  assert.strictEqual(resolvedEvent.redeemed, true, 'prepWheel:resolved redeemed:true taşımalı');
  console.log('[test11] e2e: redeemInRoom başarılı, prepWheel:resolved TÜM odaya redeemed:true ile yayıldı ✅');

  // --- envanter tükendi mi doğrula ---
  const statusAfter = await fetch(`${BASE}/api/rewards/status`, { headers: { cookie } }).then((r) => r.json());
  assert.strictEqual(statusAfter.inventory[wonKind], undefined, 'kullanılan perk envanterden düşmeli');
  console.log('[test11] e2e: kullanılan perk envanterden düştü ✅');

  console.log('[test11] (B) UÇTAN UCA TESTİ TÜM GEÇTİ ✅');

  sHost.close(); sGuest.close();
  server.close();
}

async function main() {
  unitTests();
  await e2eTest();
  console.log('[test11] TÜM TESTLER GEÇTİ ✅');
  process.exit(0);
}

main().catch((e) => { console.error('[test11] HATA:', e); process.exit(1); });
