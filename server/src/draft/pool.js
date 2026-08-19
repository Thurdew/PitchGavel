const { loadPlayerData } = require('../playerData');
const {
  BACKUP_RATING_GAP, MAIN_MIN_RATING, ICON_BACKUP_RATING_GAP, MIN_BACKUP_RATING,
  TOP_FALLBACK_POOL_SIZE, WHEEL_RATING_BANDS, WHEEL_SPECIAL_SEGMENTS, WHEEL_POOL_PICK_COUNT,
} = require('../shared/gameConfig');

// poolKey -> (position -> oyuncu[]) — havuz filtresine göre ayrı ayrı önbelleklenir.
const indexCache = new Map();

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Tek Lig Modu — sadece Süper Lig'de oynayan aktif
// oyuncular + Türk icon'lar (Rüştü, Emre, Arda vb. — dünyaca ünlü icon'lar bu modun "yerli"
// temasına uymadığı için hariç tutulur, ama 9 Türk icon tema açısından uyumlu olduğundan dahil
// edildi). Havuz küçük (~555 oyuncu) ama pool.js'teki mevcut "havuz yetmezse elden gelenle
// devam et" mantığı (aşağıda) zaten sığ pozisyonları (LM/RM gibi) sorunsuz karşılıyor.
const POOL_FILTERS = {
  all: () => true,
  'super-lig': (p) => p.league === 'Süper Lig' || (p.isIcon && p.nation === 'Türkiye'),
};

function indexByPosition(poolKey = 'all') {
  const key = POOL_FILTERS[poolKey] ? poolKey : 'all';
  if (indexCache.has(key)) return indexCache.get(key);

  const data = loadPlayerData();
  const filter = POOL_FILTERS[key];
  const map = new Map();
  for (const p of data.players) {
    if (!filter(p)) continue;
    if (!map.has(p.position)) map.set(p.position, []);
    map.get(p.position).push(p);
  }
  indexCache.set(key, map);
  return map;
}

function randomInt(n) {
  return Math.floor(Math.random() * n);
}

// [KULLANICI İSTEĞİ] "Sürpriz oyuncu farkında da o kadar fark koyma, kötü oyuncu en az 70
// olsun" — bir hedef reytinge en yakın adayı seçerken, mümkünse MIN_BACKUP_RATING altına hiç
// düşmeyen ve ana oyuncudan yüksek olmayan bir alt havuz tercih edilir; yoksa elden gelenin
// en iyisiyle devam edilir.
function pickClosestToTarget(pool, targetRating, mainRating) {
  const decent = pool.filter((p) => p.rating >= MIN_BACKUP_RATING && p.rating <= mainRating);
  const below = pool.filter((p) => p.rating <= mainRating);
  const searchPool = decent.length ? decent : (below.length ? below : pool);

  let pick = searchPool[0];
  let bestDiff = Math.abs(pick.rating - targetRating);
  for (const p of searchPool) {
    const diff = Math.abs(p.rating - targetRating);
    if (diff < bestDiff) { pick = p; bestDiff = diff; }
  }
  return pick;
}

/**
 * Belirli bir slot tipi için havuzdan rastgele bir "ana" oyuncu ve ona `ratingGap` reyting
 * altında bir "yedek" oyuncu seçer. `takenIds` o odada zaten satılmış/alınmış oyuncuları
 * filtreler (münhasır sahiplik — bkz. AUCTION-GAME-CLAUDE.md "Kadro / Draft Kuralları").
 *
 * [KULLANICI İSTEĞİ] Ana oyuncu en az MAIN_MIN_RATING reytinde olmalı — havuzda bu eşiğin
 * üzerinde aday kalmadıysa (sığ pozisyon ya da üst segment tükenmiş) en yüksek reytingli
 * birkaç aday arasından RASTGELE seçilir.
 *
 * [KULLANICI İSTEĞİ, BUG FIX] "Sürekli aynı oyuncuları veriyor" — eski kod, 80+ aday kalmadığında
 * havuzdaki TEK EN YÜKSEK reytingli oyuncuyu deterministik olarak seçiyordu (ör. RM/LM gibi sığ
 * pozisyonlarda 80+ aday hiç yok, bu yüzden her oyunda AYNI oyuncu çıkıyordu). Artık en yüksek
 * reytingli TOP_FALLBACK_POOL_SIZE aday arasından rastgele seçiliyor — hem kalite korunuyor hem
 * çeşitlilik geri geliyor.
 *
 * `ratingGap` verilmezse normal BACKUP_RATING_GAP kullanılır; "büyük fark" pozisyonlarında
 * (bkz. DraftEngine.startDraft) çağıran taraf daha büyük bir değer geçebilir.
 *
 * [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — bu fonksiyon artık genel amaçlı
 * pickMainAndLadder(..., 1, ...)'in ince bir sarmalayıcısı (2 kişilik oda davranışı BİREBİR
 * aynı kaldı — tek yedek isteyince eski algoritmayla tamamen özdeş sonuç üretir).
 */
