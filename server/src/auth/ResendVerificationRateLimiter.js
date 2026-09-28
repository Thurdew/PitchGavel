// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] `LoginRateLimiter`/`RegisterRateLimiter`
// ile AYNI hand-rolled desen — bu kez kullanıcı ID başına (giriş yapılmış bir aksiyon olduğu
// için IP yerine kullanıcı kimliği daha doğru anahtar). Amaç: birinin "tekrar gönder" düğmesine
// art arda basıp kendi Resend kotasını/gelen kutusunu spamlamasını önlemek.
const WINDOW_MS = Number(process.env.RESEND_VERIFICATION_WINDOW_MS) || 60 * 60 * 1000; // 1 saat
const MAX_ATTEMPTS = Number(process.env.RESEND_VERIFICATION_MAX_ATTEMPTS) || 3;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

class ResendVerificationRateLimiter {
  constructor() {
    this.attempts = new Map(); // userId -> { count, windowStart }
    this._sweepTimer = setInterval(() => this._sweepStale(), SWEEP_INTERVAL_MS);
    this._sweepTimer.unref?.();
  }

  isBlocked(userId) {
    const rec = this.attempts.get(userId);
    if (!rec) return false;
    if (Date.now() - rec.windowStart > WINDOW_MS) return false;
    return rec.count >= MAX_ATTEMPTS;
  }

  recordAttempt(userId) {
    const rec = this.attempts.get(userId);
    if (!rec || Date.now() - rec.windowStart > WINDOW_MS) {
      this.attempts.set(userId, { count: 1, windowStart: Date.now() });
    } else {
      rec.count += 1;
    }
  }

  _sweepStale() {
    const now = Date.now();
    for (const [userId, rec] of this.attempts) {
      if (now - rec.windowStart > WINDOW_MS) this.attempts.delete(userId);
    }
  }
}

module.exports = { ResendVerificationRateLimiter };
