const { loadPlayerData } = require('../playerData');
const {
  BACKUP_RATING_GAP, MAIN_MIN_RATING, ICON_BACKUP_RATING_GAP, MIN_BACKUP_RATING,
  TOP_FALLBACK_POOL_SIZE,
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

module.exports = { pickMainAndBackup, pickMainAndLadder, pickSingle, indexByPosition };
