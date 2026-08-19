// N oyunculu maç fazını yönetir: her ikili arasında ev sahibi + deplasman (2 maç), ve tüm
// ikililer bitince bir puan tablosu (round-robin — bkz. doküman "Çok Oyunculu Mod" / "Maç fazı").
//
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — v3, "LİG USÜLÜ"] "Çoklu maçlarda her maç 3 puan,
// beraberlikler 1 puan olsun. Lig usülü olsun, n kişilik lig gibi. Ev ve deplasmanı kazanana
// (aggregate'i) 3 puan verme, her maç kendi başına 3 puan; ona göre 1. olan şampiyon olsun." —
// önceki iki tasarım da (v1: "berabere=1-1 puan + deplasman golü kuralıyla görsel galip", v2:
// "çift maçlı eleme — averaj berabereyse penaltı, galibiyet 3/mağlubiyet 0") kullanıcı isteğiyle
// TERK EDİLDİ (bkz. claude.md "Puan Tablosu 3-0 sorusu" — v2'ye dönülmüştü, şimdi o da
// bırakılıyor). v3'te bir fikstürdeki İKİ maç (ev+deplasman) ARTIK BİRBİRİNDEN BAĞIMSIZ birer
// lig maçı: her biri kendi başına normal futbol puanlamasıyla (galibiyet 3, beraberlik 1-1,
// mağlubiyet 0) puan tablosuna işleniyor — gerçek bir çift devreli lig (herkes herkesle 2 kez
// oynar) gibi. Artık averaj eşitliğinde penaltı YOK (bir lig maçı berabere bitebilir, bu
// sorun değil) — `penalties.js`/`simulateShootout` bu akışta kullanılmıyor (ileride bir
// knockout/kupa modu eklenirse diye dosya silinmedi).
const { simulateSingleMatch } = require('./simulate');
const { computeMatchRatings, scorerCountsFor } = require('./ratings');

// Tek bir maçın sonucuna göre normal futbol puanlaması (3 galibiyet / 1 beraberlik / 0 mağlubiyet).
function matchPoints(goalsHome, goalsAway) {
  if (goalsHome > goalsAway) return { pointsHome: 3, pointsAway: 0 };
  if (goalsHome < goalsAway) return { pointsHome: 0, pointsAway: 3 };
  return { pointsHome: 1, pointsAway: 1 };
}

