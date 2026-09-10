// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Salt skor yeterli değil — simülasyon zaten hangi grubun
// (Hücum/Defans/Kaleci) maçı belirlediğini biliyor, round sonucunda 'rakibin kalecisi seni 3 kez
// kurtardı' ya da 'zayıf defansın seni yedi' gibi motoru gerçekten yansıtan kısa bir anlatı/
// flavor-text üretilebilir. Bu, hesaplamayı değiştirmiyor ama oyuncuya 'neden kaybettim'
// sorusuna somut bir cevap veriyor." — bu dosya SONUCU asla değiştirmez (skor zaten simulate.js'de
// Poisson ile kesinleşti), sadece o sonuca giden hesaplamayı (grup güçleri, xG) yorumlayan en
// fazla birkaç "olgu" (fact) üretir. Tamamen deterministik — aynı maç verisiyle her zaman aynı
// olgular çıkar, ekstra rastgelelik YOK.
//
// [MİMARİ] Burada takım İSİMLERİ yok, sadece 'home'/'away' etiketli yapısal olgular üretiliyor —
// narration.js'in event->metin ayrımıyla AYNI desen: server yapısal veri üretir, client (bkz.
// views.js STORY_TEMPLATES) gerçek oyuncu/takım adlarıyla cümleyi kurar.
const { REFERENCE_RATING } = require('../shared/gameConfig');
const { goalkeeperSaveFactor } = require('./simulate');

// xG formülündeki attackPower'ın bölündüğü referans (bkz. simulate.js expectedGoals
// referenceAttack) — "hücum hattı ortalamanın ne kadar üstünde/altında" burada da AYNI çapaya
// göre ölçülüyor ki hikaye gerçek formülle tutarlı kalsın.
const ATTACK_REFERENCE = REFERENCE_RATING * 1.5;
// [Eşikler] Flavor-text'in "bu, maçı gerçekten etkileyen bir fark" saydığı büyüklükler —
// bilimsel değil, hikayenin nadir/anlamlı hissettirmesi için kalibre edilmiş göreli eşikler.
const NOTABLE_POWER_GAP = 12; // reyting puanı
const GK_SAVE_MIDPOINT = (0.10 + 0.45) / 2; // goalkeeperSaveFactor'ün aralığının ortası
const GK_NOTABLE_GAP = 0.12;
const XG_SURPRISE_GAP = 1.1; // gerçek gol, beklenenden (xG) bu kadar saparsa "şans" vurgulanır
const MAX_STORY_FACTS = 2;

function attackPowerOf(powers) { return powers.FW + 0.5 * powers.MF; }

// Bir yön (attackerTeam'in defenderTeam'in savunmasına karşı ne kadar baskın/zayıf kaldığı) için
// olası olgu adaylarını üretir.
function directionalFacts(attackerPowers, defenderPowers, attackerTeam, defenderTeam) {
  const facts = [];
  const attackEdge = attackPowerOf(attackerPowers) - ATTACK_REFERENCE; // + : hücum güçlü
  const defenseEdge = defenderPowers.DF - REFERENCE_RATING; // + : defans güçlü
  const gkEdge = goalkeeperSaveFactor(defenderPowers.GK) - GK_SAVE_MIDPOINT; // + : kaleci güçlü

  // Hücumun çok güçlü olması ile defansın çok zayıf olması aynı yönün iki yüzü — ikisi birden
  // eklenip tekrara düşülmesin diye büyük olan seçiliyor.
  if (Math.max(attackEdge, -defenseEdge) >= NOTABLE_POWER_GAP) {
    if (attackEdge >= -defenseEdge) facts.push({ key: 'attack_star', team: attackerTeam, magnitude: attackEdge });
    else facts.push({ key: 'defense_leak', team: defenderTeam, magnitude: -defenseEdge });
  } else if (defenseEdge >= NOTABLE_POWER_GAP) {
    facts.push({ key: 'defense_wall', team: defenderTeam, magnitude: defenseEdge });
  }

  if (gkEdge >= GK_NOTABLE_GAP) facts.push({ key: 'keeper_wall', team: defenderTeam, magnitude: gkEdge * 30 });
  else if (gkEdge <= -GK_NOTABLE_GAP) facts.push({ key: 'keeper_soft', team: defenderTeam, magnitude: -gkEdge * 30 });

  return facts;
}

/**
 * powersHome/powersAway: groupPowers() çıktısı (bkz. simulate.js — RAW, taktik/kart düzeltmesi
 * uygulanmamış kadro gücü, tıpkı simulateSingleMatch'in döndürdüğü gibi). xgHome/xgAway,
 * goalsHome/goalsAway: aynı maçın zaten belirlenmiş sonucu. Döner: en fazla MAX_STORY_FACTS
 * adet { key, team, magnitude } — büyüklüğe göre azalan sırada.
 */
function buildMatchStory({ powersHome, powersAway, xgHome, xgAway, goalsHome, goalsAway }) {
  // [DÜZELTİLDİ — Monte Carlo testinde bulundu] "Yapısal" (kadro gücüne dayalı) olgular ile
  // "şans" (gerçek skor xG'den saptı) olguları TEK bir ortak magnitude havuzunda yarıştırılırsa,
  // büyük bir reyting farkında yapısal olgular HER ZAMAN kazanıyordu — aynı iki kadro tekrar
  // eşleşince (ör. ev+deplasman maçları) skor ne olursa olsun (1-1 berabere dahil) BİREBİR AYNI
  // hikaye çıkıyordu, "şans" hiç görünmüyordu. Artık iki kategori AYRI havuzlarda en iyisini
  // seçiyor (en fazla 1 yapısal + 1 şans olgusu) — hikaye artık o maçın GERÇEK skoruna göre de
  // değişiyor, sadece sabit kadro gücüne göre değil.
  const structuralFacts = [
    ...directionalFacts(powersHome, powersAway, 'home', 'away'),
    ...directionalFacts(powersAway, powersHome, 'away', 'home'),
  ].sort((a, b) => b.magnitude - a.magnitude);

  const luckFacts = [];
  if (goalsHome <= xgHome - XG_SURPRISE_GAP) luckFacts.push({ key: 'unlucky', team: 'home', magnitude: xgHome - goalsHome });
  else if (goalsHome >= xgHome + XG_SURPRISE_GAP) luckFacts.push({ key: 'lucky', team: 'home', magnitude: goalsHome - xgHome });
  if (goalsAway <= xgAway - XG_SURPRISE_GAP) luckFacts.push({ key: 'unlucky', team: 'away', magnitude: xgAway - goalsAway });
  else if (goalsAway >= xgAway + XG_SURPRISE_GAP) luckFacts.push({ key: 'lucky', team: 'away', magnitude: goalsAway - xgAway });
  luckFacts.sort((a, b) => b.magnitude - a.magnitude);

  const facts = [structuralFacts[0], luckFacts[0]].filter(Boolean);
  if (facts.length < MAX_STORY_FACTS && structuralFacts[1]) facts.push(structuralFacts[1]);
  return facts.slice(0, MAX_STORY_FACTS);
}

module.exports = { buildMatchStory };
