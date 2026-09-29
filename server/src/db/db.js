const path = require('path');
const fs = require('fs');
const { wrapSqlite, wrapLibsql } = require('./adapter');

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ] Yerelde Node'un built-in `node:sqlite`
// modülü (Node >=22.5, bkz. package.json engines).
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TURSO] `TURSO_DATABASE_URL` tanımlıysa (canlıda, sunucudaki
// /etc/pitchgavel.env'den) bunun yerine uzak Turso veritabanı kullanılır — hesaplar sunucudan
// bağımsız kalıcı olsun diye (eskiden Render'ın ücretsiz planında disk her deploy'da sıfırlanıyordu). Tanımlı değilse (yerel geliştirme, testler) eski
// yerel dosya aynen kullanılıyor. Servisler iki durumda da aynı asenkron arayüzü görür (adapter.js).
const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'pitchgavel.sqlite');
const TURSO_URL = process.env.TURSO_DATABASE_URL;

let db;
if (TURSO_URL) {
  // `/web` alt yolu saf fetch tabanlı — native binary gerektirmiyor.
  const { createClient } = require('@libsql/client/web');
  db = wrapLibsql(createClient({ url: TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN }));
} else {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DB_DIR, { recursive: true });
  const sqlite = new DatabaseSync(DB_PATH);
  // node:sqlite foreign key kısıtlarını varsayılan KAPALI açar. (Turso'da her HTTP isteği ayrı
  // bir bağlantı olduğu için bu PRAGMA orada kalıcı değil — uygulama kodu CASCADE'e güvenmiyor,
  // kullanıcı silme akışı yok.)
  sqlite.exec('PRAGMA foreign_keys = ON;');
  db = wrapSqlite(sqlite);
}

const SCHEMA_SQL = `
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

  -- [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAROLA SIFIRLAMA] Tek kullanımlık, 1 saatlik sıfırlama
  -- token'ları. Token'ın KENDİSİ değil SHA-256 hash'i saklanıyor — veritabanı sızsa bile bu
  -- satırlarla bir hesabın parolası değiştirilemesin diye (bkz. AuthService.createPasswordResetToken).
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

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
`;

// Şema + guard'lı ALTER'lar. Asenkron — index.js sunucuyu dinlemeye açmadan önce `ready`'i bekler.
async function initSchema(database) {
  await database.exec(SCHEMA_SQL);

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 3] `perk_grants` Faz 2'de "tüketildi
  // mi" alanı olmadan oluşturulmuştu (bilerek — o fazda gerekmiyordu). Mevcut bir tabloya
  // `CREATE TABLE IF NOT EXISTS` yeni kolon EKLEMEZ, bu yüzden minimal, tek seferlik guard'lı bir
  // ALTER — migration framework'süz, elle.
  const perkGrantsCols = (await database.all('PRAGMA table_info(perk_grants)')).map((c) => c.name);
  if (!perkGrantsCols.includes('consumed_at')) {
    await database.exec('ALTER TABLE perk_grants ADD COLUMN consumed_at INTEGER');
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] `users` Faz 1'de bu kolon olmadan
  // oluşturulmuştu — aynı guard'lı ALTER deseni.
  const usersCols = (await database.all('PRAGMA table_info(users)')).map((c) => c.name);
  if (!usersCols.includes('email_verified_at')) {
    await database.exec('ALTER TABLE users ADD COLUMN email_verified_at INTEGER');
  }
}

const ready = initSchema(db);

module.exports = { db, ready, initSchema, SCHEMA_SQL, DB_PATH, usingTurso: !!TURSO_URL };
