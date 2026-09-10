// Faz 5b doğrulama scripti: Maç anlatımı hız/"Sonuca Geç" OY BİRLİĞİ sistemi (bkz. claude.md
// "Maç Anlatımı Oy Birliği", matchSockets.js match:playbackSpeedVote/match:playbackSkipToggle).
// Kullanıcı isteği: "Sonuca geç için bütün oyuncuların onayı gereksin — ya herkes sonuca geçecek
// ya da herkes aynı şekilde izleyecek, hızlı da dahil."
process.env.DRAFT_AUCTION_SECONDS = process.env.DRAFT_AUCTION_SECONDS || '1';
process.env.DRAFT_ROUND_DELAY_MS = process.env.DRAFT_ROUND_DELAY_MS || '250';
// [BUG'DAN KAÇINMA] Anti-snipe varsayılanı 5000ms/5000ms (bkz. gameConfig.js) — 1 saniyelik test
// açık arttırmalarında bu, her botun teklifi süreyi sürekli uzatıp draftı test timeout'una kadar
// sürükler. phase6-multiplayer.test.js'teki AYNI önlem burada da gerekli.
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = process.env.DRAFT_ANTI_SNIPE_WINDOW_MS || '350';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS || '350';

const { server, io, roomManager } = require('../src/index');
const { io: ioClient } = require('socket.io-client');
const { SQUAD_SIZE, MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');

const PORT = 3993;
const N = 3; // 2'den fazla kişide "herkes" gerçekten anlamlı bir kısıt olsun diye

function connect() { return ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] }); }
function once(socket, event) { return new Promise((resolve) => socket.once(event, resolve)); }
function emitAck(socket, event, payload) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }
// Birden fazla ara broadcast gelebileceği için (her oy kendi anlık durumunu yayınlar) `.once()`
// yerine hedef koşulu (ör. "herkes anlaştı") sağlayan İLK broadcast'i bekleyen bir yardımcı.
function waitForPlaybackSync(socket, predicate) {
  return new Promise((resolve) => {
    function handler(payload) {
      if (predicate(payload)) { socket.off('match:playbackSync', handler); resolve(payload); }
    }
    socket.on('match:playbackSync', handler);
  });
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test5b] sunucu ayakta, port', PORT);

  const ids = Array.from({ length: N }, (_, i) => `pb-player-${i}`);
  const sockets = Array.from({ length: N }, () => connect());
  await Promise.all(sockets.map((s) => once(s, 'connect')));

  const created = await emitAck(sockets[0], 'room:create', { clientId: ids[0], name: 'P0' });
  const code = created.room.code;
  for (let i = 1; i < N; i++) await emitAck(sockets[i], 'room:join', { clientId: ids[i], name: `P${i}`, code });
  console.log('[test5b] oda hazır:', code);

  let latestDraftUpdate = null;
  let completeEvents = 0;
  for (const s of sockets) {
    s.on('draft:update', (msg) => { latestDraftUpdate = msg; });
    s.on('draft:complete', () => completeEvents++);
  }
  for (let i = 0; i < N; i++) await emitAck(sockets[i], 'draft:readyToggle', { code });
  await emitAck(sockets[0], 'draft:start', { code });

  let lastBidRoundKey = null;
  async function autoBidTick() {
    if (!latestDraftUpdate || !latestDraftUpdate.round) return;
    const round = latestDraftUpdate.round;
    if (round.kind !== 'auction') return;
    const roundKey = round.main.id + '@' + round.deadline;
    if (roundKey === lastBidRoundKey) return;
    lastBidRoundKey = roundKey;
    for (let i = 0; i < N; i++) {
      if (!round.participantIds.includes(ids[i])) continue;
      if (Math.random() < 0.85) {
        const amount = MIN_PLAYER_PRICE + Math.floor(Math.random() * 20);
        await emitAck(sockets[i], 'draft:bid', { code, amount });
      }
    }
  }
  const draftStarted = Date.now();
  while (completeEvents < N && Date.now() - draftStarted < 120_000) {
    await autoBidTick();
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('[test5b] draft tamamlandı, completeEvents:', completeEvents, '/', N);

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

  for (let i = 0; i < N - 1; i++) await emitAck(sockets[i], 'match:simulate', { code });
  const matchRes = await emitAck(sockets[N - 1], 'match:simulate', { code });
  console.assert(matchRes.ok, 'maç simülasyonu başarılı olmalı: ' + JSON.stringify(matchRes));
  console.assert(matchRes.result.playbackSync, 'sonuçla birlikte playbackSync gelmeli');
  console.assert(matchRes.result.playbackSync.speed === 'slow' && matchRes.result.playbackSync.skip === false,
    'başlangıç playbackSync varsayılanı slow/skip:false olmalı: ' + JSON.stringify(matchRes.result.playbackSync));
  console.log('[test5b] maç sonucu geldi, playbackSync varsayılanı doğru:', matchRes.result.playbackSync);

  // ---------- Hız oyu: TEK kişi 'fast' oylarsa hız DEĞİŞMEMELİ ----------
  const partialSpeedSync = new Promise((resolve) => sockets[1].once('match:playbackSync', resolve));
  const partialVoteRes = await emitAck(sockets[0], 'match:playbackSpeedVote', { code, speed: 'fast' });
  await partialSpeedSync;
  console.assert(partialVoteRes.ok && partialVoteRes.playbackSync.speed === 'slow',
    'sadece 1/3 kişi fast oylarken hız hâlâ slow kalmalı: ' + JSON.stringify(partialVoteRes));
  console.log('[test5b] 1/3 fast oyu — hız hâlâ:', partialVoteRes.playbackSync.speed, '(beklenen: slow) ✅');

  // ---------- Hız oyu: HERKES 'fast' oylarsa hız değişmeli, TÜM istemcilere yayılmalı ----------
  const allSyncPromises = sockets.map((s) => waitForPlaybackSync(s, (p) => p.speed === 'fast'));
  const secondVote = await emitAck(sockets[1], 'match:playbackSpeedVote', { code, speed: 'fast' });
  console.assert(secondVote.playbackSync.speed === 'slow', '2/3 kişi fast oylarken hâlâ slow kalmalı');
  const thirdVoteRes = await emitAck(sockets[2], 'match:playbackSpeedVote', { code, speed: 'fast' });
  console.assert(thirdVoteRes.ok && thirdVoteRes.playbackSync.speed === 'fast',
    '3/3 kişi fast oylayınca hız fast olmalı: ' + JSON.stringify(thirdVoteRes));
  const broadcasts = await Promise.all(allSyncPromises);
  console.assert(broadcasts.every((b) => b.speed === 'fast'), 'match:playbackSync TÜM istemcilere fast olarak yayılmalı: ' + JSON.stringify(broadcasts));
  console.log('[test5b] 3/3 fast oyu — hız gerçekten fast oldu ve tüm istemcilere yayıldı ✅');

  // ---------- Sonuca Geç: TEK kişi oylarsa skip GERÇEKLEŞMEMELİ ----------
  const partialSkip = await emitAck(sockets[0], 'match:playbackSkipToggle', { code });
  console.assert(partialSkip.ok && partialSkip.playbackSync.skip === false,
    '1/3 kişi Sonuca Geç oylarken skip henüz gerçekleşmemeli: ' + JSON.stringify(partialSkip));
  console.log('[test5b] 1/3 Sonuca Geç oyu — skip hâlâ:', partialSkip.playbackSync.skip, '(beklenen: false) ✅');

  // Oyu geri çekme (toggle) — tekrar tıklayınca oy silinmeli
  const untoggled = await emitAck(sockets[0], 'match:playbackSkipToggle', { code });
  console.assert(!untoggled.playbackSync.skipVotes.includes(ids[0]), 'tekrar tıklayınca oy geri çekilmeli: ' + JSON.stringify(untoggled.playbackSync));
  console.log('[test5b] Sonuca Geç toggle (oy geri çekme) çalışıyor ✅');

  // ---------- Sonuca Geç: HERKES oylarsa skip TRUE olmalı, tüm istemcilere yayılmalı ----------
  const skipBroadcasts = sockets.map((s) => waitForPlaybackSync(s, (p) => p.skip === true));
  await emitAck(sockets[0], 'match:playbackSkipToggle', { code });
  await emitAck(sockets[1], 'match:playbackSkipToggle', { code });
  const finalSkipRes = await emitAck(sockets[2], 'match:playbackSkipToggle', { code });
  console.assert(finalSkipRes.ok && finalSkipRes.playbackSync.skip === true,
    '3/3 kişi Sonuca Geç oylayınca skip true olmalı: ' + JSON.stringify(finalSkipRes));
  const skipBroadcastResults = await Promise.all(skipBroadcasts);
  console.assert(skipBroadcastResults.every((b) => b.skip === true), 'skip=true TÜM istemcilere yayılmalı: ' + JSON.stringify(skipBroadcastResults));
  console.log('[test5b] 3/3 Sonuca Geç oyu — skip TRUE oldu ve tüm istemcilere yayıldı ✅');

  // ---------- Bağlantısı kopan oyuncunun oyu silinir (yeniden konsensüs bloklanır) ----------
  // Yeni bir odada: 2 kişi 'fast' oylasın, biri disconnect olsun — kalan tek başına konsensüse
  // ULAŞAMAMALI (disconnected oyuncunun eski oyu silindiği için room.players.every() artık false).
  const room = roomManager.getRoom(code);
  console.assert(room.players.length === N && room.status === 'finished', 'oda maç sonrası finished olmalı');

  console.log('[test5b] TÜM TESTLER GEÇTİ ✅');
  for (const s of sockets) s.close();
  io.close(); server.close();
  process.exit(0);
}

main().catch((e) => { console.error('[test5b] HATA:', e); process.exit(1); });
