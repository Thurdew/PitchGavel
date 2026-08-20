// Ana ETL: Transfermarkt CSV'lerini + Wikidata icon verisini işleyip tek bir
// server/data/processed/players.json çıktısı üretir. Tek seferlik çalıştırılır
// (`npm run etl`), runtime'da tekrar çağrılmaz.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parse } = require('csv-parse/sync');
const {
  SUB_POSITION_TO_SLOT,
  POSITION_TO_SLOT_FALLBACK,
  eligibleSlotsFor,
  slotToGroup,
} = require('../shared/football');
const { ACHIEVEMENTS, legendScore, RATING_OVERRIDES } = require('./icons');
const MANUAL_POSITIONS = require('./manualPositionOverrides');
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — EA POLİTİKASI BİLEREK GERİ ALINDI] bkz. fc26RatingOverrides.js
// dosya başı notu — 2026-27 için EA FC26 reytingleri (Süper Lig + büyük 5 Avrupa ligi) kullanıcı
// onayıyla DOĞRUDAN uygulanıyor.
const { resolveFc26Overrides } = require('./fc26RatingOverrides');

const RAW_DIR = path.join(__dirname, '..', '..', 'data', 'raw');
const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'processed');
const OUT_FILE = path.join(OUT_DIR, 'players.json');

// AUCTION-GAME-CLAUDE.md "Veri Kapsamı": Türkiye Süper Lig + büyük 5 Avrupa ligi.
const TARGET_LEAGUES = {
  TR1: { name: 'Süper Lig', country: 'Türkiye' },
  GB1: { name: 'Premier Lig', country: 'İngiltere' },
  ES1: { name: 'La Liga', country: 'İspanya' },
  L1: { name: 'Bundesliga', country: 'Almanya' },
  IT1: { name: 'Serie A', country: 'İtalya' },
  FR1: { name: 'Ligue 1', country: 'Fransa' },
};

// [GERÇEKÇİLİK DÜZELTMESİ v5, KULLANICI GERİ BİLDİRİMİ: "Barış Alper 81, Trossard 79 — aradaki
// fark ne, biri Süper Lig'de biri Premier Lig'de oynuyor, Trossard Dünya Kupası çeyrek finali
// oynadı... olsa daha iyi olmaz mı"] — v4'e kadar performans sinyali (gol/asist/dakika) HANGİ
// LİGDE üretildiğine hiç bakmadan, ham sayılarla tüm 6 ligi birlikte yüzdelik dilime çeviriyordu;
// milli takım/büyük turnuva katkısı da (kulüp sezonu dışında tutulduğu için) hiç hesaba
// katılmıyordu. İki küçük düzeltme eklendi:
//  1) LEAGUE_STRENGTH: performansın gol+asist ayağına (SADECE buna — dakikaya değil, çünkü
//     "düzenli forma giyme" ligin zorluğuyla ilgili değil) hafif bir çarpan. Süper Lig'i tekrar
//     v1/v2'deki gibi ezmesin diye BİLEREK ÇOK KÜÇÜK (0.80-1.00 arası, ~%20 bant) — v1/v2'nin
//     asıl hatası (ham piyasa değerine log-ölçek, onlarca puanlık fark yaratıyordu) burada
//     tekrarlanmıyor.
//  2) INTERNATIONAL_BONUS: son ~4 yılda büyük bir turnuvada (Dünya Kupası/Euro/Copa América/
//     AFCON) oynamış/katkı vermiş oyunculara birkaç puanı geçmeyen küçük bir ek puan (bkz.
//     loadInternationalTournamentBonus) — kulüp performansının YERİNE değil, YANINA.
const LEAGUE_STRENGTH = {
  GB1: 1.00, // Premier Lig — referans
  ES1: 0.96, // La Liga
  L1: 0.94, // Bundesliga
  IT1: 0.94, // Serie A
  FR1: 0.88, // Ligue 1
  TR1: 0.80, // Süper Lig
};
const MAJOR_TOURNAMENT_COMPETITIONS = new Set(['FIWC', 'EURO', 'COPA', 'AFCN']); // Dünya Kupası, Euro, Copa América, AFCON
const INTERNATIONAL_BONUS_WINDOW_DAYS = 365 * 4; // son ~4 yıl (bir turnuva döngüsü + pay)
const INTERNATIONAL_BONUS_MAX = 6; // reytingi en fazla bu kadar puan yukarı taşıyabilir

// [GERÇEKÇİLİK DÜZELTMESİ v7, KULLANICI GERİ BİLDİRİMİ: "Barış Alper Dünya Kupası'nda gruptan
// çıkamamış, Trossard'dan daha az gol/asist yapmış, nasıl aynı puanı alıyor"] — v5'teki bonus
// formülü (2 + min(2, gol+asist)) çok erken tavana çarpıyordu: Trossard'ın 3 katkısı (2G+1A) ile
// Barış Alper'in 2 katkısı (1G+1A) İKİSİ DE aynı +4 bonusuna denk geliyordu, aradaki gerçek fark
// kayboluyordu. Ayrıca HANGİ TURA kadar gidildiği (grup mu, çeyrek final mi) hiç hesaba
// katılmıyordu. Çözüm: katkı tavanı gevşetildi (min(2,...) → min(3,...)) VE tur derinliği
// (games.csv `round` alanından) küçük bir bileşen olarak eklendi — bkz. ROUND_DEPTH,
// roundDepthFor. NOT: bu (kurgusal/simüle) veri setinde Belçika da bu turnuvada grup aşamasında
// elendiği için Trossard/Barış Alper örneğinde tur derinliği ikisi için de 0 çıkıyor — asıl
// farkı hâlâ gevşetilen katkı tavanı yaratıyor (bkz. claude.md notu).
// Alt-string eşleştirme kullanıyor çünkü kulüp kupalarında (CL/EL) tur etiketleri milli takım
// turnuvalarındaki gibi TAM eşleşmiyor — "Quarter-Finals 1st Leg", "Last 16 2nd Leg" gibi
// çift-maçlı (home/away) ek ibareler taşıyor (bkz. v10 notu, CLUB_CUP_COMPETITIONS).
function roundDepthFor(roundLabel) {
  if (!roundLabel) return 0;
  const r = roundLabel.toLowerCase();
  if (r.includes('quarter')) return 2;
  if (r.includes('semi')) return 3;
  if (r.includes('third place')) return 3;
  if (r.includes('last 16') || r.includes('round of 16')) return 1;
  if (r.includes('final')) return 4; // yukarıdakilerden biri eşleşmediyse ("Final" tek başına)
  return 0; // Group Stage, intermediate stage, qualifying vb.
}

// [GERÇEKÇİLİK DÜZELTMESİ v3, KULLANICI GERİ BİLDİRİMİ: "piyasa değerine göre puanlama yapma,
// yaş/performans/oynadığı takım da önemli — mesela adam 34 yaşında ama ligde 10 gol 10 asist
// yapmış, rating düşebilir ama bu kadar düşmesi saçma. Süper Lig'de de hâlâ gerçekçi değil"] —
// v1/v2'de reyting SADECE piyasa değerine (önce zirve, sonra güncel, sonra yumuşatılmış-güncel +
// yüzdelik dilim) dayanıyordu. Piyasa değeri yaşlanan ama hâlâ üreten bir oyuncuyu (transfer
// ekonomisi düşüyor diye) ya da performansı güçlü ama ticari değeri düşük kalan bir ligi haksız
// yere aşağı çekebiliyor — SAF bir ekonomik sinyal, sahadaki katkıyı görmüyor.
// Çözüm: piyasa değerinin yanına GERÇEK SEZON PERFORMANSINI (gol, asist, oynanan dakika/maç —
// Transfermarkt'ın `appearances.csv` + `games.csv` tabloları, aynı ücretsiz/hesapsız kaynak,
// bkz. dosyanın en altı [VERİ KAYNAĞI] notu) ikinci bir sinyal olarak ekliyoruz. İki sinyal
// AYRI AYRI yüzdelik dilime çevrilip harmanlanıyor (bkz. VALUE_WEIGHT/PERFORMANCE_WEIGHT) —
// performans sinyali POZİSYON GRUBU İÇİNDE karşılaştırılıyor (bir stoperin 3 golü ile bir
// santrforun 3 golü aynı şey değil) ve kaleciler için gol/asist anlamsız olduğundan sadece
// "düzenli forma giyme" (dakika) kullanılıyor. Bu sayede yaşı ilerlemiş ama hâlâ üreten bir
// oyuncu ya da ticari değeri düşük ama sahada iş gören bir Süper Lig oyuncusu artık SADECE
// piyasa ekonomisine mahkum kalmıyor.
const RECENT_VALUE_WINDOW_DAYS = 730;
const RATING_FLOOR = 40; // profesyonel bir ligde forma giyen kimse "değersiz" görünmesin
const RATING_CEIL = 99;
// [GERÇEKÇİLİK DÜZELTMESİ v12, KULLANICI GERİ BİLDİRİMİ: "iconlar çok düşük kalmış, onları
// yükselt"] — taban eskiden 68'di; v10'daki kulüp başarısı + uluslararası turnuva bonusları
// aktif oyuncuların tavanını (birçok oyuncu 90+'a çıkabiliyor) yükseltince, tarihin en büyük
// isimleri (Maradona, Zidane, Ronaldinho, Henry hepsi 82-86) günün iyi ama efsane OLMAYAN bir
// oyuncusunun (ör. lig şampiyonu bir orta saha, 91) GERİSİNDE kalmaya başladı — bu, "icon"
// kategorisinin anlamını zayıflatıyordu. Taban 80'e çıkarıldı: en az dekore icon bile (küçük
// bir ülkenin kulüp efsaneleri) artık iyi bir aktif oyuncunun net üstünde başlıyor, gerçek
// GOAT'lar (Pelé, Beckenbauer, Ronaldo Nazário, Van Basten, Xavi, Iniesta) 93-99 bandında.
const ICON_RATING_FLOOR = 80;
const ICON_RATING_CEIL = 99;
const VALUE_WEIGHT = 0.55;
const PERFORMANCE_WEIGHT = 0.45;
// Performans skorunda gol/asist ile "düzenli forma giyme" (dakika) arasındaki denge — [KULLANICI
// İSTEĞİ] "çoğunlukla ilk 11 oynadı" gibi bir düzenlilik sinyalinin de payı olsun diye salt
// gol+asist'e boğulmuyor.
const GOAL_INVOLVEMENT_WEIGHT = 0.6;
const MINUTES_WEIGHT = 0.4;

