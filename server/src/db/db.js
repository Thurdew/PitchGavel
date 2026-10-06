const path = require('path');
const crypto = require('crypto');

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
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

  -- [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Bakiye users.coins'te (aşağıdaki
  -- guard'lı ALTER); her hareket (maç ödülü +, satın alma -) ayrıca bu deftere yazılır.
  CREATE TABLE IF NOT EXISTS coin_ledger (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     INTEGER NOT NULL,
    reason     TEXT NOT NULL,
    meta       TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_coin_ledger_user_id ON coin_ledger(user_id);

  -- Günlük maç kazancı (tavan) + günün ilk galibiyet bonusu verildi mi.
  CREATE TABLE IF NOT EXISTS coin_daily (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day       TEXT NOT NULL,
    earned    INTEGER NOT NULL DEFAULT 0,
    first_win INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );

  -- Aynı iki hesap arasında o gün kaç ödüllü maç oynandı (pair_key = "küçükId:büyükId").
  CREATE TABLE IF NOT EXISTS coin_pair_daily (
    day      TEXT NOT NULL,
    pair_key TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, pair_key)
  );

  -- Mağazadan alınan ürünler (item_id ör. "kit:retro").
  CREATE TABLE IF NOT EXISTS user_items (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id)
  );

  -- [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAYLAŞILAN SONUÇ] /sonuc/:id anlık görüntüsü (bkz. sockets/matchSockets.js).
  CREATE TABLE IF NOT EXISTS shared_results (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL);

  -- [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ARKADAŞLAR] Çift başına tek satır, user_a < user_b
  -- normalize. status: 'pending' (requested_by'ın isteği onay bekliyor) | 'accepted'.
  -- Bkz. friends/FriendService.js.
  CREATE TABLE IF NOT EXISTS friendships (
    user_a       INTEGER NOT NULL,
    user_b       INTEGER NOT NULL,
    status       TEXT NOT NULL,
    requested_by INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (user_a, user_b)
  );
  CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b);

  -- Tek yönlü engel: blocker, blocked'dan istek almaz ve ona görünmez.
  CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );
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
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKIM TEMASI] Tuttuğu takım (ücretsiz, bilgi amaçlı).
  if (!usersCols.includes('favorite_team')) {
    await database.exec('ALTER TABLE users ADD COLUMN favorite_team TEXT');
  }
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — FORMA ÇEŞİTLERİ] Seçili forma varyantı (null = iç saha).
  if (!usersCols.includes('favorite_kit')) {
    await database.exec('ALTER TABLE users ADD COLUMN favorite_kit TEXT');
  }
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Coin bakiyesi.
  if (!usersCols.includes('coins')) {
    await database.exec('ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0');
  }
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Takılı kozmetikler, JSON: { frame: 'gold', ... }.
  if (!usersCols.includes('cosmetics')) {
    await database.exec('ALTER TABLE users ADD COLUMN cosmetics TEXT');
  }
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ARKADAŞLAR] Paylaşılabilir arkadaş kodu (ilk ihtiyaçta
  // üretilir, bkz. FriendService.ensureCode) ve "durumumu arkadaşlarıma gösterme" ayarı. ALTER
  // UNIQUE kolon ekleyemediği için benzersizlik ayrı bir index'le (NULL'lar çakışmaz).
  if (!usersCols.includes('friend_code')) {
    await database.exec('ALTER TABLE users ADD COLUMN friend_code TEXT');
  }
  if (!usersCols.includes('presence_hidden')) {
    await database.exec('ALTER TABLE users ADD COLUMN presence_hidden INTEGER NOT NULL DEFAULT 0');
  }
  await database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_friend_code ON users(friend_code)');
  // [GÜVENLİK] Token'ları hash'le saklama geçişi — bkz. migrateTokenHashing.
  await migrateTokenHashing(database, 'sessions');
  await migrateTokenHashing(database, 'email_verifications');
}

// [GÜVENLİK — KOD İNCELEMESİ] Oturum ve e-posta doğrulama token'ları artık (password_resets gibi)
// düz değil SHA-256 hash'i olarak saklanıyor — veritabanı sızsa bile bu satırlarla hesaplara
// girilemesin. Mevcut düz satırlar bir kereye mahsus yerinde hash'leniyor (`hashed` bayrağı),
// böylece deploy sonrası kimsenin oturumu düşmüyor.
async function migrateTokenHashing(database, table) {
  const cols = (await database.all(`PRAGMA table_info(${table})`)).map((c) => c.name);
  if (!cols.includes('hashed')) {
    await database.exec(`ALTER TABLE ${table} ADD COLUMN hashed INTEGER NOT NULL DEFAULT 0`);
  }
  const rows = await database.all(`SELECT token FROM ${table} WHERE hashed = 0`);
  for (const row of rows) {
    await database.run(`UPDATE ${table} SET token = ?, hashed = 1 WHERE token = ? AND hashed = 0`, sha256(row.token), row.token);
  }
}

const ready = initSchema(db);

module.exports = { db, ready, initSchema, migrateTokenHashing, sha256, SCHEMA_SQL, DB_PATH, usingTurso: !!TURSO_URL };
