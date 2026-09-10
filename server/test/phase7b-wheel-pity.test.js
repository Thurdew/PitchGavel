// Faz 7b doğrulama scripti: Çark Modu "Pity" sistemi (bkz. claude.md "Çark Pity Sistemi",
// gameConfig.js WHEEL_PITY_*, pool.js spinWheelSegment, DraftEngine.resolveSpin).
// Kullanıcı şikayeti/sorusu: "Çark neye göre dönüyor, olasılıklar eşit mi? Art arda kötü gelirse
// sonra iyiye döner mi yoksa şans hep aynı mı?" — bu script sunucu ayağa kaldırmadan, saf
// istatistiksel bir Monte Carlo ile iki şeyi kanıtlıyor:
//   (A) pityBoost gerçekten 'iyi' havuzun ağırlığını matematiksel olarak beklenen oranda artırıyor.
//   (B) pity AÇIKKEN, uzun art arda 'kötü' seriler pity KAPALIYKEN'e göre belirgin şekilde daha
//       nadir — yani "5 tur kötü gidince iyiye dönme eğilimi" artık gerçekten var (garanti değil,
//       ama istatistiksel olarak ölçülebilir).
const assert = require('assert');
const { spinWheelSegment } = require('../src/draft/pool');
const { WHEEL_PITY_BOOST_PER_STREAK, WHEEL_PITY_MAX_STREAK } = require('../src/shared/gameConfig');

function pct(n, d) { return ((n / d) * 100).toFixed(2) + '%'; }

// ---------- Test A: ağırlık matematiği ----------
function testWeightMath() {
  const segments = [
    { label: 'iyi-seg', pool: 'iyi', weight: 5 },
    { label: 'orta-seg', pool: 'orta', weight: 10 },
    { label: 'kötü-seg', pool: 'kötü', weight: 15 },
  ];
  const N = 200_000;

  function sampleIyiShare(boost) {
    let iyiCount = 0;
    for (let i = 0; i < N; i++) {
      if (spinWheelSegment(segments, boost).pool === 'iyi') iyiCount++;
    }
    return iyiCount / N;
  }

  const baseline = sampleIyiShare(1);
  const expectedBaseline = 5 / 30; // 0.1667
  console.log(`[test7b] boost=1 iyi payı: ${pct(baseline, 1)} (beklenen ~${pct(expectedBaseline, 1)})`);
  assert(Math.abs(baseline - expectedBaseline) < 0.01, `boost=1 iyi payı beklenenden çok sapmış: ${baseline}`);

  const maxBoost = 1 + WHEEL_PITY_MAX_STREAK * WHEEL_PITY_BOOST_PER_STREAK; // 1+5*0.6=4
  const boosted = sampleIyiShare(maxBoost);
  const expectedBoosted = (5 * maxBoost) / (5 * maxBoost + 10 + 15); // 20/45 = 0.444
  console.log(`[test7b] boost=${maxBoost} (tam pity) iyi payı: ${pct(boosted, 1)} (beklenen ~${pct(expectedBoosted, 1)})`);
  assert(Math.abs(boosted - expectedBoosted) < 0.01, `boost=${maxBoost} iyi payı beklenenden çok sapmış: ${boosted}`);
  assert(boosted > baseline * 2, 'tam pity, iyi payını en az 2 katına çıkarmalı');

  console.log('[test7b] Test A (ağırlık matematiği) GEÇTİ ✅');
}

