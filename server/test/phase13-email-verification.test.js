// Faz 13 doğrulama scripti: E-posta Doğrulama (bkz. claude.md). Kullanıcı "rastgele bir e-posta
// yazınca da kabul ediyor" dedi — kayıt olurken gönderilen (Resend ile) bir linke tıklanana
// kadar hesap "doğrulanmamış" sayılıyor. Hiçbir özelliği (ödül çarkı, banked perk) KISITLAMIYOR,
// sadece bilgilendirici. RESEND_API_KEY bu test ortamında set EDİLMİYOR — EmailService doğal
// olarak "dev fallback" moduna düşer, testler GERÇEK ağ isteği yapmaz.
//  (A) Saf birim testleri — token üretimi/doğrulama/tek kullanımlık olması/süre dolması,
//      EmailService'in dev-fallback modunda gerçek ağ çağrısı yapmadan `{mode:'dev',verifyUrl}`
//      döndürdüğü.
//  (B) Uçtan uca testi (gerçek HTTP sunucu) — register sonrası emailVerified:false, DB'den
//      okunan gerçek token'la /api/auth/verify'ın doğru redirect'i döndürdüğü, doğrulama sonrası
//      /api/auth/me'nin emailVerified:true döndürdüğü, resendVerification'ın ALREADY_VERIFIED/
//      rate-limit davranışı, ve mevcut testlerin (phase2-12) regresyona uğramadığı.
const assert = require('assert');

process.env.RESEND_API_KEY = ''; // delete YETMEZ: loadEnv, anahtar hiç yoksa server/.env'deki GERÇEK anahtarı yükler — boş string onu engeller, test asla gerçek e-posta göndermez
process.env.RESEND_VERIFICATION_MAX_ATTEMPTS = process.env.RESEND_VERIFICATION_MAX_ATTEMPTS || '3';
process.env.RESEND_VERIFICATION_WINDOW_MS = process.env.RESEND_VERIFICATION_WINDOW_MS || '600000';

