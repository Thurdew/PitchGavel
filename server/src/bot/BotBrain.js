// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — BİLGİSAYARA KARŞI] Botun karar mantığı (saf fonksiyonlar —
// zamanlama/socket yok, bkz. BotController.js). Tek zorluk seviyesi: hep en mantıklı hamle.
//
// Temel fikir: açık arttırmayı kaybeden boş kalmıyor, yedeği 10₺'ye alıyor. Bu yüzden bir turu
// kazanmanın değeri "ana oyuncu − kaybedene kalacak yedek" reyting farkı; bu fark da o mevkinin maç
// motorundaki (simulate.js) gol etkisiyle tartılıyor. Bütçe, kalan slotlar arasında bu değere göre
// paylaştırılıyor — harcanmayan para draft sonunda değersiz olduğu için son slotlarda tamamı açılır.
const { FORMATIONS, slotToGroup } = require('../shared/football');
const {
  MIN_PLAYER_PRICE, MIN_RAISE, BACKUP_RATING_GAP, BIG_GAP_RATING_GAP,
} = require('../shared/gameConfig');
const { expectedGoals, applyTactic, applyCounterDefense } = require('../match/simulate');
const { buildableFormations } = require('../lineup/lineup');

const NEUTRAL_RATING = 75; // FC27 havuzunun medyanı civarı
const TACTICS = ['balanced', 'attack', 'defensive', 'counter'];

function groupCounts(formation) {
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const s of FORMATIONS[formation] || []) counts[slotToGroup(s)] += 1;
  return counts;
}

// Ev + deplasman ortalaması: (attığım xG − yediğim xG).
function goalDiff(me, opp) {
  const home = expectedGoals(me, opp, true) - expectedGoals(opp, me, false);
  const away = expectedGoals(me, opp, false) - expectedGoals(opp, me, true);
  return (home + away) / 2;
}

// Bir oyuncunun reytingi 1 puan artınca takımın gol farkı ne kadar değişir — mevki grubuna göre.
// (Grup gücü ortalama olduğu için tek oyuncu +1 → grup ortalaması +1/n.)
function groupWeights(formation) {
  const n = groupCounts(formation);
  const base = { GK: NEUTRAL_RATING, DF: NEUTRAL_RATING, MF: NEUTRAL_RATING, FW: NEUTRAL_RATING };
  const f0 = goalDiff(base, base);
  const w = {};
  for (const g of ['GK', 'DF', 'MF', 'FW']) {
    if (!n[g]) { w[g] = 0; continue; }
    w[g] = goalDiff({ ...base, [g]: base[g] + 1 / n[g] }, base) - f0;
  }
  return w;
}

function totalNeeded(slotsNeeded) {
  return Object.values(slotsNeeded || {}).reduce((a, b) => a + b, 0);
}

// Kişisel güvenlik tavanı — DraftEngine.personalMaxBid ile aynı formül (sunucu zaten zorluyor,
// bot sadece reddedilecek teklif göndermesin diye bilir).
function personalCap(player, squadSize = 11) {
  const remaining = squadSize - player.squad.length;
  if (remaining <= 0) return 0;
  let cap = player.budget - (remaining - 1) * MIN_PLAYER_PRICE;
  if (player.prepPerk && player.prepPerk.kind === 'ceiling_reduction' && player.prepPerk.active) cap = Math.floor(cap * 0.8);
  return cap;
}

/**
 * Bu aşamayı kazanmak için verilebilecek en yüksek fiyat.
 * round: aktif auction/blind_auction round'u (main + backups — backups[0] kaybedene kalacak aday).
 */
