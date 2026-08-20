// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — EA POLİTİKASI BİLEREK GERİ ALINDI] Kullanıcının eklediği
// FC26 2026-27 reyting dosyalarını (önce Süper Lig, sonra büyük 5 Avrupa ligi) players.json'daki
// oyuncularla eşleştirip eşleşenlerin `rating`'ini DOĞRUDAN bu dosyalardaki EA FC26 değeriyle
// DEĞİŞTİRİR.
//
// ÖNEMLİ — bu, daha önce claude.md'de bilinçli olarak alınmış bir kararı ("EA FC/FIFA reytingleri
// KULLANILMAYACAK ve KOPYALANMAYACAK — telif riski, proje herkese açık yayınlanacak") tersine
// çeviriyor. Bu ters çevirme kullanıcıya AÇIKÇA sorulup onaylandı (bkz. claude.md "FC26 Reyting
// Override'ı" notu) — sessizce/otomatik yapılmadı.
//
// Eşleştirme stratejisi: isim normalize edilip (aksan farkları giderilerek) TÜM havuzda aranır
// (sadece o ligde değil — bir oyuncu transfer olduysa players.json'daki `club` alanı ETL'in kaynak
// verisinden dolayı ESKİ kulübünü gösterebiliyor, isim bazlı eşleştirme buna dayanıklı). Birden
// fazla aday çıkarsa (aynı isimde farklı oyuncular) md dosyasındaki takımla players.json `club`
// alanı arasında bir uyuşma aranır: önce elle verilmiş `clubAliases` (Süper Lig'de Transfermarkt
// kulüp adları tutarsız yazıldığı için — bazıları Türkçe karakterli, bazıları ASCII'ye
// düzleştirilmiş), yoksa GENEL bir "kulüp adı benzerliği" (ortak/tip kelimeler — FC, CF, United
// vb. — çıkarılıp kalan çekirdek kelimeler karşılaştırılır). Hâlâ belirsizse (ya da hiç aday
// yoksa) o oyuncu için override UYGULANMAZ — kendi bağımsız formülümüzün reytingi korunur.
const { parseMarkdown } = require('./parseSuperLigOverrides');

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/İ/g, 'I');
}
function normName(s) {
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Kulüp adlarında anlam taşımayan "tip" kelimeleri (FC, United, Calcio, sayılar vb.) — genel
// kulüp-benzerliği kontrolünde çıkarılıp geri kalan "çekirdek" kelimeler karşılaştırılır. Ör.
// "Arsenal FC" -> {arsenal}, "Arsenal" -> {arsenal} -> eşleşir. "Manchester United" -> {manchester,
// united}, "Manchester City" -> {manchester, city} -> ortak "manchester" var ama tam eşleşme değil,
// bu yüzden EŞİT KÜME (tam aynı çekirdek kelime seti) aranıyor, kısmi kesişim değil — aksi halde
// "Manchester United" ile "Manchester City" yanlışlıkla eşleşirdi.
const CLUB_STOPWORDS = new Set([
  'fc', 'cf', 'afc', 'cfc', 'sc', 'ac', 'ca', 'sv', 'ud', 'cd', 'rcd', 'ssc', 'ss', 'us', 'uc',
  'sk', 'sd', 'vfb', 'vfl', 'rb', 'tsg', 'og', 'osc', 'aj', 'as', 'sm', 'ea', 'estac', 'club',
  'calcio', 'football', 'futbol', 'de', 'of', 'the', 'sporting', 'associazione', 'sportiva',
  'societa', 'spa', 'kulübü', 'spor', 'fk', 'jimnastik',
]);
function clubCoreTokens(s) {
  return new Set(
    stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter((t) => t && !CLUB_STOPWORDS.has(t) && !/^\d+$/.test(t))
  );
}
// [KULLANICI GERİ BİLDİRİMİ ÜZERİNE DÜZELTİLDİ] Tam küme eşitliği çok katıydı — "Real Betis
// Balompié" (havuzumuz) ile "Real Betis" (md) ya da "Athletic Bilbao" ile "Athletic Club" gibi
// resmi/kısaltılmış ad çiftlerini kaçırıyordu (bir tarafta fazladan bir kelime var). Artık KÜÇÜK
// kümenin BÜYÜK kümenin alt kümesi olması yeterli (iki yönde de) — "Real Betis"⊆"Real Betis
// Balompié" ✓, ama "Manchester United" ile "Manchester City" gibi FARKLI takımlar hâlâ eşleşmez
// (ne biri diğerinin alt kümesi).
function sameCoreClub(a, b) {
  const ta = clubCoreTokens(a);
  const tb = clubCoreTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/**
 * @param {Array} allPlayers ETL'in ürettiği nihai oyuncu listesi (aktif + icon).
 * @param {string} mdPath FC26 reyting dosyasının yolu.
 * @param {{ clubAliases?: Record<string,string[]>, nameAliases?: Record<string,string> }} [opts]
 *   clubAliases: md takım başlığı -> players.json `club` değer(ler)i (Süper Lig gibi tutarsız
 *   yazılmış ligler için elle verilen kesin eşleme — verilmişse genel benzerlikten ÖNCE denenir).
 *   nameAliases: normalize edilmiş md ismi -> normalize edilmiş havuz ismi (takma ad farkları).
 * @returns {{ overrides: Map<string, {rating:number, mdName:string, team:string}>, unmatched: string[] }}
 */
function resolveFc26Overrides(allPlayers, mdPath, opts = {}) {
  const { clubAliases = {}, nameAliases = {} } = opts;

  const byNorm = new Map();
  for (const p of allPlayers) {
    const key = normName(p.name);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(p);
  }

  const teams = parseMarkdown(mdPath);
  const overrides = new Map();
  const unmatched = [];

  for (const t of teams) {
    const aliasClubs = clubAliases[t.team] || [];
    for (const entry of t.players) {
      let key = normName(entry.name);
      if (nameAliases[key]) key = nameAliases[key];
      let candidates = byNorm.get(key) || [];

      if (candidates.length > 1) {
        const aliasPreferred = candidates.filter((c) => aliasClubs.includes(c.club));
        if (aliasPreferred.length === 1) {
          candidates = aliasPreferred;
        } else {
          const fuzzyPreferred = candidates.filter((c) => sameCoreClub(c.club, t.team));
          if (fuzzyPreferred.length === 1) candidates = fuzzyPreferred;
        }
      }

      if (candidates.length !== 1) {
        unmatched.push(`${t.team} | ${entry.name} (${entry.rating})${candidates.length > 1 ? ` [BELİRSİZ — ${candidates.length} aday]` : ''}`);
        continue;
      }
      // [KULLANICI İSTEĞİ, "2026-2027 transferlerini uygula"] `durum`/`not` de taşınıyor — Süper
      // Lig dosyasındaki "🆕 Yeni transfer" satırları için run.js bunu kullanıp oyuncunun kulüp/
      // lig alanını da (sadece reytingi değil) yeni takıma göre günceller. Diğer 5 ligin
      // dosyasında bu kolonlar hiç yok, entry.durum/entry.not orada hep '' — o dosyalarda bu blok
      // hiçbir zaman tetiklenmez, davranış öncekiyle birebir aynı kalır.
      overrides.set(candidates[0].id, { rating: entry.rating, mdName: entry.name, team: t.team, durum: entry.durum, not: entry.not });
    }
  }

  return { overrides, unmatched };
}

module.exports = { resolveFc26Overrides, normName, sameCoreClub };
