// Faz 6 doğrulama scripti: Çok Oyunculu Mod (N=4) uçtan uca — ortak havuzda canlı draft
// (yedek merdiveni dahil), dizilim seçimi, ve round-robin maç fazı (herkes herkesle
// ev+deplasman + puan tablosu). bkz. claude.md "Çok Oyunculu Mod (N ≤ 8)".
process.env.DRAFT_AUCTION_SECONDS = process.env.DRAFT_AUCTION_SECONDS || '1';
process.env.DRAFT_ROUND_DELAY_MS = process.env.DRAFT_ROUND_DELAY_MS || '250';
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = process.env.DRAFT_ANTI_SNIPE_WINDOW_MS || '350';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS || '350';

const { server, io, roomManager } = require('../src/index');
const { io: ioClient } = require('socket.io-client');
const { SQUAD_SIZE, MIN_PLAYER_PRICE, MAX_ROOM_PLAYERS } = require('../src/shared/gameConfig');

const PORT = 3995;
const N = 4;

function connect() { return ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] }); }
function once(socket, event) { return new Promise((resolve) => socket.once(event, resolve)); }
function emitAck(socket, event, payload) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kullanıcı oynayacağını lobide sorma, kaç kişi
// gelirse gelsin" — host'a hedef bir sayı sorulmuyor; oda sadece MAX_ROOM_PLAYERS (8) tavanına
// kadar katılım kabul eder. Bu, ana N=4 akışından bağımsız, kendi odasıyla test edilir.
async function testCapacityCap() {
  const capSockets = Array.from({ length: MAX_ROOM_PLAYERS }, () => connect());
  await Promise.all(capSockets.map((s) => once(s, 'connect')));

  const created = await emitAck(capSockets[0], 'room:create', { clientId: 'cap-0', name: 'Cap0' });
  let ok = created.room.maxPlayers === MAX_ROOM_PLAYERS;
  console.assert(ok, `oda tavanı ${MAX_ROOM_PLAYERS} olmalı: ${created.room.maxPlayers}`);
  const code = created.room.code;

  for (let i = 1; i < MAX_ROOM_PLAYERS; i++) {
    const joined = await emitAck(capSockets[i], 'room:join', { clientId: `cap-${i}`, name: `Cap${i}`, code });
    if (joined.error) ok = false;
    console.assert(!joined.error, `cap-${i} katılabilmeli: ${JSON.stringify(joined.error)}`);
  }

  const extra = connect();
  await once(extra, 'connect');
  const rejected = await emitAck(extra, 'room:join', { clientId: 'cap-extra', name: 'Fazla', code });
  ok = ok && rejected.error === 'ROOM_FULL';
  console.assert(rejected.error === 'ROOM_FULL', `${MAX_ROOM_PLAYERS + 1}. kişi ROOM_FULL ile reddedilmeli: ` + JSON.stringify(rejected));
  console.log(`[test6] kapasite tavanı (${MAX_ROOM_PLAYERS}) doğru uygulanıyor:`, ok);

  extra.close();
  for (const s of capSockets) s.close();
  return ok;
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test6] sunucu ayakta, port', PORT);

  const capacityOk = await testCapacityCap();

  const ids = Array.from({ length: N }, (_, i) => `mp-player-${i}`);
  const sockets = Array.from({ length: N }, () => connect());
  await Promise.all(sockets.map((s) => once(s, 'connect')));

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] room:create artık bir hedef oyuncu sayısı almıyor —
  // odayı kuran sockets[0] otomatik olarak hostClientId olur (bkz. RoomManager.createRoom).
  const created = await emitAck(sockets[0], 'room:create', { clientId: ids[0], name: 'P0' });
  const code = created.room.code;
  console.assert(created.room.hostClientId === ids[0], 'odayı kuran host olmalı: ' + created.room.hostClientId);
  for (let i = 1; i < N; i++) {
    const joined = await emitAck(sockets[i], 'room:join', { clientId: ids[i], name: `P${i}`, code });
    console.assert(!joined.error, `P${i} odaya katılabilmeli: ${JSON.stringify(joined.error)}`);
  }
  console.log('[test6] oda hazır:', code, `(${N} kişilik, host: ${created.room.hostClientId})`);

  let latestDraftUpdate = null;
  let completeEvents = 0;
  let ladderRoundsSeen = 0; // participantIds.length > 2 olan en az bir tur görülmeli
  let biddingErrors = [];

  function onUpdate(msg) {
    latestDraftUpdate = msg;
    if (msg.round && msg.round.kind === 'auction' && (msg.round.participantIds || []).length > 2) {
      ladderRoundsSeen++;
    }
  }
  for (const s of sockets) { s.on('draft:update', onUpdate); s.on('draft:complete', () => completeEvents++); }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Herkes hazır verdikten sonra oda sahibi başlatsın" —
  // host olmayan biri başlatmaya çalışırsa reddedilmeli; tüm N oyuncu "hazırım" dedikten sonra
  // SADECE host (sockets[0]) draft:start ile fiilen başlatabilir.
  const nonHostStart = await emitAck(sockets[1], 'draft:start', { code });
  console.assert(nonHostStart.error === 'ONLY_HOST_CAN_START', 'host olmayan draftı başlatamamalı: ' + JSON.stringify(nonHostStart));
  for (let i = 0; i < N; i++) {
    const r = await emitAck(sockets[i], 'draft:readyToggle', { code });
    console.assert(r.ok && r.ready, `${i}. oyuncu hazırım diyebilmeli: ${JSON.stringify(r)}`);
  }
  const startRes = await emitAck(sockets[0], 'draft:start', { code });
  console.assert(startRes.ok, 'herkes hazır olunca host draftı başlatabilmeli: ' + JSON.stringify(startRes));
  console.log('[test6] draft başladı');

  // Oto-teklif: her round update'inde, o turun katılımcıları (round.participantIds) kendi
  // kişisel tavanları dahilinde rastgele teklif versin.
  let lastBidRoundKey = null;
  async function autoBidTick() {
    if (!latestDraftUpdate || !latestDraftUpdate.round) return;
    const round = latestDraftUpdate.round;
    if (round.kind !== 'auction') return;
    const roundKey = round.main.id + '@' + round.deadline;
    if (roundKey === lastBidRoundKey) return;
    lastBidRoundKey = roundKey;

    for (let i = 0; i < N; i++) {
      if (!round.participantIds.includes(ids[i])) continue; // sadece bu turun katılımcıları teklif verebilir
      if (Math.random() < 0.85) {
        const amount = MIN_PLAYER_PRICE + Math.floor(Math.random() * 20);
        const res = await emitAck(sockets[i], 'draft:bid', { code, amount });
        if (res.error && res.error !== 'BID_TOO_LOW' && res.error !== 'AUCTION_CLOSED') {
          biddingErrors.push(res.error);
        }
      }
    }
  }

  const started = Date.now();
  const TIMEOUT_MS = 120_000;
  while (completeEvents < N && Date.now() - started < TIMEOUT_MS) {
    await autoBidTick();
    await new Promise((r) => setTimeout(r, 120));
  }

  console.assert(completeEvents >= 1, 'draft:complete en az bir kez gelmeli');
  console.log('[test6] draft tamamlandı, complete event sayısı:', completeEvents);
  console.log('[test6] beklenmeyen teklif hataları:', biddingErrors);
  console.assert(ladderRoundsSeen > 0, '4 kişilik oda, en az bir turda 2den fazla katılımcı (yedek merdiveni) görmeli');
  console.log('[test6] >2 katılımcılı (merdivenli) tur sayısı:', ladderRoundsSeen);

  const room = roomManager.getRoom(code);
  console.log('[test6] formasyon:', room.formation, 'status:', room.status);
  const allSquadIds = new Set();
  let overlapFound = false;
  for (const p of room.players) {
    console.log(`[test6] ${p.name}: kadro=${p.squad.length}/${SQUAD_SIZE} bütçe kalan=${p.budget}`);
    console.assert(p.squad.length === SQUAD_SIZE, `${p.name} kadrosu tam 11 olmalı, oldu: ${p.squad.length}`);
    console.assert(p.budget >= 0, `${p.name} bütçesi negatif olamaz, oldu: ${p.budget}`);
    const ids2 = new Set(p.squad.map((s) => s.player.id));
    console.assert(ids2.size === p.squad.length, `${p.name} kadrosunda tekrarlanan oyuncu olmamalı`);
    for (const id of ids2) {
      if (allSquadIds.has(id)) overlapFound = true;
      allSquadIds.add(id);
    }
  }
  // Münhasır sahiplik: N oyuncu arasında da hiçbir oyuncu paylaşılmamalı.
  console.assert(!overlapFound, 'oyuncular arasında münhasır sahiplik ihlali (aynı oyuncu 2 kadroda) olmamalı');
  console.log('[test6] münhasır sahiplik ihlali:', overlapFound);

  // ---------- Dizilim + round-robin maç fazı ----------
  async function submitBothLineups(socket) {
    const opts = await emitAck(socket, 'lineup:options', { code });
    const o = opts.options.find((x) => x.feasible);
    const assignment = o.suggestedLineup.map((l) => l.squadIndex);
    await emitAck(socket, 'lineup:submit', { code, matchSide: 'home', formation: o.formation, assignment });
    await emitAck(socket, 'lineup:submit', { code, matchSide: 'away', formation: o.formation, assignment });
  }

  const matchReadyPromise = once(sockets[0], 'match:ready');
  for (const s of sockets) await submitBothLineups(s);
  await matchReadyPromise;
  console.log('[test6] tüm oyuncular dizilimini gönderdi, status=match');

  for (let i = 0; i < N - 1; i++) {
    const r = await emitAck(sockets[i], 'match:simulate', { code });
    console.assert(r.ok && r.waiting, `${i}. oyuncu tek başına maçı başlatmamalı: ${JSON.stringify(r)}`);
  }
  const matchRes = await emitAck(sockets[N - 1], 'match:simulate', { code });
  console.assert(matchRes.ok, 'son oyuncu onaylayınca simülasyon başarılı olmalı: ' + JSON.stringify(matchRes));
  const r = matchRes.result;

  // N=4 -> C(4,2) = 6 eşleşme (herkes herkesle ev+deplasman).
  const expectedFixtures = (N * (N - 1)) / 2;
  console.assert(r.fixtures.length === expectedFixtures, `${expectedFixtures} eşleşme beklenir, gelen: ${r.fixtures.length}`);
  console.assert(r.standings.length === N, `puan tablosunda ${N} satır olmalı, gelen: ${r.standings.length}`);

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — "LİG USÜLÜ"] Her fikstür artık 2 BAĞIMSIZ maç (ev +
  // deplasman) — her biri kendi başına 3 (galibiyet) ya da 2 (1-1 beraberlik) puan dağıtır,
  // fikstür başına toplam puan artık sabit 3 değil, 4-6 arası bir aralık.
  const totalPoints = r.standings.reduce((sum, s) => sum + s.points, 0);
  const minPoints = expectedFixtures * 4;
  const maxPoints = expectedFixtures * 6;
  console.assert(totalPoints >= minPoints && totalPoints <= maxPoints,
    `toplam puan ${minPoints}-${maxPoints} arası olmalı (her fikstür 2 bağımsız maç, maç başı 2 ya da 3 puan dağıtır), gelen: ${totalPoints}`);
  const playedOk = r.standings.every((s) => s.played === 2 * (N - 1));
  console.assert(playedOk, `her oyuncu ${2 * (N - 1)} maç oynamış olmalı (N-1 rakip × 2 maç): ` + JSON.stringify(r.standings.map((s) => s.played)));

  // Sıralama azalan olmalı (puana göre, sonra averaja göre).
  let sorted = true;
  for (let i = 1; i < r.standings.length; i++) {
    const prev = r.standings[i - 1];
    const cur = r.standings[i];
    if (prev.points < cur.points || (prev.points === cur.points && prev.goalDiff < cur.goalDiff)) sorted = false;
  }
  console.assert(sorted, 'puan tablosu puan/averaja göre azalan sıralı olmalı: ' + JSON.stringify(r.standings));

  console.log('[test6] eşleşme sayısı:', r.fixtures.length, '(beklenen:', expectedFixtures, ')');
  console.log('[test6] puan tablosu:', r.standings.map((s) => `${s.name}:${s.points}p(${s.goalsFor}-${s.goalsAgainst})`).join(', '));
  console.log('[test6] şampiyon:', r.winnerClientId, r.standings.find((s) => s.clientId === r.winnerClientId)?.name);

  const roomAfter = roomManager.getRoom(code);
  console.assert(roomAfter.status === 'finished', 'maç sonrası status finished olmalı');

  const allOk = capacityOk && biddingErrors.length === 0 && !overlapFound && ladderRoundsSeen > 0
    && r.fixtures.length === expectedFixtures && totalPoints >= minPoints && totalPoints <= maxPoints && playedOk && sorted;
  console.log(allOk ? '[test6] TÜM TESTLER GEÇTİ ✅' : '[test6] BAZI KONTROLLER BAŞARISIZ ❌');

  for (const s of sockets) s.close();
  io.close(); server.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('[test6] HATA:', e); process.exit(1); });