function auctionCeiling(room, bot, round) {
  const weights = groupWeights(room.formation);
  const type = round.slotType;
  const loserGets = round.backups && round.backups.length ? round.backups[0] : null;
  const gap = loserGets ? Math.max(0, round.main.rating - loserGets.rating) : BACKUP_RATING_GAP;
  const valueNow = gap * weights[slotToGroup(type)];

  // Kalan diğer slotlardan beklenen değer (bu tur hariç) — normal turda ~5, büyük farkta ~18 puan.
  const bigGap = room.draft.bigGapSlots || new Set();
  const others = { ...bot.slotsNeeded };
  others[type] = Math.max(0, (others[type] || 0) - 1);
  let othersValue = 0;
  for (const [t, c] of Object.entries(others)) {
    if (!c) continue;
    const expGap = bigGap.has(t) ? BIG_GAP_RATING_GAP : BACKUP_RATING_GAP;
    othersValue += c * expGap * weights[slotToGroup(t)];
  }

  const remaining = totalNeeded(bot.slotsNeeded);
  const extra = Math.max(0, bot.budget - remaining * MIN_PLAYER_PRICE);
  const share = valueNow + othersValue > 0 ? valueNow / (valueNow + othersValue) : 0;
  const ceiling = MIN_PLAYER_PRICE + Math.floor(extra * share);
  return Math.max(MIN_PLAYER_PRICE, Math.min(ceiling, personalCap(bot)));
}

// Canlı açık arttırma: önde değilse ve tavanı yetiyorsa minimum artışla teklif ver.
function liveBidDecision(room, bot, round) {
  if (round.highestBidderClientId === bot.clientId) return null;
  const minAcceptable = round.highestBid > 0 ? round.highestBid + MIN_RAISE : MIN_PLAYER_PRICE;
  const ceiling = auctionCeiling(room, bot, round);
  return minAcceptable <= ceiling ? minAcceptable : null;
}

// Kör teklif (birinci fiyat, kapalı zarf): rakibin bu tur ne yazacağını geçmiş açıklanan
// tekliflerinden tahmin eder (tavanıma oranı), az farkla geçmeye çalışır; geçemeyecekse en düşük
// fiyatı yazıp parayı sonraki turlara saklar. Rakibin tavanını aşan bir teklif zaten yeterli.
function blindBidDecision(room, bot, round, history) {
  const ceiling = auctionCeiling(room, bot, round);
  const ratios = (history || []).slice(-6).map((h) => h.ratio).sort((a, b) => a - b);
  const ratio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0.6;
  const predicted = ratio * ceiling;
  let bid;
  if (predicted + MIN_RAISE > ceiling) bid = MIN_PLAYER_PRICE;
  else bid = Math.min(ceiling, Math.ceil(predicted * 1.1) + MIN_RAISE);
  const rivals = room.players.filter((p) => p.clientId !== bot.clientId && round.participantIds.includes(p.clientId));
  const rivalCap = rivals.reduce((m, p) => Math.max(m, personalCap(p)), 0);
  if (rivals.length) bid = Math.min(bid, rivalCap + 1);
  return Math.max(MIN_PLAYER_PRICE, Math.min(bid, personalCap(bot)));
}

// ------------------------------- Dizilim -------------------------------

function powersOf(squad, formation, assignment) {
  const slots = FORMATIONS[formation];
  const sums = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  assignment.forEach((squadIndex, i) => {
    const g = slotToGroup(slots[i]);
    sums[g] += squad[squadIndex].player.rating;
    counts[g] += 1;
  });
  const out = {};
  for (const g of Object.keys(sums)) out[g] = counts[g] ? sums[g] / counts[g] : 55;
  return out;
}

function poissonPmf(lambda, kMax = 12) {
  const out = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= kMax; k++) { out.push(p); p = (p * lambda) / (k + 1); }
  return out;
}

// Galibiyet 3, beraberlik 1 puan — beklenen puan.
function expectedPoints(me, myTactic, opp, oppTactic, isHome) {
  const mine = applyTactic(me, myTactic);
  const theirs = applyTactic(opp, oppTactic);
  const xgFor = expectedGoals(applyCounterDefense(mine, oppTactic), theirs, isHome);
  const xgAg = expectedGoals(applyCounterDefense(theirs, myTactic), mine, !isHome);
  const a = poissonPmf(xgFor);
  const b = poissonPmf(xgAg);
  let win = 0;
  let draw = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (i > j) win += a[i] * b[j];
      else if (i === j) draw += a[i] * b[j];
    }
  }
  return 3 * win + draw;
}

