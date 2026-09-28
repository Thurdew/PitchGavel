// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAROLA SIFIRLAMA] Register/ResendVerification limiter'larıyla
// AYNI hand-rolled desen, ama anahtar dışarıdan veriliyor — index.js iki örnek kullanıyor:
// IP başına (tek IP'den e-posta bombardımanı/tarama) ve e-posta başına (bir kişinin gelen
// kutusunun farklı IP'lerden sıfırlama maili ile doldurulması).
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

class PasswordResetRateLimiter {
  constructor({ maxAttempts, windowMs }) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.attempts = new Map(); // key -> { count, windowStart }
    this._sweepTimer = setInterval(() => this._sweepStale(), SWEEP_INTERVAL_MS);
    this._sweepTimer.unref?.();
  }

  isBlocked(key) {
    const rec = this.attempts.get(key);
    if (!rec) return false;
    if (Date.now() - rec.windowStart > this.windowMs) return false;
    return rec.count >= this.maxAttempts;
  }

  recordAttempt(key) {
    const rec = this.attempts.get(key);
    if (!rec || Date.now() - rec.windowStart > this.windowMs) {
      this.attempts.set(key, { count: 1, windowStart: Date.now() });
    } else {
      rec.count += 1;
    }
  }

  _sweepStale() {
    const now = Date.now();
    for (const [key, rec] of this.attempts) {
      if (now - rec.windowStart > this.windowMs) this.attempts.delete(key);
    }
  }
}

module.exports = { PasswordResetRateLimiter };
