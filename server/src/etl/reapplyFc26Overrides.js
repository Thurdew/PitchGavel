// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "bütün oyuncuları fc26 yap" — FC26 override eşleşme oranını
// (o an %91, bkz. claude.md "FC26 Reyting Override'ı") mümkün olduğunca yükseltmek için, tam ETL
// pipeline'ını (`npm run etl`) YENİDEN ÇALIŞTIRMADAN — bu ortamda `server/data/raw/` (Transfermarkt
// ham CSV'leri) YOK, o yüzden `npm run etl` çalıştırılamıyor — SADECE mevcut `players.json` +
// 6 FC26 markdown dosyası üzerinde `resolveFc26Overrides`'ı (run.js'teki AYNI mantık/sıra, bkz.
// FC26_RATING_FILES/transferLockedIds) yeniden uygulayan bağımsız bir script. Bu, run.js'in FC26
// override bloğunun (satır ~913-987) bir KOPYASI — run.js'in KENDİSİ değiştirilmedi (raw veri
// olmadan `npm run etl`'i uçtan uca test edemediğimiz için ana ETL script'ine dokunmak riskli).
//
// Kullanım:
//   node src/etl/reapplyFc26Overrides.js --dry-run   (sadece rapor, players.json'a YAZMAZ)
//   node src/etl/reapplyFc26Overrides.js             (players.json'ı GÜNCELLER)
const fs = require('fs');
const path = require('path');
const { resolveFc26Overrides } = require('./fc26RatingOverrides');

const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'processed');
const PLAYERS_PATH = path.join(OUT_DIR, 'players.json');

// bkz. run.js TARGET_LEAGUES (aynı 6 lig, burada da gerekiyor ama run.js'ten export edilmiyor —
// küçük/stabil bir tablo olduğu için burada da tutmak, run.js'e dokunmaktan daha güvenli).
const TARGET_LEAGUES = {
  TR1: { name: 'Süper Lig', country: 'Türkiye' },
  GB1: { name: 'Premier Lig', country: 'İngiltere' },
  ES1: { name: 'La Liga', country: 'İspanya' },
  L1: { name: 'Bundesliga', country: 'Almanya' },
  IT1: { name: 'Serie A', country: 'İtalya' },
  FR1: { name: 'Ligue 1', country: 'Fransa' },
};

