const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 30 gün
const SESSION_SWEEP_INTERVAL_MS = 30 * 60 * 1000; // RoomManager'ın periyodik temizliğiyle aynı ritim
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA]
const EMAIL_VERIFICATION_TTL_MS = Number(process.env.EMAIL_VERIFICATION_TTL_MS) || 24 * 60 * 60 * 1000; // 24 saat
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAROLA SIFIRLAMA]
const PASSWORD_RESET_TTL_MS = Number(process.env.PASSWORD_RESET_TTL_MS) || 60 * 60 * 1000; // 1 saat

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

// [GÜVENLİK — KOD İNCELEMESİ] scrypt artık ASENKRON (libuv thread pool'unda) — senkron
// `scryptSync` her giriş denemesinde event loop'u ~50ms kilitliyor, o sırada canlı açık
// arttırmalar ve maçlar takılıyordu; toplu giriş denemesi tüm oyunu durdurabiliyordu.
function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt)).toString('hex');
  return { hash, salt };
}

async function verifyPassword(password, hash, salt) {
  const candidate = await scryptAsync(password, salt);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

// [GÜVENLİK] Kayıtlı olmayan bir e-postayla giriş denemesinde de AYNI maliyette bir scrypt
// çalıştırılır — aksi halde bilinmeyen e-postalar anında, kayıtlılar ~50ms geç yanıt alıyor ve
// bu süre farkından hangi e-postaların kayıtlı olduğu öğrenilebiliyordu.
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_HASH = crypto.scryptSync(crypto.randomBytes(16).toString('hex'), DUMMY_SALT, SCRYPT_KEYLEN).toString('hex');

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] users.cosmetics JSON; bozuksa boş obje.
function parseCosmetics(raw) {
  if (!raw) return {};
  try { const o = JSON.parse(raw); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}

function toPublicUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, emailVerified: !!row.email_verified_at, favoriteTeam: row.favorite_team || null, favoriteKit: row.favorite_kit || 'home', coins: Number(row.coins || 0), cosmetics: parseCosmetics(row.cosmetics) };
}

class AuthService {
  constructor(db) {
    this.db = db;
    this._sweepTimer = setInterval(() => { this.sweepExpiredSessions().catch((e) => console.error('[auth] sweep hatası:', e.message)); }, SESSION_SWEEP_INTERVAL_MS);
    this._sweepTimer.unref?.();
  }

