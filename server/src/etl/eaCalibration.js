// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TEK ÖLÇEK] "Aynı havuzda iki farklı ölçek karışıyor
// (EA vs bizim formül)" + "alt banda çok oyuncu var, herkes 60 civarı, fark yok."
//
// TEŞHİS (players.json üzerinde ölçüldü, 3558 aktif oyuncu):
//   · EA FC26 dosyalarıyla eşleşen 2584 oyuncu  → ortalama 74.1
//   · eşleşmeyip kendi formülümüzle hesaplanan 974 oyuncu → ortalama 54.8
//   · histogram ÇİFT TEPELİ: 45-59 bandında 804 oyuncu (neredeyse tamamı formül artığı),
//     gerçek kütle 70-79'da. Yani "alt bant kalabalık ve orada fark yok" şikâyeti, ayrı bir
//     ölçeğin oraya yığılmasından geliyordu — oyuncuların kalitesinden değil.
//   · Süper Lig'de kapsam sadece %57 olduğu için lig ortalaması (62.4) haksız yere en düşüktü;
//     aynı ligin EA ile eşleşenlerinin ortalaması 69.8.
//
// KARAR: "Tamamen EA'ya geç." Tek engel, EA dosyalarının ilk takım kadrolarını kapsaması —
// 974 oyuncunun EA reytingi YOK, onları havuzdan atmak havuzu daraltır. Çözüm: kendi
// formülümüzü artık REYTİNG ÜRETMEK için değil, sadece SIRALAMA için kullanmak. Sayının
// kendisi EA dağılımından okunuyor (quantile kalibrasyonu):
//
//   1. Her lig için EA ile eşleşen oyuncuların reytingleri sıralanır → o ligin gerçek EA
//      dağılımı (cetvel) elde edilir.
//   2. O ligdeki eşleşmeyen oyuncular, kendi formülümüzün verdiği reytinge göre SIRALANIR
//      (sayı atılır, sıra korunur).
//   3. Bu sıra, ligin EA dağılımının [taban, HIGH_PERCENTILE] bandına doğrusal eşlenir.
//
// Neden ligin TAMAMI değil de üst sınır p70? EA dosyaları ilk takımı listeler; eşleşmeyenler
// ağırlıkla kenar kadro, altyapı ve sezon içinde ayrılmış oyuncular. Bu grubu ligin en
// tepesine kadar yaymak, kenar kadro oyuncusunu yıldız yapardı. Alt sınır ise ligin EA
// minimumunun 4 puan altı (mutlak taban 48) — böylece iki grup arasında boşluk ya da basamak
// oluşmuyor, dağılım tek tepeli ve sürekli kalıyor.
//
// ÖLÇÜLEN SONUÇ: 48-91 aralığında tek tepeli dağılım, ortalama 71.4 (EA'nın 74.1'ine yakın),
// 45-59 bandındaki yığın 804 → 351'e düşüyor, 19 puanlık cetvel uçurumu kayboluyor.
//
// Şeffaflık: kalibre edilen oyuncular `ratingOverrideSource: 'fc26-2026-27-kalibre'` ile
// işaretlenir — istemci bunu "≈EA" rozetiyle gösterir (bkz. helpers.js fmtRatingSource),
// yani hangi sayının EA'nın kendi verisi hangisinin o ölçeğe oturtulmuş tahmin olduğu
// kullanıcıdan gizlenmiyor.

const HIGH_PERCENTILE = 0.70; // eşleşmeyenlerin çıkabileceği en üst EA dilimi
const LOW_OFFSET = 4;         // ligin EA minimumunun kaç puan altından başlasın
const ABSOLUTE_FLOOR = 48;    // profesyonel bir ligde forma giyen kimse bunun altına inmesin
const MIN_EA_SAMPLE = 40;     // bir ligin kendi cetveli için gereken en az EA örneği
const EA_SOURCE = 'fc26-2026-27';
const CALIBRATED_SOURCE = 'fc26-2026-27-kalibre';

