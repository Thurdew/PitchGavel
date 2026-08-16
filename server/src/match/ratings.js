// [KULLANICI İSTEĞİ] "Saha formatında oyuncuların performansını gösteren performans puanı
// gözüksün, mesela X oyuncusu iyi oynadı maç puanı 9 gibi." — bu, oyuncunun SABİT kadro
// reytinginden bağımsız, o maça özel bir performans skorudur (1-10 ölçek, gerçek maç
// raporlarındaki oyuncu notlarına benzer). Sonucu DEĞİŞTİRMEZ — skor zaten simulate.js'de
// belirlendi, bu sadece o sonucu oyuncu bazında yorumlayan bir sunum katmanı.
const { slotToGroup } = require('../shared/football');

const BASE_RATING = 6.4;
const MIN_RATING = 4.5;
const MAX_RATING = 10;

/**
 * events (bkz. narration.js buildMatchEvents çıktısı) içindeki gol event'lerinden, belirli bir
 * takım ('home'|'away' — o maça özel taraf) için oyuncu adı -> gol sayısı haritası çıkarır.
 */
function scorerCountsFor(events, team) {
  const counts = new Map();
  for (const ev of events || []) {
    if (ev.type === 'goal' && ev.team === team) {
      counts.set(ev.scorerName, (counts.get(ev.scorerName) || 0) + 1);
    }
  }
  return counts;
}

/**
 * lineup: [{slot, player}]. Döner: aynı diziler + her girişe eklenmiş `matchRating` (1-10).
 * Formül: takım sonucu (galibiyet/mağlubiyet farkı) herkese hafif yansır, gol atana kişisel
 * bonus verilir, kaleciye yediği gol sayısına göre bonus/ceza uygulanır, kaliteli oyuncu
 * ortalamada biraz daha güvenilir oynar (küçük bir çapa), ve sınırlı bir rastgele form
 * varyasyonu eklenir (aynı maçta bazı oyuncular iyi bazıları kötü günündedir).
 */
function computeMatchRatings(lineup, goalsFor, goalsAgainst, scorerCounts) {
  const goalDiff = goalsFor - goalsAgainst;
  return lineup.map((entry) => {
    let rating = BASE_RATING;
    const group = slotToGroup(entry.slot);

    rating += Math.max(-1.2, Math.min(1.2, goalDiff * 0.35));

    const goals = scorerCounts.get(entry.player.name) || 0;
    rating += goals * 1.1;

    if (group === 'GK') {
      rating += Math.max(-1.5, Math.min(1.5, (1.2 - goalsAgainst) * 0.55));
    }

    rating += (entry.player.rating - 70) / 110;
    rating += (Math.random() * 1.6 - 0.8);

    rating = Math.max(MIN_RATING, Math.min(MAX_RATING, rating));
    return { slot: entry.slot, player: entry.player, matchRating: Math.round(rating * 10) / 10 };
  });
}

module.exports = { computeMatchRatings, scorerCountsFor };
