// Faz 14 doğrulama scripti: Parola Sıfırlama (bkz. claude.md). RESEND_API_KEY bu test ortamında
// set EDİLMİYOR — EmailService "dev fallback" moduna düşer, sıfırlama linki konsola yazılır
// (e2e testi bu linki console.log'u geçici olarak dinleyerek yakalıyor), gerçek ağ isteği yok.
//  (A) Saf birim testleri — token'ın DB'de hash'li saklandığı, kayıtsız e-postanın null döndüğü,
//      tek kullanımlık olması, yeni link isteyince eskisinin geçersizleşmesi, süre dolması,
//      parola değişince eski parolanın/TÜM oturumların geçersizleşip yeni oturum açılması,
//      e-postanın doğrulanmış sayılması, eşzamanlı çift kullanımda sadece birinin başarması.
//  (B) Uçtan uca testi (gerçek HTTP) — forgotPassword'ün kayıtlı/kayıtsız e-posta için AYNI yanıtı
//      verdiği, linkteki token'la resetPassword'ün parolayı değiştirip cookie verdiği, eski cookie'nin
//      düştüğü, yeni parolayla girişin çalıştığı, IP rate limit'in 429 döndürdüğü.
const assert = require('assert');

process.env.RESEND_API_KEY = ''; // delete YETMEZ: loadEnv, anahtar hiç yoksa server/.env'deki GERÇEK anahtarı yükler — boş string onu engeller, test asla gerçek e-posta göndermez
process.env.PASSWORD_RESET_IP_MAX_ATTEMPTS = process.env.PASSWORD_RESET_IP_MAX_ATTEMPTS || '6';

