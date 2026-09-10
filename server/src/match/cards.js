// [KULLANICI İSTEĞİ] "Kadro diziliminde agresif oyna/sakin oyna gibi seçenekler gelsin, buna
// bağlı olarak kırmızı kart ve sarı kart gelsin." — maç öncesi seçilen "oyun tarzı"na (style)
// göre o takımın kadrosu için sarı/kırmızı kart event'leri üretir. Sarı kartlar sadece anlatım
// rengi içindir; kırmızı kart takımın maç gücünü etkiler (bkz. simulate.js
// applyRedCardPenalty) — yani sonucu (skoru) DEĞİL, skora giden gücü etkiler.
const { RED_CARD_RISK, YELLOW_CARD_COUNT } = require('../shared/gameConfig');

const VALID_STYLES = ['calm', 'normal', 'aggressive'];

function normalizeStyle(style) {
  return VALID_STYLES.includes(style) ? style : 'normal';
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fieldPlayers(lineup) {
  const outfield = lineup.filter((e) => e.slot !== 'GK');
  return outfield.length ? outfield : lineup; // kaleciden başka kimse yoksa (pratikte olmaz) yine de bir aday bulunsun
}

// takenMinutes verilirse (bkz. narration.js), gol/şans event'leriyle aynı dakikaya denk
// gelmesin diye paylaşılan bir "dakika havuzu" kullanılır.
function uniqueMinute(min, max, takenMinutes) {
  if (!takenMinutes) return randomInt(min, max);
  let m;
  let guard = 0;
  do {
    m = randomInt(min, max);
    guard++;
  } while (takenMinutes.has(m) && guard < 200);
  takenMinutes.add(m);
  return m;
}

/**
 * lineup: [{slot, player}]. style: 'calm'|'normal'|'aggressive' (geçersiz/eksikse 'normal').
 * Döner: { events: [{type:'yellow'|'red', minute, playerName}], hasRed: boolean }
 */
function rollCards(lineup, style, takenMinutes) {
  const key = normalizeStyle(style);
  const players = fieldPlayers(lineup);
  const events = [];

  const [yMin, yMax] = YELLOW_CARD_COUNT[key];
  const yellowCount = randomInt(yMin, yMax);
  for (let i = 0; i < yellowCount; i++) {
    events.push({ type: 'yellow', minute: uniqueMinute(4, 88, takenMinutes), playerName: pick(players).player.name });
  }

  let hasRed = false;
  if (Math.random() < RED_CARD_RISK[key]) {
    hasRed = true;
    // Kırmızı kartlar genelde maçın ilerleyen dakikalarında (sinirlerin gerildiği an) gelir.
    events.push({ type: 'red', minute: uniqueMinute(35, 90, takenMinutes), playerName: pick(players).player.name });
  }

  return { events, hasRed };
}

module.exports = { rollCards, normalizeStyle, VALID_STYLES };
