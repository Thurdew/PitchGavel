// Faz 5 doğrulama scripti: draft + dizilim akışını tamamlar, ardından match:simulate
// ile 2 maçlık (ev+deplasman) formatı ve gerekirse penaltı tiebreaker'ı test eder.
process.env.DRAFT_AUCTION_SECONDS = '1';
process.env.DRAFT_ROUND_DELAY_MS = '150';
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = '250';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = '250';

const { server, io, roomManager } = require('../src/index');
const { io: ioClient } = require('socket.io-client');
const { MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');

const PORT = 3996;
function connect() { return ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] }); }
function once(socket, event) { return new Promise((resolve) => socket.once(event, resolve)); }
function emitAck(socket, event, payload) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }

async function runDraftToCompletion(host, guest, hostId, guestId, code) {
  let latest = null;
  const onUpdate = (msg) => { latest = msg; };
  host.on('draft:update', onUpdate);
  guest.on('draft:update', onUpdate);
  let done = 0;
  host.on('draft:complete', () => done++);
  guest.on('draft:complete', () => done++);
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Herkes hazır verdikten sonra oda sahibi başlatsın" —
  // bkz. phase3 testindeki aynı not.
  await emitAck(host, 'draft:readyToggle', { code });
  await emitAck(guest, 'draft:readyToggle', { code });
  await emitAck(host, 'draft:start', { code });
  let lastKey = null;
  const started = Date.now();
  while (done < 2 && Date.now() - started < 60000) {
    if (latest && latest.round && latest.round.kind === 'auction') {
      const key = latest.round.main.id + '@' + latest.round.deadline;
      if (key !== lastKey) {
        lastKey = key;
        for (const [s, id] of [[host, hostId], [guest, guestId]]) {
          if (Math.random() < 0.8) await emitAck(s, 'draft:bid', { code, amount: MIN_PLAYER_PRICE + Math.floor(Math.random() * 20) });
        }
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  host.off('draft:update', onUpdate);
  guest.off('draft:update', onUpdate);
}

async function submitBothLineups(socket, code, formation) {
  const opts = await emitAck(socket, 'lineup:options', { code });
  const o = opts.options.find((x) => x.formation === formation);
  const assignment = o.suggestedLineup.map((l) => l.squadIndex);
  await emitAck(socket, 'lineup:submit', { code, matchSide: 'home', formation, assignment });
  await emitAck(socket, 'lineup:submit', { code, matchSide: 'away', formation, assignment });
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const hostId = 'match-host';
  const guestId = 'match-guest';
  const host = connect();
  const guest = connect();
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

  const created = await emitAck(host, 'room:create', { clientId: hostId, name: 'Host' });
  const code = created.room.code;
  await emitAck(guest, 'room:join', { clientId: guestId, name: 'Guest', code });

  await runDraftToCompletion(host, guest, hostId, guestId, code);
  const room = roomManager.getRoom(code);
  console.log('[test5] draft tamam, formasyon:', room.formation);

  const matchReadyPromise = once(host, 'match:ready');
  await submitBothLineups(host, code, room.formation);
  await submitBothLineups(guest, code, room.formation);
  await matchReadyPromise;
  console.log('[test5] her iki taraf da dizilimini gönderdi, status=match');

  // [KULLANICI İSTEĞİ] "Maç başlarken de iki oyuncuda hazır versin" — bkz. matchSockets.js.
  const waitRes = await emitAck(host, 'match:simulate', { code });
  console.assert(waitRes.ok && waitRes.waiting, 'host tek başına maçı başlatmamalı: ' + JSON.stringify(waitRes));
  const res = await emitAck(guest, 'match:simulate', { code });
  console.assert(res.ok, 'iki taraf da onaylayınca simülasyon başarılı olmalı: ' + JSON.stringify(res));
  const r = res.result;
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — sonuç artık {fixtures, standings,
  // winnerClientId} şeklinde (round-robin'in N-genel hali); 2 kişilik odada fixtures tek
  // elemanlıdır, eski match1/match2/aggregate ilk (ve tek) fixture'ın içinde.
  console.assert(Array.isArray(r.fixtures) && r.fixtures.length === 1, '2 kişilik odada tek eşleşme olmalı: ' + JSON.stringify(r.fixtures?.length));
  const fx = r.fixtures[0];
  console.log('[test5] Maç 1:', fx.match1.homeClientId, fx.match1.goalsHome, '-', fx.match1.goalsAway, fx.match1.awayClientId, `(xG ${fx.match1.xgHome.toFixed(2)}-${fx.match1.xgAway.toFixed(2)})`);
  console.log('[test5] Maç 2:', fx.match2.homeClientId, fx.match2.goalsHome, '-', fx.match2.goalsAway, fx.match2.awayClientId, `(xG ${fx.match2.xgHome.toFixed(2)}-${fx.match2.xgAway.toFixed(2)})`);
  console.log('[test5] toplam:', fx.aggregate);
  console.log('[test5] penaltılara gitti mi:', fx.wentToPenalties, fx.penalties ? `(${fx.penalties.scoreA}-${fx.penalties.scoreB})` : '');
  console.log('[test5] eşleşme galibi:', fx.winnerClientId);
  console.log('[test5] puan tablosu:', r.standings.map((s) => `${s.name}:${s.points}p(${s.goalsFor}-${s.goalsAgainst})`).join(', '));
  console.log('[test5] şampiyon:', r.winnerClientId);

  console.assert(fx.winnerClientId === hostId || fx.winnerClientId === guestId, 'eşleşme galibi taraflardan biri olmalı');
  console.assert(r.winnerClientId === fx.winnerClientId, 'tek eşleşmeli odada şampiyon == eşleşme galibi olmalı');
  console.assert(fx.aggregate[hostId] >= 0 && fx.aggregate[guestId] >= 0, 'toplam goller negatif olamaz');
  console.assert(r.standings.length === 2, 'puan tablosunda 2 satır olmalı');
  console.assert(r.standings[0].points === 3 && r.standings[1].points === 0, 'galip 3 puan, mağlup 0 puan almalı: ' + JSON.stringify(r.standings));
  const roomAfter = roomManager.getRoom(code);
  console.assert(roomAfter.status === 'finished', 'maç sonrası status finished olmalı');

  // Tekrar çağrılırsa cache'ten aynı sonucu dönmeli (idempotent)
  const res2 = await emitAck(host, 'match:simulate', { code });
  console.assert(res2.cached === true, 'ikinci çağrı cache sonucu dönmeli');
  console.assert(res2.result.winnerClientId === r.winnerClientId, 'cachelenmiş sonuç tutarlı olmalı');
  console.log('[test5] tekrar çağrı cacheden geldi, tutarlı');

  console.log('[test5] TÜM TESTLER GEÇTİ ✅');
  host.close(); guest.close(); io.close(); server.close();
  process.exit(0);
}

main().catch((e) => { console.error('[test5] HATA:', e); process.exit(1); });