// Sıralı bir dizide t (0..1) diliminin değeri — aradaki noktalar doğrusal enterpolasyonla.
function quantile(sorted, t) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * Math.max(0, Math.min(1, t));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Eşleşmeyen oyuncuların reytingini EA ölçeğine kalibre eder (yerinde değiştirir).
 * @param {Array} activePlayers - aktif (icon olmayan) oyuncular, FC26 override'ları UYGULANMIŞ halde
 * @returns {{ calibrated:number, byLeague:Object, suspects:Array }} özet + muhtemel eşleme hataları
 */
function calibrateToEaScale(activePlayers) {
  const byLeague = new Map();
  for (const p of activePlayers) {
    const key = p.league || '—';
    if (!byLeague.has(key)) byLeague.set(key, []);
    byLeague.get(key).push(p);
  }

  // Global cetvel — EA örneği az olan ligler için yedek.
  const globalEa = activePlayers
    .filter((p) => p.ratingOverrideSource === EA_SOURCE)
    .map((p) => p.rating)
    .sort((a, b) => a - b);

  if (globalEa.length < MIN_EA_SAMPLE) {
    console.warn('[etl] EA kalibrasyonu atlandı — yeterli EA örneği yok');
    return { calibrated: 0, byLeague: {}, suspects: [] };
  }

  const summary = {};
  let calibrated = 0;

  for (const [league, group] of byLeague) {
    const ea = group
      .filter((p) => p.ratingOverrideSource === EA_SOURCE)
      .map((p) => p.rating)
      .sort((a, b) => a - b);
    const table = ea.length >= MIN_EA_SAMPLE ? ea : globalEa;

    const low = Math.max(ABSOLUTE_FLOOR, table[0] - LOW_OFFSET);
    const high = Math.round(quantile(table, HIGH_PERCENTILE));

    // Sıralama anahtarı: kendi formülümüzün reytingi. Eşitlikleri isimle kırıyoruz — böylece
    // sonuç deterministik (aynı veriyle aynı çıktı) ve eşit reytingli oyuncular da farklı
    // sıralara düşüp bandın içine yayılıyor ("herkes aynı sayı" sorununun bir parçası buydu).
    const unmatched = group
      .filter((p) => p.ratingOverrideSource !== EA_SOURCE)
      .sort((a, b) => (a.rating - b.rating) || String(a.name).localeCompare(String(b.name), 'tr'));

    unmatched.forEach((p, i) => {
      const rank01 = unmatched.length === 1 ? 1 : i / (unmatched.length - 1);
      p.ratingBeforeCalibration = p.rating; // teşhis için saklanıyor (istemciye gitmiyor)
      p.rating = Math.max(1, Math.min(99, Math.round(low + (high - low) * rank01)));
      p.ratingOverrideSource = CALIBRATED_SOURCE;
      calibrated++;
    });

    summary[league] = {
      eaCount: ea.length,
      calibratedCount: unmatched.length,
      usedGlobalTable: table === globalEa,
      band: [low, high],
    };
  }

  // Muhtemel İSİM EŞLEME HATALARI: EA dosyasında bulunamamış ama piyasa değeri yüksek
  // oyuncular. Bunlar gerçekten kenar kadro değil, çoğu zaman yazım farkı (ör. "Ilya
  // Zabarnyi" ↔ "Illia Zabarnyi") — alias eklemek kalibrasyondan daha doğru sonuç verir,
  // bu yüzden ETL çıktısında açıkça listeleniyor.
  const suspects = activePlayers
    .filter((p) => p.ratingOverrideSource === CALIBRATED_SOURCE && (p.marketValueEUR || 0) >= 20e6)
    .sort((a, b) => (b.marketValueEUR || 0) - (a.marketValueEUR || 0))
    .slice(0, 30)
    .map((p) => ({ name: p.name, club: p.club, league: p.league, value: p.marketValueEUR, rating: p.rating }));

  return { calibrated, byLeague: summary, suspects };
}

module.exports = {
  calibrateToEaScale,
  EA_SOURCE,
  CALIBRATED_SOURCE,
  HIGH_PERCENTILE,
  ABSOLUTE_FLOOR,
};
