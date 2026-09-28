// Faz 9 doğrulama scripti: Hesap Sistemi — Faz 1 (bkz. claude.md "Hesap Sistemi + Veritabanı
// Temeli"). İsteğe bağlı, oyun mantığından (RoomManager/DraftEngine, anonim sessionStorage
// clientId) TAMAMEN AYRI bir HTTP kimlik katmanı: kayıt/giriş/çıkış/"ben kimim". Perk/ödül/
// reklam/matchmaking'in HİÇBİRİ bu fazda yok.
//  (A) Saf birim testleri (sunucu ayağa kaldırmadan) — AuthService'in hashing/session/enumeration
//      korumasını, LoginRateLimiter'ın pencere/sayaç mantığını doğrudan doğrular.
//  (B) Uçtan uca testi (gerçek HTTP sunucu) — register→me→logout→me(null)→login akışını, yanlış
//      parola/rate-limit hatalarını ve mevcut oyun testlerinin (phase2-8) regresyona uğramadığını
//      doğrular.
const assert = require('assert');

// Rate limiter testlerini gerçek dakikalar beklemeden çalıştırabilmek için (phase8'in
// DRAFT_PREP_WHEEL_SECONDS'ı kısaltmasıyla aynı desen) — index.js bu değerleri require
// ANINDA okuyor, bu yüzden env değişkenleri her require'dan ÖNCE ayarlanmalı.
process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || '3';
process.env.LOGIN_RATE_LIMIT_WINDOW_MS = process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '600000';
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÜVENLİK SERTLEŞTİRME] bkz. claude.md.
process.env.REGISTER_RATE_LIMIT_MAX_ATTEMPTS = process.env.REGISTER_RATE_LIMIT_MAX_ATTEMPTS || '5';
process.env.REGISTER_RATE_LIMIT_WINDOW_MS = process.env.REGISTER_RATE_LIMIT_WINDOW_MS || '600000';

