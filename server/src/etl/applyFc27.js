// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "FC 27 ratingleri belli oldu, ratingleri ona göre güncelle" +
// "kadroları da ona göre güncelle". fetchFc27Ratings.js'in yazdığı fc27_squads.json'u (6 lig,
// kulüp kulüp tam FC27 kadroları) players.json'a uygular. FC26 turundan farkı: FC27 artık sadece
// reyting kaynağı değil, AKTİF HAVUZUN KENDİSİ — aktif oyuncu havuzu birebir FC27'deki 6 lig
// kadrolarına eşitleniyor:
//   · FC27 satırı havuzdaki bir oyuncuyla eşleşirse → reyting + kulüp + lig FC27'den güncellenir,
//     Transfermarkt kaynaklı diğer alanlar (isim, pozisyon, doğum tarihi, piyasa değeri,
//     sezon istatistikleri) korunur.
//   · Eşleşmezse (yeni transfer, altyapıdan çıkan, havuzda hiç olmayan) → FC27 verisinden YENİ
//     bir oyuncu kaydı oluşturulur (id `fc27_<fcratings id>`, mevki FC27'nin ana + ikincil mevkileri).
//   · Havuzda olup FC27'de 6 ligin HİÇBİRİNDE bulunmayan aktif oyuncu (ligden ayrılmış, küme
//     düşen kulübün oyuncusu vb.) havuzdan çıkarılır.
//   · Icon'lara (efsaneler) dokunulmaz.
// Herkesin reytingi artık doğrudan EA FC27 olduğu için kalibrasyon adımına (eaCalibration.js)
// gerek kalmıyor.
//
// Kullanım (server/ klasöründen):
//   node src/etl/applyFc27.js --dry-run   (sadece rapor)
//   node src/etl/applyFc27.js             (players.json'ı günceller)
const fs = require('fs');
const path = require('path');
const { normName, sameCoreClub } = require('./fc26RatingOverrides');
const {
  TARGET_LEAGUES, SUPER_LIG_NAME_ALIASES, PREMIER_LEAGUE_NAME_ALIASES, BUNDESLIGA_NAME_ALIASES,
  SERIE_A_NAME_ALIASES, LA_LIGA_NAME_ALIASES,
} = require('./reapplyFc26Overrides');
const { eligibleSlotsFor } = require('../shared/football');

const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'processed');
const PLAYERS_PATH = path.join(OUT_DIR, 'players.json');
const SQUADS_PATH = path.join(OUT_DIR, 'fc27_squads.json');
const SOURCE = 'fc27-2026-27';

// fetchFc27Ratings.js LEAGUES başlıkları -> lig kodu. Takma adlar FC26 turundan (aynı kaynak site);
// run.js'teki 4 ek düzeltme de (Kalibrasyon "suspects" listesinden çıkanlar) buraya eklendi.
const LEAGUE_CONFIG = {
  'Süper Lig': { code: 'TR1', aliases: SUPER_LIG_NAME_ALIASES },
  'Premier League': { code: 'GB1', aliases: PREMIER_LEAGUE_NAME_ALIASES },
  'La Liga': { code: 'ES1', aliases: { ...LA_LIGA_NAME_ALIASES, 'abdessamad ezzalzouli': 'abde ezzalzouli' } },
  'Bundesliga': { code: 'L1', aliases: { ...BUNDESLIGA_NAME_ALIASES, 'kim min jae': 'min jae kim' } },
  'Serie A': { code: 'IT1', aliases: { ...SERIE_A_NAME_ALIASES, 'yann aurel bisseck': 'yann bisseck' } },
  'Ligue 1': { code: 'FR1', aliases: { 'illia zabarnyi': 'ilya zabarnyi' } },
};