/**
 * İki oyuncu arasındaki tam eşleşmeyi (ev sahibi + deplasman) oynatır. Her iki maç da KENDİ
 * BAŞINA puanlanır — aralarında bir "fikstür galibi" ya da penaltı YOK.
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

  const points1 = matchPoints(match1.goalsHome, match1.goalsAway); // home=pA, away=pB
  const points2 = matchPoints(match2.goalsHome, match2.goalsAway); // home=pB, away=pA

  // [KULLANICI İSTEĞİ] "Saha formatında oyuncuların performansını gösteren performans puanı
  // gözüksün" — her maç için, o maçta oynayan iki dizilimin oyuncu bazlı maç reytingleri
  // hesaplanır (bkz. ratings.js). Sonucu değiştirmez, sadece yorumlar.
  const match1LineupHome = computeMatchRatings(squadsA.home.lineup, match1.goalsHome, match1.goalsAway, scorerCountsFor(match1.events, 'home'));
  const match1LineupAway = computeMatchRatings(squadsB.away.lineup, match1.goalsAway, match1.goalsHome, scorerCountsFor(match1.events, 'away'));
  const match2LineupHome = computeMatchRatings(squadsB.home.lineup, match2.goalsHome, match2.goalsAway, scorerCountsFor(match2.events, 'home'));
  const match2LineupAway = computeMatchRatings(squadsA.away.lineup, match2.goalsAway, match2.goalsHome, scorerCountsFor(match2.events, 'away'));

  return {
    aClientId: pA.clientId,
    bClientId: pB.clientId,
    match1: {
      homeClientId: pA.clientId, awayClientId: pB.clientId,
      homeFormation: squadsA.home.formation, awayFormation: squadsB.away.formation,
      goalsHome: match1.goalsHome, goalsAway: match1.goalsAway,
      xgHome: match1.xgHome, xgAway: match1.xgAway,
      events: match1.events,
      lineupHome: match1LineupHome, lineupAway: match1LineupAway,
      pointsHome: points1.pointsHome, pointsAway: points1.pointsAway,
    },
    match2: {
      homeClientId: pB.clientId, awayClientId: pA.clientId,
      homeFormation: squadsB.home.formation, awayFormation: squadsA.away.formation,
      goalsHome: match2.goalsHome, goalsAway: match2.goalsAway,
      xgHome: match2.xgHome, xgAway: match2.xgAway,
      events: match2.events,
      lineupHome: match2LineupHome, lineupAway: match2LineupAway,
      pointsHome: points2.pointsHome, pointsAway: points2.pointsAway,
    },
    // Bilgi amaçlı — averaj/toplam gol (puan hesabında ARTIK kullanılmıyor, sadece "bu ikili
    // toplamda nasıl gitti" özetini göstermek için client'ta kullanılabilir).
    aggregate: {
      [pA.clientId]: match1.goalsHome + match2.goalsAway,
      [pB.clientId]: match1.goalsAway + match2.goalsHome,
    },
  };
}

/**
 * [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — "Maç fazı": draft bitince N oyuncu
 * round-robin (herkes herkesle ev+deplasman) oynar. Her maç KENDİ BAŞINA puanlanır (3/1/0) —
 * gerçek bir çift devreli lig gibi. Puan tablosu W-D-L (galibiyet-beraberlik-mağlubiyet)
 * sayaçları da taşıyor (gerçek bir lig tablosu formatı). N=2 için tek bir eşleşme (2 maç)
 * oynanır.
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
  const wins = {};
  const draws = {};
  const losses = {};
  const goalsFor = {};
  const goalsAgainst = {};
  for (const p of players) {
    points[p.clientId] = 0; wins[p.clientId] = 0; draws[p.clientId] = 0; losses[p.clientId] = 0;
    goalsFor[p.clientId] = 0; goalsAgainst[p.clientId] = 0;
  }

  // Bir tek maçın sonucunu puan tablosuna işler (W/D/L sayaçları + gol farkı dahil).
  function applyMatch(m) {
    points[m.homeClientId] += m.pointsHome;
    points[m.awayClientId] += m.pointsAway;
    goalsFor[m.homeClientId] += m.goalsHome; goalsAgainst[m.homeClientId] += m.goalsAway;
    goalsFor[m.awayClientId] += m.goalsAway; goalsAgainst[m.awayClientId] += m.goalsHome;
    if (m.pointsHome === 3) { wins[m.homeClientId] += 1; losses[m.awayClientId] += 1; }
    else if (m.pointsAway === 3) { wins[m.awayClientId] += 1; losses[m.homeClientId] += 1; }
    else { draws[m.homeClientId] += 1; draws[m.awayClientId] += 1; }
  }

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const pA = players[i];
      const pB = players[j];
      const fixture = playPairFixture(pA, pB, room.squads[pA.clientId], room.squads[pB.clientId]);
      fixtures.push(fixture);
      applyMatch(fixture.match1);
      applyMatch(fixture.match2);
    }
  }

  const standings = players.map((p) => ({
    clientId: p.clientId,
    name: p.name,
    played: wins[p.clientId] + draws[p.clientId] + losses[p.clientId],
    wins: wins[p.clientId],
    draws: draws[p.clientId],
    losses: losses[p.clientId],
    points: points[p.clientId],
    goalsFor: goalsFor[p.clientId],
    goalsAgainst: goalsAgainst[p.clientId],
    goalDiff: goalsFor[p.clientId] - goalsAgainst[p.clientId],
  })).sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);

  return {
    fixtures,
    standings,
    winnerClientId: standings[0].clientId, // lig şampiyonu — puan tablosunun 1.si
  };
}

module.exports = { playRoundRobin, playPairFixture };
