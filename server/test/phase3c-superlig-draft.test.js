// Faz 3c doğrulama scripti: Tek Lig Modu'nu (playerPool='super-lig') uçtan uca simüle eder —
// tam bir draft oturumu (kura + 11'e 11) ve draft biten kadrolardaki HER oyuncunun gerçekten
// Süper Lig'li ya da Türk icon olduğunu doğrular (bkz. draft/pool.js POOL_FILTERS).
process.env.DRAFT_AUCTION_SECONDS = process.env.DRAFT_AUCTION_SECONDS || '1';
process.env.DRAFT_ROUND_DELAY_MS = process.env.DRAFT_ROUND_DELAY_MS || '300';
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = process.env.DRAFT_ANTI_SNIPE_WINDOW_MS || '400';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS || '400';

const { server, io, roomManager } = require('../src/index');
const { io: ioClient } = require('socket.io-client');
const { loadPlayerData } = require('../src/playerData');
const { SQUAD_SIZE, MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');

const PORT = 3996;

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
  console.log('[test3c] sunucu ayakta, port', PORT);

  const allPlayersById = new Map(loadPlayerData().players.map((p) => [p.id, p]));
  const inSuperLigPool = (id) => {
    const p = allPlayersById.get(id);
    return !!p && (p.league === 'Süper Lig' || (p.isIcon && p.nation === 'Türkiye'));
  };

  const hostId = 'sl-host';
  const guestId = 'sl-guest';
  const host = connect();
  const guest = connect();
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

  const created = await emitAck(host, 'room:create', { clientId: hostId, name: 'Host', playerPool: 'super-lig' });
  const code = created.room.code;
  console.assert(created.room.playerPool === 'super-lig', 'oda playerPool=super-lig olarak kurulmalı: ' + created.room.playerPool);
  await emitAck(guest, 'room:join', { clientId: guestId, name: 'Guest', code });
  console.log('[test3c] oda hazır:', code, 'playerPool:', created.room.playerPool);

  let latestDraftUpdate = null;
  let completeEvents = 0;
  let biddingErrors = [];

  host.on('draft:update', (msg) => { latestDraftUpdate = msg; });
  guest.on('draft:update', (msg) => { latestDraftUpdate = msg; });
  host.on('draft:complete', () => completeEvents++);
  guest.on('draft:complete', () => completeEvents++);

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Herkes hazır verdikten sonra oda sahibi başlatsın".
  await emitAck(host, 'draft:readyToggle', { code });
  await emitAck(guest, 'draft:readyToggle', { code });
  const startRes = await emitAck(host, 'draft:start', { code });
  console.assert(startRes.ok, 'herkes hazır olunca host draftı başlatabilmeli: ' + JSON.stringify(startRes));
  console.log('[test3c] draft başladı');

  let lastBidRoundKey = null;
  async function autoBidTick() {
    if (!latestDraftUpdate || !latestDraftUpdate.round) return;
    const round = latestDraftUpdate.round;
    if (round.kind !== 'auction') return;
    const roundKey = round.main.id + '@' + round.deadline;
    if (roundKey === lastBidRoundKey) return;
    lastBidRoundKey = roundKey;

    for (const [socket] of [[host], [guest]]) {
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
  console.log('[test3c] draft tamamlandı, complete event sayısı:', completeEvents);
  console.log('[test3c] beklenmeyen teklif hataları:', biddingErrors);

  const room = roomManager.getRoom(code);
  console.log('[test3c] formasyon:', room.formation, 'status:', room.status);
  let outsidePoolCount = 0;
  for (const p of room.players) {
    console.log(`[test3c] ${p.name}: kadro=${p.squad.length}/${SQUAD_SIZE} bütçe kalan=${p.budget}`);
    console.assert(p.squad.length === SQUAD_SIZE, `${p.name} kadrosu tam 11 olmalı, oldu: ${p.squad.length}`);
    for (const entry of p.squad) {
      if (!inSuperLigPool(entry.player.id)) {
        outsidePoolCount++;
        console.error(`[test3c] HAVUZ DIŞI OYUNCU: ${entry.player.name} (${entry.player.league || 'icon'})`);
      }
    }
  }
  console.assert(outsidePoolCount === 0, 'Tek Lig Modu\'nda havuz dışı oyuncu draft edilmemeli, sayı: ' + outsidePoolCount);
  console.log('[test3c] havuz dışı oyuncu sayısı:', outsidePoolCount);

  const allOk = biddingErrors.length === 0 && outsidePoolCount === 0;
  console.log(allOk ? '[test3c] TÜM TESTLER GEÇTİ ✅' : '[test3c] BAZI KONTROLLER BAŞARISIZ ❌');

  host.close(); guest.close(); io.close(); server.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('[test3c] HATA:', e); process.exit(1); });
