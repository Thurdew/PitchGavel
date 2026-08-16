// Faz 3 doğrulama scripti: tam bir draft oturumunu (kura + 11'e 11 tamamlanana kadar
// otomatik teklif) uçtan uca simüle eder. Hızlı çalışması için DRAFT_AUCTION_SECONDS=1
// ile başlatılmalı (bkz. package.json "test:draft" script'i).
process.env.DRAFT_AUCTION_SECONDS = process.env.DRAFT_AUCTION_SECONDS || '1';
process.env.DRAFT_ROUND_DELAY_MS = process.env.DRAFT_ROUND_DELAY_MS || '300';
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = process.env.DRAFT_ANTI_SNIPE_WINDOW_MS || '400';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS || '400';

const { server, io, roomManager, draftEngine } = require('../src/index');
const { io: ioClient } = require('socket.io-client');
const { SQUAD_SIZE, MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');

const PORT = 3998;

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
  console.log('[test3] sunucu ayakta, port', PORT);

  const hostId = 'draft-host';
  const guestId = 'draft-guest';
  const host = connect();
  const guest = connect();
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

  const created = await emitAck(host, 'room:create', { clientId: hostId, name: 'Host' });
  const code = created.room.code;
  await emitAck(guest, 'room:join', { clientId: guestId, name: 'Guest', code });
  console.log('[test3] oda hazır:', code);

  let latestDraftUpdate = null;
  let completeEvents = 0;
  let biddingErrors = [];

  host.on('draft:update', (msg) => { latestDraftUpdate = msg; });
  guest.on('draft:update', (msg) => { latestDraftUpdate = msg; });
  host.on('draft:complete', () => completeEvents++);
  guest.on('draft:complete', () => completeEvents++);

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Herkes hazır verdikten sonra oda sahibi başlatsın" —
  // ready oyu vermek (draft:readyToggle) artık draftı kendiliğinden başlatmıyor; host olmayan
  // biri draft:start çağırırsa reddedilmeli, host da herkes hazır olmadan başlatamamalı.
  const earlyStart = await emitAck(guest, 'draft:start', { code });
  console.assert(earlyStart.error === 'ONLY_HOST_CAN_START', 'host olmayan draftı başlatamamalı: ' + JSON.stringify(earlyStart));
  const hostReady = await emitAck(host, 'draft:readyToggle', { code });
  console.assert(hostReady.ok && hostReady.ready, 'host hazırım diyebilmeli: ' + JSON.stringify(hostReady));
  const startTooEarly = await emitAck(host, 'draft:start', { code });
  console.assert(startTooEarly.error === 'NOT_EVERYONE_READY', 'guest hazır değilken host başlatamamalı: ' + JSON.stringify(startTooEarly));
  const guestReady = await emitAck(guest, 'draft:readyToggle', { code });
  console.assert(guestReady.ok && guestReady.ready, 'guest hazırım diyebilmeli: ' + JSON.stringify(guestReady));
  const startRes = await emitAck(host, 'draft:start', { code });
  console.assert(startRes.ok, 'herkes hazır olunca host draftı başlatabilmeli: ' + JSON.stringify(startRes));
  console.log('[test3] draft başladı');

  // Basit oto-bidding döngüsü: her round update'inde, aktif bir auction varsa,
  // rastgele iki taraf da (kişisel tavan dahilinde) teklif versin.
  let lastBidRoundKey = null;
  async function autoBidTick() {
    if (!latestDraftUpdate || !latestDraftUpdate.round) return;
    const round = latestDraftUpdate.round;
    if (round.kind !== 'auction') return;
    const roundKey = round.main.id + '@' + round.deadline;
    if (roundKey === lastBidRoundKey) return; // bu round için zaten teklif verdik
    lastBidRoundKey = roundKey;

    for (const [socket, clientId] of [[host, hostId], [guest, guestId]]) {
      if (Math.random() < 0.85) {
        const amount = MIN_PLAYER_PRICE + Math.floor(Math.random() * 20);
        const res = await emitAck(socket, 'draft:bid', { code, amount });
        if (res.error && res.error !== 'BID_TOO_LOW' && res.error !== 'AUCTION_CLOSED') {
          biddingErrors.push(res.error);
        }
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
  console.log('[test3] draft tamamlandı, complete event sayısı:', completeEvents);
  console.log('[test3] beklenmeyen teklif hataları:', biddingErrors);

  const room = roomManager.getRoom(code);
  console.log('[test3] formasyon:', room.formation, 'status:', room.status);
  for (const p of room.players) {
    console.log(`[test3] ${p.name}: kadro=${p.squad.length}/${SQUAD_SIZE} bütçe kalan=${p.budget}`);
    console.assert(p.squad.length === SQUAD_SIZE, `${p.name} kadrosu tam 11 olmalı, oldu: ${p.squad.length}`);
    console.assert(p.budget >= 0, `${p.name} bütçesi negatif olamaz, oldu: ${p.budget}`);
    const ids = new Set(p.squad.map((s) => s.player.id));
    console.assert(ids.size === p.squad.length, `${p.name} kadrosunda tekrarlanan oyuncu olmamalı`);
  }
  // Karşı takımla oyuncu çakışması olmamalı (münhasır sahiplik)
  const [pA, pB] = room.players;
  const idsA = new Set(pA.squad.map((s) => s.player.id));
  const idsB = new Set(pB.squad.map((s) => s.player.id));
  const overlap = [...idsA].filter((id) => idsB.has(id));
  console.assert(overlap.length === 0, 'iki takım arasında oyuncu çakışması olmamalı: ' + overlap);
  console.log('[test3] çakışan oyuncu sayısı:', overlap.length);

  const reasons = room.draft.history.reduce((acc, h) => { acc[h.reason] = (acc[h.reason]||0)+1; return acc; }, {});
  console.log('[test3] atama nedeni dağılımı:', reasons);

  console.log(biddingErrors.length === 0 && overlap.length === 0 ? '[test3] TÜM TESTLER GEÇTİ ✅' : '[test3] BAZI KONTROLLER BAŞARISIZ ❌');

  host.close(); guest.close(); io.close(); server.close();
  process.exit(0);
}

main().catch((e) => { console.error('[test3] HATA:', e); process.exit(1); });
