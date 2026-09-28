// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 2] Günlük çark ödül biriktirme (bkz.
// claude.md). SADECE biriktirme — bir perk'in ODADA harcanması Faz 3'ün işi, burada
// RoomManager/DraftEngine'e HİÇ dokunulmuyor. AuthService'in `{ error: 'CODE' }` dönme
// konvansiyonuyla birebir.
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — REKLAM İZLEME KALDIRILDI] Gerçek bir reklam ağı entegre
// edilemediği (bkz. claude.md "AppLixir" notu) için "reklam izle → çevirme hakkı kazan" üçgen
// merdiveni tamamen kaldırıldı — artık her kullanıcı günde `DAILY_REWARD_FREE_SPINS_PER_DAY`
// (varsayılan 1) kadar ücretsiz çevirme hakkına sahip, reklam adımı yok.
const { PREP_WHEEL_SEGMENTS, DAILY_REWARD_FREE_SPINS_PER_DAY } = require('../shared/gameConfig');
const { spinWheelSegment } = require('../draft/pool');

// Kötü/nötr segmentleri (gambler/budget_penalty/ceiling_reduction/blind_first_round) bir "ödül"
// olarak vermek anlamsız olurdu — Hazırlık Çarkı'nın kendi kataloğunun sadece 'iyi' alt kümesi.
const REWARD_SEGMENTS = PREP_WHEEL_SEGMENTS.filter((s) => s.pool === 'iyi');

function todayUTC() { return new Date().toISOString().slice(0, 10); }

class RewardsService {
  constructor(db) {
    this.db = db;
  }

  // Satırı okur, gün değiştiyse (cron/scheduler yok — okuma/yazma anında) sıfırlar. Satır yoksa
  // oluşturur.
  _getOrResetState(userId) {
    const today = todayUTC();
    let row = this.db.prepare('SELECT * FROM daily_reward_state WHERE user_id = ?').get(userId);
    if (!row) {
      this.db.prepare(
        'INSERT INTO daily_reward_state (user_id, day, ads_progress, spins_used, last_ad_watched_at) VALUES (?, ?, 0, 0, 0)'
      ).run(userId, today);
      row = { user_id: userId, day: today, ads_progress: 0, spins_used: 0, last_ad_watched_at: 0 };
    } else if (row.day !== today) {
      this.db.prepare(
        'UPDATE daily_reward_state SET day = ?, ads_progress = 0, spins_used = 0 WHERE user_id = ?'
      ).run(today, userId);
      row = { ...row, day: today, ads_progress: 0, spins_used: 0 };
    }
    return row;
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 3] Sadece HARCANMAMIŞ grant'ler
  // envanterde görünür — bir perk `consumeOneGrant` ile tüketilince buradan otomatik düşer.
  _inventory(userId) {
    const rows = this.db.prepare(
      'SELECT kind, COUNT(*) AS n FROM perk_grants WHERE user_id = ? AND consumed_at IS NULL GROUP BY kind'
    ).all(userId);
    const inventory = {};
    for (const r of rows) inventory[r.kind] = r.n;
    return inventory;
  }

  // Bir odada gerçekten harcamak için (bkz. DraftEngine.redeemBankedPerk) — FIFO: en eski
  // harcanmamış grant önce tüketilir.
  consumeOneGrant(userId, kind) {
    const row = this.db.prepare(
      'SELECT id FROM perk_grants WHERE user_id = ? AND kind = ? AND consumed_at IS NULL ORDER BY granted_at ASC LIMIT 1'
    ).get(userId, kind);
    if (!row) return { error: 'NO_GRANT' };
    this.db.prepare('UPDATE perk_grants SET consumed_at = ? WHERE id = ?').run(Date.now(), row.id);
    return { ok: true };
  }

  getStatus(userId) {
    const row = this._getOrResetState(userId);
    return {
      day: row.day,
      spinsUsedToday: row.spins_used,
      spinsPerDay: DAILY_REWARD_FREE_SPINS_PER_DAY,
      spinAvailable: row.spins_used < DAILY_REWARD_FREE_SPINS_PER_DAY,
      inventory: this._inventory(userId),
    };
  }

  spin(userId) {
    const row = this._getOrResetState(userId);
    if (row.spins_used >= DAILY_REWARD_FREE_SPINS_PER_DAY) return { error: 'NO_SPIN_LEFT' };

    const seg = spinWheelSegment(REWARD_SEGMENTS);
    const now = Date.now();
    this.db.prepare(
      'INSERT INTO perk_grants (user_id, kind, label, description, granted_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, seg.kind, seg.label, seg.description, now);
    this.db.prepare(
      'UPDATE daily_reward_state SET spins_used = spins_used + 1 WHERE user_id = ?'
    ).run(userId);

    return { perk: { kind: seg.kind, label: seg.label, description: seg.description, pool: seg.pool }, status: this.getStatus(userId) };
  }
}

module.exports = { RewardsService, REWARD_SEGMENTS };