function pickMainAndBackup(slotType, takenIds, ratingGap = BACKUP_RATING_GAP, poolKey = 'all') {
  const { main, backups } = pickMainAndLadder(slotType, takenIds, 1, ratingGap, poolKey);
  return { main, backup: backups[0] || null };
}

/**
 * [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod (N ≤ 8) — "Reveal/yedek merdiveni":
 * bir turda o pozisyona ihtiyacı olan oyuncu sayısı K ise, 1 ana + (K−1) yedek gösterilir;
 * yedekler azalan reytingte bir merdiven oluşturur. Sabit +ratingGap aralığı sadece İLK
 * basamak (en iyi yedek) için kullanılır — o noktadan MIN_BACKUP_RATING tabanına kadar geri
 * kalan basamaklar EŞİT ARALIKLI yerleştirilir (K büyüdükçe basamaklar arası fark küçülür).
 * `backupCount` 1 ise (2 kişilik oda) eski pickMainAndBackup ile birebir aynı sonucu üretir.
 * Havuz yetmezse (çok sığ pozisyon) merdiven eldeki adaylarla olabildiğince doldurulur, hiç
 * aday kalmazsa erken kesilir — DraftEngine bunu (backups.length < backupCount) ele almalı.
 */
function pickMainAndLadder(slotType, takenIds, backupCount, ratingGap = BACKUP_RATING_GAP, poolKey = 'all') {
  const byPos = indexByPosition(poolKey);
  const candidates = (byPos.get(slotType) || []).filter((p) => !takenIds.has(p.id));
  if (candidates.length === 0) return { main: null, backups: [] };

  const eliteCandidates = candidates.filter((p) => p.rating >= MAIN_MIN_RATING);
  let main;
  if (eliteCandidates.length > 0) {
    main = eliteCandidates[randomInt(eliteCandidates.length)];
  } else {
    // Havuzda 80+ kalmadı — en yüksek reytingli birkaç aday arasından rastgele seç (bkz. üstteki
    // BUG FIX notu). Havuz TOP_FALLBACK_POOL_SIZE'dan küçükse zaten hepsi aday havuzuna girer.
    const sorted = [...candidates].sort((a, b) => b.rating - a.rating);
    const topPool = sorted.slice(0, Math.min(TOP_FALLBACK_POOL_SIZE, sorted.length));
    main = topPool[randomInt(topPool.length)];
  }

  let rest = candidates.filter((p) => p.id !== main.id);
  if (rest.length === 0 || backupCount <= 0) return { main, backups: [] };

  // [KULLANICI İSTEĞİ] Ana oyuncu bir icon ise, kaybedenin neredeyse aynı kalitede bir yedek
  // almasını önlemek için gap büyütülür ("icon alamayan kişiye de iyi oyuncu gidiyor" şikayeti).
  const effectiveGap = main.isIcon ? Math.max(ratingGap, ICON_BACKUP_RATING_GAP) : ratingGap;
  const topTarget = main.rating - effectiveGap;
  const floor = Math.min(MIN_BACKUP_RATING, topTarget);

  const targets = [];
  for (let i = 0; i < backupCount; i++) {
    targets.push(backupCount === 1 ? topTarget : topTarget - (topTarget - floor) * (i / (backupCount - 1)));
  }

  const backups = [];
  for (const target of targets) {
    if (rest.length === 0) break; // havuz tükendi — merdiven kısa kalır
    const pick = pickClosestToTarget(rest, target, main.rating);
    backups.push(pick);
    rest = rest.filter((p) => p.id !== pick.id);
  }
  return { main, backups };
}

/** Belirli bir slot tipinden (rekabet olmadan) doğrudan atama için tek bir oyuncu seçer. */
function pickSingle(slotType, takenIds, poolKey = 'all') {
  const byPos = indexByPosition(poolKey);
  const candidates = (byPos.get(slotType) || []).filter((p) => !takenIds.has(p.id));
  if (candidates.length === 0) return null;
  return candidates[randomInt(candidates.length)];
}

/** Belirli bir slot tipi için (havuz filtresine göre) henüz satılmamış tüm adaylar. */
function poolForSlot(slotType, takenIds, poolKey = 'all') {
  const byPos = indexByPosition(poolKey);
  return (byPos.get(slotType) || []).filter((p) => !takenIds.has(p.id));
}

