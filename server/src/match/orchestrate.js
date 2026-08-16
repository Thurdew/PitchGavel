// N oyunculu maç fazını yönetir: her ikili arasında ev sahibi + deplasman (2 maç), gerekirse
// penaltı atışları (bkz. doküman "Maç Simülasyonu" ve "Maç formatı"), ve tüm ikililer bitince
// bir puan tablosu (round-robin — bkz. doküman "Çok Oyunculu Mod" / "Maç fazı").
// [KULLANICI İSTEĞİ — DEĞİŞTİRİLDİ, GERİ ALINDI] Bir turda hem "berabere = 1-1 puan + deplasman
// golü kuralıyla görsel galip" denendi hem de bundan hemen sonra "boşver, çift maçlı eleme
// (Şampiyonlar Ligi tarzı) gibi olsun, deplasman golü kuralı yok artık [gerçek futbolda da UEFA
// 2021'de kaldırdı], averaj berabereyse penaltılar gitsin" denilerek ORİJİNAL penaltı-tabanlı
// tasarıma dönüldü — puan tablosunda beraberlik YOK, her fikstür kesin bir galip üretir.
const { simulateSingleMatch } = require('./simulate');
const { simulateShootout, lineupGkRating } = require('./penalties');
const { computeMatchRatings, scorerCountsFor } = require('./ratings');

/**
 * İki oyuncu arasındaki tam eşleşmeyi (ev sahibi + deplasman, gerekirse penaltı) oynatır.
 * squadsA/squadsB: room.squads[clientId] = { home: {formation, lineup, style, tactic}, away: {...} }
 */
function playPairFixture(pA, pB, squadsA, squadsB) {
  // [KULLANICI İSTEĞİ] "Kadro diziliminde agresif/sakin oyna, atak/dengeli/defansif oyna gibi
  // seçenekler gelsin" — her taraf, o maça özel seçtiği stil/taktiği (lineup:submit ile
  // birlikte kaydedilir, bkz. lineupSockets.js) simülasyona taşır. Eksikse (eski/varsayılan)
  // 'normal'/'balanced' kullanılır — davranış değişmez.
  // Maç 1: A ev sahibi (A'nın "home" dizilimi) vs B deplasman (B'nin "away" dizilimi)
  const match1 = simulateSingleMatch(squadsA.home.lineup, squadsB.away.lineup, {
    styleHome: squadsA.home.style, styleAway: squadsB.away.style,
    tacticHome: squadsA.home.tactic, tacticAway: squadsB.away.tactic,
  });
  // Maç 2: B ev sahibi (B'nin "home" dizilimi) vs A deplasman (A'nın "away" dizilimi)
  const match2 = simulateSingleMatch(squadsB.home.lineup, squadsA.away.lineup, {
    styleHome: squadsB.home.style, styleAway: squadsA.away.style,
    tacticHome: squadsB.home.tactic, tacticAway: squadsA.away.tactic,
  });

  const totalA = match1.goalsHome + match2.goalsAway;
  const totalB = match1.goalsAway + match2.goalsHome;

  // [KULLANICI İSTEĞİ] "Saha formatında oyuncuların performansını gösteren performans puanı
  // gözüksün" — her maç için, o maçta oynayan iki dizilimin oyuncu bazlı maç reytingleri
  // hesaplanır (bkz. ratings.js). Sonucu değiştirmez, sadece yorumlar.
  const match1LineupHome = computeMatchRatings(squadsA.home.lineup, match1.goalsHome, match1.goalsAway, scorerCountsFor(match1.events, 'home'));
  const match1LineupAway = computeMatchRatings(squadsB.away.lineup, match1.goalsAway, match1.goalsHome, scorerCountsFor(match1.events, 'away'));
  const match2LineupHome = computeMatchRatings(squadsB.home.lineup, match2.goalsHome, match2.goalsAway, scorerCountsFor(match2.events, 'home'));
  const match2LineupAway = computeMatchRatings(squadsA.away.lineup, match2.goalsAway, match2.goalsHome, scorerCountsFor(match2.events, 'away'));

  const fixture = {
    aClientId: pA.clientId,
    bClientId: pB.clientId,
    match1: {
      homeClientId: pA.clientId, awayClientId: pB.clientId,
      homeFormation: squadsA.home.formation, awayFormation: squadsB.away.formation,
      goalsHome: match1.goalsHome, goalsAway: match1.goalsAway,
      xgHome: match1.xgHome, xgAway: match1.xgAway,
      events: match1.events,
      lineupHome: match1LineupHome, lineupAway: match1LineupAway,
    },
    match2: {
      homeClientId: pB.clientId, awayClientId: pA.clientId,
      homeFormation: squadsB.home.formation, awayFormation: squadsA.away.formation,
      goalsHome: match2.goalsHome, goalsAway: match2.goalsAway,
      xgHome: match2.xgHome, xgAway: match2.xgAway,
      events: match2.events,
      lineupHome: match2LineupHome, lineupAway: match2LineupAway,
    },
    aggregate: { [pA.clientId]: totalA, [pB.clientId]: totalB },
    winnerClientId: null,
    wentToPenalties: false,
    penalties: null,
  };

  if (totalA === totalB) {
    // Berabere: penaltı atışları (bkz. gameConfig PENALTY_SAVE_MIN/MAX). Her kullanıcının
    // "home" dizilimindeki kalecisi tiebreaker'da kendi takımını temsil eder (iki ayrı maç
    // farklı kaleci kullanmış olabilir; dokümanda bu ayrım netleşmemiş, makul bir varsayım).
    const gkA = lineupGkRating(squadsA.home.lineup);
    const gkB = lineupGkRating(squadsB.home.lineup);
    const shootout = simulateShootout({ gkRating: gkA }, { gkRating: gkB });
    fixture.wentToPenalties = true;
    fixture.penalties = shootout;
    fixture.winnerClientId = shootout.winner === 'A' ? pA.clientId : pB.clientId;
  } else {
    fixture.winnerClientId = totalA > totalB ? pA.clientId : pB.clientId;
  }

  return fixture;
}