  async register(email, password, displayName, favoriteTeam = null) {
    const normEmail = normalizeEmail(email);
    const existing = await this.db.get('SELECT id FROM users WHERE email = ?', normEmail);
    if (existing) return { error: 'EMAIL_TAKEN' };

    const { hash, salt } = await hashPassword(password);
    const now = Date.now();
    let info;
    try {
      info = await this.db.run(
        `INSERT INTO users (email, password_hash, password_salt, display_name, favorite_team, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        normEmail, hash, salt, displayName.trim().slice(0, 24), favoriteTeam || null, now, now
      );
    } catch (e) {
      // Asenkron DB'de yukarıdaki SELECT ile bu INSERT arasında aynı e-postayla eşzamanlı bir
      // kayıt araya girebilir — UNIQUE kısıtı onu yakalar, aynı hata koduna çevrilir.
      if (/UNIQUE/i.test(String(e && e.message))) return { error: 'EMAIL_TAKEN' };
      throw e;
    }

    const user = await this.db.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);
    const token = await this._createSession(user.id);
    return { user: toPublicUser(user), token };
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Odaya hesap bağlanırken (bkz.
  // roomSockets room:bindAccount) — kullanıcı bilgisi token'dan değil kısa ömürlü bilet'ten gelir.
  async getUserById(userId) {
    const row = await this.db.get('SELECT * FROM users WHERE id = ?', userId);
    return row ? toPublicUser(row) : null;
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKIM TEMASI] null = "takım tutmuyorum".
  async setFavoriteTeam(userId, teamId) {
    await this.db.run('UPDATE users SET favorite_team = ?, updated_at = ? WHERE id = ?', teamId || null, Date.now(), userId);
    return toPublicUser(await this.db.get('SELECT * FROM users WHERE id = ?', userId));
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — FORMA ÇEŞİTLERİ]
  async setFavoriteKit(userId, kitId) {
    await this.db.run('UPDATE users SET favorite_kit = ?, updated_at = ? WHERE id = ?', kitId, Date.now(), userId);
    return toPublicUser(await this.db.get('SELECT * FROM users WHERE id = ?', userId));
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Tek slotu değiştirir; key null = varsayılana dön.
  // Sahiplik kontrolü çağıranda (index.js /api/auth/cosmetic).
  async setCosmetic(userId, slot, key) {
    const row = await this.db.get('SELECT cosmetics FROM users WHERE id = ?', userId);
    const cur = parseCosmetics(row && row.cosmetics);
    if (key) cur[slot] = key; else delete cur[slot];
    await this.db.run('UPDATE users SET cosmetics = ?, updated_at = ? WHERE id = ?', JSON.stringify(cur), Date.now(), userId);
    return toPublicUser(await this.db.get('SELECT * FROM users WHERE id = ?', userId));
  }

  async login(email, password) {
    const normEmail = normalizeEmail(email);
    const user = await this.db.get('SELECT * FROM users WHERE email = ?', normEmail);
    // Bilinmeyen e-posta ile yanlış parola AYNI hata kodunu döner — e-posta enumeration'a
    // izin vermemek için.
    if (!user) {
      await verifyPassword(password, DUMMY_HASH, DUMMY_SALT);
      return { error: 'INVALID_CREDENTIALS' };
    }
    if (!(await verifyPassword(password, user.password_hash, user.password_salt))) {
      return { error: 'INVALID_CREDENTIALS' };
    }
    const token = await this._createSession(user.id);
    return { user: toPublicUser(user), token };
  }

  async getUserByToken(token) {
    if (!token) return null;
    const row = await this.db.get(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ? AND sessions.expires_at > ?`,
      sha256(token), Date.now()
    );
    return row ? toPublicUser(row) : null;
  }

  // Sadece sunulan token'a ait oturumu kapatır ("bu cihazdan çıkış") — aynı kullanıcının diğer
  // cihaz/tarayıcılardaki oturumları doğal süresi (30 gün) dolana kadar geçerli kalır.
  async logout(token) {
    await this.db.run('DELETE FROM sessions WHERE token = ?', sha256(token));
  }

  async sweepExpiredSessions() {
    await this.db.run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
    await this.db.run('DELETE FROM email_verifications WHERE expires_at <= ?', Date.now());
    await this.db.run('DELETE FROM password_resets WHERE expires_at <= ?', Date.now());
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAROLA SIFIRLAMA] Kayıtlı olmayan bir e-posta için
  // `null` döner — route bunu istemciye HİÇ yansıtmıyor (her durumda aynı yanıt, enumeration yok).
  // Kullanıcının önceki (henüz kullanılmamış) sıfırlama linkleri geçersiz kılınır — sadece en son
  // istenen link çalışır. DB'ye token'ın hash'i yazılır, düz token sadece e-postadaki linkte.
  async createPasswordResetToken(email) {
    const user = await this.db.get('SELECT * FROM users WHERE email = ?', normalizeEmail(email));
    if (!user) return null;
    await this.db.run('DELETE FROM password_resets WHERE user_id = ?', user.id);
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    await this.db.run(
      'INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      sha256(token), user.id, now, now + PASSWORD_RESET_TTL_MS
    );
    return { user: toPublicUser(user), token };
  }

  // Tek kullanımlık: token satırı ÖNCE silinir, sadece silmeyi başaran (changes=1) devam eder
  // (verifyEmailToken ile aynı desen). Parola değişince kullanıcının TÜM oturumları kapatılır —
  // hesabı ele geçirilmiş biri varsa dışarı atılsın diye — ve bu tarayıcıya yeni bir oturum açılır.
  // Linke tıklamak e-posta kutusunun sahibi olmayı kanıtladığı için e-posta da doğrulanmış sayılır.
  async resetPassword(token, newPassword) {
    const tokenHash = sha256(token);
    const row = await this.db.get(
      'SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?',
      tokenHash, Date.now()
    );
    if (!row) return { error: 'INVALID_OR_EXPIRED_TOKEN' };
    const del = await this.db.run('DELETE FROM password_resets WHERE token_hash = ?', tokenHash);
    if (del.changes !== 1) return { error: 'INVALID_OR_EXPIRED_TOKEN' };

    const { hash, salt } = await hashPassword(newPassword);
    const now = Date.now();
    await this.db.run(
      'UPDATE users SET password_hash = ?, password_salt = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?',
      hash, salt, now, now, row.user_id
    );
    await this.db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);

    const user = await this.db.get('SELECT * FROM users WHERE id = ?', row.user_id);
    const sessionToken = await this._createSession(row.user_id);
    return { ok: true, user: toPublicUser(user), sessionToken };
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] bkz. claude.md. index.js
  // sendVerificationEmail'i BU token ile çağırıyor — token asla HTTP response body'sinde
  // dönmüyor (sadece e-posta linkinde), güvenlik açısından.
  async createVerificationToken(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    // [GÜVENLİK] DB'ye token'ın hash'i yazılır (password_resets ile aynı) — düz token sadece e-postada.
    await this.db.run('INSERT INTO email_verifications (token, user_id, created_at, expires_at, hashed) VALUES (?, ?, ?, ?, 1)', sha256(token), userId, now, now + EMAIL_VERIFICATION_TTL_MS);
    return token;
  }