// ---------- Test B: uzun kötü serilerin gerçek hayatta seyreltilmesi ----------
// Gerçek çarktaki tipik oran (bkz. gameConfig.js WHEEL_RATING_BANDS/WHEEL_SPECIAL_SEGMENTS
// varsayılan 3'erli seçim sonrası kabaca 1/3 iyi - 1/3 orta - 1/3 kötü karışımına yakın, ama
// KÖTÜ havuzu bilerek biraz ağır tutulan sentetik bir örnek: gerçek hayatta bir kullanıcının
// "hep kötü geliyor" hissini simüle etmek için 'kötü'yü kasıtlı ağırlıklı kurduk.
function testStreakMitigation() {
  const segments = [
    { label: 'iyi-seg', pool: 'iyi', weight: 4 },
    { label: 'orta-seg', pool: 'orta', weight: 10 },
    { label: 'kötü-seg', pool: 'kötü', weight: 16 },
  ];
  const CAREERS = 5_000;
  const SPINS_PER_CAREER = 40;
  const STREAK_THRESHOLD = 5; // kullanıcının bahsettiği "5 tur kötü"

  function simulateCareer(pityEnabled) {
    let streak = 0; // art arda kötü sayacı (DraftEngine.resolveSpin ile birebir aynı mantık)
    let maxStreak = 0;
    let hitThreshold = false;
    for (let i = 0; i < SPINS_PER_CAREER; i++) {
      const boost = pityEnabled ? 1 + Math.min(streak, WHEEL_PITY_MAX_STREAK) * WHEEL_PITY_BOOST_PER_STREAK : 1;
      const landed = spinWheelSegment(segments, boost);
      if (landed.pool === 'kötü') { streak++; maxStreak = Math.max(maxStreak, streak); }
      else if (landed.pool === 'iyi') { streak = 0; }
      // 'orta': sayaç değişmez (gerçek resolveSpin ile aynı davranış)
      if (streak >= STREAK_THRESHOLD) hitThreshold = true;
    }
    return { maxStreak, hitThreshold };
  }

  let withoutPityHits = 0, withPityHits = 0;
  let withoutPityMaxSum = 0, withPityMaxSum = 0;
  for (let i = 0; i < CAREERS; i++) {
    const a = simulateCareer(false);
    const b = simulateCareer(true);
    if (a.hitThreshold) withoutPityHits++;
    if (b.hitThreshold) withPityHits++;
    withoutPityMaxSum += a.maxStreak;
    withPityMaxSum += b.maxStreak;
  }

  const withoutRate = withoutPityHits / CAREERS;
  const withRate = withPityHits / CAREERS;
  console.log(`[test7b] pity KAPALI  — ${STREAK_THRESHOLD}+ art arda kötü seri görülme oranı: ${pct(withoutRate, 1)}, ort. en uzun seri: ${(withoutPityMaxSum / CAREERS).toFixed(2)}`);
  console.log(`[test7b] pity AÇIK    — ${STREAK_THRESHOLD}+ art arda kötü seri görülme oranı: ${pct(withRate, 1)}, ort. en uzun seri: ${(withPityMaxSum / CAREERS).toFixed(2)}`);

  // [NOT] Sentetik örnekte 'kötü' havuzu bilerek çok ağır (16 vs iyi'nin 4) ve kariyer uzun (40
  // spin) tutulduğu için 5+ seri KAPALIYKEN neredeyse kaçınılmaz (~%95+) — pity'nin işi bunu
  // İMKANSIZ yapmak değil (garanti/deterministik olmamalı), belirgin şekilde SEYRELTMEK. Eşik
  // buna göre gerçekçi: en az %15 görece azalma + ortalama en uzun serinin gözle görülür kısalması.
  assert(withRate < withoutRate * 0.85, `pity açıkken ${STREAK_THRESHOLD}+ seri oranı belirgin şekilde düşmeli (pity kapalı: ${withoutRate}, pity açık: ${withRate})`);
  assert(withPityMaxSum < withoutPityMaxSum * 0.75, `pity açıkken ortalama en uzun kötü seri belirgin şekilde kısalmalı (kapalı: ${withoutPityMaxSum / CAREERS}, açık: ${withPityMaxSum / CAREERS})`);

  console.log('[test7b] Test B (uzun kötü seri seyreltme) GEÇTİ ✅');
}

testWeightMath();
testStreakMitigation();
console.log('[test7b] TÜM TESTLER GEÇTİ ✅');
