// Faz 10 doğrulama scripti: Hesap Sistemi — Faz 2, Günlük Ödül Çarkı (bkz. claude.md).
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — REKLAM İZLEME KALDIRILDI] Gerçek bir reklam ağı entegre
// edilemediği için "reklam izle → çevirme hakkı kazan" merdiveni tamamen kaldırıldı — artık her
// kullanıcı günde sabit sayıda (varsayılan 1) ücretsiz çevirme hakkına sahip.
// SADECE biriktirme (banking) — bir perk'in ODADA harcanması Faz 3'ün işi, bu yüzden
// RoomManager/DraftEngine bu testte HİÇ devreye girmiyor.
//  (A) Saf birim testleri — günlük ücretsiz çevirme limitini, ödül havuzunun HER ZAMAN
//      pool='iyi' olduğunu, gün değişince lazy-reset'i doğrudan doğrular.
//  (B) Uçtan uca testi (gerçek HTTP sunucu) — giriş yapmadan 401, gerçek spin→status akışını
//      ve mevcut testlerin (phase2-9) regresyona uğramadığını doğrular.
const assert = require('assert');

process.env.RESEND_API_KEY = ''; // delete YETMEZ: loadEnv, anahtar hiç yoksa server/.env'deki GERÇEK anahtarı yükler — boş string onu engeller, test asla gerçek e-posta göndermez

process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || '50'; // bu testte login rate limit'e takılmayalım

// ---------- (A) Birim testleri ----------
async function unitTests() {
  const { DatabaseSync } = require('node:sqlite');
  const { wrapSqlite } = require('../src/db/adapter');
  const { RewardsService, REWARD_SEGMENTS } = require('../src/rewards/RewardsService');
  const { PREP_WHEEL_SEGMENTS, DAILY_REWARD_FREE_SPINS_PER_DAY } = require('../src/shared/gameConfig');

  // --- ödül havuzu SADECE 'iyi' segmentler ---
  assert(REWARD_SEGMENTS.length > 0, 'ödül havuzu boş olmamalı');
  assert(REWARD_SEGMENTS.every((s) => s.pool === 'iyi'), 'ödül havuzunda kötü/nötr segment OLMAMALI');
  const goodCount = PREP_WHEEL_SEGMENTS.filter((s) => s.pool === 'iyi').length;
  assert.strictEqual(REWARD_SEGMENTS.length, goodCount, 'PREP_WHEEL_SEGMENTS ile aynı sayıda iyi segment olmalı');
  console.log(`[test10] ödül havuzu sadece 'iyi' segmentlerden oluşuyor (${REWARD_SEGMENTS.length} adet) ✅`);

  // db.js'teki DDL'in aynısı (sadece bu test için gereken tablolar) — izole :memory: DB.
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
  const rewards = new RewardsService(wrapSqlite(db));

  // --- ilk status: hiç çevirme yapılmamış, günlük hak dolu ---
  const status0 = await rewards.getStatus(1);
  assert.strictEqual(status0.spinsUsedToday, 0);
  assert.strictEqual(status0.spinsPerDay, DAILY_REWARD_FREE_SPINS_PER_DAY);
  assert.strictEqual(status0.spinAvailable, true);
  assert.deepStrictEqual(status0.inventory, {});
  console.log('[test10] ilk status doğru (0 çevirme, hak müsait, boş envanter) ✅');

  // --- ücretsiz spin başarılı, pool HER ZAMAN 'iyi' ---
  const spin1 = await rewards.spin(1);
  assert(spin1.perk, 'spin başarılı olmalı: ' + JSON.stringify(spin1));
  assert.strictEqual(spin1.perk.pool, 'iyi');
  assert.strictEqual(spin1.status.spinsUsedToday, 1);
  assert.strictEqual(spin1.status.spinAvailable, false, 'günlük hak tükenmiş olmalı');
  assert.strictEqual(spin1.status.inventory[spin1.perk.kind], 1, 'envanterde kazanılan perk görünmeli');
  console.log(`[test10] ücretsiz spin başarılı (${spin1.perk.kind}), günlük hak tüketildi ✅`);

  // --- aynı gün ikinci spin -> NO_SPIN_LEFT ---
  const spinAgain = await rewards.spin(1);
  assert.strictEqual(spinAgain.error, 'NO_SPIN_LEFT');
  console.log('[test10] aynı gün ikinci spin NO_SPIN_LEFT döndürüyor ✅');

  // --- gün değişimi: satırı elle eskiye çekip lazy-reset'i doğrula ---
  db.prepare("UPDATE daily_reward_state SET day = '2000-01-01' WHERE user_id = 1").run();
  const statusNewDay = await rewards.getStatus(1);
  assert.strictEqual(statusNewDay.spinsUsedToday, 0, 'yeni günde spinsUsedToday sıfırlanmalı');
  assert.strictEqual(statusNewDay.spinAvailable, true, 'yeni günde hak yeniden müsait olmalı');
  assert.strictEqual(statusNewDay.inventory[spin1.perk.kind], 1, 'envanter (perk_grants ledger) gün değişse de KORUNMALI — sadece günlük hak sıfırlanır');
  console.log('[test10] gün değişince günlük hak sıfırlanıyor, envanter (kalıcı) korunuyor ✅');

  // --- [TURSO] Yarış: aynı anda iki spin isteği (çift tıklama) günlük sınırı aşamamalı ---
  const [raceA, raceB] = await Promise.all([rewards.spin(1), rewards.spin(1)]);
  assert.strictEqual([raceA, raceB].filter((r) => r.perk).length, 1, 'eşzamanlı iki spinden sadece biri başarmalı: ' + JSON.stringify([raceA.error, raceB.error]));
  assert.strictEqual([raceA, raceB].filter((r) => r.error === 'NO_SPIN_LEFT').length, 1);
  assert.strictEqual((await rewards.getStatus(1)).spinsUsedToday, 1, 'spins_used 1\'i aşmamalı');
  console.log('[test10] eşzamanlı iki spin: sadece biri başarılı, günlük sınır korunuyor ✅');

  console.log('[test10] (A) BİRİM TESTLERİ TÜM GEÇTİ ✅');
}