// bkz. run.js SUPER_LIG_CLUB_ALIASES/SUPER_LIG_NAME_ALIASES/LA_LIGA_NAME_ALIASES — BİREBİR KOPYA.
const SUPER_LIG_CLUB_ALIASES = {
  'Beşiktaş': ['Beşiktaş Jimnastik Kulübü'],
  'Galatasaray': ['Galatasaray'],
  'Fenerbahçe': ['Fenerbahce'],
  'Trabzonspor': ['Trabzonspor'],
  'Başakşehir': ['Basaksehir FK'],
  'Kasımpaşa': ['Kasimpasa'],
  'Eyüpspor': ['Eyüpspor'],
  'Göztepe': ['Göztepe'],
  'Samsunspor': ['Samsunspor'],
  'Çaykur Rizespor': ['Caykur Rizespor'],
  'Konyaspor': ['Konyaspor'],
  'Kocaelispor': ['Kocaelispor'],
  'Alanyaspor': ['Alanyaspor'],
  'Gaziantep FK': ['Gaziantep FK'],
  'Gençlerbirliği': ['Gençlerbirliği Spor Kulübü'],
  'Erzurumspor FK': ['Erzurumspor FK'],
  'Çorum FK': [],
};
const SUPER_LIG_NAME_ALIASES = {
  'anderson talisca': 'talisca',
  'oghenekaro etebo': 'peter etebo',
  'halil ibrahim dervisoglu': 'halil dervisoglu',
};
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — "bütün oyuncuları fc26 yap"] Eşleşme oranını daha da
// yükseltmek için eklenen YENİ takma adlar — her biri UYGULANMADAN ÖNCE `verifyAliasGuesses.js`
// ile players.json havuzunda GERÇEKTEN TEK bir adaya çıktığı doğrulandı (La Liga'daki disiplinle
// aynı). Bazı tahminler (ör. "João Cancelo", "Kim Min Jae", "Al-Musrati") havuzda HİÇ bulunamadığı
// için (muhtemelen ETL'in "aktif oyuncu" filtresine takılmışlar ya da veri setinde hiç yoklar)
// BİLEREK eklenmedi — yanlış eşleşme riskini göze almaktansa unmatched bırakmak tercih edildi.
const PREMIER_LEAGUE_NAME_ALIASES = {
  'zubimendi': 'martin zubimendi',
  'benjamin white': 'ben white',
  'kepa': 'kepa arrizabalaga',
  'mosquera': 'cristhian mosquera',
  'palhinha': 'joao palhinha',
  'amad': 'amad diallo',
  'igor': 'igor julio',
};
const BUNDESLIGA_NAME_ALIASES = {
  'grimaldo': 'alejandro grimaldo',
};
const SERIE_A_NAME_ALIASES = {
  'de gea': 'david de gea',
  'morata': 'alvaro morata',
  'andre franck zambo anguissa': 'frank anguissa',
};
const LA_LIGA_NAME_ALIASES = {
  // [YENİ — Athletic Club/Real Betis takma adları] Önceki "tamamla" turu bu iki kulübün
  // takma adlarını kapsamamıştı.
  'sancet': 'oihan sancet', 'vivian': 'dani vivian', 'gorosabel': 'andoni gorosabel',
  'lekue': 'inigo lekue', 'cucho': 'cucho hernandez',
  'balde': 'alejandro balde', 'fermin': 'fermin lopez', 'vini jr': 'vinicius junior',
  'carvajal': 'daniel carvajal', 'brahim': 'brahim diaz', 'asencio': 'raul asencio',
  'gonzalo': 'gonzalo garcia', 'pubill': 'marc pubill', 'rodri mendoza': 'rodrigo mendoza',
  'moleiro': 'alberto moleiro', 'ayoze': 'ayoze perez', 'parejo': 'dani parejo',
  'pedraza': 'alfonso pedraza', 'alfon': 'alfon gonzalez', 'oyarzabal': 'mikel oyarzabal',
  'barrenetxea': 'ander barrenetxea', 'zubeldia': 'igor zubeldia', 'jon mikel aramburu': 'jon aramburu',
  'gorrotxa': 'jon gorrotxategi', 'turrientes': 'benat turrientes', 'odriozola': 'alvaro odriozola',
  'karrikaburu': 'jon karrikaburu', 'frances': 'alejandro frances', 'flavien enzo boyomo': 'enzo boyomo',
  'catena': 'alejandro catena', 'moncayola': 'jon moncayola', 'aitor': 'aitor fernandez',
  'herrando': 'jorge herrando', 'osambela': 'asier osambela', 'arguibide': 'inigo arguibide',
  'de frutos': 'jorge de frutos', 'isi': 'isi palazon', 'gumbau': 'gerard gumbau',
  'de las sias': 'marco de las sias', 'gaya': 'jose gaya', 'agirrezabala': 'julen agirrezabala',
  'copete': 'jose copete', 'carmona': 'jose angel carmona', 'akor jerome adams': 'akor adams',
  'peque': 'peque fernandez', 'sivera': 'antonio sivera', 'jonny': 'jonny otto', 'pacheco': 'jon pacheco',
  'alena': 'carles alena', 'guridi': 'jon guridi', 'abderrahman rebbach': 'abde rebbach',
  'mariano': 'mariano diaz', 'raillo': 'antonio raillo', 'abdelkabir abqar': 'abdel abqar',
  'karl edouard etta eyong': 'karl etta eyong', 'olasagasti': 'jon ander olasagasti', 'dela': 'adrian dela',
  'morales': 'jose luis morales', 'elgezabal': 'unai elgezabal', 'bigas': 'pedro bigas',
  'valera': 'german valera', 'alvaro': 'alvaro rodriguez', 'mourad daoudi el ghezouani': 'mourad el ghezouani',
  'iturbe': 'alejandro iturbe', 'aaron': 'aaron escandell',
};

