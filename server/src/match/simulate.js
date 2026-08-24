// Maç simülasyonu çekirdeği (bkz. AUCTION-GAME-CLAUDE.md "Maç Simülasyonu").
const { slotToGroup } = require('../shared/football');
const {
  BASE_GOAL_RATE,
  MIDFIELD_ATTACK_WEIGHT,
  REFERENCE_RATING,
  GK_SAVE_FACTOR_MIN,
  GK_SAVE_FACTOR_MAX,
  HOME_ADVANTAGE_BONUS,
  TACTIC_SHIFT,
  RED_CARD_POWER_PENALTY,
  COUNTER_OWN_ATTACK_PENALTY,
  COUNTER_OPPONENT_ATTACK_PENALTY,
} = require('../shared/gameConfig');
const { buildMatchEvents } = require('./narration');
const { rollCards } = require('./cards');

/** Dizilimi (lineup: [{slot, player}]) 4 güç grubuna ayırıp her biri için ortalama reyting hesaplar. */
function groupPowers(lineup) {
  const sums = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const entry of lineup) {
    const group = slotToGroup(entry.slot);
    sums[group] += entry.player.rating;
    counts[group] += 1;
  }
  const avg = (g) => (counts[g] > 0 ? sums[g] / counts[g] : REFERENCE_RATING);
  return { GK: avg('GK'), DF: avg('DF'), MF: avg('MF'), FW: avg('FW') };
}

/** Kaleci reytingini (1-99) bir "kurtarış faktörüne" (0-1 arası çarpan) çevirir. */
function goalkeeperSaveFactor(gkRating) {
  const t = Math.max(0, Math.min(1, (gkRating - 1) / 98));
  return GK_SAVE_FACTOR_MIN + (GK_SAVE_FACTOR_MAX - GK_SAVE_FACTOR_MIN) * t;
}

/**
 * xG_A = baz_gol * (Hücum_A + ağırlıklı*OrtaSaha_A) / (Defans_B/referans) * (1 - Kaleci_B kurtarış faktörü)
 * (bkz. doküman formülü). `isHome` ise Hücum_A'ya ev sahibi avantajı bonusu uygulanır.
 */
function expectedGoals(attackerPowers, defenderPowers, isHome) {
  let attack = attackerPowers.FW;
  if (isHome) attack *= (1 + HOME_ADVANTAGE_BONUS);
  const attackPower = attack + MIDFIELD_ATTACK_WEIGHT * attackerPowers.MF;
  const referenceAttack = REFERENCE_RATING * (1 + MIDFIELD_ATTACK_WEIGHT);
  const defenseFactor = defenderPowers.DF / REFERENCE_RATING;
  const saveFactor = goalkeeperSaveFactor(defenderPowers.GK);
  const xg = BASE_GOAL_RATE * (attackPower / referenceAttack) / defenseFactor * (1 - saveFactor);
  return Math.max(0.05, xg); // xG asla tam sıfıra inmesin (her zaman küçük bir gol ihtimali kalsın)
}

/** Knuth algoritmasıyla Poisson dağılımlı rastgele tam sayı üretir. */
function samplePoisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