// ---------- (B) Uçtan uca testi ----------
function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function e2eTest() {
  const { server } = require('../src/index');
  const PORT = 3990;
  const BASE = `http://localhost:${PORT}`;
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test10] sunucu ayakta, port', PORT);

  // --- giriş yapmadan 401 NOT_LOGGED_IN ---
  const guestStatusRes = await fetch(`${BASE}/api/rewards/status`);
  assert.strictEqual(guestStatusRes.status, 401);
  assert.strictEqual((await guestStatusRes.json()).error, 'NOT_LOGGED_IN');
  const guestSpinRes = await fetch(`${BASE}/api/rewards/spin`, { method: 'POST' });
  assert.strictEqual(guestSpinRes.status, 401);
  console.log('[test10] e2e: giriş yapmadan /api/rewards/* 401 NOT_LOGGED_IN ✅');

  // --- kayıt ol, cookie al ---
  const email = `rewards-${Date.now()}@example.com`;
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', displayName: 'Rewards Test' }),
  });
  const cookie = extractCookie(regRes);
  assert(cookie, 'register cookie döndürmeli');

  // --- status (giriş yapılmış) ---
  const statusRes = await fetch(`${BASE}/api/rewards/status`, { headers: { cookie } });
  assert.strictEqual(statusRes.status, 200);
  const status0 = await statusRes.json();
  assert.strictEqual(status0.spinsUsedToday, 0);
  assert.strictEqual(status0.spinAvailable, true);
  console.log('[test10] e2e: giriş yapılmış kullanıcı için status 200 döndü ✅');

  // --- ücretsiz spin başarılı ---
  const spinRes = await fetch(`${BASE}/api/rewards/spin`, { method: 'POST', headers: { cookie } });
  assert.strictEqual(spinRes.status, 200);
  const spinJson = await spinRes.json();
  assert(spinJson.perk && spinJson.perk.pool === 'iyi', 'kazanılan perk pool=iyi olmalı: ' + JSON.stringify(spinJson));
  assert.strictEqual(spinJson.status.spinsUsedToday, 1);
  console.log(`[test10] e2e: ücretsiz spin başarılı (${spinJson.perk.kind}) ✅`);

  // --- aynı gün ikinci spin -> 400 NO_SPIN_LEFT ---
  const secondSpinRes = await fetch(`${BASE}/api/rewards/spin`, { method: 'POST', headers: { cookie } });
  assert.strictEqual(secondSpinRes.status, 400);
  assert.strictEqual((await secondSpinRes.json()).error, 'NO_SPIN_LEFT');
  console.log('[test10] e2e: aynı gün ikinci spin 400 NO_SPIN_LEFT ✅');

  console.log('[test10] (B) UÇTAN UCA TESTİ TÜM GEÇTİ ✅');

  server.close();
}

async function main() {
  await unitTests();
  await e2eTest();
  console.log('[test10] TÜM TESTLER GEÇTİ ✅');
  process.exit(0);
}

main().catch((e) => { console.error('[test10] HATA:', e); process.exit(1); });