/**
 * [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Belirli bir slot tipi + çarktan çıkan reyting
 * bandı için uygun (havuzda kalan) adayları döner. Bant+pozisyon kombinasyonunda hiç aday
 * kalmadıysa (havuz tükenmiş — küçük bir ihtimal ama sığ pozisyonlarda/draftın sonlarına doğru
 * olası) WHEEL_RATING_BANDS sırasına göre bir SONRAKİ (daha düşük) banda doğru genişletilir; o da
 * boşsa nihayetinde pozisyondaki TÜM kalan adaylarla (bant sınırı olmadan) devam edilir —
 * draftın asla tıkanmaması için (bkz. DraftEngine.submitWheelPick/otomatik atama). `segment`
 * DraftEngine.resolveSpin'de sentetik olarak üretilmiş (min:1,max:99 gibi, steal/icon/give_best
 * "uygun aday yok" fallback'i) bir nesne de olabilir — bu durumda WHEEL_RATING_BANDS içinde
 * bulunamaz (`indexOf` -1 döner), doğrudan `inBand` (zaten tüm havuz) ile sonuçlanır.
 * Dönüş: { candidates, effectiveLabel } — effectiveLabel çarkın gösterdiği bantla FARKLIYSA
 * istemciye "bu bantta kimse kalmadı, X bandına genişletildi" bilgisini taşımak için kullanılır.
 */
function pickWheelRatingCandidates(slotType, takenIds, segment, poolKey = 'all') {
  const all = poolForSlot(slotType, takenIds, poolKey);
  if (all.length === 0) return { candidates: [], effectiveLabel: segment.label };

  const inBand = all.filter((p) => p.rating >= segment.min && p.rating <= segment.max);
  if (inBand.length > 0) return { candidates: inBand, effectiveLabel: segment.label };

  const idx = WHEEL_RATING_BANDS.indexOf(segment);
  for (let i = idx + 1; i < WHEEL_RATING_BANDS.length; i++) {
    const s = WHEEL_RATING_BANDS[i];
    const pool = all.filter((p) => p.rating >= s.min && p.rating <= s.max);
    if (pool.length > 0) return { candidates: pool, effectiveLabel: s.label };
  }
  // En alt banda kadar hiçbiri de dolu değilse (garip ama olası) pozisyondaki tüm kalanlarla devam.
  return { candidates: all, effectiveLabel: null };
}

/** [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Efsaneler Havuzu" segmenti — sadece icon adaylar. */
function pickWheelIconCandidates(slotType, takenIds, poolKey = 'all') {
  return poolForSlot(slotType, takenIds, poolKey).filter((p) => p.isIcon);
}

/**
 * [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Lig Piyangosu" / "Milliyet Piyangosu" —
 * `field` ('league' | 'nation') değeri `value`'ya eşit adaylar. `value` DraftEngine.resolveSpin
 * tarafından o an havuzda MEVCUT olan bir değerden seçildiği için sonuç asla boş dönmez (garanti
 * değil ama pratikte — bkz. resolveSpin'deki "values boşsa fallback" notu).
 */
function pickWheelFieldCandidates(slotType, takenIds, poolKey, field, value) {
  return poolForSlot(slotType, takenIds, poolKey).filter((p) => p[field] === value);
}

/**
 * [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Her draftta çarktaki yazılar değişsin, çark
 * havuzu yap, iyi/orta/kötü diye ayır, her draft 3 havuzdan da belli miktarda getir." —
 * WHEEL_RATING_BANDS + WHEEL_SPECIAL_SEGMENTS'i `pool` alanına göre üç kovaya ayırır, HER kovadan
 * (rastgele karıştırılmış sırayla) WHEEL_POOL_PICK_COUNT kadarını seçip birleşik bir dizi olarak
 * döner — bu, o draftın SABİT çarkı olur (draft boyunca değişmez, spin başına yeniden çekilmez).
 * Elemanlar spread-copy ile döndürülür ki DraftEngine.resolveSpin'in olası (sentetik segment
 * üretimi gibi) işlemleri paylaşılan config nesnelerini mutasyona uğratmasın.
 */
function buildWheelSegments() {
  const pools = { iyi: [], orta: [], kötü: [] };
  for (const b of WHEEL_RATING_BANDS) pools[b.pool].push(b);
  for (const s of WHEEL_SPECIAL_SEGMENTS) pools[s.pool].push(s);

  const picked = [];
  for (const key of Object.keys(pools)) {
    const shuffled = [...pools[key]].sort(() => Math.random() - 0.5);
    const take = shuffled.slice(0, Math.min(WHEEL_POOL_PICK_COUNT, shuffled.length));
    picked.push(...take.map((s) => ({ ...s })));
  }
  return picked;
}

/** Ağırlıklı rastgele bir segment seçer — sunucu tarafında otoriter "çark çevirme". `segments`
 * artık global bir sabit değil, çağıran tarafın kendi draftına özel listesi (bkz. buildWheelSegments). */
function spinWheelSegment(segments) {
  const total = segments.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * total;
  for (const s of segments) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return segments[segments.length - 1];
}

module.exports = {
  pickMainAndBackup, pickMainAndLadder, pickSingle, indexByPosition,
  poolForSlot, pickWheelRatingCandidates, pickWheelIconCandidates, pickWheelFieldCandidates,
  buildWheelSegments, spinWheelSegment,
};
