// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "FC 27 ratingleri belli oldu, ratingleri ona göre güncelle."
// FC26 dosyaları elle hazırlanmış markdown'lardı (kaynak: fcratings.com). FC27 için aynı kaynağın
// kulüp sayfaları doğrudan çekilip HTML'i deterministik olarak ayrıştırılıyor — bir modelin sayfayı
// "okuyup tabloyu yeniden yazması" (FC27 denemesinde transkripsiyon hatası riski olarak reddedilmişti)
// YOK. Çıktı FC26 dosyalarıyla AYNI markdown biçimi (## Takım + | Oyuncu | Reyting | Mevki |) — böylece
// mevcut parseSuperLigOverrides/fc26RatingOverrides eşleştirme motoru hiç değişmeden kullanılıyor.
//
// robots.txt tarama kısıtı koymuyor; yine de istekler arasında bekleme var (siteye yük bindirmemek için).
//
// Kullanım:  node src/etl/fetchFc27Ratings.js   (server/ klasöründen)
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'processed');
const BASE = 'https://www.fcratings.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DELAY_MS = 1200;

const LEAGUES = [
  { slug: 'turkish-super-lig-68', file: 'super_lig_2026_2027_fc27_reytingleri.md', title: 'Süper Lig' },
  { slug: 'english-premier-league-13', file: 'premier_league_2026_2027_fc27_reytingleri.md', title: 'Premier League' },
  { slug: 'spanish-la-liga-53', file: 'la_liga_2026_2027_fc27_reytingleri.md', title: 'La Liga' },
  { slug: 'german-bundesliga-19', file: 'bundesliga_2026_2027_fc27_reytingleri.md', title: 'Bundesliga' },
  { slug: 'italian-serie-a-31', file: 'serie_a_2026_2027_fc27_reytingleri.md', title: 'Serie A' },
  { slug: 'french-ligue-1-16', file: 'ligue_1_2026_2027_fc27_reytingleri.md', title: 'Ligue 1' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`);
      await sleep(DELAY_MS * attempt * 2);
    }
  }
}

function decode(s) {
  return s
    .replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function clubLinks(html) {
  const seen = new Set();
  for (const m of html.matchAll(/href="https:\/\/www\.fcratings\.com\/clubs\/([a-z0-9-]+)"/g)) seen.add(m[1]);
  return [...seen];
}

// Kulüp sayfasındaki kadro tablosunun her <tr>'si: isim (.custom-name), ana mevki (dolu
// .custom-pos-badge — outline olanlar ikincil mevki), OVR (".custom-stat border" hücresinin
// data-sort-value'su). JSON-LD ItemList'teki oyuncu sayısıyla karşılaştırılıp eksik okuma yakalanıyor.
function parseClub(html) {
  const h1 = html.match(/<h1[^>]*>([^<]+?)\s+FC 27 Player Ratings<\/h1>/);
  const team = h1 ? decode(h1[1]) : null;
  const expectedMatch = html.match(/"@type":"ItemList"[^]*?"numberOfItems":(\d+)/);
  const expected = expectedMatch ? Number(expectedMatch[1]) : null;
  const players = [];
  for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const r = row[1];
    const name = r.match(/class="custom-name[^"]*">([^<]+)</);
    const ovr = r.match(/class="custom-stat border[^"]*" data-sort-value="(\d+)"/);
    if (!name || !ovr) continue;
    const pos = r.match(/class="custom-pos-badge text-reset[^"]*"[^>]*>([A-Z]{2,3})</);
    const alt = [...r.matchAll(/class="custom-pos-badge custom-pos-badge-outline text-reset[^"]*"[^>]*>([A-Z]{2,3})</g)].map((m) => m[1]);
    const nation = r.match(/class="custom-flag custom-flag-decoration" alt="([^"]+)"/);
    const id = r.match(/href="https:\/\/www\.fcratings\.com\/[a-z0-9-]+-(\d+)" class="text-reset/);
    players.push({
      name: decode(name[1]), rating: Number(ovr[1]), position: pos ? pos[1] : '', altPositions: alt,
      nation: nation ? decode(nation[1]) : null, fcId: id ? id[1] : null,
    });
  }
  return { team, expected, players };
}

function toMarkdown(league, clubs) {
  const total = clubs.reduce((n, c) => n + c.players.length, 0);
  const out = [];
  out.push(`# ${league.title} — 2026-2027 Sezonu FC27 Kadro Reytingleri`, '');
  out.push(`${new Date().toISOString().slice(0, 10)} itibarıyla. Kaynak: fcratings.com (EA Sports FC 27 resmi veritabanı), fetchFc27Ratings.js ile otomatik çekildi — ${clubs.length} kulüp, ${total} oyuncu.`, '');
  out.push('## Özet (takıma göre)', '', '| Takım | Oyuncu Sayısı | Ortalama Reyting | En Yüksek Reyting | En Yüksek Reytingli Oyuncu |', '|---|---|---|---|---|');
  const sorted = [...clubs].sort((a, b) => avg(b) - avg(a));
  for (const c of sorted) {
    const best = c.players.reduce((a, b) => (b.rating > a.rating ? b : a), c.players[0]);
    out.push(`| ${c.team} | ${c.players.length} | ${avg(c).toFixed(1)} | ${best.rating} | ${best.name} |`);
  }
  for (const c of sorted) {
    out.push('', `## ${c.team}`, '', '| Oyuncu | Reyting | Mevki |', '|---|---|---|');
    for (const p of [...c.players].sort((a, b) => b.rating - a.rating)) out.push(`| ${p.name} | ${p.rating} | ${p.position} |`);
  }
  return out.join('\n') + '\n';
}
const avg = (c) => c.players.reduce((n, p) => n + p.rating, 0) / c.players.length;

async function main() {
  const only = process.argv.slice(2);
  let problems = 0;
  // Markdown'lar insan okuması + mevcut eşleştirme motoru için; kadro güncellemesi (yeni oyuncu
  // eklemek) milliyet/ikincil mevki gibi md'de olmayan alanlara ihtiyaç duyduğu için aynı veri
  // ayrıca JSON olarak da yazılıyor (bkz. applyFc27.js).
  const jsonPath = path.join(OUT_DIR, 'fc27_squads.json');
  const all = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : { leagues: {} };
  for (const league of LEAGUES) {
    if (only.length && !only.some((o) => league.slug.includes(o))) continue;
    const slugs = clubLinks(await get(`${BASE}/leagues/${league.slug}`));
    const clubs = [];
    for (const slug of slugs) {
      await sleep(DELAY_MS);
      const c = parseClub(await get(`${BASE}/clubs/${slug}`));
      if (!c.team || !c.players.length) { console.warn(`  ! ${slug}: ayrıştırılamadı`); problems++; continue; }
      if (c.expected != null && c.expected !== c.players.length) {
        console.warn(`  ! ${c.team}: sayfada ${c.expected} oyuncu var, ${c.players.length} okundu`);
        problems++;
      }
      clubs.push(c);
    }
    fs.writeFileSync(path.join(OUT_DIR, league.file), toMarkdown(league, clubs), 'utf8');
    all.leagues[league.title] = { file: league.file, clubs: clubs.map((c) => ({ team: c.team, players: c.players })) };
    all.fetchedAt = new Date().toISOString();
    fs.writeFileSync(jsonPath, JSON.stringify(all, null, 1), 'utf8');
    console.log(`[fc27] ${league.title}: ${clubs.length} kulüp, ${clubs.reduce((n, c) => n + c.players.length, 0)} oyuncu -> ${league.file}`);
  }
  if (problems) { console.error(`[fc27] ${problems} sorun var — yukarıya bak`); process.exitCode = 1; }
}

main().catch((e) => { console.error(e); process.exit(1); });