const FC26_RATING_FILES = [
  { file: 'super_lig_2026_2027_fc26_reytingleri.md', label: 'Süper Lig', leagueCode: 'TR1', clubAliases: SUPER_LIG_CLUB_ALIASES, nameAliases: SUPER_LIG_NAME_ALIASES },
  { file: 'premier_league_2026_2027_fc26_reytingleri.md', label: 'Premier League', leagueCode: 'GB1', nameAliases: PREMIER_LEAGUE_NAME_ALIASES },
  { file: 'la_liga_2026_2027_fc26_reytingleri.md', label: 'La Liga', leagueCode: 'ES1', nameAliases: LA_LIGA_NAME_ALIASES },
  { file: 'bundesliga_2026_2027_fc26_reytingleri.md', label: 'Bundesliga', leagueCode: 'L1', nameAliases: BUNDESLIGA_NAME_ALIASES },
  { file: 'serie_a_2026_2027_fc26_reytingleri.md', label: 'Serie A', leagueCode: 'IT1', nameAliases: SERIE_A_NAME_ALIASES },
  { file: 'ligue_1_2026_2027_fc26_reytingleri.md', label: 'Ligue 1', leagueCode: 'FR1' },
];

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const allPlayers = JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf8'));
  const list = allPlayers.players || allPlayers; // players.json şekli: { generatedAt, counts, ratingScale, players: [...] }
  const players = Array.isArray(list) ? list : allPlayers.players;

  let fc26TotalApplied = 0;
  let fc26TotalRows = 0;
  let fc26ClubUpdatesApplied = 0;
  const transferLockedIds = new Set();
  const unmatchedByLeague = {};

  for (const cfg of FC26_RATING_FILES) {
    const mdPath = path.join(OUT_DIR, cfg.file);
    if (!fs.existsSync(mdPath)) { console.log(`[reapply] ${cfg.label}: dosya bulunamadı, atlanıyor`); continue; }
    const leagueInfoForFile = TARGET_LEAGUES[cfg.leagueCode];
    const { overrides, unmatched } = resolveFc26Overrides(players, mdPath, {
      clubAliases: cfg.clubAliases, nameAliases: cfg.nameAliases,
      leagueName: leagueInfoForFile.name, leagueCode: cfg.leagueCode, country: leagueInfoForFile.country,
    });
    let applied = 0;
    for (const p of players) {
      const ov = overrides.get(p.id);
      if (!ov) continue;
      if (transferLockedIds.has(p.id)) continue;
      p.rating = Math.max(1, Math.min(99, Math.round(ov.rating)));
      p.ratingOverrideSource = 'fc26-2026-27';
      applied++;
      const clubChanged = ov.resolvedClub && ov.resolvedClub !== p.club;
      if (clubChanged) fc26ClubUpdatesApplied++;
      if (ov.resolvedClub) {
        p.club = ov.resolvedClub; p.league = ov.leagueName; p.leagueCode = ov.leagueCode; p.country = ov.country;
      }
      const isNewTransfer = /Yeni transfer/.test(ov.durum || '');
      if (isNewTransfer) transferLockedIds.add(p.id);
    }
    fc26TotalApplied += applied;
    fc26TotalRows += applied + unmatched.length;
    unmatchedByLeague[cfg.label] = unmatched;
    console.log(`[reapply] ${cfg.label}: ${applied}/${applied + unmatched.length} eşleşti (%${((applied / (applied + unmatched.length)) * 100).toFixed(1)})`);
  }
  console.log(`[reapply] TOPLAM: ${fc26TotalApplied}/${fc26TotalRows} (%${((fc26TotalApplied / fc26TotalRows) * 100).toFixed(1)}) — kulüp senkronu: ${fc26ClubUpdatesApplied}`);

  if (dryRun) {
    console.log('\n[reapply] --dry-run: players.json YAZILMADI. Eşleşmeyenler:');
    for (const [label, list2] of Object.entries(unmatchedByLeague)) {
      if (!list2.length) continue;
      console.log(`\n-- ${label} (${list2.length}) --`);
      for (const line of list2) console.log('  ' + line);
    }
  } else {
    // `players` üstteki `allPlayers.players`'ın AYNI referansı — üstteki döngüler zaten yerinde
    // (in-place) mutasyon yaptı, burada sadece dosyayı orijinal (2 boşluklu, okunabilir) biçimde
    // geri yazıyoruz.
    fs.writeFileSync(PLAYERS_PATH, JSON.stringify(allPlayers, null, 2));
    console.log('[reapply] players.json güncellendi.');
  }
}

main();