// ---------- (A) Birim testleri ----------
async function unitTests() {
  const { DatabaseSync } = require('node:sqlite');
  const { wrapSqlite } = require('../src/db/adapter');
  const { initSchema } = require('../src/db/db');
  const { AuthService } = require('../src/auth/AuthService');

  // Şema elle kopyalanmıyor, gerçek initSchema ile kuruluyor — önceki test dosyalarındaki
  // "DDL kopyası geride kaldı" hatası (bkz. claude.md phase9/10 notları) burada yaşanmasın.
  const raw = new DatabaseSync(':memory:');
  const db = wrapSqlite(raw);
  await initSchema(db);
  const auth = new AuthService(db);
  clearInterval(auth._sweepTimer);

  const reg = await auth.register('reset@example.com', 'eskiParola1', 'Reset');
  assert(reg.user, 'kayıt başarılı olmalı');

  // --- kayıtsız e-posta -> null (route bunu istemciye yansıtmıyor) ---
  assert.strictEqual(await auth.createPasswordResetToken('yok@example.com'), null);
  console.log('[test14] kayıtsız e-posta için token üretilmiyor (null) ✅');

  // --- token DB'de hash'li ---
  const t1 = await auth.createPasswordResetToken('RESET@example.com'); // büyük/küçük harf duyarsız
  assert(t1 && t1.token && t1.user.id === reg.user.id);
  const stored = raw.prepare('SELECT token_hash FROM password_resets WHERE user_id = ?').all(reg.user.id);
  assert.strictEqual(stored.length, 1);
  assert.notStrictEqual(stored[0].token_hash, t1.token, 'DB\'de düz token DEĞİL hash saklanmalı');
  console.log('[test14] token DB\'de hash\'li saklanıyor, düz token sadece e-postada ✅');

  // --- yeni link isteyince eskisi geçersiz ---
  const t2 = await auth.createPasswordResetToken('reset@example.com');
  assert.strictEqual((await auth.resetPassword(t1.token, 'yeniParola1')).error, 'INVALID_OR_EXPIRED_TOKEN', 'eski link geçersiz olmalı');
  console.log('[test14] yeni link istenince önceki link geçersizleşiyor ✅');

  // --- başarılı sıfırlama: eski parola düşer, tüm oturumlar kapanır, yeni oturum açılır ---
  const otherSession = (await auth.login('reset@example.com', 'eskiParola1')).token;
  const ok = await auth.resetPassword(t2.token, 'yeniParola1');
  assert(ok.ok && ok.sessionToken, 'sıfırlama başarılı olmalı: ' + JSON.stringify(ok));
  assert.strictEqual((await auth.login('reset@example.com', 'eskiParola1')).error, 'INVALID_CREDENTIALS', 'eski parola artık çalışmamalı');
  assert((await auth.login('reset@example.com', 'yeniParola1')).token, 'yeni parola çalışmalı');
  assert.strictEqual(await auth.getUserByToken(reg.token), null, 'kayıt anındaki oturum kapanmalı');
  assert.strictEqual(await auth.getUserByToken(otherSession), null, 'diğer cihazdaki oturum kapanmalı');
  assert.strictEqual((await auth.getUserByToken(ok.sessionToken)).id, reg.user.id, 'yeni oturum geçerli olmalı');
  assert.strictEqual(ok.user.emailVerified, true, 'linke tıklamak e-postayı doğrulanmış saymalı');
  console.log('[test14] sıfırlama: eski parola düştü, tüm oturumlar kapandı, yeni oturum açıldı, e-posta doğrulandı ✅');

  // --- tek kullanımlık ---
  assert.strictEqual((await auth.resetPassword(t2.token, 'baskaParola1')).error, 'INVALID_OR_EXPIRED_TOKEN');
  console.log('[test14] aynı link ikinci kez kullanılamıyor ✅');

  // --- eşzamanlı çift kullanım: sadece biri başarır ---
  const t3 = await auth.createPasswordResetToken('reset@example.com');
  const [rA, rB] = await Promise.all([auth.resetPassword(t3.token, 'parolaA123'), auth.resetPassword(t3.token, 'parolaB123')]);
  assert.strictEqual([rA, rB].filter((r) => r.ok).length, 1, 'eşzamanlı iki kullanımdan sadece biri başarmalı');
  console.log('[test14] eşzamanlı iki kullanımda sadece biri başarıyor ✅');

  // --- süresi dolmuş token + sweep ---
  const t4 = await auth.createPasswordResetToken('reset@example.com');
  raw.prepare('UPDATE password_resets SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1, reg.user.id);
  assert.strictEqual((await auth.resetPassword(t4.token, 'parolaC123')).error, 'INVALID_OR_EXPIRED_TOKEN');
  await auth.sweepExpiredSessions();
  assert.strictEqual(raw.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n, 0, 'sweep süresi dolmuş token\'ı silmeli');
  console.log('[test14] süresi dolmuş link reddediliyor ve sweep ile temizleniyor ✅');

  console.log('[test14] (A) BİRİM TESTLERİ TÜM GEÇTİ ✅');
}

// ---------- (B) Uçtan uca testi ----------
function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

// Dev modda EmailService linki console.log'a yazıyor — gönderim arka planda (route beklemiyor)
// olduğu için linki birkaç kez yoklayarak yakalıyoruz.
const capturedLogs = [];
async function waitForResetLink(email) {
  for (let i = 0; i < 50; i++) {
    const line = capturedLogs.find((l) => l.includes('Parola sıfırlama linki') && l.includes(email));
    if (line) return line.match(/reset=([0-9a-f]+)/)[1];
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

async function e2eTest() {
  const origLog = console.log;
  console.log = (...args) => { capturedLogs.push(args.join(' ')); origLog(...args); };

  const { server } = require('../src/index');
  const PORT = 3986;
  const BASE = `http://localhost:${PORT}`;
  await new Promise((resolve) => server.listen(PORT, resolve));
  const post = (path, body, cookie) => fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

  const email = `reset-e2e-${Date.now()}@example.com`;
  const regRes = await post('/api/auth/register', { email, password: 'eskiParola1', displayName: 'Reset E2E' });
  assert.strictEqual(regRes.status, 201);
  const oldCookie = extractCookie(regRes);

  // --- kayıtlı ve kayıtsız e-posta AYNI yanıtı almalı ---
  const knownRes = await post('/api/auth/forgotPassword', { email });
  const unknownRes = await post('/api/auth/forgotPassword', { email: `hic-yok-${Date.now()}@example.com` });
  assert.strictEqual(knownRes.status, 200);
  assert.strictEqual(unknownRes.status, 200);
  assert.deepStrictEqual(await knownRes.json(), await unknownRes.json(), 'kayıtlı/kayıtsız e-posta aynı yanıtı almalı');
  console.log('[test14] e2e: forgotPassword kayıtlı ve kayıtsız e-posta için aynı yanıtı veriyor ✅');

  const token = await waitForResetLink(email);
  assert(token, 'dev modda sıfırlama linki loglanmalıydı');

  // --- geçersiz girdiler ---
  assert.strictEqual((await post('/api/auth/resetPassword', { token, password: 'kisa' })).status, 400, 'kısa parola reddedilmeli');
  assert.strictEqual((await post('/api/auth/resetPassword', { token: 'uydurma', password: 'yeniParola1' })).status, 400);
  console.log('[test14] e2e: kısa parola ve uydurma token reddediliyor ✅');

  // --- gerçek sıfırlama ---
  const resetRes = await post('/api/auth/resetPassword', { token, password: 'yeniParola1' });
  assert.strictEqual(resetRes.status, 200);
  const newCookie = extractCookie(resetRes);
  assert(newCookie, 'sıfırlama sonrası oturum cookie\'si verilmeli');
  assert.strictEqual((await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: newCookie } })).json()).user.email, email);
  assert.strictEqual((await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie: oldCookie } })).json()).user, null, 'eski oturum kapanmalı');
  assert.strictEqual((await post('/api/auth/login', { email, password: 'eskiParola1' })).status, 401);
  assert.strictEqual((await post('/api/auth/login', { email, password: 'yeniParola1' })).status, 200);
  console.log('[test14] e2e: sıfırlama sonrası yeni cookie çalışıyor, eski oturum kapandı, yeni parolayla giriş başarılı ✅');

  // --- IP rate limit ---
  const MAX = Number(process.env.PASSWORD_RESET_IP_MAX_ATTEMPTS);
  let lastStatus = null;
  for (let i = 0; i < MAX; i++) lastStatus = (await post('/api/auth/forgotPassword', { email })).status;
  assert.strictEqual(lastStatus, 429, `IP limiti aşılınca 429 beklenirdi: ${lastStatus}`);
  console.log('[test14] e2e: art arda forgotPassword IP rate limit\'e takılıyor (429) ✅');

  console.log = origLog;
  console.log('[test14] (B) UÇTAN UCA TESTİ TÜM GEÇTİ ✅');
  server.close();
}

async function main() {
  await unitTests();
  await e2eTest();
  console.log('[test14] TÜM TESTLER GEÇTİ ✅');
  process.exit(0);
}

main().catch((e) => { console.error('[test14] HATA:', e); process.exit(1); });