  // Bir kereye mahsus: doğrulama sonrası token satırı SİLİNİR — link ikinci kez tıklanırsa
  // (ör. e-posta istemcisi linki önden "önizleme" için otomatik açtıysa) INVALID_OR_EXPIRED_TOKEN
  // döner, ama kullanıcı zaten doğrulanmış olduğu için pratikte bir zarar yok.
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Doğrulama koduyla giriş yapabilmeliyim" — link SADECE
  // "doğrulandı" işaretlemekle kalmıyor, AYRICA yeni bir oturum (session token) açıyor. Bu
  // sayede link HANGİ tarayıcı/cihazda tıklanırsa (kayıt olunan cihazdan farklı olsa bile) o
  // tarayıcı da otomatik giriş yapmış oluyor — parolayı tekrar girmeye gerek kalmıyor.
  async verifyEmailToken(rawToken) {
    if (!rawToken) return { error: 'INVALID_OR_EXPIRED_TOKEN' };
    const token = sha256(rawToken);
    const row = await this.db.get(
      `SELECT email_verifications.user_id AS user_id FROM email_verifications
       WHERE token = ? AND expires_at > ?`,
      token, Date.now()
    );
    if (!row) return { error: 'INVALID_OR_EXPIRED_TOKEN' };

    // Önce token'ı SİL, sonra doğrula — iki eşzamanlı tıklamadan sadece silmeyi başaran (changes=1)
    // devam eder, böylece tek kullanımlık garanti asenkron DB'de de korunur.
    const del = await this.db.run('DELETE FROM email_verifications WHERE token = ?', token);
    if (del.changes !== 1) return { error: 'INVALID_OR_EXPIRED_TOKEN' };

    const now = Date.now();
    await this.db.run('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?', now, now, row.user_id);

    const user = await this.db.get('SELECT * FROM users WHERE id = ?', row.user_id);
    const sessionToken = await this._createSession(row.user_id);
    return { ok: true, user: toPublicUser(user), sessionToken };
  }

  async _createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    // [GÜVENLİK] Tarayıcıya düz token (cookie), veritabanına sadece hash'i.
    await this.db.run('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?, ?, ?, ?, 1)', sha256(token), userId, now, now + SESSION_TTL_MS);
    return token;
  }
}

module.exports = { AuthService, SESSION_TTL_MS };
