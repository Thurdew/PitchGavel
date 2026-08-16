// Faz 3b doğrulama scripti: Kör Draft modunu uçtan uca simüle eder (kura + 11'e 11 tamamlanana
// kadar otomatik gizli teklif). phase3-draft.test.js ile aynı iskelet, sadece round.kind
// 'blind_auction' ve sunucunun rakip teklifini ASLA açığa çıkarmadığını da doğruluyor.
process.env.DRAFT_BLIND_SECONDS = process.env.DRAFT_BLIND_SECONDS || '1';
process.env.DRAFT_ROUND_DELAY_MS = process.env.DRAFT_ROUND_DELAY_MS || '300';

const { server, io, roomManager, draftEngine } = require('../src/index');
const { io: ioClient } = require('socket.io-client');
const { SQUAD_SIZE, MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');

const PORT = 3997;

function connect() {
  return ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });
}
function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}
function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test3b] sunucu ayakta, port', PORT);

  const hostId = 'blind-host';
  const guestId = 'blind-guest';
  const host = connect();
  const guest = connect();
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

  const created = await emitAck(host, 'room:create', { clientId: hostId, name: 'Host', draftMode: 'blind' });
  const code = created.room.code;
  console.assert(created.room.draftMode === 'blind', 'oda draftMode=blind olarak kurulmalı: ' + created.room.draftMode);
  await emitAck(guest, 'room:join', { clientId: guestId, name: 'Guest', code });
  console.log('[test3b] oda hazır:', code, 'draftMode:', created.room.draftMode);

  let latestDraftUpdate = null;
  let completeEvents = 0;
  let biddingErrors = [];
  let leakedAmountEvents = 0; // publicRoundState hiçbir zaman highestBid/highestBidderClientId göndermemeli

  function onUpdate(msg) {
    latestDraftUpdate = msg;
    if (msg.round && msg.round.kind === 'blind_auction') {
      if ('highestBid' in msg.round || 'highestBidderClientId' in msg.round) leakedAmountEvents++;
    }
  }
  host.on('draft:update', onUpdate);
  guest.on('draft:update', onUpdate);
  host.on('draft:complete', () => completeEvents++);
  guest.on('draft:complete', () => completeEvents++);

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Herkes hazır verdikten sonra oda sahibi başlatsın" —
  // ready oyu (draft:readyToggle) draftı kendiliğinden başlatmaz, sadece host draft:start ile
  // fiilen başlatabilir (bkz. draftSockets.js).
  await emitAck(host, 'draft:readyToggle', { code });
  await emitAck(guest, 'draft:readyToggle', { code });
  const startRes = await emitAck(host, 'draft:start', { code });
  console.assert(startRes.ok, 'herkes hazır olunca host draftı başlatabilmeli: ' + JSON.stringify(startRes));
  console.log('[test3b] draft başladı');

  // Basit oto-teklif döngüsü: her round update'inde, aktif bir kör teklif turu varsa,
  // her iki taraf da (kişisel tavan dahilinde) bir kez gizli teklif versin.
  let lastBidRoundKey = null;
  async function autoBidTick() {
    if (!latestDraftUpdate || !latestDraftUpdate.round) return;
    const round = latestDraftUpdate.round;
    if (round.kind !== 'blind_auction') return;
    const roundKey = round.main.id + '@' + round.deadline;
    if (roundKey === lastBidRoundKey) return;
    lastBidRoundKey = roundKey;

    for (const [socket, clientId] of [[host, hostId], [guest, guestId]]) {
      if (Math.random() < 0.85) {
        const amount = MIN_PLAYER_PRICE + Math.floor(Math.random() * 20);
        const res = await emitAck(socket, 'draft:bid', { code, amount });
        if (res.error && res.error !== 'AUCTION_CLOSED') biddingErrors.push(res.error);
      }
    }
  }

  const started = Date.now();
  const TIMEOUT_MS = 60_000;
  while (completeEvents < 2 && Date.now() - started < TIMEOUT_MS) {
    await autoBidTick();
    await new Promise((r) => setTimeout(r, 150));
  }

  console.assert(completeEvents >= 1, 'draft:complete en az bir kez gelmeli');
  console.log('[test3b] draft tamamlandı, complete event sayısı:', completeEvents);
  console.log('[test3b] beklenmeyen teklif hataları:', biddingErrors);
  console.assert(leakedAmountEvents === 0, 'kör turlarda highestBid/highestBidderClientId ASLA yayınlanmamalı, sızıntı sayısı: ' + leakedAmountEvents);

  const room = roomManager.getRoom(code);
  console.log('[test3b] formasyon:', room.formation, 'status:', room.status);
  for (const p of room.players) {
    console.log(`[test3b] ${p.name}: kadro=${p.squad.length}/${SQUAD_SIZE} bütçe kalan=${p.budget}`);
    console.assert(p.squad.length === SQUAD_SIZE, `${p.name} kadrosu tam 11 olmalı, oldu: ${p.squad.length}`);
    console.assert(p.budget >= 0, `${p.name} bütçesi negatif olamaz, oldu: ${p.budget}`);
    const ids = new Set(p.squad.map((s) => s.player.id));
    console.assert(ids.size === p.squad.length, `${p.name} kadrosunda tekrarlanan oyuncu olmamalı`);
  }
  const [pA, pB] = room.players;
  const idsA = new Set(pA.squad.map((s) => s.player.id));
  const idsB = new Set(pB.squad.map((s) => s.player.id));
  const overlap = [...idsA].filter((id) => idsB.has(id));
  console.assert(overlap.length === 0, 'iki takım arasında oyuncu çakışması olmamalı: ' + overlap);
  console.log('[test3b] çakışan oyuncu sayısı:', overlap.length);

  const reasons = room.draft.history.reduce((acc, h) => { acc[h.reason] = (acc[h.reason]||0)+1; return acc; }, {});
  console.log('[test3b] atama nedeni dağılımı:', reasons);

  const allOk = biddingErrors.length === 0 && overlap.length === 0 && leakedAmountEvents === 0;
  console.log(allOk ? '[test3b] TÜM TESTLER GEÇTİ ✅' : '[test3b] BAZI KONTROLLER BAŞARISIZ ❌');

  host.close(); guest.close(); io.close(); server.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('[test3b] HATA:', e); process.exit(1); });
