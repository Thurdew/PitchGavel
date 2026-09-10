// [KULLANICI İSTEĞİ] "Maçta direkt sonucu gösterme, maç anlatımı olsun" — skor zaten
// simulate.js'de Poisson ile belirlenmiş olduğu için burada SONUÇ değiştirilmiyor, sadece
// o skora denk gelen dakika bazlı bir "event" akışı (goller + birkaç gole gitmeyen pozisyon)
// üretiliyor. İstemci bu event listesini hızlı/yavaş modda oynatıp en sonunda mevcut skor
// ekranını gösteriyor (bkz. client/public/views.js renderMatchPlayback).
const { slotToGroup } = require('../shared/football');
const { CHANCE_EVENT_COUNT_MIN, CHANCE_EVENT_COUNT_MAX } = require('../shared/gameConfig');

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Bir dizilimden, hücuma katkı ağırlığına göre (FW en yüksek, sonra MF) rastgele bir
// "aktör" (golcü/şutu çeken oyuncu) seçer — kaleciler gol atan/şut çeken rolüne girmez.
function weightedAttacker(lineup) {
  const WEIGHT = { FW: 6, MF: 3, DF: 1, GK: 0 };
  const bag = [];
  for (const entry of lineup) {
    const w = WEIGHT[slotToGroup(entry.slot)];
    for (let i = 0; i < (w || 0); i++) bag.push(entry);
  }
  if (bag.length === 0) return lineup.find((e) => e.slot !== 'GK') || lineup[0];
  return pick(bag);
}

function goalkeeperOf(lineup) {
  return lineup.find((e) => e.slot === 'GK') || null;
}

// Aynı dakikada iki event çakışmasın diye benzersiz bir dakika (1-90) üretir.
function uniqueMinute(taken) {
  let m;
  let guard = 0;
  do {
    m = randomInt(1, 90);
    guard++;
  } while (taken.has(m) && guard < 500);
  taken.add(m);
  return m;
}

/**
 * lineupHome/lineupAway: [{slot, player}]. goalsHome/goalsAway: simulate.js'de zaten
 * belirlenmiş nihai skor (burada değiştirilmez). Döner: dakikaya göre sıralı event dizisi.
 * Event tipleri: 'goal' (skoru oluşturan, sayısı goalsHome+goalsAway kadar) ve 'chance'
 * (sadece anlatım rengi için, skora etkisi yok).
 *
 * `sharedTakenMinutes` verilirse (bkz. simulate.js), kart event'leriyle (cards.js) aynı
 * dakika havuzu paylaşılır — böylece bir gol ile bir kart aynı dakikaya denk gelmez.
 */
function buildMatchEvents(lineupHome, lineupAway, goalsHome, goalsAway, sharedTakenMinutes) {
  const takenMinutes = sharedTakenMinutes || new Set();
  const events = [];

  for (let i = 0; i < goalsHome; i++) {
    const scorer = weightedAttacker(lineupHome);
    events.push({
      type: 'goal',
      team: 'home',
      minute: uniqueMinute(takenMinutes),
      scorerName: scorer.player.name,
      scorerSlot: scorer.slot,
    });
  }
  for (let i = 0; i < goalsAway; i++) {
    const scorer = weightedAttacker(lineupAway);
    events.push({
      type: 'goal',
      team: 'away',
      minute: uniqueMinute(takenMinutes),
      scorerName: scorer.player.name,
      scorerSlot: scorer.slot,
    });
  }

  const chanceCount = randomInt(CHANCE_EVENT_COUNT_MIN, CHANCE_EVENT_COUNT_MAX);
  for (let i = 0; i < chanceCount; i++) {
    const isHome = Math.random() < 0.5;
    const attackLineup = isHome ? lineupHome : lineupAway;
    const defendLineup = isHome ? lineupAway : lineupHome;
    const shooter = weightedAttacker(attackLineup);
    const gk = goalkeeperOf(defendLineup);
    events.push({
      type: 'chance',
      team: isHome ? 'home' : 'away',
      minute: uniqueMinute(takenMinutes),
      playerName: shooter.player.name,
      gkName: gk ? gk.player.name : null,
    });
  }

  events.sort((a, b) => a.minute - b.minute);
  return events;
}

module.exports = { buildMatchEvents };
