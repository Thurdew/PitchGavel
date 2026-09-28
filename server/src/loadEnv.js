const fs = require('fs');
const path = require('path');

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] `dotenv` paketi eklemeden (yeni
// bağımlılık yok kararı, bkz. claude.md) `server/.env` dosyasını (varsa) okuyup process.env'e
// yazan minimal bir yükleyici. Gerçek ortam değişkenleri HER ZAMAN önceliklidir — `.env`'deki
// değer SADECE process.env'de o anahtar hiç yoksa yazılır (standart dotenv davranışıyla aynı).
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnvFile };
