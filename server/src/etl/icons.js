// Icon oyuncular için elle küratörlü başarı verisi + bağımsız "efsane skoru" formülü.
//
// ÖNEMLİ: Bu tablodaki sayılar (Ballon d'Or, şampiyonluk, gol/maç) kamuya açık, herkesçe
// bilinen kariyer istatistikleridir (Wikipedia/Wikidata/FIFA arşivleri gibi kaynaklarla
// çapraz kontrol edilebilir) — EA FC/FIFA oyunundaki reytingler DEĞİLDİR, oradan hiçbir
// sayı kopyalanmamıştır. Reyting, aşağıdaki formülle bu başarı verisinden bağımsız olarak
// türetilir (bkz. AUCTION-GAME-CLAUDE.md "Reyting Sistemi"). Küçük tarihsel sapmalar
// (ör. bir-iki gol/maç farkı, kaynağa göre değişen sayılar) olası ve kabul edilebilir —
// bu bir istatistik arşivi değil, oyun içi güç dengesi için bir yaklaşıklıktır. Kullanıcı
// gerekirse tekil isimler için reytingi elle düzeltebilir (bkz. RATING_OVERRIDES).
//
// Alanlar:
//   ballonDor            : Ballon d'Or (veya FIFA World Player benzeri en üst bireysel ödül) sayısı
//   worldCupWins         : Dünya Kupası şampiyonluğu
//   continentalIntlWins  : Kıtasal milli takım şampiyonluğu (Euro / Copa América)
//   clubContinentalWins  : Kıtasal kulüp şampiyonluğu (Avrupa Şampiyon Kulüpler Kupası/UEFA
//                          Şampiyonlar Ligi, Copa Libertadores) — en üst seviye
//   minorClubContinental : İkincil kıtasal kulüp kupası (UEFA Kupası/Europa League vb.)
//   majorIndividualHonor : Diğer büyük bireysel onur (ör. "FIFA Yüzyılın Futbolcusu") — 0/1
//   intlCaps / intlGoals : Milli takım maç/gol sayısı (kariyer uzunluğu/etkisi göstergesi)
//   subPosition/position : Draft/formasyon sistemine entegrasyon için pozisyon ataması