// ---------- (A) Birim testleri ----------
function unitTests() {
  const { DatabaseSync } = require('node:sqlite');
  const { AuthService } = require('../src/auth/AuthService');
  const { LoginRateLimiter } = require('../src/auth/LoginRateLimiter');

  // db.js'teki DDL'in aynısı — gerçek dosyaya dokunmadan izole bir :memory: DB.
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      email_verified_at INTEGER
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE email_verifications (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  const auth = new AuthService(db);

  // --- register başarılı, hash/salt asla dışarı sızmıyor ---
  const reg = auth.register('Test@Example.com', 'password123', 'Semih');
  assert(reg.user && reg.token, 'register başarılı olmalı: ' + JSON.stringify(reg));
  assert.strictEqual(reg.user.email, 'test@example.com', 'e-posta normalize edilip küçük harfe çevrilmeli');
  assert.strictEqual(reg.user.displayName, 'Semih');
  assert(!('password_hash' in reg.user) && !('password_salt' in reg.user), 'user objesi hash/salt İÇERMEMELİ');
  console.log('[test9] register başarılı, hassas alanlar döndürülmüyor ✅');

  // --- aynı e-posta (farklı büyük/küçük harfle de) EMAIL_TAKEN ---
  const dup1 = auth.register('test@example.com', 'baskaParola1', 'Başkası');
  assert.strictEqual(dup1.error, 'EMAIL_TAKEN');
  const dup2 = auth.register('TEST@EXAMPLE.COM', 'baskaParola2', 'Başkası2');
  assert.strictEqual(dup2.error, 'EMAIL_TAKEN', 'büyük/küçük harf farkı e-posta eşitliğini bozmamalı');
  console.log('[test9] tekrar kayıt (case-insensitive dahil) EMAIL_TAKEN döndürüyor ✅');

  // --- login: doğru/yanlış parola ---
  const loginOk = auth.login('test@example.com', 'password123');
  assert(loginOk.user && loginOk.token, 'doğru parolayla login başarılı olmalı: ' + JSON.stringify(loginOk));
  const loginWrong = auth.login('test@example.com', 'yanlisparola');
  assert.strictEqual(loginWrong.error, 'INVALID_CREDENTIALS');
  const loginUnknown = auth.login('hicYokBoyle@example.com', 'herhangi');
  assert.strictEqual(loginUnknown.error, 'INVALID_CREDENTIALS', 'kayıtsız e-posta da AYNI hatayı döndürmeli (enumeration yok)');
  console.log('[test9] login doğru/yanlış parola + e-posta enumeration koruması doğru çalışıyor ✅');

  // --- getUserByToken ---
  const me = auth.getUserByToken(loginOk.token);
  assert(me && me.email === 'test@example.com', 'token ile doğru kullanıcı dönmeli');
  assert.strictEqual(auth.getUserByToken('uydurma-gecersiz-token'), null, 'geçersiz token null dönmeli');
  console.log('[test9] getUserByToken geçerli/geçersiz token için doğru sonuç veriyor ✅');

  // --- logout ---
  auth.logout(loginOk.token);
  assert.strictEqual(auth.getUserByToken(loginOk.token), null, 'logout sonrası token geçersiz olmalı');
  console.log('[test9] logout oturumu geçersiz kılıyor ✅');

  // --- sweepExpiredSessions ---
  const stillValid = auth.login('test@example.com', 'password123').token;
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run('expired-token-for-test', reg.user.id, now - 1000, now - 1);
  auth.sweepExpiredSessions();
  assert.strictEqual(auth.getUserByToken('expired-token-for-test'), null, 'süresi geçmiş oturum temizlenmeli');
  assert(auth.getUserByToken(stillValid), 'geçerli oturum sweep\'ten etkilenmemeli');
  console.log('[test9] sweepExpiredSessions süresi geçmiş oturumları temizliyor, geçerli olanı koruyor ✅');

  // --- LoginRateLimiter ---
  const limiter = new LoginRateLimiter();
  const ip = '127.0.0.1', email = 'rl@example.com';
  const MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
  for (let i = 0; i < MAX; i++) {
    assert(!limiter.isBlocked(ip, email), `${i + 1}. denemeden ÖNCE bloklanmamalı`);
    limiter.recordFailure(ip, email);
  }
  assert(limiter.isBlocked(ip, email), `${MAX} başarısız denemeden sonra bloklanmalı`);
  limiter.recordSuccess(ip, email);
  assert(!limiter.isBlocked(ip, email), 'başarılı girişten sonra sayaç sıfırlanmalı');
  console.log('[test9] LoginRateLimiter N başarısız denemeden sonra bloklar, başarılı girişte sıfırlanır ✅');

  // Pencere süresi dolmuş bir kaydın artık bloklamadığını doğrula (zamanı elle "yaşlandır").
  for (let i = 0; i < MAX; i++) limiter.recordFailure(ip, email);
  assert(limiter.isBlocked(ip, email));
  const rec = limiter.attempts.get(limiter._key(ip, email));
  rec.windowStart -= (Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) + 1000);
  assert(!limiter.isBlocked(ip, email), 'pencere süresi dolmuş bir kayıt artık bloklamamalı');
  console.log('[test9] LoginRateLimiter pencere süresi dolunca bloklamayı bırakıyor ✅');

  // --- RegisterRateLimiter — bkz. claude.md "Güvenlik Sertleştirme" ---
  const { RegisterRateLimiter } = require('../src/auth/RegisterRateLimiter');
  const regLimiter = new RegisterRateLimiter();
  const REG_MAX = Number(process.env.REGISTER_RATE_LIMIT_MAX_ATTEMPTS);
  const ip2 = '10.0.0.1';
  for (let i = 0; i < REG_MAX; i++) {
    assert(!regLimiter.isBlocked(ip2), `${i + 1}. denemeden ÖNCE bloklanmamalı`);
    regLimiter.recordAttempt(ip2);
  }
  assert(regLimiter.isBlocked(ip2), `${REG_MAX} denemeden sonra bloklanmalı (login'in aksine BAŞARILI denemeler de sayılır)`);
  assert(!regLimiter.isBlocked('10.0.0.2'), 'başka bir IP bundan etkilenmemeli');
  console.log('[test9] RegisterRateLimiter IP başına N denemeden sonra bloklar, farklı IP\'yi etkilemez ✅');

  console.log('[test9] (A) BİRİM TESTLERİ TÜM GEÇTİ ✅');
}

// ---------- (B) Uçtan uca testi ----------
function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  if (!raw) return null;
  return raw.split(';')[0]; // "kk_session=abc123; Path=/; ..." -> "kk_session=abc123"
}