/**
 * [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — "Maç fazı": draft bitince N oyuncu
 * round-robin (herkes herkesle ev+deplasman) oynar; mevcut pairwise playPairFixture AYNEN
 * reuse edilir, üstüne bir puan tablosu (standings) eklenir. Beraberlik puan tablosunda hiç
 * oluşmaz — her eşleşme averaj eşitliğinde bile penaltılarla kesin bir kazanan üretir (bkz.
 * playPairFixture), bu yüzden galibiyet 3 puan / mağlubiyet 0 puan yeterli.
 * N=2 için tek bir eşleşme oynanır — eski 1v1 davranışıyla puan/sonuç bazında birebir aynı,
 * sadece dönen şekil {fixtures, standings} olarak genellendi.
 */
function playRoundRobin(room) {
  const players = room.players;
  if (players.length < 2) return { error: 'NOT_ENOUGH_PLAYERS' };

  for (const p of players) {
    const s = room.squads[p.clientId];
    if (!s || !s.home || !s.away) return { error: 'LINEUPS_NOT_READY' };
  }

  const fixtures = [];
  const points = {};
  const goalsFor = {};
  const goalsAgainst = {};
  for (const p of players) { points[p.clientId] = 0; goalsFor[p.clientId] = 0; goalsAgainst[p.clientId] = 0; }

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const pA = players[i];
      const pB = players[j];
      const fixture = playPairFixture(pA, pB, room.squads[pA.clientId], room.squads[pB.clientId]);
      fixtures.push(fixture);

      const totalA = fixture.aggregate[pA.clientId];
      const totalB = fixture.aggregate[pB.clientId];
      goalsFor[pA.clientId] += totalA; goalsAgainst[pA.clientId] += totalB;
      goalsFor[pB.clientId] += totalB; goalsAgainst[pB.clientId] += totalA;
      points[fixture.winnerClientId] += 3;
    }
  }

  const standings = players.map((p) => ({
    clientId: p.clientId,
    name: p.name,
    points: points[p.clientId],
    goalsFor: goalsFor[p.clientId],
    goalsAgainst: goalsAgainst[p.clientId],
    goalDiff: goalsFor[p.clientId] - goalsAgainst[p.clientId],
  })).sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);

  return {
    fixtures,
    standings,
    winnerClientId: standings[0].clientId,
  };
}

module.exports = { playRoundRobin, playPairFixture };
