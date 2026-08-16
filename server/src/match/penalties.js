// Penaltı atışları simülasyonu (2 maç toplamda berabere biterse — bkz. doküman
// "Maç formatı"). Aynı kaleci-kurtarış mantığı, penaltı bağlamına uygun ayrı bir olasılık
// aralığıyla (bkz. gameConfig PENALTY_SAVE_MIN/MAX) yeniden kullanılır.
const { PENALTY_SAVE_MIN, PENALTY_SAVE_MAX } = require('../shared/gameConfig');
const { groupPowers } = require('./simulate');

function penaltySaveProbability(gkRating) {
  const t = Math.max(0, Math.min(1, (gkRating - 1) / 98));
  return PENALTY_SAVE_MIN + (PENALTY_SAVE_MAX - PENALTY_SAVE_MIN) * t;
}

function takeKick(opponentGkRating) {
  const saveProb = penaltySaveProbability(opponentGkRating);
  return Math.random() >= saveProb; // true = gol
}

/**
 * Standart penaltı atışları: 5+5 atış, hâlâ berabereyse ani ölüm (sudden death) 1'e 1 devam.
 * teamA/teamB: { gkRating } — o maçtaki dizilimden kaleci reytingi.
 * Döner: { winner: 'A'|'B', scoreA, scoreB, kicks: [...] }
 */
function simulateShootout(teamA, teamB) {
  const kicks = [];
  let scoreA = 0;
  let scoreB = 0;

  function kick(side) {
    const shooterIsA = side === 'A';
    const opponentGk = shooterIsA ? teamB.gkRating : teamA.gkRating;
    const scored = takeKick(opponentGk);
    if (scored) { if (shooterIsA) scoreA++; else scoreB++; }
    kicks.push({ side, scored });
    return scored;
  }

  // İlk 5 tur (dönüşümlü)
  for (let round = 1; round <= 5; round++) {
    kick('A');
    kick('B');
    // Erken bitirme: kalan turlarla bile fark kapanamıyorsa döngüyü kes.
    const roundsLeft = 5 - round;
    if (scoreA > scoreB + roundsLeft) break;
    if (scoreB > scoreA + roundsLeft) break;
  }

  // Ani ölüm
  while (scoreA === scoreB) {
    kick('A');
    kick('B');
  }

  return { winner: scoreA > scoreB ? 'A' : 'B', scoreA, scoreB, kicks };
}

/** Bir lineup'tan kaleciyi bulup reytingini döner (yoksa referans değer). */
function lineupGkRating(lineup) {
  const gk = lineup.find((e) => e.slot === 'GK');
  return gk ? gk.player.rating : groupPowers(lineup).GK;
}

module.exports = { simulateShootout, penaltySaveProbability, lineupGkRating };