// [KULLANICI İSTEĞİ] "Atak/dengeli/defansif oyna seçenekleri gelsin maçtan önce." — takımın
// kendi seçtiği taktiğe göre hücum/defans gücü arasında bir ödünleşim (trade-off) uygular.
// 'balanced' (varsayılan/eksikse) hiçbir şeyi değiştirmez.
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kontra" — zayıf bir kadroya da gerçek bir taktik şansı
// versin diye eklendi (bkz. gameConfig.js COUNTER_* notu). Burada SADECE kendi hücum/orta saha
// gücünden feragat eden kısmı uygulanıyor; rakibin hücum gücünü KISAN kısmı (asıl "kontra"
// etkisi) simulateSingleMatch'te, iki takımın taktiği birbirine bakılarak uygulanıyor — o yüzden
// applyTactic tek başına (rakip bilgisi olmadan) sadece kendi tarafını işleyebiliyor.
function applyTactic(powers, tactic) {
  if (tactic === 'attack') {
    return { ...powers, FW: powers.FW * (1 + TACTIC_SHIFT), DF: powers.DF * (1 - TACTIC_SHIFT) };
  }
  if (tactic === 'defensive') {
    return { ...powers, DF: powers.DF * (1 + TACTIC_SHIFT), FW: powers.FW * (1 - TACTIC_SHIFT) };
  }
  if (tactic === 'counter') {
    return { ...powers, FW: powers.FW * (1 - COUNTER_OWN_ATTACK_PENALTY), MF: powers.MF * (1 - COUNTER_OWN_ATTACK_PENALTY / 2) };
  }
  return powers;
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kontra taktiğinin asıl etkisi — rakip, kontra oynayan bir
// takıma karşı saldırırken kendi hücum gücünden bir kısmını (COUNTER_OPPONENT_ATTACK_PENALTY)
// kaybeder. Bu, "defansif" taktiğin aksine kendi DF/GK kalitesinden BAĞIMSIZ, doğrudan rakibin
// hücumunu köreltiyor — zayıf savunması olan bir kadro bile disiplinli bir kontra bloğuyla güçlü
// bir hücum hattını gerçekten zorlayabiliyor.
function applyCounterDefense(attackerPowers, defenderTactic) {
  if (defenderTactic !== 'counter') return attackerPowers;
  // [DÜZELTİLDİ — Monte Carlo testinde ölçüldü] Sadece FW'yi kısmak, attackPower formülünde
  // (FW + 0.5×MF) etkiyi fazlaca sulandırıyordu — zayıf tarafın kazanma ihtimalini pratikte
  // ~%1 (istatistiksel gürültü seviyesinde) değiştiriyordu, "gerçek bir taktik şansı" hissi
  // vermiyordu. Artık MF de aynı oranda kısılıyor (attackPower'ın TAMAMI, sadece FW'si değil).
  return {
    ...attackerPowers,
    FW: attackerPowers.FW * (1 - COUNTER_OPPONENT_ATTACK_PENALTY),
    MF: attackerPowers.MF * (1 - COUNTER_OPPONENT_ATTACK_PENALTY),
  };
}

// [KULLANICI İSTEĞİ] Kırmızı kart görülünce (10 kişi kalma) takımın kaleci hariç tüm güç
// gruplarına ceza uygulanır (bkz. cards.js rollCards).
function applyRedCardPenalty(powers) {
  const factor = 1 - RED_CARD_POWER_PENALTY;
  return { GK: powers.GK, DF: powers.DF * factor, MF: powers.MF * factor, FW: powers.FW * factor };
}

/**
 * Tek bir maçı simüle eder. lineupHome/lineupAway: [{slot, player}] dizileri.
 * opts: { styleHome, styleAway, tacticHome, tacticAway } — hepsi opsiyonel, eksikse
 * 'normal'/'balanced' (davranışı değiştirmeyen) varsayılanlar kullanılır.
 * Döner: { xgHome, xgAway, goalsHome, goalsAway, events, cards }
 */
function simulateSingleMatch(lineupHome, lineupAway, opts = {}) {
  const { styleHome = 'normal', styleAway = 'normal', tacticHome = 'balanced', tacticAway = 'balanced' } = opts;

  const rawPowersHome = groupPowers(lineupHome);
  const rawPowersAway = groupPowers(lineupAway);

  // [KULLANICI İSTEĞİ] Kartlar, goller/şanslarla (narration.js) AYNI dakika havuzunu
  // paylaşır ki bir kart bir golle aynı dakikaya denk gelmesin.
  const sharedMinutes = new Set();
  const cardsHome = rollCards(lineupHome, styleHome, sharedMinutes);
  const cardsAway = rollCards(lineupAway, styleAway, sharedMinutes);

  let powersHome = applyTactic(rawPowersHome, tacticHome);
  let powersAway = applyTactic(rawPowersAway, tacticAway);
  if (cardsHome.hasRed) powersHome = applyRedCardPenalty(powersHome);
  if (cardsAway.hasRed) powersAway = applyRedCardPenalty(powersAway);

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kontra taktiği — rakip kontra oynuyorsa, SALDIRAN
  // takımın hücum gücü bu spesifik yönde (sadece bu xG hesabı için, kalıcı olarak DEĞİL — ör.
  // ev sahibinin gücü deplasman maçında/başka bir hesapta bundan etkilenmez) kısılıyor.
  const xgHome = expectedGoals(applyCounterDefense(powersHome, tacticAway), powersAway, true);
  const xgAway = expectedGoals(applyCounterDefense(powersAway, tacticHome), powersHome, false);

  const goalsHome = samplePoisson(xgHome);
  const goalsAway = samplePoisson(xgAway);

  // [KULLANICI İSTEĞİ] Sonucu değiştirmeyen, sadece anlatım için dakika bazlı event akışı
  // (bkz. narration.js). İstemci sonucu direkt göstermek yerine bunu oynatıyor.
  const goalEvents = buildMatchEvents(lineupHome, lineupAway, goalsHome, goalsAway, sharedMinutes);
  const cardEvents = [
    ...cardsHome.events.map((e) => ({ ...e, team: 'home' })),
    ...cardsAway.events.map((e) => ({ ...e, team: 'away' })),
  ];
  const events = [...goalEvents, ...cardEvents].sort((a, b) => a.minute - b.minute);

  return {
    xgHome, xgAway, goalsHome, goalsAway,
    // İstatistik ekranında (draft sonrası güç dağılımı vb.) ham/gerçek kadro gücü gösterilsin
    // diye taktik/kart düzeltmesi UYGULANMAMIŞ güçler döndürülüyor — düzeltme sadece xG
    // hesabında (skor üretiminde) kullanıldı.
    powersHome: rawPowersHome, powersAway: rawPowersAway,
    events,
    cards: { home: cardsHome.events, away: cardsAway.events },
  };
}

module.exports = {
  groupPowers, goalkeeperSaveFactor, expectedGoals, samplePoisson, simulateSingleMatch,
  applyTactic, applyRedCardPenalty, applyCounterDefense,
};
