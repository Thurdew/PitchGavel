// npm rate-limit paketi yerine, projenin anti-snipe/pause-vote guard'larıyla aynı hand-rolled
// stil: IP+e-posta başına basit bir pencere/sayaç.

const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000; // 10 dk
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) || 5;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

class LoginRateLimiter {
  constructor() {
    this.attempts = new Map(); // "ip|email" -> { count, windowStart }
    this._sweepTimer = setInterval(() => this._sweepStale(), SWEEP_INTERVAL_MS);
    this._sweepTimer.unref?.();
  }

  _key(ip, email) { return `${ip}|${String(email).trim().toLowerCase()}`; }

  isBlocked(ip, email) {
    const rec = this.attempts.get(this._key(ip, email));
    if (!rec) return false;
    if (Date.now() - rec.windowStart > WINDOW_MS) return false;
    return rec.count >= MAX_ATTEMPTS;
  }

  recordFailure(ip, email) {
    const key = this._key(ip, email);
    const rec = this.attempts.get(key);
    if (!rec || Date.now() - rec.windowStart > WINDOW_MS) {
      this.attempts.set(key, { count: 1, windowStart: Date.now() });
    } else {
      rec.count += 1;
    }
  }

  recordSuccess(ip, email) { this.attempts.delete(this._key(ip, email)); }

  _sweepStale() {
    const now = Date.now();
    for (const [key, rec] of this.attempts) {
      if (now - rec.windowStart > WINDOW_MS) this.attempts.delete(key);
    }
  }
}

module.exports = { LoginRateLimiter };
