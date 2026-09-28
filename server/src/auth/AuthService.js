const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 30 gün
const SESSION_SWEEP_INTERVAL_MS = 30 * 60 * 1000; // RoomManager'ın periyodik temizliğiyle aynı ritim
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA]
const EMAIL_VERIFICATION_TTL_MS = Number(process.env.EMAIL_VERIFICATION_TTL_MS) || 24 * 60 * 60 * 1000; // 24 saat

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function toPublicUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, emailVerified: !!row.email_verified_at };
}

class AuthService {
  constructor(db) {
    this.db = db;
    this._sweepTimer = setInterval(() => this.sweepExpiredSessions(), SESSION_SWEEP_INTERVAL_MS);
    this._sweepTimer.unref?.();
  }

  register(email, password, displayName) {
    const normEmail = normalizeEmail(email);
    const existing = this.db.prepare('SELECT id FROM users WHERE email = ?').get(normEmail);
    if (existing) return { error: 'EMAIL_TAKEN' };

    const { hash, salt } = hashPassword(password);
    const now = Date.now();
    const info = this.db.prepare(
      `INSERT INTO users (email, password_hash, password_salt, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(normEmail, hash, salt, displayName.trim().slice(0, 24), now, now);

    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = this._createSession(user.id);
    return { user: toPublicUser(user), token };
  }

  login(email, password) {
    const normEmail = normalizeEmail(email);
    const user = this.db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);
    // Bilinmeyen e-posta ile yanlış parola AYNI hata kodunu döner — e-posta enumeration'a
    // izin vermemek için.
    if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
      return { error: 'INVALID_CREDENTIALS' };
    }
    const token = this._createSession(user.id);
    return { user: toPublicUser(user), token };
  }

  getUserByToken(token) {
    if (!token) return null;
    const row = this.db.prepare(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ? AND sessions.expires_at > ?`
    ).get(token, Date.now());
    return row ? toPublicUser(row) : null;
  }

  // Sadece sunulan token'a ait oturumu kapatır ("bu cihazdan çıkış") — aynı kullanıcının diğer
  // cihaz/tarayıcılardaki oturumları doğal süresi (30 gün) dolana kadar geçerli kalır.
  logout(token) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  sweepExpiredSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    this.db.prepare('DELETE FROM email_verifications WHERE expires_at <= ?').run(Date.now());
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] bkz. claude.md. index.js
  // sendVerificationEmail'i BU token ile çağırıyor — token asla HTTP response body'sinde
  // dönmüyor (sadece e-posta linkinde), güvenlik açısından.
  createVerificationToken(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.db.prepare('INSERT INTO email_verifications (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, now, now + EMAIL_VERIFICATION_TTL_MS);
    return token;
  }

  // Bir kereye mahsus: doğrulama sonrası token satırı SİLİNİR — link ikinci kez tıklanırsa
  // (ör. e-posta istemcisi linki önden "önizleme" için otomatik açtıysa) INVALID_OR_EXPIRED_TOKEN
  // döner, ama kullanıcı zaten doğrulanmış olduğu için pratikte bir zarar yok.
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Doğrulama koduyla giriş yapabilmeliyim" — link SADECE
  // "doğrulandı" işaretlemekle kalmıyor, AYRICA yeni bir oturum (session token) açıyor. Bu
  // sayede link HANGİ tarayıcı/cihazda tıklanırsa (kayıt olunan cihazdan farklı olsa bile) o
  // tarayıcı da otomatik giriş yapmış oluyor — parolayı tekrar girmeye gerek kalmıyor.
  verifyEmailToken(token) {
    const row = this.db.prepare(
      `SELECT email_verifications.user_id AS user_id FROM email_verifications
       WHERE token = ? AND expires_at > ?`
    ).get(token, Date.now());
    if (!row) return { error: 'INVALID_OR_EXPIRED_TOKEN' };

    const now = Date.now();
    this.db.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.user_id);
    this.db.prepare('DELETE FROM email_verifications WHERE token = ?').run(token);

    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    const sessionToken = this._createSession(row.user_id);
    return { ok: true, user: toPublicUser(user), sessionToken };
  }

  _createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, now, now + SESSION_TTL_MS);
    return token;
  }
}

module.exports = { AuthService, SESSION_TTL_MS };
