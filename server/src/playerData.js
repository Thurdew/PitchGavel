// ETL çıktısını (server/data/processed/players.json) belleğe yükler ve oyun motoruna
// tek doğruluk kaynağı olarak sunar. Runtime'da harici bir API çağrısı YAPILMAZ
// (bkz. AUCTION-GAME-CLAUDE.md "Mimari").
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'processed', 'players.json');

let cache = null;

function loadPlayerData() {
  if (cache) return cache;
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(
      `Oyuncu veri seti bulunamadı: ${DATA_PATH}. Önce "npm run etl" ile ETL'i çalıştırın.`
    );
  }
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  cache = JSON.parse(raw);
  return cache;
}

module.exports = { loadPlayerData };
