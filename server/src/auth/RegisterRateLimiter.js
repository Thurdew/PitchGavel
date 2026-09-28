// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÜVENLİK SERTLEŞTİRME] `LoginRateLimiter` ile AYNI
// hand-rolled desen, ama IP+e-posta değil SADECE IP başına — çünkü kayıt denemesinde e-posta
// her denemede DEĞİŞİR (bir enumeration/spam script'i farklı e-postalar dener), IP+email
// anahtarı bu senaryoyu YAKALAMAZ. Amaç: (a) tek bir IP'den kitlesel sahte hesap açılmasını,
// (b) `EMAIL_TAKEN` hatasının hızlı/otomatik e-posta enumeration'da kullanılmasını yavaşlatmak.
// Login'den daha gevşek bir eşik — aynı ofis/ev IP'sinden birkaç gerçek kişi art arda kayıt
// olabilir, bunu cezalandırmamalı.
const WINDOW_MS = Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000; // 1 saat
const MAX_ATTEMPTS = Number(process.env.REGISTER_RATE_LIMIT_MAX_ATTEMPTS) || 10;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

class RegisterRateLimiter {
  constructor() {
    this.attempts = new Map(); // ip -> { count, windowStart }
    this._sweepTimer = setInterval(() => this._sweepStale(), SWEEP_INTERVAL_MS);
    this._sweepTimer.unref?.();
  }

  isBlocked(ip) {
    const rec = this.attempts.get(ip);
    if (!rec) return false;
    if (Date.now() - rec.windowStart > WINDOW_MS) return false;
    return rec.count >= MAX_ATTEMPTS;
  }

  // Başarılı da başarısız da her deneme sayılır — amaç kitlesel hesap açmayı/enumeration'ı
  // yavaşlatmak, sadece başarısız denemeleri değil.
  recordAttempt(ip) {
    const rec = this.attempts.get(ip);
    if (!rec || Date.now() - rec.windowStart > WINDOW_MS) {
      this.attempts.set(ip, { count: 1, windowStart: Date.now() });
    } else {
      rec.count += 1;
    }
  }

  _sweepStale() {
    const now = Date.now();
    for (const [ip, rec] of this.attempts) {
      if (now - rec.windowStart > WINDOW_MS) this.attempts.delete(ip);
    }
  }
}

module.exports = { RegisterRateLimiter };