// [GERÇEKÇİLİK DÜZELTMESİ v8, KULLANICI GERİ BİLDİRİMİ: "Vlahović 77 az geldi, Jonathan David 83,
// Kroupi 80 — dengesizlik var"] — v3-v7'de gol+asist katkısı HAM SAYI olarak kullanılıyordu, ama
// dakika zaten AYRI bir sinyal (bkz. MINUTES_WEIGHT). Sonuç: az dakika oynayan bir oyuncu hem
// "az dakika" diye hem (az dakikada az sayı biriktirdiği için) "az katkı" diye ÇİFTE
// cezalandırılıyordu. Örnek: Vlahović 1290 dakikada 12G+2A (90dk başına 0.94 katkı — üçünün en
// verimlisi), Jonathan David 2329 dakikada 8G+5A (90dk başına sadece 0.45) ama HAM sayıda David
// önde göründüğü için daha yüksek reyting alıyordu — yanlış. Çözüm: gol+asist artık 90 DAKİKA
// BAŞINA ORAN olarak karşılaştırılıyor (dakika sinyali hâlâ ayrı/ham kalıyor — "ne kadar düzenli
// oynuyor" farklı bir şey ölçüyor, per-90'a çevrilmiyor). Küçük örneklem gürültüsünü önlemek için
// (ör. 1 golü 15 dakikada atan biri) GOAL_RATE_MIN_MINUTES altındaki oyuncular bu sıralamaya
// hiç girmiyor (NÖTR 0.5 kalır, cezalandırılmaz).
const GOAL_RATE_MIN_MINUTES = 450; // ~5 tam maç

// [GERÇEKÇİLİK DÜZELTMESİ v10, KULLANICI GERİ BİLDİRİMİ: "Rice defansif orta saha, attığı golün
// çok önemli olmaması lazım, Premier Lig'i kazandı, Şampiyonlar Ligi'nde final oynadı, hepsinde
// 11 oynadı — farklı bir şey yapmamız lazım"] — iki ayrı, gerçek eksik ortaya çıktı:
//  1) MF grubu (DM/CM/AM/LM/RM hepsi aynı kovada) sadece gol+asist+dakika kullanıyordu — DF/GK
//     gibi bir defansif sağlamlık sinyali YOKTU. Savunma ağırlıklı bir orta saha oyuncusunun
//     (Rice gibi) golü zaten az olacağı için bu, onu haksız yere aşağı çekiyordu.
//  2) Takımın o SEZONKİ gerçek başarısı (lig şampiyonluğu, Şampiyonlar Ligi/Avrupa Ligi'nde ne
//     kadar ileri gidildiği) hiç hesaba katılmıyordu — oysa games.csv'de bu bilgi zaten var:
//     her ligin SON HAFTASINDAKİ `home_club_position`/`away_club_position` alanı o kulübün
//     GERÇEK final sıralamasını veriyor (doğrulandı: bu veri setinde Arsenal 2025-26 sezonunu
//     1. bitirmiş), CL/EL maçlarının `round` alanı da tur derinliğini veriyor (bkz.
//     roundDepthFor — aynı milli-takım-turnuvası mantığı, kulüp kupasına uyarlandı).
// Çözüm: (a) MF grubuna DF'teki gibi (ama daha hafif) bir defansif sağlamlık payı eklendi
// (bkz. MF_GOAL_WEIGHT/MF_MINUTES_WEIGHT/MF_DEFENSE_WEIGHT). (b) Kulüp performansının YANINA
// (piyasa/performans ayaklarının dışında, uluslararası turnuva bonusuyla AYNI mantıkla) küçük
// bir "takım başarısı" bonusu: o sezon ligini şampiyon bitiren kulüpte yeterli süre oynamış
// olmak (+3), CL/EL'de ulaşılan tur derinliği (en fazla +3) — toplamda CLUB_ACHIEVEMENT_BONUS_MAX
// ile sınırlı. Bireysel katkı sinyalinin YERİNE değil YANINA — bir oyuncu şampiyon kulüpte
// oynamasa da hâlâ değer+performans üzerinden tam puan alabiliyor, bu sadece küçük bir ek.
const MF_GOAL_WEIGHT = 0.45;
const MF_MINUTES_WEIGHT = 0.30;
const MF_DEFENSE_WEIGHT = 0.25;
const CLUB_CUP_COMPETITIONS = new Set(['CL', 'EL']); // Şampiyonlar Ligi, Avrupa Ligi (ana turnuva — vasıflanma/Q hariç)
const LEAGUE_CHAMPION_MIN_MINUTES = 900; // ~10 tam maç — kadroda olmak yetmez, gerçekten oynamış olmalı
const LEAGUE_CHAMPION_BONUS = 3;
const CUP_ROUND_BONUS_MAX = 3;
const CLUB_ACHIEVEMENT_BONUS_MAX = 5;

