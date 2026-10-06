// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 2] Günlük çark ödül biriktirme (bkz.
// claude.md). SADECE biriktirme — bir perk'in ODADA harcanması Faz 3'ün işi, burada
// RoomManager/DraftEngine'e HİÇ dokunulmuyor. AuthService'in `{ error: 'CODE' }` dönme
// konvansiyonuyla birebir.
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — REKLAM İZLEME KALDIRILDI] Gerçek bir reklam ağı entegre
// edilemediği (bkz. claude.md "AppLixir" notu) için "reklam izle → çevirme hakkı kazan" üçgen
// merdiveni tamamen kaldırıldı — artık her kullanıcı günde `DAILY_REWARD_FREE_SPINS_PER_DAY`
// (varsayılan 1) kadar ücretsiz çevirme hakkına sahip, reklam adımı yok.
const { PREP_WHEEL_SEGMENTS, DAILY_REWARD_FREE_SPINS_PER_DAY, DAILY_REWARD_COIN_SEGMENTS } = require('../shared/gameConfig');
const { spinWheelSegment } = require('../draft/pool');

// Kötü/nötr segmentleri (gambler/budget_penalty/ceiling_reduction/blind_first_round) bir "ödül"
// olarak vermek anlamsız olurdu — Hazırlık Çarkı'nın kendi kataloğunun sadece 'iyi' alt kümesi.
const PERK_REWARD_SEGMENTS = PREP_WHEEL_SEGMENTS.filter((s) => s.pool === 'iyi');
// Çarkın tamamı: perk'ler + coin dilimleri (`coins` alanı olanlar envantere değil bakiyeye gider).
const REWARD_SEGMENTS = [...PERK_REWARD_SEGMENTS, ...DAILY_REWARD_COIN_SEGMENTS];

function todayUTC() { return new Date().toISOString().slice(0, 10); }

class RewardsService {
  constructor(db) {
    this.db = db;
  }

  // Satırı okur, gün değiştiyse (cron/scheduler yok — okuma/yazma anında) sıfırlar. Satır yoksa
  // oluşturur. [TURSO] Asenkron DB'de eşzamanlı iki istek güvenli olsun diye INSERT OR IGNORE +
  // koşullu UPDATE (day != today) kullanılıyor, sonra satır yeniden okunuyor.
  async _getOrResetState(userId) {
    const today = todayUTC();
    await this.db.run(
      'INSERT OR IGNORE INTO daily_reward_state (user_id, day, ads_progress, spins_used, last_ad_watched_at) VALUES (?, ?, 0, 0, 0)',
      userId, today
    );
    await this.db.run(
      'UPDATE daily_reward_state SET day = ?, ads_progress = 0, spins_used = 0 WHERE user_id = ? AND day != ?',
      today, userId, today
    );
    return this.db.get('SELECT * FROM daily_reward_state WHERE user_id = ?', userId);
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 3] Sadece HARCANMAMIŞ grant'ler
  // envanterde görünür — bir perk `consumeOneGrant` ile tüketilince buradan otomatik düşer.
  async _inventory(userId) {
    const rows = await this.db.all(
      'SELECT kind, COUNT(*) AS n FROM perk_grants WHERE user_id = ? AND consumed_at IS NULL GROUP BY kind',
      userId
    );
    const inventory = {};
    // Katalogdan kaldırılmış perk türleri (ör. '🎁 Bedava Yedek' — free_backup) harcanamaz,
    // envanterde gösterilmez.
    for (const r of rows) {
      if (PREP_WHEEL_SEGMENTS.some((s) => s.kind === r.kind)) inventory[r.kind] = Number(r.n);
    }
    return inventory;
  }

  // Bir odada gerçekten harcamak için (bkz. DraftEngine.redeemBankedPerk) — FIFO: en eski
  // harcanmamış grant önce tüketilir. [TURSO] UPDATE `consumed_at IS NULL` koşullu — eşzamanlı iki
  // istek aynı satırı seçse bile sadece biri tüketebilir (changes=1), diğeri sıradakini dener.
  // Dönen `grantId`, işlem sonradan geçersiz kalırsa `restoreGrant` ile iade için.
  async consumeOneGrant(userId, kind) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.db.get(
        'SELECT id FROM perk_grants WHERE user_id = ? AND kind = ? AND consumed_at IS NULL ORDER BY granted_at ASC, id ASC LIMIT 1',
        userId, kind
      );
      if (!row) return { error: 'NO_GRANT' };
      const upd = await this.db.run('UPDATE perk_grants SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', Date.now(), row.id);
      if (upd.changes === 1) return { ok: true, grantId: row.id };
    }
    return { error: 'NO_GRANT' };
  }

  // Tüketilen bir grant'i geri verir — ör. DB beklenirken oyuncunun turu zaman aşımıyla geçtiyse.
  async restoreGrant(grantId) {
    await this.db.run('UPDATE perk_grants SET consumed_at = NULL WHERE id = ?', grantId);
  }

  async getStatus(userId) {
    const row = await this._getOrResetState(userId);
    return {
      day: row.day,
      spinsUsedToday: row.spins_used,
      spinsPerDay: DAILY_REWARD_FREE_SPINS_PER_DAY,
      spinAvailable: row.spins_used < DAILY_REWARD_FREE_SPINS_PER_DAY,
      inventory: await this._inventory(userId),
    };
  }

  async spin(userId) {
    await this._getOrResetState(userId);
    // [TURSO] Hakkı ÖNCE koşullu UPDATE ile düş — eşzamanlı iki istekten sadece biri başarır
    // (changes=1), böylece günde 1 çevirme sınırı çift tıklamayla aşılamaz.
    const claimed = await this.db.run(
      'UPDATE daily_reward_state SET spins_used = spins_used + 1 WHERE user_id = ? AND spins_used < ?',
      userId, DAILY_REWARD_FREE_SPINS_PER_DAY
    );
    if (claimed.changes !== 1) return { error: 'NO_SPIN_LEFT' };

    const seg = spinWheelSegment(REWARD_SEGMENTS);
    const perk = { kind: seg.kind, label: seg.label, description: seg.description, pool: seg.pool };
    if (seg.coins) {
      // Coin dilimi: envantere değil doğrudan bakiyeye (CoinService._credit ile aynı iki yazım).
      await this.db.run('UPDATE users SET coins = coins + ? WHERE id = ?', seg.coins, userId);
      await this.db.run(
        'INSERT INTO coin_ledger (user_id, amount, reason, meta, created_at) VALUES (?, ?, ?, ?, ?)',
        userId, seg.coins, 'daily_wheel', JSON.stringify({ kind: seg.kind }), Date.now()
      );
      const row = await this.db.get('SELECT coins FROM users WHERE id = ?', userId);
      perk.coins = seg.coins;
      perk.balance = row ? Number(row.coins || 0) : null;
    } else {
      await this.db.run(
        'INSERT INTO perk_grants (user_id, kind, label, description, granted_at) VALUES (?, ?, ?, ?, ?)',
        userId, seg.kind, seg.label, seg.description, Date.now()
      );
    }

    return { perk, status: await this.getStatus(userId) };
  }
}

module.exports = { RewardsService, REWARD_SEGMENTS, PERK_REWARD_SEGMENTS };