// ---------- (A) Birim testleri ----------
async function unitTests() {
  const { DatabaseSync } = require('node:sqlite');
  const { wrapSqlite } = require('../src/db/adapter');
  const { AuthService } = require('../src/auth/AuthService');
  const { sendVerificationEmail } = require('../src/auth/EmailService');

  // --- EmailService dev-fallback: gerçek ağ isteği YOK, sadece bir verifyUrl döner ---
  const sendRes = await sendVerificationEmail('dev-fallback-test@example.com', 'sometoken123');
  assert.strictEqual(sendRes.ok, true);
  assert.strictEqual(sendRes.mode, 'dev', 'RESEND_API_KEY yokken dev moda düşmeli');
  assert(sendRes.verifyUrl && sendRes.verifyUrl.includes('sometoken123'), 'verifyUrl token\'ı içermeli: ' + sendRes.verifyUrl);
  console.log('[test13] EmailService dev-fallback modunda gerçek ağ isteği yapmadan verifyUrl döndürüyor ✅');

  // db.js'teki DDL'in aynısı (bu test için gereken tablolar) — izole :memory: DB.
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, email_verified_at INTEGER, favorite_team TEXT, favorite_kit TEXT
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE email_verifications (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
  `);
  const auth = new AuthService(wrapSqlite(db));
  const reg = await auth.register('verify-test@example.com', 'password123', 'VerifyTest');
  assert.strictEqual(reg.user.emailVerified, false, 'yeni kayıt emailVerified:false olmalı');
  console.log('[test13] register sonrası emailVerified:false ✅');

  // --- geçersiz token ---
  const badVerify = await auth.verifyEmailToken('uydurma-token');
  assert.strictEqual(badVerify.error, 'INVALID_OR_EXPIRED_TOKEN');
  console.log('[test13] geçersiz token INVALID_OR_EXPIRED_TOKEN döndürüyor ✅');

  // --- geçerli token ile doğrulama ---
  const token = await auth.createVerificationToken(reg.user.id);
  const okVerify = await auth.verifyEmailToken(token);
  assert(okVerify.ok, 'geçerli token ile doğrulama başarılı olmalı: ' + JSON.stringify(okVerify));
  assert.strictEqual(okVerify.user.emailVerified, true);
  assert.strictEqual((await auth.getUserByToken(reg.token)).emailVerified, true, 'session üzerinden de emailVerified:true görünmeli');
  console.log('[test13] geçerli token ile doğrulama başarılı, emailVerified:true oluyor ✅');

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Doğrulama koduyla giriş yapabilmeliyim" — verifyEmailToken
  // AYRICA yeni, kayıt olunan cihazdan BAĞIMSIZ bir session token da üretmeli.
  assert(okVerify.sessionToken, 'verifyEmailToken bir sessionToken da döndürmeli: ' + JSON.stringify(okVerify));
  assert.notStrictEqual(okVerify.sessionToken, reg.token, 'bu, kayıt anındaki session\'dan BAĞIMSIZ yeni bir token olmalı');
  assert.strictEqual((await auth.getUserByToken(okVerify.sessionToken)).id, reg.user.id, 'yeni session token gerçekten aynı kullanıcıya ait olmalı');
  console.log('[test13] verifyEmailToken bağımsız, geçerli bir yeni session token da üretiyor ✅');

  // --- tek kullanımlık: aynı token ikinci kez kullanılamaz ---
  const secondUse = await auth.verifyEmailToken(token);
  assert.strictEqual(secondUse.error, 'INVALID_OR_EXPIRED_TOKEN', 'token bir kereye mahsus olmalı');
  console.log('[test13] token bir kereye mahsus — ikinci kullanım reddediliyor ✅');

  // --- süresi geçmiş token ---
  const reg2 = await auth.register('verify-test-2@example.com', 'password123', 'VerifyTest2');
  const now = Date.now();
  db.prepare('INSERT INTO email_verifications (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run('expired-token-for-test', reg2.user.id, now - 1000, now - 1);
  const expiredVerify = await auth.verifyEmailToken('expired-token-for-test');
  assert.strictEqual(expiredVerify.error, 'INVALID_OR_EXPIRED_TOKEN');
  console.log('[test13] süresi geçmiş token reddediliyor ✅');

  console.log('[test13] (A) BİRİM TESTLERİ TÜM GEÇTİ ✅');
}

// ---------- (B) Uçtan uca testi ----------
function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0];
}

async function e2eTest() {
  const { server, db } = require('../src/index');
  const PORT = 3987;
  const BASE = `http://localhost:${PORT}`;
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test13] sunucu ayakta, port', PORT);

  const email = `verify-e2e-${Date.now()}@example.com`;
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', displayName: 'Verify E2E' }),
  });
  assert.strictEqual(regRes.status, 201);
  const regJson = await regRes.json();
  const cookie = extractCookie(regRes);
  assert.strictEqual(regJson.user.emailVerified, false, 'register response emailVerified:false döndürmeli');
  console.log('[test13] e2e: register sonrası emailVerified:false ✅');

  // Token asla HTTP response'da dönmüyor — testte doğrudan DB'den okunuyor (bkz. index.js db export'u).
  const row = await db.get('SELECT token FROM email_verifications WHERE user_id = ?', regJson.user.id);
  assert(row && row.token, 'kayıt sonrası bir doğrulama token\'ı oluşmuş olmalı');
  console.log('[test13] e2e: kayıt sonrası DB\'de bir doğrulama token\'ı oluştu (token response\'da YOK) ✅');

  // --- geçersiz token -> redirect verified=0 ---
  const badRes = await fetch(`${BASE}/api/auth/verify?token=uydurma`, { redirect: 'manual' });
  assert([301, 302, 303, 307, 308].includes(badRes.status), 'redirect statüsü beklenirdi: ' + badRes.status);
  assert.strictEqual(badRes.headers.get('location'), '/giris?verified=0');
  console.log('[test13] e2e: geçersiz token /giris?verified=0\'a yönlendiriyor ✅');

  // --- gerçek token -> redirect verified=1 + YENİ bir session cookie ---
  const goodRes = await fetch(`${BASE}/api/auth/verify?token=${row.token}`, { redirect: 'manual' });
  assert.strictEqual(goodRes.headers.get('location'), '/giris?verified=1');
  const verifyCookie = extractCookie(goodRes);
  assert(verifyCookie && verifyCookie !== cookie, 'verify endpoint\'i YENİ bir session cookie\'si döndürmeli (kayıt anındakinden bağımsız)');
  console.log('[test13] e2e: gerçek token /giris?verified=1\'e yönlendiriyor + yeni bir session cookie\'si veriyor ✅');

  // --- doğrulama sonrası /api/auth/me emailVerified:true dönmeli (kayıt anındaki cookie ile) ---
  const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  const meJson = await meRes.json();
  assert.strictEqual(meJson.user.emailVerified, true, 'doğrulama sonrası /api/auth/me emailVerified:true dönmeli');
  console.log('[test13] e2e: doğrulama sonrası /api/auth/me emailVerified:true ✅');

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Doğrulama koduyla giriş yapabilmeliyim" — linkin verdiği
  // YENİ cookie, kayıt anındaki tarayıcıdan TAMAMEN BAĞIMSIZ bir istekle de (farklı bir cihaz/
  // tarayıcıyı simüle eder) doğru kullanıcıyı doğrulamalı.
  const meViaVerifyCookieRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: verifyCookie } });
  const meViaVerifyCookieJson = await meViaVerifyCookieRes.json();
  assert.strictEqual(meViaVerifyCookieJson.user.email, email, 'doğrulama linkinin verdiği cookie, BAŞKA bir tarayıcı/cihazdan da doğru kullanıcıyla giriş yapmalı');
  console.log('[test13] e2e: doğrulama linkinin verdiği cookie, farklı bir istekten (farklı cihazı simüle eder) de doğru kullanıcıya giriş yapıyor ✅');

  // --- artık doğrulanmış olduğu için resendVerification -> ALREADY_VERIFIED ---
  const alreadyRes = await fetch(`${BASE}/api/auth/resendVerification`, { method: 'POST', headers: { cookie } });
  assert.strictEqual(alreadyRes.status, 400);
  assert.strictEqual((await alreadyRes.json()).error, 'ALREADY_VERIFIED');
  console.log('[test13] e2e: doğrulanmış kullanıcı için resendVerification ALREADY_VERIFIED ✅');

  // --- YENİ (doğrulanmamış) bir kullanıcı için resendVerification akışı + rate limit ---
  const email2 = `verify-e2e-2-${Date.now()}@example.com`;
  const regRes2 = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email2, password: 'password123', displayName: 'Verify E2E 2' }),
  });
  const cookie2 = extractCookie(regRes2);
  const MAX = Number(process.env.RESEND_VERIFICATION_MAX_ATTEMPTS);
  let lastStatus = null;
  for (let i = 0; i < MAX + 1; i++) {
    const r = await fetch(`${BASE}/api/auth/resendVerification`, { method: 'POST', headers: { cookie: cookie2 } });
    lastStatus = r.status;
  }
  assert.strictEqual(lastStatus, 429, `${MAX + 1}. art arda resendVerification denemesinde 429 beklenirdi: ${lastStatus}`);
  console.log('[test13] e2e: art arda resendVerification denemesi rate limit\'e takılıyor (429) ✅');

  // --- giriş yapmadan resendVerification -> 401 ---
  const guestResendRes = await fetch(`${BASE}/api/auth/resendVerification`, { method: 'POST' });
  assert.strictEqual(guestResendRes.status, 401);
  console.log('[test13] e2e: giriş yapmadan resendVerification 401 NOT_LOGGED_IN ✅');

  console.log('[test13] (B) UÇTAN UCA TESTİ TÜM GEÇTİ ✅');

  server.close();
}

async function main() {
  await unitTests();
  await e2eTest();
  console.log('[test13] TÜM TESTLER GEÇTİ ✅');
  process.exit(0);
}

main().catch((e) => { console.error('[test13] HATA:', e); process.exit(1); });