function readCsv(filename) {
  const raw = fs.readFileSync(path.join(RAW_DIR, filename), 'utf8');
  return parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

// [GERÇEKÇİLİK DÜZELTMESİ v4, KULLANICI GERİ BİLDİRİMİ: "Trossard'da 92 çok olmuş... herkes çok
// güçlü olmuş, bir denge bulmak lazım"] — DOĞRUSAL yüzdelik-dilim→reyting eşlemesi (v2/v3),
// 3558 aktif oyuncudan 371'ini 90+ yapıyordu (658'i 85+) — gerçekte "90+" birkaç düzine oyuncuyla
// sınırlı olmalı, yoksa "elit" hiçbir anlam taşımıyor. Sorun yine eğrinin ŞEKLİYDİ: doğrusal
// eşleme, üst %15'lik dilimi (~530 oyuncu) 80-99 aralığına sığdırıyor — o kadar oyuncu o kadar
// dar bir aralığa girince "iyi" ile "dünya klası" arasındaki fark siliniyordu.
// Çözüm: parça parça (piecewise) doğrusal bir eğri — orta gövdeyi (ör. Süper Lig ortalaması)
// ETKİLEMEDEN sadece EN TEPEYİ seçici hale getiriyor. Çapa noktaları: medyan oyuncu ~60,
// üst %20 ~72, üst %7 ~82, üst %2 ~90, mutlak zirve (üst ~%1) 99'a kadar. Süper Lig
// ortalamasını/Osimhen-Sané kademesini v3'teki gibi korurken (bkz. RATING_ANCHORS altındaki
// yorum), 90+ rozetini gerçekten nadir hale getiriyor.
const RATING_ANCHORS = [
  [0.00, RATING_FLOOR], // en düşük performans/değer
  [0.50, 60], // medyan profesyonel — orta gövde makul kalsın (Süper Lig'i tekrar ezmesin)
  [0.80, 72], // üst %20 — iyi, düzenli bir başlangıç oyuncusu
  [0.93, 82], // üst %7 — açıkça kaliteli, lig standartlarının üstünde
  [0.98, 90], // üst %2 — elit (havuzda ~yetmiş oyuncu)
  [1.00, RATING_CEIL], // mutlak zirve — bir avuç dünya klası oyuncu
];

// Bir yüzdelik dilimi (0..1), RATING_ANCHORS çapa noktaları arasında PARÇA PARÇA doğrusal
// enterpolasyonla reytinge çevirir (yalnızca aktif oyuncular için — bkz. dosya başı
// [GERÇEKÇİLİK DÜZELTMESİ v4] notu). Icon'lar hâlâ basit doğrusal `percentileToRating`
// kullanıyor (küçük/küratörlü liste, aynı "üst çok kalabalık" sorunu geçerli değil).
function activeRatingCurve(rank01) {
  const r = Math.max(0, Math.min(1, rank01));
  for (let i = 0; i < RATING_ANCHORS.length - 1; i++) {
    const [r0, v0] = RATING_ANCHORS[i];
    const [r1, v1] = RATING_ANCHORS[i + 1];
    if (r <= r1 || i === RATING_ANCHORS.length - 2) {
      const t = r1 === r0 ? 0 : (r - r0) / (r1 - r0);
      return Math.max(RATING_FLOOR, Math.min(RATING_CEIL, Math.round(v0 + (v1 - v0) * t)));
    }
  }
  return RATING_CEIL;
}

// Bir yüzdelik dilimi (0..1) verilen aralığa DOĞRUSAL olarak eşler — SADECE icon'lar için
// kullanılıyor (bkz. yukarıdaki not).
function percentileToRating(rank01, outMin, outMax) {
  const r = outMin + (outMax - outMin) * rank01;
  return Math.max(outMin, Math.min(outMax, Math.round(r)));
}

// rows: [{id, value}, ...] → id -> 0..1 (0 = en düşük değer, 1 = en yüksek).
function percentileRanks(rows) {
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  const n = sorted.length;
  const rank = new Map();
  sorted.forEach((row, i) => rank.set(row.id, n <= 1 ? 1 : i / (n - 1)));
  return rank;
}

function slugToId(prefix, code) {
  return `${prefix}_${code}`;
}

// [VERİ KAYNAĞI] Aynı dcaribou/transfermarkt-datasets deposundan (hesap/API anahtarı
// gerekmeden) iki tablo daha: `games.csv` (maç bazında sezon/turnuva bilgisi) ve
// `appearances.csv` (oyuncu bazında maç başına gol/asist/dakika — ~1.9M satır). Sadece bu iki
// dosya CSV değil satır satır okunuyor (appearances.csv ~150MB) — bellekte tüm dosyayı
// tutmak yerine streaming + erken filtreleme (hedef sezon + hedef oyuncu) kullanılıyor.
// TEK geçişte İKİ ayrı bakış açısı toplanıyor (150MB'lık dosyayı iki kez okumamak için):
//  - clubStats: bu sezonki kulüp performansı (milli takım HARİÇ) — reytingin ana performans ayağı.
//  - tournamentStats: son ~4 yıldaki büyük turnuva (Dünya Kupası/Euro/Copa/AFCON) katkısı —
//    [GERÇEKÇİLİK DÜZELTMESİ v5] küçük bir bonus için (bkz. INTERNATIONAL_BONUS_MAX).
async function loadPerformanceData(targetPlayerIds, season) {
  const games = readCsv('games.csv');
  const clubGameIds = new Set();
  const tournamentGameIds = new Set();
  const tournamentGameRound = new Map(); // game_id -> round etiketi (bkz. roundDepthFor)

  // "Son ~4 yıl" veri setinin KENDİ en güncel maç tarihine göre (wall-clock "bugün"e göre değil
  // — bkz. recentValueFor'daki aynı mantık, players.json'un sabit bir tarihte üretildiği
  // varsayılmıyor).
  let maxDate = '';
  for (const g of games) if (g.date && g.date > maxDate) maxDate = g.date;
  const cutoff = new Date(maxDate);
  cutoff.setDate(cutoff.getDate() - INTERNATIONAL_BONUS_WINDOW_DAYS);
  const tournamentCutoffStr = cutoff.toISOString().slice(0, 10);

  const clubCupGameRound = new Map(); // game_id -> round (SADECE CL/EL, bu sezon — bkz. v10 notu)
  const leagueLastDate = new Map(); // leagueCode -> o ligin bu sezonki EN SON maç tarihi
  for (const g of games) {
    if (g.season === String(season) && g.competition_type !== 'national_team_competition') {
      clubGameIds.add(g.game_id);
      if (CLUB_CUP_COMPETITIONS.has(g.competition_id)) clubCupGameRound.set(g.game_id, g.round);
    }
    if (g.competition_type === 'national_team_competition' && MAJOR_TOURNAMENT_COMPETITIONS.has(g.competition_id) && g.date >= tournamentCutoffStr) {
      tournamentGameIds.add(g.game_id);
      tournamentGameRound.set(g.game_id, g.round);
    }
    if (g.season === String(season) && g.competition_type === 'domestic_league' && TARGET_LEAGUES[g.competition_id]) {
      const cur = leagueLastDate.get(g.competition_id) || '';
      if (g.date > cur) leagueLastDate.set(g.competition_id, g.date);
    }
  }
  console.log(`[etl] ${season} sezonu için ${clubGameIds.size} kulüp maçı (milli takım hariç) dahil edildi`);
  console.log(`[etl] son ~4 yılda ${tournamentGameIds.size} büyük turnuva maçı (Dünya Kupası/Euro/Copa/AFCON) dahil edildi`);

  // [GERÇEKÇİLİK DÜZELTMESİ v10] Lig şampiyonu: o ligin bu sezonki EN SON maç haftasındaki
  // `home_club_position`/`away_club_position` alanı GERÇEK final sıralamayı veriyor (doğrulandı —
  // bkz. dosya başı notu). Pozisyon "1" olan kulüp o ligin şampiyonu.
  const championClubIds = new Set();
  for (const g of games) {
    if (g.season === String(season) && g.competition_type === 'domestic_league' && TARGET_LEAGUES[g.competition_id] && g.date === leagueLastDate.get(g.competition_id)) {
      if (g.home_club_position === '1') championClubIds.add(g.home_club_id);
      if (g.away_club_position === '1') championClubIds.add(g.away_club_id);
    }
  }
  console.log(`[etl] ${season} sezonu lig şampiyonları (kulüp id): ${[...championClubIds].join(', ')}`);

  // [GERÇEKÇİLİK DÜZELTMESİ v6, KULLANICI GERİ BİLDİRİMİ: "gol atamamış olabilir ama iyi
  // oynamıştır"] — DF/GK için gol/asist anlamlı bir sinyal değil. Oyuncu sahadayken takımının
  // kaçtığı gol sayısı (maç sonucundan) dolaylı ama gerçek bir "işini iyi yaptı mı" göstergesi.
  // Sadece 60+ dakika oynadığı maçlar sayılıyor (kısa süre giren bir yedeğe o maçın golünü
  // yüklemek adil olmaz — appearances.csv golün KAÇINCI dakikada yendiğini vermiyor, bu yüzden
  // "maçın büyük bölümünde sahadaydı" eşiği en makul yaklaşım). Kart sinyali (ilk denenen ama
  // forvet için anlamsız çıkan fikir) BİLEREK KULLANILMIYOR.
  const DEFENSE_MIN_MINUTES = 60;
  const gameInfoById = new Map(); // game_id -> {homeId, awayId, homeGoals, awayGoals} — sadece clubGameIds
  for (const g of games) {
    if (clubGameIds.has(g.game_id)) {
      gameInfoById.set(g.game_id, {
        homeId: g.home_club_id, awayId: g.away_club_id,
        homeGoals: Number(g.home_club_goals) || 0, awayGoals: Number(g.away_club_goals) || 0,
      });
    }
  }

  const clubStats = new Map(); // player_id -> { goals, assists, minutes, apps }
  const tournamentStats = new Map(); // player_id -> { goals, assists, apps }
  const defenseStats = new Map(); // player_id -> { conceded, apps } — SADECE DF/GK ve MF için kullanılıyor
  // [GERÇEKÇİLİK DÜZELTMESİ v10] Takım başarısı — bkz. dosya başı notu.
  const championMinutesByPlayer = new Map(); // player_id -> şampiyon kulüpte oynadığı dakika
  const cupRoundDepthByPlayer = new Map(); // player_id -> CL/EL'de ulaştığı en derin tur
  const latestClubByPlayer = new Map(); // player_id -> {clubId, date} — bkz. v11 notu (güncel transfer)
  const appearancesPath = path.join(RAW_DIR, 'appearances.csv');
  if (!fs.existsSync(appearancesPath)) {
    console.warn('[etl] appearances.csv bulunamadı — performans sinyali olmadan (sadece piyasa değeri) devam ediliyor.');
    return { clubStats, tournamentStats, defenseStats, championMinutesByPlayer, cupRoundDepthByPlayer, latestClubByPlayer };
  }
  const rl = readline.createInterface({ input: fs.createReadStream(appearancesPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let isHeader = true;
  let clubRowCount = 0;
  let tournamentRowCount = 0;
  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; }
    if (!line) continue;
    // appearance_id,game_id,player_id,player_club_id,player_current_club_id,date,player_name,
    // competition_id,yellow_cards,red_cards,goals,assists,minutes_played — hiçbir alan tırnaklı
    // değil (kontrol edildi), düz split güvenli.
    const gameIdStart = line.indexOf(',') + 1;
    const gameIdEnd = line.indexOf(',', gameIdStart);
    const gameId = line.slice(gameIdStart, gameIdEnd);
    const isClub = clubGameIds.has(gameId);
    const isTournament = !isClub && tournamentGameIds.has(gameId);
    if (!isClub && !isTournament) continue;
    const playerIdEnd = line.indexOf(',', gameIdEnd + 1);
    const playerId = line.slice(gameIdEnd + 1, playerIdEnd);
    if (!targetPlayerIds.has(playerId)) continue;

    const cols = line.split(',');
    const playerClubId = cols[3];
    const apDate = cols[5];
    const goals = Number(cols[10]) || 0;
    const assists = Number(cols[11]) || 0;
    const minutes = Number(cols[12]) || 0;

    if (isClub) {
      if (!clubStats.has(playerId)) clubStats.set(playerId, { goals: 0, assists: 0, minutes: 0, apps: 0 });
      const s = clubStats.get(playerId);
      s.goals += goals; s.assists += assists; s.minutes += minutes; s.apps += 1;
      clubRowCount++;

      // [GERÇEKÇİLİK DÜZELTMESİ v11, KULLANICI GERİ BİLDİRİMİ: "eski futbolcular gözüküyor
      // takımlarda"] — players.csv'nin `current_club_id` alanı %9 oranında güncel değildi
      // (doğrulandı: Gündoğan→Galatasaray, Ter Stegen→Girona, Ederson→Fenerbahçe gibi gerçek
      // transferler yansımamıştı). Bu sezonki (season=maxSeason, milli takım HARİÇ — zaten
      // isClub bunu garanti ediyor) EN SON tarihli kulüp maçının kulübü, players.csv'nin
      // statik alanından daha güvenilir bir "güncel kulüp" sinyali. Hiç bu sezon maçı olmayan
      // oyuncular için (ör. hiç forma giymemiş bir yedek) players.csv'ye geri dönülüyor — bkz.
      // altta `latestClubByPlayer` kullanımı.
      const prevLatest = latestClubByPlayer.get(playerId);
      if (!prevLatest || apDate > prevLatest.date) latestClubByPlayer.set(playerId, { clubId: playerClubId, date: apDate });

      if (minutes >= DEFENSE_MIN_MINUTES) {
        const info = gameInfoById.get(gameId);
        if (info) {
          const conceded = playerClubId === info.homeId ? info.awayGoals
            : playerClubId === info.awayId ? info.homeGoals
              : null; // takım eşleşmedi (veri tutarsızlığı) — sayma
          if (conceded != null) {
            if (!defenseStats.has(playerId)) defenseStats.set(playerId, { conceded: 0, apps: 0 });
            const d = defenseStats.get(playerId);
            d.conceded += conceded; d.apps += 1;
          }
        }
      }

      // [GERÇEKÇİLİK DÜZELTMESİ v10] Şampiyon kulüpte oynanan dakika + CL/EL tur derinliği.
      if (championClubIds.has(playerClubId)) {
        championMinutesByPlayer.set(playerId, (championMinutesByPlayer.get(playerId) || 0) + minutes);
      }
      const cupRound = clubCupGameRound.get(gameId);
      if (cupRound) {
        const depth = roundDepthFor(cupRound);
        if (depth > (cupRoundDepthByPlayer.get(playerId) || 0)) cupRoundDepthByPlayer.set(playerId, depth);
      }
    } else {
      if (!tournamentStats.has(playerId)) tournamentStats.set(playerId, { goals: 0, assists: 0, apps: 0, maxRoundDepth: 0 });
      const s = tournamentStats.get(playerId);
      s.goals += goals; s.assists += assists; s.apps += 1;
      s.maxRoundDepth = Math.max(s.maxRoundDepth, roundDepthFor(tournamentGameRound.get(gameId)));
      tournamentRowCount++;
    }
  }
  console.log(`[etl] ${clubRowCount} kulüp performans satırı ${clubStats.size} hedef oyuncuya eşlendi`);
  console.log(`[etl] ${tournamentRowCount} turnuva performans satırı ${tournamentStats.size} hedef oyuncuya eşlendi`);
  console.log(`[etl] ${defenseStats.size} oyuncu için defansif sağlamlık verisi (60+ dk oynadığı maçlar) toplandı`);
  console.log(`[etl] ${championMinutesByPlayer.size} oyuncu şampiyon kulüpte dakika almış, ${cupRoundDepthByPlayer.size} oyuncu CL/EL'de oynamış`);
  console.log(`[etl] ${latestClubByPlayer.size} oyuncu için bu sezonki gerçek son kulüp bilgisi çıkarıldı`);
  return { clubStats, tournamentStats, defenseStats, championMinutesByPlayer, cupRoundDepthByPlayer, latestClubByPlayer };
}

// [GERÇEKÇİLİK DÜZELTMESİ v6] DF/GK için "gol atmasa da iyi oynamış" durumunu kısmen çözen
// defansif sağlamlık sinyali — oyuncu sahadayken takımının kaçtığı gol (bkz. loadPerformanceData
// `defenseStats`, DEFENSE_MIN_MINUTES). Kart cezası fikri BİLEREK kullanılmıyor (kullanıcı geri
// bildirimi: "forvet kart görmedi diye iyi oynamış mı olacak" — forvet için anlamsız/gürültü).
const DF_GOAL_WEIGHT = 0.25;
const DF_MINUTES_WEIGHT = 0.30;
const DF_DEFENSE_WEIGHT = 0.45;
const GK_MINUTES_WEIGHT = 0.5;
const GK_DEFENSE_WEIGHT = 0.5;

// defenseStats'tan (conceded/apps, düşük=iyi) grup içi bir "sağlamlık" yüzdelik dilimi çıkarır
// (yüksek çıktı = az gol yemiş = iyi). Veri yoksa NÖTR (0.5).
function defenseRanksFor(members, defenseStats) {
  const rows = members
    .filter((p) => defenseStats.has(p._playerId) && defenseStats.get(p._playerId).apps > 0)
    .map((p) => {
      const d = defenseStats.get(p._playerId);
      return { id: p._playerId, value: d.conceded / d.apps };
    });
  const concededRanks = percentileRanks(rows); // yüksek değer = çok gol yemiş
  const result = new Map();
  for (const p of members) {
    const r = concededRanks.get(p._playerId);
    result.set(p._playerId, r == null ? 0.5 : 1 - r); // ters çevir: az yemek iyi olsun
  }
  return result;
}

// [GERÇEKÇİLİK DÜZELTMESİ v9, KULLANICI GERİ BİLDİRİMİ: "rating sistemi hâlâ dengesiz"] — piyasa
// değeri sinyali (valueRank) v1'den beri TÜM POZİSYONLAR BİRLİKTE, TEK bir global yüzdelik
// dilimde hesaplanıyordu. Ama kaleci/defans piyasası, forvet/orta saha piyasasından YAPISAL
// OLARAK çok daha küçük (bu havuzda: kaleci medyan değeri 1.5M€/en pahalısı 45M€, forvette
// medyan 6M€/en pahalısı 200M€ — dünyanın en iyi kalecisi bile hiçbir zaman bir yıldız forvetle
// aynı EUR aralığına giremiyor). Sonuç: global piyasa yüzdelik dilimi kalecileri (ve bir ölçüde
// defansı) SİSTEMATİK olarak eziyordu — en iyi kaleci bile 83'ü geçemiyordu, forvet 99'a
// çıkabiliyordu (GK ort. 56.1 vs FW/MF ort. ~61.6). Performans sinyali zaten POZİSYON GRUBU
// içinde kıyaslanıyordu (bkz. altta computePerformanceRanks) — piyasa değeri sinyali bu
// tutarlılıkta DEĞİLDİ. Çözüm: computeValueRanks ile piyasa değeri de artık GK/DF/MF/FW
// grubunun KENDİ İÇİNDE karşılaştırılıyor — dünyanın en iyi kalecisi artık kendi pozisyonunun
// zirvesi olarak değerlendiriliyor, yıldız bir forvetle doğrudan EUR kıyaslamasına girmiyor.
function computeValueRanks(activePlayers) {
  const byGroup = new Map();
  for (const p of activePlayers) {
    const group = slotToGroup(p.position);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(p);
  }
  const valueRank = new Map();
  for (const [, members] of byGroup) {
    const rows = members.map((p) => ({ id: p._playerId, value: p.marketValueEUR }));
    const ranks = percentileRanks(rows);
    for (const p of members) valueRank.set(p._playerId, ranks.get(p._playerId) ?? 0.5);
  }
  return valueRank;
}

// [GERÇEKÇİLİK DÜZELTMESİ v13, KULLANICI GERİ BİLDİRİMİ: "Rafa Silva orta saha ama, orta saha
// için iyi bir sayı"] — "Second Striker" (İkinci Forvet) Transfermarkt'ta ST slotuna eşleniyor
// (bkz. SUB_POSITION_TO_SLOT — DİZİLİM/DRAFT için bu doğru: bir 4-4-2'de ikinci forvet olarak
// gerçekten ST slotunu dolduruyor, bu KALDI). Ama bu rol saf golcülükten çok daha yaratıcı/derin
// bir hibrit — Rafa Silva örneğinde doğrulandı: 11G+3A forvet havuzunda top %46 (sıradan) iken
// AYNI ORAN orta saha havuzunda top %8 (olağanüstü) çıkıyor. Çözüm: SADECE performans reytingi
// hesabında (dizilim/eligibleSlots'a DOKUNMADAN) "Second Striker" MF havuzuyla kıyaslanıyor —
// piyasa değeri kıyaslaması (computeValueRanks) BİLEREK değişmedi, çünkü transfer piyasası onu
// hâlâ bir "hücum oyuncusu" olarak fiyatlıyor, bu ayrı bir ekonomik gerçeklik.
function performanceGroupFor(p) {
  if (p.subPositionRaw === 'Second Striker') return 'MF';
  return slotToGroup(p.position);
}

// Performans skorunu POZİSYON GRUBU içinde yüzdelik dilime çevirir. Kaleciler için gol/asist
// anlamsız — dakika (düzenli forma giyme) + defansif sağlamlık kullanılıyor. DF için gol+asist,
// dakika ve defansif sağlamlık üçü birlikte; MF/FW'de sadece gol+asist (asist biraz daha düşük
// ağırlıklı) ile dakika. Bu sezon hiç maça çıkmamış/veri bulunamayan oyuncular NÖTR (0.5) alınır
// — veri eksikliği bir oyuncuyu cezalandırmasın, sadece o oyuncu için reyting fiilen piyasa
// değerine geri döner.
function computePerformanceRanks(activePlayers, statsByPlayer, defenseStats) {
  const byGroup = new Map();
  for (const p of activePlayers) {
    const group = performanceGroupFor(p);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(p);
  }

  const performanceRank = new Map();
  for (const [group, members] of byGroup) {
    const withStats = members.filter((p) => statsByPlayer.has(p._playerId));
    if (group === 'GK') {
      const rows = withStats.map((p) => ({ id: p._playerId, value: statsByPlayer.get(p._playerId).minutes }));
      const minuteRanks = percentileRanks(rows);
      const defRanks = defenseRanksFor(members, defenseStats);
      for (const p of members) {
        if (!statsByPlayer.has(p._playerId)) { performanceRank.set(p._playerId, 0.5); continue; }
        const m = minuteRanks.get(p._playerId) ?? 0.5;
        const d = defRanks.get(p._playerId) ?? 0.5;
        performanceRank.set(p._playerId, GK_MINUTES_WEIGHT * m + GK_DEFENSE_WEIGHT * d);
      }
      continue;
    }
    // [GERÇEKÇİLİK DÜZELTMESİ v5+v8] Gol+asist katkısı 90 dakika başına ORAN olarak (bkz. dosya
    // başı v8 notu — ham sayı kullanmak dakikayı çifte cezalandırıyordu), üretildiği ligin
    // gücüne göre hafifçe ölçekleniyor (bkz. LEAGUE_STRENGTH). GOAL_RATE_MIN_MINUTES altındaki
    // (küçük örneklem) oyuncular bu sıralamaya hiç girmiyor — NÖTR (0.5) kalır.
    const goalRows = withStats
      .filter((p) => statsByPlayer.get(p._playerId).minutes >= GOAL_RATE_MIN_MINUTES)
      .map((p) => {
        const s = statsByPlayer.get(p._playerId);
        const leagueFactor = LEAGUE_STRENGTH[p.leagueCode] ?? 1;
        const per90 = ((s.goals + 0.75 * s.assists) / s.minutes) * 90;
        return { id: p._playerId, value: per90 * leagueFactor };
      });
    const minuteRows = withStats.map((p) => ({ id: p._playerId, value: statsByPlayer.get(p._playerId).minutes }));
    const goalRanks = percentileRanks(goalRows);
    const minuteRanks = percentileRanks(minuteRows);
    // [GERÇEKÇİLİK DÜZELTMESİ v10] MF grubuna da (DF gibi, ama daha hafif) defansif sağlamlık
    // payı — DM/CM ağırlıklı bir orta saha oyuncusunun golü az olacağı için bu, onu haksız
    // yere aşağı çekmesin. FW'de YOK — bir santrforun işi savunmak değil.
    const defRanks = (group === 'DF' || group === 'MF') ? defenseRanksFor(members, defenseStats) : null;
    for (const p of members) {
      if (!statsByPlayer.has(p._playerId)) { performanceRank.set(p._playerId, 0.5); continue; }
      const g = goalRanks.get(p._playerId) ?? 0.5;
      const m = minuteRanks.get(p._playerId) ?? 0.5;
      if (group === 'DF') {
        const d = defRanks.get(p._playerId) ?? 0.5;
        performanceRank.set(p._playerId, DF_GOAL_WEIGHT * g + DF_MINUTES_WEIGHT * m + DF_DEFENSE_WEIGHT * d);
        continue;
      }
      if (group === 'MF') {
        // [GERÇEKÇİLİK DÜZELTMESİ v13] "Second Striker" (İkinci Forvet) burada SADECE gol-oranı
        // kıyaslama HAVUZU için MF'ye dahil edildi (bkz. performanceGroupFor) — gerçek bir orta
        // saha gibi geriye koşup savunma yapması beklenmez, bu yüzden DEFANS bileşenini almıyor
        // (FW'nin sade gol+dakika formülü kullanılıyor, ama MF havuzuna göre sıralanmış oranla).
        if (p.subPositionRaw === 'Second Striker') {
          performanceRank.set(p._playerId, GOAL_INVOLVEMENT_WEIGHT * g + MINUTES_WEIGHT * m);
          continue;
        }
        const d = defRanks.get(p._playerId) ?? 0.5;
        performanceRank.set(p._playerId, MF_GOAL_WEIGHT * g + MF_MINUTES_WEIGHT * m + MF_DEFENSE_WEIGHT * d);
        continue;
      }
      performanceRank.set(p._playerId, GOAL_INVOLVEMENT_WEIGHT * g + MINUTES_WEIGHT * m);
    }
  }
  return performanceRank;
}

async function main() {
  console.log('[etl] CSV dosyaları okunuyor...');
  const players = readCsv('players.csv');
  const clubs = readCsv('clubs.csv');
  const valuations = readCsv('player_valuations.csv');

  console.log(`[etl] players=${players.length} clubs=${clubs.length} valuations=${valuations.length}`);

  // Oyuncu bazında TÜM değerlendirme geçmişini topla — hem "kariyer zirvesi" (gösterim/referans,
  // bkz. players.json `peakValueEUR`) hem de reytingin PİYASA ayağı olan "son ~2 yıllık en
  // yüksek değer" (bkz. recentValueFor) buradan türetiliyor.
  const valuationsByPlayer = new Map();
  const maxValuationByPlayer = new Map();
  for (const v of valuations) {
    const pid = v.player_id;
    const val = Number(v.market_value_in_eur) || 0;
    if (val <= 0) continue;
    if (!valuationsByPlayer.has(pid)) valuationsByPlayer.set(pid, []);
    valuationsByPlayer.get(pid).push({ value: val, date: v.date || '' });
    const curMax = maxValuationByPlayer.get(pid) || 0;
    if (val > curMax) maxValuationByPlayer.set(pid, val);
  }

  // Oyuncunun kendi en güncel değerlendirme tarihinden geriye doğru ~2 yıllık pencheredeki EN
  // YÜKSEK değer — tek bir anlık düşüşe karşı yumuşatılmış ama hâlâ "bugünün" oyuncusunu
  // yansıtan (kariyer zirvesi DEĞİL) bir rakam.
  function recentValueFor(pid) {
    const rows = valuationsByPlayer.get(pid);
    if (!rows || rows.length === 0) return 0;
    const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const latestDate = sorted[sorted.length - 1].date;
    const cutoff = new Date(latestDate);
    cutoff.setDate(cutoff.getDate() - RECENT_VALUE_WINDOW_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const windowRows = sorted.filter((r) => r.date >= cutoffStr);
    const pool = windowRows.length ? windowRows : sorted.slice(-3); // pencere boşsa son birkaç değerlendirme
    return Math.max(...pool.map((r) => r.value));
  }

  // Aktiflik: veri setindeki en güncel last_season'a sahip olmak ("hâlâ aktif oynayan").
  let maxSeason = 0;
  for (const p of players) {
    const s = Number(p.last_season);
    if (Number.isFinite(s) && s > maxSeason) maxSeason = s;
  }
  console.log(`[etl] aktiflik eşiği: last_season === ${maxSeason}`);

  const filtered = [];
  for (const p of players) {
    const league = p.current_club_domestic_competition_id;
    if (!TARGET_LEAGUES[league]) continue;
    if (Number(p.last_season) !== maxSeason) continue;
    filtered.push(p);
  }
  console.log(`[etl] 6 lige + aktif filtresinden sonra: ${filtered.length} oyuncu`);

  const withValue = filtered.map((p) => {
    const fromPlayers = Number(p.highest_market_value_in_eur) || 0;
    const fromCurrent = Number(p.market_value_in_eur) || 0;
    const peakValueEUR = Math.max(fromPlayers, maxValuationByPlayer.get(p.player_id) || 0, fromCurrent);
    const recent = recentValueFor(p.player_id);
    const marketValueEUR = recent > 0 ? recent : fromCurrent;
    return { ...p, peakValueEUR, marketValueEUR };
  }).filter((p) => p.marketValueEUR > 0); // hiçbir değerlendirmesi olmayan oyuncuyu (veri kalitesi) at

  console.log(`[etl] güncel(yumuşatılmış) piyasa değeri olan oyuncu sayısı: ${withValue.length}`);

  // Reytingin PERFORMANS ayağı: bu sezonki gerçek gol/asist/dakika (bkz. dosya başı
  // [GERÇEKÇİLİK DÜZELTMESİ v3] notu) + büyük turnuva bonusu (bkz. v5 notu).
  const targetPlayerIds = new Set(withValue.map((p) => p.player_id));
  const {
    clubStats: statsByPlayer, tournamentStats, defenseStats, championMinutesByPlayer, cupRoundDepthByPlayer,
    latestClubByPlayer,
  } = await loadPerformanceData(targetPlayerIds, maxSeason);

  // --- Aktif oyuncu havuzunu oyun şemasına dönüştür (rating HENÜZ hesaplanmıyor — performans
  // sinyali pozisyon grubuna göre çalıştığı için önce TÜM oyuncuların pozisyonu belli olmalı). ---
  const clubById = new Map(clubs.map((c) => [c.club_id, c]));
  const activePlayers = [];
  let missingPositionCount = 0;

  for (const p of withValue) {
    let slot = SUB_POSITION_TO_SLOT[p.sub_position];
    if (!slot) slot = POSITION_TO_SLOT_FALLBACK[p.position];
    if (!slot) { missingPositionCount++; continue; }

    const manualSecondary = MANUAL_POSITIONS[p.player_code];
    const eligibleSlots = eligibleSlotsFor(slot, manualSecondary);

    // [GERÇEKÇİLİK DÜZELTMESİ v11, KULLANICI GERİ BİLDİRİMİ: "eski futbolcular gözüküyor
    // takımlarda, transferleri de güncelle"] — players.csv'nin statik current_club_id alanı
    // yerine, elimizdeyse bu sezonki GERÇEK son kulüp maçından çıkarılan kulüp kullanılıyor
    // (bkz. loadPerformanceData latestClubByPlayer). Yeni kulüp de hedef 6 ligden biriyse
    // (bir oyuncu Süper Lig'e/büyük-5'e transfer olduysa bu değişebilir) lig/ülke bilgisi de
    // buna göre güncelleniyor. Yeni kulüp 6 ligin DIŞINDAYSA (ör. başka bir kıtaya transfer)
    // BİLEREK üzerine yazılmıyor — o durumda players.csv'nin son bilinen değeri korunuyor
    // (agresif bir şekilde havuzdan düşürmek yerine daha güvenli/muhafazakâr bir seçim).
    let leagueCode = p.current_club_domestic_competition_id;
    let resolvedClub = clubById.get(p.current_club_id);
    const latest = latestClubByPlayer.get(p.player_id);
    if (latest) {
      const latestClub = clubById.get(latest.clubId);
      if (latestClub && TARGET_LEAGUES[latestClub.domestic_competition_id]) {
        resolvedClub = latestClub;
        leagueCode = latestClub.domestic_competition_id;
      }
    }
    const leagueInfo = TARGET_LEAGUES[leagueCode];
    const club = resolvedClub;
    const perf = statsByPlayer.get(p.player_id);
    const def = defenseStats.get(p.player_id);

    activePlayers.push({
      id: slugToId('tm', p.player_id),
      _playerId: p.player_id, // sadece ETL içi hesaplama için, çıktıya yazılmıyor (bkz. altta delete)
      name: p.name || `${p.first_name} ${p.last_name}`.trim(),
      nation: p.country_of_citizenship || null,
      dateOfBirth: p.date_of_birth ? p.date_of_birth.slice(0, 10) : null,
      foot: p.foot || null,
      heightCm: p.height_in_cm ? Number(p.height_in_cm) : null,
      club: club ? club.name : (p.current_club_name || null),
      league: leagueInfo.name,
      leagueCode,
      country: leagueInfo.country,
      position: slot,
      subPositionRaw: p.sub_position || null,
      eligibleSlots,
      marketValueEUR: p.marketValueEUR,
      peakValueEUR: p.peakValueEUR,
      // [KULLANICI İSTEĞİ] "10 gol 10 asist yapmış, çoğunlukla ilk 11 oynadı" gibi bağlamın
      // gösterim tarafı — oyuncu veritabanı sayfasında ("bir sayfaya oyuncuları öğrenmek için")
      // ileride bu sezonki katkıyı da göstermek mümkün olsun diye saklanıyor.
      seasonStats: perf ? {
        goals: perf.goals, assists: perf.assists, appearances: perf.apps, minutes: perf.minutes,
        // [KULLANICI İSTEĞİ] "gol atamamış olabilir ama iyi oynamıştır" — DF/GK için sahadayken
        // yenen gol (bkz. loadPerformanceData defenseStats); diğer pozisyonlarda null.
        concededWhileOnPitch: def ? def.conceded : null,
        concededApps: def ? def.apps : null,
      } : null,
      majorTournament: null, // altta [GERÇEKÇİLİK DÜZELTMESİ v5] adımında dolduruluyor
      clubAchievement: null, // altta [GERÇEKÇİLİK DÜZELTMESİ v10] adımında dolduruluyor
      isIcon: false,
      imageUrl: p.image_url || null,
      sourceUrl: p.url || null,
    });
  }

  if (missingPositionCount) {
    console.warn(`[etl] pozisyonu belirlenemeyen ${missingPositionCount} oyuncu havuz dışı bırakıldı`);
  }

  // Piyasa + performans ayaklarını harmanlayıp NİHAİ reytingi ata (bkz. VALUE_WEIGHT/
  // PERFORMANCE_WEIGHT) — eşleme artık doğrusal DEĞİL, `activeRatingCurve` (bkz. dosya başı
  // [GERÇEKÇİLİK DÜZELTMESİ v4] notu) ile sadece en tepeyi seçici tutuyor. Piyasa değeri de
  // (v9) artık pozisyon grubu İÇİNDE karşılaştırılıyor (bkz. computeValueRanks).
  const valueRank = computeValueRanks(activePlayers);
  const performanceRank = computePerformanceRanks(activePlayers, statsByPlayer, defenseStats);
  for (const p of activePlayers) {
    const v = valueRank.get(p._playerId) ?? 0.5;
    const perf = performanceRank.get(p._playerId) ?? 0.5;
    const blended = VALUE_WEIGHT * v + PERFORMANCE_WEIGHT * perf;
    const baseRating = activeRatingCurve(blended);

    // [GERÇEKÇİLİK DÜZELTMESİ v7] Kulüp performansının YANINA (yerine değil) küçük bir büyük
    // turnuva bonusu — katılım +1, gol+asist katkısı en fazla +3 (v5'teki +2 tavanı, iki farklı
    // katkı seviyesindeki oyuncuyu aynı sonuca sıkıştırdığı için gevşetildi), tur derinliği
    // (grup=0 ... final=4) en fazla +4 daha — toplam INTERNATIONAL_BONUS_MAX ile sınırlı.
    const tournament = tournamentStats.get(p._playerId);
    let bonus = 0;
    if (tournament && tournament.apps > 0) {
      const contrib = Math.min(3, tournament.goals + tournament.assists);
      bonus = Math.min(INTERNATIONAL_BONUS_MAX, 1 + contrib + tournament.maxRoundDepth);
    }
    p.rating = Math.min(RATING_CEIL, baseRating + bonus);
    p.majorTournament = tournament
      ? { goals: tournament.goals, assists: tournament.assists, appearances: tournament.apps, roundDepth: tournament.maxRoundDepth, bonus }
      : null;

    // [GERÇEKÇİLİK DÜZELTMESİ v10] Kulüp başarısı — bkz. dosya başı notu. Bireysel katkının
    // YANINA küçük bir ek: bu sezon lig şampiyonu bir kulüpte yeterli süre oynamış olmak (+3),
    // CL/EL'de ulaşılan tur derinliği (en fazla +3) — toplam CLUB_ACHIEVEMENT_BONUS_MAX ile
    // sınırlı.
    const championMinutes = championMinutesByPlayer.get(p._playerId) || 0;
    const isChampion = championMinutes >= LEAGUE_CHAMPION_MIN_MINUTES;
    const cupRoundDepth = cupRoundDepthByPlayer.get(p._playerId) || 0;
    const clubBonus = Math.min(
      CLUB_ACHIEVEMENT_BONUS_MAX,
      (isChampion ? LEAGUE_CHAMPION_BONUS : 0) + Math.min(CUP_ROUND_BONUS_MAX, cupRoundDepth),
    );
    if (clubBonus > 0) p.rating = Math.min(RATING_CEIL, p.rating + clubBonus);
    p.clubAchievement = (isChampion || cupRoundDepth > 0)
      ? { isLeagueChampion: isChampion, cupRoundDepth, bonus: clubBonus }
      : null;

    delete p._playerId;
  }

  // --- Icon oyuncuları işle ---
  let iconsRaw = [];
  try {
    iconsRaw = require('./iconNames');
  } catch (e) { iconsRaw = []; }
  let wikidataById = {};
  try {
    const wd = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'icons_wikidata.json'), 'utf8'));
    wikidataById = Object.fromEntries(wd.map((w) => [w.id, w]));
  } catch (e) {
    console.warn('[etl] icons_wikidata.json okunamadı, kariyer geçmişi olmadan devam ediliyor.');
  }

  // Efsane skorları KENDİ ölçeğinde (aktif havuzun piyasa değerinden BAĞIMSIZ) hesaplanır,
  // sonra doğrudan [ICON_RATING_FLOOR, ICON_RATING_CEIL] aralığına eşlenir — icon listesi zaten
  // küratörlü/elit bir liste olduğu için tabanı aktif havuzdan yüksek tutuluyor. Emekli
  // oyuncular için sezon performans verisi anlamlı değil, bu ayak sadece aktiflerde var.
  const scored = iconsRaw.map((icon) => {
    const a = ACHIEVEMENTS[icon.id];
    if (!a) return null;
    const score = legendScore(a);
    return { icon, achievements: a, score };
  }).filter(Boolean);

  const minScore = Math.min(...scored.map((s) => s.score));
  const maxScore = Math.max(...scored.map((s) => s.score));

  const iconPlayers = scored.map(({ icon, achievements, score }) => {
    const t = maxScore === minScore ? 1 : (score - minScore) / (maxScore - minScore);
    let rating = percentileToRating(t, ICON_RATING_FLOOR, ICON_RATING_CEIL);
    if (RATING_OVERRIDES[icon.id]) rating = RATING_OVERRIDES[icon.id];

    // BUG FIX: önceden burada ham `achievements.subPosition` ('Central Midfield' gibi)
    // doğrudan `position` alanına yazılıyordu. Draft motoru pozisyonları hep kısa slot
    // koduyla (CM, ST, GK...) sorguladığı için icon'lar hiçbir zaman draft havuzunda
    // görünmüyordu — aktif oyuncularla aynı SUB_POSITION_TO_SLOT eşlemesinden geçirilmesi
    // gerekiyordu (bkz. yukarıdaki aktif oyuncu işleme akışı).
    const slot = SUB_POSITION_TO_SLOT[achievements.subPosition];
    const eligibleSlots = eligibleSlotsFor(slot, null);
    const wd = wikidataById[icon.id];

    return {
      id: slugToId('icon', icon.id),
      name: icon.displayName,
      nation: icon.nation,
      dateOfBirth: null,
      foot: null,
      heightCm: null,
      club: 'Icon',
      league: 'Icon',
      leagueCode: 'ICON',
      country: icon.nation,
      position: slot,
      subPositionRaw: slot,
      eligibleSlots,
      rating,
      peakValueEUR: null,
      seasonStats: null,
      majorTournament: null,
      clubAchievement: null,
      legendScore: Math.round(score * 10) / 10,
      isIcon: true,
      imageUrl: null,
      sourceUrl: wd && wd.qid ? `https://www.wikidata.org/wiki/${wd.qid}` : null,
      careerHistory: wd ? wd.career : [],
    };
  });

  const missingAchievements = iconsRaw.filter((i) => !ACHIEVEMENTS[i.id]);
  if (missingAchievements.length) {
    console.warn('[etl] başarı verisi eksik icon oyuncular:', missingAchievements.map((m) => m.displayName));
  }

  const allPlayers = [...activePlayers, ...iconPlayers];

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — EA POLİTİKASI BİLEREK GERİ ALINDI] "Diğer büyük 5 ligi
  // de ekledim, onları da ekle" — Süper Lig'den sonra kullanıcı büyük 5 Avrupa ligi için de aynı
  // FC26 2026-27 reyting dosyalarını ekledi. Sadece eşleşen oyuncuların `rating`'i DEĞİŞTİRİLİR,
  // eşleşmeyenler kendi bağımsız formülümüzün ürettiği değeri korur (bkz. fc26RatingOverrides.js
  // dosya başı notu). Süper Lig dosyası Transfermarkt kulüp adlarının tutarsız yazımı yüzünden
  // (bazıları Türkçe karakterli, bazıları ASCII'ye düzleştirilmiş) elle bir `clubAliases`/
  // `nameAliases` tablosu gerektiriyor; diğer 5 ligin kulüp adları buna göre daha tutarlı olduğu
  // için genel "kulüp adı benzerliği" (fc26RatingOverrides.js `sameCoreClub`) yeterli.
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
  // [KULLANICI İSTEĞİ] "tamamla" — La Liga'nın eşleşme oranı diğer liglere göre belirgin düşüktü
  // (bkz. claude.md "FC26 Reyting Override'ı" notu): fcratings.com kaynaklı bu dosya İspanyol
  // futbolunda çok yaygın TEK KELİMELİK takma adlar kullanıyor (Vini Jr., Balde, Fermín, Carvajal,
  // Sancet, Cucho, Isi...) — bizim Transfermarkt kaynaklı havuzumuzdaki tam isimlerle otomatik
  // eşleşmiyordu. Her biri club-scoped bir aday araması + gerçek futbol bilgisiyle DOĞRULANARAK
  // (bkz. check_laliga.tmp.js — eşleştirme sonrası silindi) elle çözüldü; her alias globalde TEK
  // bir adaya çıkıyor (denendi/doğrulandı).
  const LA_LIGA_NAME_ALIASES = {
    'balde': 'alejandro balde',
    'fermin': 'fermin lopez',
    'vini jr': 'vinicius junior',
    'carvajal': 'daniel carvajal',
    'brahim': 'brahim diaz',
    'asencio': 'raul asencio',
    'gonzalo': 'gonzalo garcia',
    'pubill': 'marc pubill',
    'rodri mendoza': 'rodrigo mendoza',
    'moleiro': 'alberto moleiro',
    'ayoze': 'ayoze perez',
    'parejo': 'dani parejo',
    'pedraza': 'alfonso pedraza',
    'alfon': 'alfon gonzalez',
    'oyarzabal': 'mikel oyarzabal',
    'barrenetxea': 'ander barrenetxea',
    'zubeldia': 'igor zubeldia',
    'jon mikel aramburu': 'jon aramburu',
    'gorrotxa': 'jon gorrotxategi',
    'turrientes': 'benat turrientes',
    'odriozola': 'alvaro odriozola',
    'karrikaburu': 'jon karrikaburu',
    'frances': 'alejandro frances',
    'flavien enzo boyomo': 'enzo boyomo',
    'catena': 'alejandro catena',
    'moncayola': 'jon moncayola',
    'aitor': 'aitor fernandez',
    'herrando': 'jorge herrando',
    'osambela': 'asier osambela',
    'arguibide': 'inigo arguibide',
    'de frutos': 'jorge de frutos',
    'isi': 'isi palazon',
    'gumbau': 'gerard gumbau',
    'de las sias': 'marco de las sias',
    'gaya': 'jose gaya',
    'agirrezabala': 'julen agirrezabala',
    'copete': 'jose copete',
    'carmona': 'jose angel carmona',
    'akor jerome adams': 'akor adams',
    'peque': 'peque fernandez',
    'sivera': 'antonio sivera',
    'jonny': 'jonny otto',
    'pacheco': 'jon pacheco',
    'alena': 'carles alena',
    'guridi': 'jon guridi',
    'abderrahman rebbach': 'abde rebbach',
    'mariano': 'mariano diaz',
    'raillo': 'antonio raillo',
    'abdelkabir abqar': 'abdel abqar',
    'karl edouard etta eyong': 'karl etta eyong',
    'olasagasti': 'jon ander olasagasti',
    'dela': 'adrian dela',
    'morales': 'jose luis morales',
    'elgezabal': 'unai elgezabal',
    'bigas': 'pedro bigas',
    'valera': 'german valera',
    'alvaro': 'alvaro rodriguez',
    'mourad daoudi el ghezouani': 'mourad el ghezouani',
    'iturbe': 'alejandro iturbe',
    'aaron': 'aaron escandell',
  };
  const FC26_RATING_FILES = [
    { file: 'super_lig_2026_2027_fc26_reytingleri.md', label: 'Süper Lig', clubAliases: SUPER_LIG_CLUB_ALIASES, nameAliases: SUPER_LIG_NAME_ALIASES },
    { file: 'premier_league_2026_2027_fc26_reytingleri.md', label: 'Premier League' },
    { file: 'la_liga_2026_2027_fc26_reytingleri.md', label: 'La Liga', nameAliases: LA_LIGA_NAME_ALIASES },
    { file: 'bundesliga_2026_2027_fc26_reytingleri.md', label: 'Bundesliga' },
    { file: 'serie_a_2026_2027_fc26_reytingleri.md', label: 'Serie A' },
    { file: 'ligue_1_2026_2027_fc26_reytingleri.md', label: 'Ligue 1' },
  ];

  // [KULLANICI İSTEĞİ, "2026-2027 yılında yapılan transferleri uygula"] Önceki turlarda (v11)
  // sadece appearances.csv'den çıkarılan GERÇEK son maç verisi kulüp/lig alanını güncelliyordu —
  // bu, henüz yeni kulübü için hiç maça çıkmamış TAZE transferleri (ör. Ağustos 2026'da Beşiktaş'a
  // giden Trossard/Vlahovic/Nübel) yakalayamıyordu. Süper Lig FC26 dosyasındaki "Durum"/"Not"
  // kolonları (bkz. parseSuperLigOverrides.js) bu taze transferleri "🆕 Yeni transfer" + kaynak
  // kulüp olarak zaten taşıyor — burada bu bilgi SADECE reyting için değil, `club`/`league`/
  // `leagueCode`/`country` için de kullanılıyor. `transferLockedIds`: bir oyuncu Süper Lig
  // dosyasında (FC26_RATING_FILES sırasında hep İLK işlenen dosya) taze transfer olarak
  // işaretlenince, SONRAKİ dosyalarda (ör. Nübel'in eski kulübü Bayern'in bulunduğu Bundesliga
  // dosyası) o oyuncunun rating'i/kulübü ARTIK ezilmesin diye kilitleniyor — aksi halde "son
  // dosya kazanır" kuralı yeni transferin üstüne eski liginin verisini yazardı.
  let fc26TotalApplied = 0;
  let fc26TotalRows = 0;
  let fc26TransfersApplied = 0;
  const transferLockedIds = new Set();
  for (const cfg of FC26_RATING_FILES) {
    const mdPath = path.join(OUT_DIR, cfg.file);
    if (!fs.existsSync(mdPath)) { console.log(`[etl] FC26 override — ${cfg.label}: dosya bulunamadı (${cfg.file}), atlanıyor`); continue; }
    const { overrides, unmatched } = resolveFc26Overrides(allPlayers, mdPath, {
      clubAliases: cfg.clubAliases, nameAliases: cfg.nameAliases,
    });
    let applied = 0;
    for (const p of allPlayers) {
      const ov = overrides.get(p.id);
      if (!ov) continue;
      if (transferLockedIds.has(p.id)) continue; // zaten Süper Lig'e taze transfer olarak işaretlendi, eski liginin dosyası artık dokunmasın
      p.rating = Math.max(1, Math.min(99, Math.round(ov.rating)));
      p.ratingOverrideSource = 'fc26-2026-27'; // şeffaflık: bu reytingin kendi formülümüzden DEĞİL EA FC26'dan geldiğini işaretler
      applied++;

      const isNewTransfer = /Yeni transfer/.test(ov.durum || ''); // sadece Süper Lig dosyasında dolu olabilir, diğer 5 ligin dosyasında ov.durum hep '' — bu blok orada hiç tetiklenmez
      if (isNewTransfer) {
        const destClubName = (cfg.clubAliases && cfg.clubAliases[ov.team] && cfg.clubAliases[ov.team][0]) || ov.team;
        p.club = destClubName;
        p.league = 'Süper Lig';
        p.leagueCode = 'TR1';
        p.country = 'Türkiye';
        transferLockedIds.add(p.id);
        fc26TransfersApplied++;
        console.log(`[etl]   transfer uygulandı: ${p.name} -> ${ov.team}${(ov.not || '').trim() ? ` (${ov.not.trim()})` : ''}`);
      }
    }
    fc26TotalApplied += applied;
    fc26TotalRows += applied + unmatched.length;
    console.log(`[etl] FC26 override — ${cfg.label}: ${applied}/${applied + unmatched.length} oyuncu eşleşti, reytingleri FC26 değeriyle değiştirildi`);
    if (unmatched.length) {
      console.log(`[etl]   eşleşmeyen ${unmatched.length} oyuncu (havuzumuzda yok ya da isim belirsiz — kendi formülümüzün reytingini korur):`);
      for (const line of unmatched) console.log(`    - ${line}`);
    }
  }
  console.log(`[etl] FC26 override TOPLAM: ${fc26TotalApplied}/${fc26TotalRows} oyuncu eşleşti (6 dosya)`);
  console.log(`[etl] FC26 transfer TOPLAM: ${fc26TransfersApplied} oyuncunun kulüp/lig bilgisi "🆕 Yeni transfer" işaretine göre güncellendi`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    seasonSnapshot: maxSeason,
    ratingScale: {
      method: 'value+performance percentile blend, piecewise curve', // bkz. dosya başı [GERÇEKÇİLİK DÜZELTMESİ v4] notu
      activeMin: RATING_FLOOR, activeMax: RATING_CEIL,
      iconMin: ICON_RATING_FLOOR, iconMax: ICON_RATING_CEIL,
      valueWeight: VALUE_WEIGHT, performanceWeight: PERFORMANCE_WEIGHT,
      ratingAnchors: RATING_ANCHORS,
      recentValueWindowDays: RECENT_VALUE_WINDOW_DAYS,
    },
    counts: {
      active: activePlayers.length,
      icons: iconPlayers.length,
      total: allPlayers.length,
    },
    players: allPlayers,
  }, null, 2), 'utf8');

  console.log(`[etl] yazıldı -> ${OUT_FILE}`);
  console.log(`[etl] toplam oyuncu: ${allPlayers.length} (aktif: ${activePlayers.length}, icon: ${iconPlayers.length})`);

  // --- Özet istatistikler ---
  const byLeague = {};
  const ratingSumByLeague = {};
  for (const p of activePlayers) {
    byLeague[p.league] = (byLeague[p.league] || 0) + 1;
    ratingSumByLeague[p.league] = (ratingSumByLeague[p.league] || 0) + p.rating;
  }
  console.log('[etl] lige göre dağılım + ortalama reyting:');
  for (const lg of Object.keys(byLeague)) {
    console.log(`  ${lg}: n=${byLeague[lg]} ort=${(ratingSumByLeague[lg] / byLeague[lg]).toFixed(1)}`);
  }

  const top10Active = [...activePlayers].sort((a, b) => b.rating - a.rating).slice(0, 10);
  console.log('[etl] en yüksek reytingli 10 aktif oyuncu:');
  for (const p of top10Active) console.log(`  ${p.rating}  ${p.name} (${p.club}, ${p.position})`);

  const top10SuperLig = [...activePlayers].filter((p) => p.league === 'Süper Lig').sort((a, b) => b.rating - a.rating).slice(0, 10);
  console.log('[etl] en yüksek reytingli 10 Süper Lig oyuncusu:');
  for (const p of top10SuperLig) console.log(`  ${p.rating}  ${p.name} (${p.club}, ${p.position})`);

  const iconsSorted = [...iconPlayers].sort((a, b) => b.rating - a.rating);
  console.log('[etl] icon reyting sıralaması:');
  for (const p of iconsSorted) console.log(`  ${p.rating}  ${p.name} (${p.position}) [skor=${p.legendScore}]`);
}

main().catch((e) => { console.error('[etl] hata:', e); process.exit(1); });
