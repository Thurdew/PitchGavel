// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TEK ÖLÇEK] Kalibrasyonu MEVCUT players.json üzerinde
// çalıştıran bağımsız script — run.js'in tamamını (Transfermarkt CSV'leri, icons_wikidata,
// FC26 eşleştirme) yeniden çalıştırmaya gerek kalmasın diye. reapplyFc26Overrides.js ile aynı
// desen: ham veri klasörüne hiç dokunmaz, sadece processed/players.json'u okur, aktif
// oyuncuların reytingini EA ölçeğine oturtur ve dosyayı geri yazar.
//
// Kullanım:  node server/src/etl/calibrateExisting.js
//
// Yeniden çalıştırmak güvenli: EA ile eşleşen oyuncular (ratingOverrideSource === EA_SOURCE)
// hiç değişmez, kalibre edilenler ise her çalıştırmada aynı sıralama anahtarından
// hesaplandığı için aynı sonucu verir — ama sıralama anahtarı kalibrasyondan SONRA
// ezildiğinden, ikinci çalıştırma bir öncekinin sonucunu sıralama girdisi olarak kullanır.
// Bu yüzden ilk çalıştırmada orijinal formül reytingi `ratingFormula` alanına yedeklenir ve
// sonraki çalıştırmalar hep ondan başlar (idempotent).
const fs = require('fs');
const path = require('path');
const { calibrateToEaScale, EA_SOURCE, CALIBRATED_SOURCE } = require('./eaCalibration');

const FILE = path.join(__dirname, '..', '..', 'data', 'processed', 'players.json');

function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`[kalibre] players.json bulunamadı: ${FILE}`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const players = doc.players || doc;
  const active = players.filter((p) => !p.isIcon);

  // İdempotanlık: orijinal formül reytingini bir kez yedekle, sonraki çalıştırmalarda ondan başla.
  for (const p of active) {
    if (p.ratingOverrideSource === CALIBRATED_SOURCE && p.ratingFormula != null) {
      p.rating = p.ratingFormula;
      p.ratingOverrideSource = null;
    } else if (p.ratingOverrideSource !== EA_SOURCE && p.ratingFormula == null) {
      p.ratingFormula = p.rating;
    }
  }

  const before = summarize(active);
  const calib = calibrateToEaScale(active);
  for (const p of active) delete p.ratingBeforeCalibration;
  const after = summarize(active);

  if (doc.ratingScale) {
    doc.ratingScale.method = 'EA FC26 (eşleşenler) + lig bazlı quantile kalibrasyonu (eşleşmeyenler)';
  }
  doc.generatedAt = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2), 'utf8');

  console.log(`[kalibre] ${calib.calibrated} oyuncu EA ölçeğine oturtuldu`);
  for (const [lg, s] of Object.entries(calib.byLeague)) {
    console.log(`  ${lg}: EA=${s.eaCount}, kalibre=${s.calibratedCount}, bant=${s.band[0]}-${s.band[1]}${s.usedGlobalTable ? ' (global cetvel)' : ''}`);
  }
  console.log(`[kalibre] ÖNCE : ${before}`);
  console.log(`[kalibre] SONRA: ${after}`);
  if (calib.suspects.length) {
    console.log('[kalibre] ⚠ muhtemel isim eşleme hatası (EA dosyasında bulunamadı ama 20M€+ — run.js\'e alias eklenirse gerçek EA reytingini alır):');
    for (const s of calib.suspects) {
      console.log(`  - ${s.name} (${s.club}, ${s.league}) ${(s.value / 1e6).toFixed(0)}M€ → kalibre ${s.rating}`);
    }
  }
  console.log(`[kalibre] yazıldı -> ${FILE}`);
}

function summarize(list) {
  const r = list.map((p) => p.rating).sort((a, b) => a - b);
  const q = (t) => r[Math.floor((r.length - 1) * t)];
  const bands = {};
  for (const v of r) { const b = Math.floor(v / 5) * 5; bands[b] = (bands[b] || 0) + 1; }
  const hist = Object.keys(bands).sort((a, b) => a - b).map((k) => `${k}:${bands[k]}`).join(' ');
  return `n=${r.length} min=${r[0]} p10=${q(0.1)} med=${q(0.5)} p90=${q(0.9)} max=${r[r.length - 1]} ort=${(r.reduce((a, b) => a + b, 0) / r.length).toFixed(1)} | ${hist}`;
}

main();