function eligible(squad, squadIndex, slot) {
  return squad[squadIndex].player.eligibleSlots.some((e) => e.slot === slot);
}

// Kurulabilen her formasyonda, uygunluğu bozmadan oyuncu yer değiştirerek (hill-climb) en iyi
// dizilimi bulur. score: powers -> sayı (büyük iyi).
function optimizeLineup(squad, score) {
  let best = null;
  for (const opt of buildableFormations(squad)) {
    if (!opt.feasible) continue;
    const slots = FORMATIONS[opt.formation];
    const assignment = opt.suggestedLineup.map((e) => e.squadIndex);
    let current = score(powersOf(squad, opt.formation, assignment));
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const a = assignment[i];
          const b = assignment[j];
          if (!eligible(squad, a, slots[j]) || !eligible(squad, b, slots[i])) continue;
          assignment[i] = b;
          assignment[j] = a;
          const s = score(powersOf(squad, opt.formation, assignment));
          if (s > current + 1e-9) { current = s; improved = true; } else { assignment[i] = a; assignment[j] = b; }
        }
      }
    }
    if (!best || current > best.score) best = { formation: opt.formation, assignment: [...assignment], score: current };
  }
  return best;
}

const NEUTRAL_POWERS = { GK: NEUTRAL_RATING, DF: NEUTRAL_RATING, MF: NEUTRAL_RATING, FW: NEUTRAL_RATING };

// Rakibin muhtemel en güçlü dizilimi (kendi kadrosuyla, nötr bir rakibe karşı).
function estimateOpponentPowers(oppSquad) {
  const best = optimizeLineup(oppSquad, (p) => goalDiff(p, NEUTRAL_POWERS));
  return best ? powersOf(oppSquad, best.formation, best.assignment) : NEUTRAL_POWERS;
}

/** Ev ya da deplasman maçı için { formation, assignment, tactic, style }. */
function chooseLineup(squad, oppSquad, isHome) {
  const opp = oppSquad && oppSquad.length === 11 ? estimateOpponentPowers(oppSquad) : NEUTRAL_POWERS;
  const best = optimizeLineup(squad, (p) => Math.max(...TACTICS.map((t) => expectedPoints(p, t, opp, 'balanced', isHome))));
  if (!best) return null;
  const powers = powersOf(squad, best.formation, best.assignment);
  let tactic = 'balanced';
  let bestPts = -1;
  for (const t of TACTICS) {
    const pts = expectedPoints(powers, t, opp, 'balanced', isHome);
    if (pts > bestPts) { bestPts = pts; tactic = t; }
  }
  // 'calm' en az kırmızı kart riski; oyun tarzının gücü artıran bir etkisi yok (bkz. cards.js).
  return { formation: best.formation, assignment: best.assignment, tactic, style: 'calm' };
}

// ------------------------------- Çark Modu -------------------------------

function bestCandidate(candidates) {
  let best = null;
  for (const p of candidates || []) {
    if (!best || p.rating > best.rating || (p.rating === best.rating && p.eligibleSlots.length > best.eligibleSlots.length)) best = p;
  }
  return best;
}

// "Rakipten çal": rakiplerin bu mevkideki en yüksek reytingli oyuncusu.
function bestStealTarget(room, bot, slotType) {
  let best = null;
  for (const o of room.players) {
    if (o.clientId === bot.clientId) continue;
    for (const e of o.squad) {
      if (e.slot !== slotType) continue;
      if (!best || e.player.rating > best.player.rating) best = { ownerClientId: o.clientId, player: e.player };
    }
  }
  return best;
}

module.exports = {
  groupWeights, auctionCeiling, liveBidDecision, blindBidDecision, personalCap,
  chooseLineup, expectedPoints, bestCandidate, bestStealTarget,
};