async function e2eTest() {
  const { server } = require('../src/index');
  const PORT = 3991;
  const BASE = `http://localhost:${PORT}`;
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test9] sunucu ayakta, port', PORT);

  // Tekrar tekrar çalıştırılabilir olsun diye (gerçek server/data/pitchgavel.sqlite dosyasını
  // kullanıyoruz, phase8'deki gibi tamamen izole bir DB değil) her koşuda benzersiz bir e-posta.
  const email = `test-${Date.now()}@example.com`;

  // --- register ---
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', displayName: 'E2E Test' }),
  });
  assert.strictEqual(regRes.status, 201, 'register 201 dönmeli');
  const regJson = await regRes.json();
  assert.strictEqual(regJson.user.email, email);
  let cookie = extractCookie(regRes);
  assert(cookie && cookie.startsWith('kk_session='), 'register Set-Cookie döndürmeli: ' + cookie);
  console.log('[test9] e2e: register 201 + Set-Cookie ✅');

  // --- me (cookie'li) ---
  const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  const meJson = await meRes.json();
  assert.strictEqual(meJson.user.email, email, 'cookie ile me doğru kullanıcıyı döndürmeli');
  console.log('[test9] e2e: cookie ile /api/auth/me doğru kullanıcıyı döndürüyor ✅');

  // --- me (cookie'siz misafir) — ASLA hata, {user:null} ---
  const guestRes = await fetch(`${BASE}/api/auth/me`);
  assert.strictEqual(guestRes.status, 200, 'cookie olmadan da /api/auth/me 200 dönmeli (misafir normal bir durum)');
  const guestJson = await guestRes.json();
  assert.strictEqual(guestJson.user, null);
  console.log('[test9] e2e: cookie\'siz istek {user:null} ile 200 dönüyor (misafir hata değil) ✅');

  // --- aynı e-posta ile ikinci kayıt -> 409 ---
  const dupRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'baskaParola1', displayName: 'Başka' }),
  });
  assert.strictEqual(dupRes.status, 409);
  assert.strictEqual((await dupRes.json()).error, 'EMAIL_TAKEN');
  console.log('[test9] e2e: tekrar kayıt 409 EMAIL_TAKEN ✅');

  // --- yanlış parolayla login -> 401 ---
  const wrongLoginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'yanlisparola' }),
  });
  assert.strictEqual(wrongLoginRes.status, 401);
  assert.strictEqual((await wrongLoginRes.json()).error, 'INVALID_CREDENTIALS');
  console.log('[test9] e2e: yanlış parola 401 INVALID_CREDENTIALS ✅');

  // --- doğru login -> yeni cookie, session cookie'den bağımsız olarak da çalışır ---
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  assert.strictEqual(loginRes.status, 200);
  const newCookie = extractCookie(loginRes);
  assert(newCookie, 'login da Set-Cookie döndürmeli');
  const meAfterLoginRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: newCookie } });
  assert.strictEqual((await meAfterLoginRes.json()).user.email, email, 'yeni (bağımsız) cookie ile de oturum doğrulanmalı — kalıcılık DB üzerinden, in-memory state üzerinden değil');
  console.log('[test9] e2e: doğru login + oturumun kalıcılığı (bağımsız cookie ile) doğrulandı ✅');

  // --- rate limit: MAX+1. yanlış deneme 429 dönmeli ---
  const rlEmail = `ratelimit-${Date.now()}@example.com`;
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: rlEmail, password: 'password123', displayName: 'RL Test' }),
  });
  const MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
  let lastStatus = null;
  for (let i = 0; i < MAX + 1; i++) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: rlEmail, password: 'yanlisparola' }),
    });
    lastStatus = r.status;
  }
  assert.strictEqual(lastStatus, 429, `${MAX + 1}. art arda yanlış denemede 429 RATE_LIMITED beklenirdi, gelen: ${lastStatus}`);
  console.log('[test9] e2e: art arda yanlış deneme rate limit\'e takılıyor (429) ✅');

  // --- logout ---
  const logoutRes = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.strictEqual((await logoutRes.json()).ok, true);
  const meAfterLogoutRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  assert.strictEqual((await meAfterLogoutRes.json()).user, null, 'logout sonrası aynı cookie artık geçersiz olmalı');
  console.log('[test9] e2e: logout oturumu geçersiz kılıyor ✅');

  // --- register rate limit: bu IP'den şimdiye kadar 3 register çağrısı yapıldı (yukarıda),
  // REGISTER_RATE_LIMIT_MAX_ATTEMPTS=5 — birkaç deneme daha eşiği aşmalı ---
  const REG_MAX = Number(process.env.REGISTER_RATE_LIMIT_MAX_ATTEMPTS);
  let lastRegisterStatus = null;
  for (let i = 0; i < REG_MAX; i++) {
    const r = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `flood-${Date.now()}-${i}@example.com`, password: 'password123', displayName: 'Flood' }),
    });
    lastRegisterStatus = r.status;
  }
  assert.strictEqual(lastRegisterStatus, 429, `${REG_MAX} deneme sonrası 429 RATE_LIMITED beklenirdi, gelen: ${lastRegisterStatus}`);
  console.log('[test9] e2e: art arda register denemesi rate limit\'e takılıyor (429) ✅');

  // --- güvenlik header'ları (bkz. claude.md "Güvenlik Sertleştirme") her yanıtta olmalı ---
  const headerCheckRes = await fetch(`${BASE}/api/health`);
  assert.strictEqual(headerCheckRes.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(headerCheckRes.headers.get('x-frame-options'), 'DENY');
  assert.strictEqual(headerCheckRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  console.log('[test9] e2e: temel güvenlik header\'ları (nosniff/frame-options/referrer-policy) her yanıtta var ✅');

  console.log('[test9] (B) UÇTAN UCA TESTİ TÜM GEÇTİ ✅');

  server.close();
}

async function main() {
  unitTests();
  await e2eTest();
  console.log('[test9] TÜM TESTLER GEÇTİ ✅');
  process.exit(0);
}

main().catch((e) => { console.error('[test9] HATA:', e); process.exit(1); });