const ACHIEVEMENTS = {
  // --- Türkiye (9) — domestik efsaneler, uluslararası kulüp/milli takım kupası azınlıkta ---
  'rustu-recber':          { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 120, intlGoals: 0,  subPosition: 'Goalkeeper',        position: 'Goalkeeper' },
  'emre-belozoglu':        { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 115, intlGoals: 9,  subPosition: 'Central Midfield',  position: 'Midfield' },
  'arda-turan':             { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 100, intlGoals: 22, subPosition: 'Attacking Midfield',position: 'Midfield' },
  'tuncay-sanli':           { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 52,  intlGoals: 22, subPosition: 'Centre-Forward',    position: 'Attack' },
  'alex-de-souza':          { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 13,  intlGoals: 3,  subPosition: 'Attacking Midfield',position: 'Midfield' },
  'lefter-kucukandonyadis':{ ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 50,  intlGoals: 27, subPosition: 'Left Winger',       position: 'Attack' },
  'metin-oktay':            { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 41,  intlGoals: 19, subPosition: 'Centre-Forward',    position: 'Attack' },
  'senol-gunes':            { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 57,  intlGoals: 0,  subPosition: 'Goalkeeper',        position: 'Goalkeeper' },
  'sergen-yalcin':          { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 55,  intlGoals: 15, subPosition: 'Attacking Midfield',position: 'Midfield' },

  // --- Dünya (29) ---
  'pele':                   { ballonDor: 0, worldCupWins: 3, continentalIntlWins: 0, clubContinentalWins: 2, minorClubContinental: 0, majorIndividualHonor: 1, intlCaps: 92,  intlGoals: 77, subPosition: 'Centre-Forward',    position: 'Attack' },
  'diego-maradona':         { ballonDor: 0, worldCupWins: 1, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 1, majorIndividualHonor: 1, intlCaps: 91,  intlGoals: 34, subPosition: 'Attacking Midfield',position: 'Midfield' },
  'johan-cruyff':            { ballonDor: 3, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 3, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 48,  intlGoals: 33, subPosition: 'Centre-Forward',    position: 'Attack' },
  'franz-beckenbauer':       { ballonDor: 2, worldCupWins: 1, continentalIntlWins: 1, clubContinentalWins: 3, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 103, intlGoals: 14, subPosition: 'Centre-Back',       position: 'Defender' },
  'ferenc-puskas':           { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 3, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 85,  intlGoals: 84, subPosition: 'Centre-Forward',    position: 'Attack' },
  'alfredo-di-stefano':      { ballonDor: 2, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 5, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 31,  intlGoals: 23, subPosition: 'Centre-Forward',    position: 'Attack' },
  'eusebio':                 { ballonDor: 1, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 64,  intlGoals: 41, subPosition: 'Centre-Forward',    position: 'Attack' },
  'garrincha':                { ballonDor: 0, worldCupWins: 2, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 50,  intlGoals: 12, subPosition: 'Right Winger',      position: 'Attack' },
  'zinedine-zidane':          { ballonDor: 1, worldCupWins: 1, continentalIntlWins: 1, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 108, intlGoals: 31, subPosition: 'Attacking Midfield',position: 'Midfield' },
  'ronaldo-nazario':          { ballonDor: 2, worldCupWins: 2, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 1, majorIndividualHonor: 0, intlCaps: 98,  intlGoals: 62, subPosition: 'Centre-Forward',    position: 'Attack' },
  'ronaldinho':                { ballonDor: 1, worldCupWins: 1, continentalIntlWins: 0, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 97,  intlGoals: 33, subPosition: 'Attacking Midfield',position: 'Midfield' },
  'roberto-baggio':           { ballonDor: 1, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 0, minorClubContinental: 1, majorIndividualHonor: 0, intlCaps: 56,  intlGoals: 27, subPosition: 'Second Striker',    position: 'Attack' },
  'paolo-maldini':            { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 5, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 126, intlGoals: 7,  subPosition: 'Left-Back',         position: 'Defender' },
  'franco-baresi':            { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 3, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 81,  intlGoals: 1,  subPosition: 'Centre-Back',       position: 'Defender' },
  'xavi-hernandez':           { ballonDor: 0, worldCupWins: 1, continentalIntlWins: 2, clubContinentalWins: 4, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 133, intlGoals: 13, subPosition: 'Central Midfield',  position: 'Midfield' },
  'andres-iniesta':           { ballonDor: 0, worldCupWins: 1, continentalIntlWins: 2, clubContinentalWins: 4, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 131, intlGoals: 14, subPosition: 'Central Midfield',  position: 'Midfield' },
  'thierry-henry':            { ballonDor: 0, worldCupWins: 1, continentalIntlWins: 1, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 123, intlGoals: 51, subPosition: 'Centre-Forward',    position: 'Attack' },
  'george-best':              { ballonDor: 1, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 37,  intlGoals: 9,  subPosition: 'Right Winger',      position: 'Attack' },
  'michel-platini':           { ballonDor: 3, worldCupWins: 0, continentalIntlWins: 1, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 72,  intlGoals: 41, subPosition: 'Attacking Midfield',position: 'Midfield' },
  'marco-van-basten':          { ballonDor: 3, worldCupWins: 0, continentalIntlWins: 1, clubContinentalWins: 3, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 58,  intlGoals: 24, subPosition: 'Centre-Forward',    position: 'Attack' },
  'ruud-gullit':               { ballonDor: 1, worldCupWins: 0, continentalIntlWins: 1, clubContinentalWins: 2, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 66,  intlGoals: 17, subPosition: 'Attacking Midfield',position: 'Midfield' },
  'lothar-matthaus':           { ballonDor: 1, worldCupWins: 1, continentalIntlWins: 1, clubContinentalWins: 0, minorClubContinental: 1, majorIndividualHonor: 0, intlCaps: 150, intlGoals: 23, subPosition: 'Central Midfield',  position: 'Midfield' },
  'gerd-muller':               { ballonDor: 1, worldCupWins: 1, continentalIntlWins: 1, clubContinentalWins: 3, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 62,  intlGoals: 68, subPosition: 'Centre-Forward',    position: 'Attack' },
  'bobby-charlton':            { ballonDor: 1, worldCupWins: 1, continentalIntlWins: 0, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 106, intlGoals: 49, subPosition: 'Central Midfield',  position: 'Midfield' },
  'andrea-pirlo':              { ballonDor: 0, worldCupWins: 1, continentalIntlWins: 0, clubContinentalWins: 2, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 116, intlGoals: 13, subPosition: 'Defensive Midfield',position: 'Midfield' },
  'didier-drogba':             { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 105, intlGoals: 65, subPosition: 'Centre-Forward',    position: 'Attack' },
  'iker-casillas':             { ballonDor: 0, worldCupWins: 1, continentalIntlWins: 2, clubContinentalWins: 3, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 167, intlGoals: 0,  subPosition: 'Goalkeeper',        position: 'Goalkeeper' },
  'rivaldo':                    { ballonDor: 1, worldCupWins: 1, continentalIntlWins: 0, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 74,  intlGoals: 35, subPosition: 'Left Winger',       position: 'Attack' },
  'david-beckham':              { ballonDor: 0, worldCupWins: 0, continentalIntlWins: 0, clubContinentalWins: 1, minorClubContinental: 0, majorIndividualHonor: 0, intlCaps: 115, intlGoals: 17, subPosition: 'Right Midfield',    position: 'Midfield' },
};

// Bağımsız "efsane skoru" formülü — EA FC/FIFA reytingleriyle hiçbir bağlantısı yok.
// Ağırlıklar, futbol tarihi genel kabulüne göre (Dünya Kupası ve Ballon d'Or en üst
// ağırlıklı bireysel/kolektif başarılar) elle ayarlanmıştır.
function legendScore(a) {
  const BASE = 35; // 38 kişilik küratörlü "tüm zamanların efsaneleri" listesine girmiş olmanın taban puanı
  return (
    BASE +
    18 * a.ballonDor +
    25 * a.worldCupWins +
    15 * a.continentalIntlWins +
    8 * a.clubContinentalWins +
    4 * a.minorClubContinental +
    20 * a.majorIndividualHonor +
    0.06 * a.intlGoals +
    0.02 * a.intlCaps
  );
}

// İsteğe bağlı elle reyting düzeltmeleri (bkz. AUCTION-GAME-CLAUDE.md: "Gerekirse kullanıcı
// belirli isimler için reytingi elle düzeltebilir"). Şu an için boş — hesaplanan otomatik
// reyting kullanılıyor.
const RATING_OVERRIDES = {};

module.exports = { ACHIEVEMENTS, legendScore, RATING_OVERRIDES };
