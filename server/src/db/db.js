const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ] Yeni bir npm bağımlılığı eklemeden kalıcı
// depolama: Node'un built-in `node:sqlite` modülü (Node >=22.5 gerektirir, bkz. package.json
// engines). Proje zaten minimal bağımlılıklı (express+socket.io+csv-parse) — bu felsefeyi bozmuyor.
const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'pitchgavel.sqlite');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// node:sqlite foreign key kısıtlarını varsayılan KAPALI açar — sessions.user_id ON DELETE
// CASCADE'in çalışması için elle açılması gerekiyor.
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  -- [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] Kayıt olurken gönderilen doğrulama
  -- linkindeki tek kullanımlık token'lar (24 saat TTL, bkz. AuthService.createVerificationToken).
  CREATE TABLE IF NOT EXISTS email_verifications (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

  -- [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 2] Günlük "reklam izle → çark
  -- çevir" ödül biriktirme. Bir kullanıcı = bir satır; gün değişince RewardsService lazy-reset
  -- yapıyor (cron/scheduler yok).
  CREATE TABLE IF NOT EXISTS daily_reward_state (
    user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    day                TEXT NOT NULL,
    ads_progress       INTEGER NOT NULL DEFAULT 0,
    spins_used         INTEGER NOT NULL DEFAULT 0,
    last_ad_watched_at INTEGER NOT NULL DEFAULT 0
  );

  -- Kazanılan perk'lerin sade bir defteri (ledger) — "tüketildi mi" alanı BİLEREK yok, bu
  -- Faz 3'ün (odada harcama) kendi ihtiyacına göre ekleyeceği bir şey.
  CREATE TABLE IF NOT EXISTS perk_grants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    label       TEXT NOT NULL,
    description TEXT NOT NULL,
    granted_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_perk_grants_user_id ON perk_grants(user_id);
`);

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 3] `perk_grants` Faz 2'de "tüketildi
// mi" alanı olmadan oluşturulmuştu (bilerek — o fazda gerekmiyordu). Şimdi gerekiyor: mevcut bir
// tabloya `CREATE TABLE IF NOT EXISTS` yeni kolon EKLEMEZ, bu yüzden minimal, tek seferlik
// guard'lı bir ALTER — migration framework'süz, elle.
const perkGrantsCols = db.prepare('PRAGMA table_info(perk_grants)').all().map((c) => c.name);
if (!perkGrantsCols.includes('consumed_at')) {
  db.exec('ALTER TABLE perk_grants ADD COLUMN consumed_at INTEGER');
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] `users` Faz 1'de bu kolon olmadan
// oluşturulmuştu (e-posta doğrulaması o an ertelenmişti) — aynı guard'lı ALTER deseni.
const usersCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!usersCols.includes('email_verified_at')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified_at INTEGER');
}

module.exports = { db, DB_PATH };