// EA mevki kodu -> bizim slot kodumuz (bkz. shared/football.js SLOTS).
const FC_POS_TO_SLOT = {
  GK: 'GK', CB: 'CB', LB: 'LB', LWB: 'LB', RB: 'RB', RWB: 'RB',
  CDM: 'DM', CM: 'CM', CAM: 'AM', LM: 'LM', RM: 'RM', LW: 'LW', RW: 'RW', ST: 'ST', CF: 'ST',
};

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const doc = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
  const squads = JSON.parse(fs.readFileSync(SQUADS_PATH, 'utf8'));
  const icons = doc.players.filter((p) => p.isIcon);
  const active = doc.players.filter((p) => !p.isIcon);

  const byNorm = new Map();
  for (const p of active) {
    const k = normName(p.name);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(p);
  }

  // Takma adlar LİGDEN BAĞIMSIZ uygulanıyor: bir oyuncu ligler arası transfer olduysa (ör.
  // Cucurella Premier League'den La Liga'ya) FC27'de YENİ liginin dosyasında çıkıyor.
  const allAliases = Object.assign({}, ...Object.values(LEAGUE_CONFIG).map((c) => c.aliases));

  const claimed = new Map(); // pool id -> { row, team, leagueTitle }
  const pending = [];
  const stats = {};
  for (const [leagueTitle, league] of Object.entries(squads.leagues)) {
    if (!LEAGUE_CONFIG[leagueTitle]) throw new Error(`Bilinmeyen lig başlığı: ${leagueTitle}`);
    stats[leagueTitle] = { rows: 0, matched: 0, fuzzy: 0, added: 0 };
    for (const club of league.clubs) {
      for (const row of club.players) { stats[leagueTitle].rows++; pending.push({ row, team: club.team, leagueTitle }); }
    }
  }

  // 1. aşama — tam isim (normalize) eşleşmesi. Önce hepsi bitiyor ki 2. aşamanın gevşek
  // eşleşmesi, tam eşleşmesi olan bir oyuncuyu kapmasın.
  const unresolved = [];
  for (const item of pending) {
    let key = normName(item.row.name);
    if (allAliases[key]) key = allAliases[key];
    let cands = (byNorm.get(key) || []).filter((p) => !claimed.has(p.id));
    if (cands.length > 1) {
      const sameClub = cands.filter((p) => sameCoreClub(p.club, item.team));
      if (sameClub.length === 1) cands = sameClub;
    }
    if (cands.length === 1) { claimed.set(cands[0].id, item); stats[item.leagueTitle].matched++; } else unresolved.push(item);
  }

  // 2. aşama — kelime kümesi eşleşmesi. FC27 çok sayıda kısa ad kullanıyor ("Cucurella",
  // "Grimaldo", "Palhinha") ya da sırası farklı ("Lee Kang In" ↔ "Kang-in Lee"). İsimlerden birinin
  // kelimeleri diğerinin kelimelerinin alt kümesiyse aday sayılır. Yanlış eşleşmeye karşı iki kilit:
  // aday TEK olmalı ve havuzdaki (FC26/kalibre) reyting FC27 reytinginden en fazla 8 puan uzak olmalı.
  const FUZZY_MAX_RATING_GAP = 8;
  const tokensOf = (name) => new Set(normName(name).split(' ').filter((t) => t.length > 1));
  const poolTokens = active.map((p) => ({ p, t: tokensOf(p.name) }));
  const subset = (a, b) => { for (const x of a) if (!b.has(x)) return false; return true; };
  const newRows = [];
  for (const item of unresolved) {
    const ft = tokensOf(allAliases[normName(item.row.name)] || item.row.name);
    let cands = [];
    if (ft.size) {
      cands = poolTokens
        .filter(({ p, t }) => !claimed.has(p.id) && t.size && (subset(ft, t) || (t.size >= 2 && subset(t, ft))))
        .map(({ p }) => p)
        .filter((p) => Math.abs(p.rating - item.row.rating) <= FUZZY_MAX_RATING_GAP);
      if (cands.length > 1) {
        const sameClub = cands.filter((p) => sameCoreClub(p.club, item.team));
        if (sameClub.length === 1) cands = sameClub;
      }
    }
    if (cands.length === 1) { claimed.set(cands[0].id, item); stats[item.leagueTitle].fuzzy++; } else { newRows.push(item); stats[item.leagueTitle].added++; }
  }

  // Milliyet adları: havuz Transfermarkt yazımını kullanıyor ("Korea, South"), FC27 EA yazımını
  // ("Korea Republic"). Eşleşen oyunculardan hangi FC27 adının hangi havuz adına karşılık geldiği
  // öğrenilip yeni eklenen oyunculara uygulanıyor — çark modunun "Milliyet Piyangosu" aynı ülkeyi
  // iki farklı yazımla ikiye bölmesin diye.
  const votes = new Map();
  for (const [id, { row }] of claimed) {
    if (!row.nation) continue;
    const p = active.find((x) => x.id === id);
    const m = votes.get(row.nation) || new Map();
    m.set(p.nation, (m.get(p.nation) || 0) + 1);
    votes.set(row.nation, m);
  }
  const nationMap = new Map();
  for (const [fc, m] of votes) nationMap.set(fc, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);

  const leagueFields = (leagueTitle) => {
    const code = LEAGUE_CONFIG[leagueTitle].code;
    return { league: TARGET_LEAGUES[code].name, leagueCode: code, country: TARGET_LEAGUES[code].country };
  };

  const kept = [];
  const removed = [];
  let clubChanges = 0;
  for (const p of active) {
    const c = claimed.get(p.id);
    if (!c) { removed.push(p); continue; }
    if (p.club !== c.team) clubChanges++;
    Object.assign(p, { rating: c.row.rating, ratingOverrideSource: SOURCE, club: c.team }, leagueFields(c.leagueTitle));
    delete p.ratingFormula;
    kept.push(p);
  }

  const added = [];
  const usedIds = new Set(kept.map((p) => p.id));
  for (const { row, team, leagueTitle } of newRows) {
    const primary = FC_POS_TO_SLOT[row.position];
    if (!primary) { console.warn(`[fc27] mevki tanınmadı, atlandı: ${row.name} (${row.position})`); continue; }
    const alts = [...new Set((row.altPositions || []).map((x) => FC_POS_TO_SLOT[x]).filter((x) => x && x !== primary))];
    let id = `fc27_${row.fcId || normName(row.name).replace(/ /g, '-')}`;
    while (usedIds.has(id)) id += '_';
    usedIds.add(id);
    added.push({
      id,
      name: row.name,
      nation: nationMap.get(row.nation) || row.nation || '—',
      dateOfBirth: null,
      foot: null,
      heightCm: null,
      club: team,
      ...leagueFields(leagueTitle),
      position: primary,
      subPositionRaw: null,
      eligibleSlots: eligibleSlotsFor(primary, alts),
      marketValueEUR: null,
      peakValueEUR: null,
      seasonStats: null,
      majorTournament: null,
      clubAchievement: null,
      isIcon: false,
      imageUrl: null,
      sourceUrl: null,
      rating: row.rating,
      ratingOverrideSource: SOURCE,
    });
  }

  const newActive = [...kept, ...added];
  for (const [lg, s] of Object.entries(stats)) {
    console.log(`[fc27] ${lg}: ${s.rows} FC27 oyuncusu — ${s.matched} tam + ${s.fuzzy} kelime eşleşmesi, ${s.added} yeni`);
  }
  console.log(`[fc27] kulübü değişen (transfer): ${clubChanges}`);
  console.log(`[fc27] havuzdan çıkan (FC27'de 6 ligde yok): ${removed.length}`);
  console.log(`[fc27] aktif havuz: ${active.length} -> ${newActive.length} (+${added.length} yeni, -${removed.length} çıkan), icon: ${icons.length}`);
  const posCount = {};
  for (const p of newActive) posCount[p.position] = (posCount[p.position] || 0) + 1;
  console.log('[fc27] mevki dağılımı:', posCount);
  const r = newActive.map((p) => p.rating).sort((a, b) => a - b);
  console.log(`[fc27] reyting: min=${r[0]} med=${r[Math.floor(r.length / 2)]} max=${r[r.length - 1]} ort=${(r.reduce((a, b) => a + b, 0) / r.length).toFixed(1)}`);

  if (process.argv.includes('--show-fuzzy')) {
    console.log('\n[fc27] kelime eşleşmeleri (FC27 adı <- havuz adı):');
    const exactIds = new Set();
    for (const item of unresolved) for (const [id, it] of claimed) if (it === item) exactIds.add(id);
    for (const id of exactIds) {
      const p = active.find((x) => x.id === id);
      const it = claimed.get(id);
      console.log(`  ${it.row.name} (${it.team}, ${it.row.rating}) <- ${p.name} (${p.club}, ${p.rating})`);
    }
  }

  if (dryRun) {
    const topRemoved = [...removed].sort((a, b) => b.rating - a.rating).slice(0, 25);
    console.log('\n[fc27] çıkanlardan en yüksek reytingli 25 (isim eşleşmesi kaçmış olabilir mi diye bak):');
    for (const p of topRemoved) console.log(`  - ${p.name} (${p.club}, ${p.league}) ${p.rating}`);
    const topAdded = [...added].sort((a, b) => b.rating - a.rating).slice(0, 25);
    console.log('\n[fc27] yenilerden en yüksek reytingli 25:');
    for (const p of topAdded) console.log(`  + ${p.name} (${p.club}, ${p.league}) ${p.rating}`);
    console.log('\n[fc27] --dry-run: players.json YAZILMADI.');
    return;
  }

  doc.players = [...newActive, ...icons];
  doc.counts = { active: newActive.length, icons: icons.length, total: newActive.length + icons.length };
  doc.generatedAt = new Date().toISOString();
  if (doc.ratingScale) doc.ratingScale.method = 'EA FC27 (tüm aktif oyuncular, kadrolar FC27 ile eşitlendi) + icon efsane skoru';
  fs.writeFileSync(PLAYERS_PATH, JSON.stringify(doc, null, 2));
  console.log('[fc27] players.json güncellendi.');
}

main();
