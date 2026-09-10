// Faz 4 doğrulama scripti: bir draft'ı tamamlar, ardından dizilim (lineup) seçim akışını
// test eder — kurulabilir formasyon tespiti, geçerli/geçersiz dizilim gönderimi, ev+deplasman
// ikisi de gönderilince match:ready sinyali.
process.env.DRAFT_AUCTION_SECONDS = '1';
process.env.DRAFT_ROUND_DELAY_MS = '200';
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = '300';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = '300';

const { server, io, roomManager } = require('../src/index');
const { io: ioClient } = require('socket.io-client');
const { MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');
const { validateAssignment } = require('../src/lineup/lineup');

const PORT = 3997;
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
  // bkz. draftSockets.js.
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
          if (Math.random() < 0.8) {
            await emitAck(s, 'draft:bid', { code, amount: MIN_PLAYER_PRICE + Math.floor(Math.random() * 20) });
          }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  host.off('draft:update', onUpdate);
  guest.off('draft:update', onUpdate);
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const hostId = 'lineup-host';
  const guestId = 'lineup-guest';
  const host = connect();
  const guest = connect();
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

  const created = await emitAck(host, 'room:create', { clientId: hostId, name: 'Host' });
  const code = created.room.code;
  await emitAck(guest, 'room:join', { clientId: guestId, name: 'Guest', code });

  await runDraftToCompletion(host, guest, hostId, guestId, code);
  const room = roomManager.getRoom(code);
  console.log('[test4] draft bitti, formasyon:', room.formation, 'status:', room.status);
  console.assert(room.status === 'squad_select', 'draft sonrası squad_select olmalı');

  // 1) lineup:options -- taslak formasyonun (draft formasyonu) mutlaka kurulabilir olması lazım
  //    (kadro zaten o formasyona göre birebir toplandı, kimlik eşleşmesi trivial olmalı).
  const opts = await emitAck(host, 'lineup:options', { code });
  console.assert(Array.isArray(opts.options), 'options dizi dönmeli');
  const draftFormationOption = opts.options.find((o) => o.formation === room.formation);
  console.assert(draftFormationOption && draftFormationOption.feasible, 'draft formasyonu her zaman kurulabilir olmalı');
  console.log('[test4] kurulabilir formasyonlar:', opts.options.map((o) => `${o.formation}:${o.feasible}`).join(', '));

  // Her feasible formasyon için suggestedLineup gerçekten geçerli mi (self-consistency)?
  for (const o of opts.options) {
    if (!o.feasible) continue;
    const assignment = o.suggestedLineup.map((l) => l.squadIndex);
    const v = validateAssignment(host_squad(room, hostId), o.formation, assignment);
    console.assert(v.valid, `önerilen dizilim geçerli olmalı (${o.formation}): ${JSON.stringify(v)}`);
  }
  console.log('[test4] tüm önerilen dizilimler kendi içinde tutarlı (valid)');

  // 2) Ev sahibi dizilimi gönder (draft formasyonuyla, önerilen atamayla)
  const homeAssignment = draftFormationOption.suggestedLineup.map((l) => l.squadIndex);
  const submitHome = await emitAck(host, 'lineup:submit', { code, matchSide: 'home', formation: room.formation, assignment: homeAssignment });
  console.assert(submitHome.ok, 'ev sahibi dizilim kabul edilmeli: ' + JSON.stringify(submitHome));

  // 3) Geçersiz dizilim reddedilmeli (aynı oyuncuyu iki slota koyarsak)
  const badAssignment = [...homeAssignment];
  badAssignment[1] = badAssignment[0];
  const badRes = await emitAck(host, 'lineup:submit', { code, matchSide: 'away', formation: room.formation, assignment: badAssignment });
  console.assert(badRes.error === 'INVALID_LINEUP', 'geçersiz (tekrarlı oyuncu) dizilim reddedilmeli: ' + JSON.stringify(badRes));
  console.log('[test4] geçersiz dizilim doğru şekilde reddedildi');

  // 4) Ev sahibi deplasman dizilimini de (geçerli) gönder
  const submitAway = await emitAck(host, 'lineup:submit', { code, matchSide: 'away', formation: room.formation, assignment: homeAssignment });
  console.assert(submitAway.ok, 'deplasman dizilimi kabul edilmeli');

  // 5) Guest de ikisini gönderene kadar match:ready gelmemeli
  const matchReadyPromise = once(host, 'match:ready');
  await emitAck(guest, 'lineup:submit', { code, matchSide: 'home', formation: room.formation, assignment: homeAssignment.length ? await defaultAssignmentFor(guest, code, room.formation) : [] });
  await emitAck(guest, 'lineup:submit', { code, matchSide: 'away', formation: room.formation, assignment: await defaultAssignmentFor(guest, code, room.formation) });

  await matchReadyPromise;
  const roomAfter = roomManager.getRoom(code);
  console.assert(roomAfter.status === 'match', 'her iki taraf da gönderince status match olmalı');
  console.log('[test4] match:ready alındı, room.status =', roomAfter.status);

  console.log('[test4] TÜM TESTLER GEÇTİ ✅');
  host.close(); guest.close(); io.close(); server.close();
  process.exit(0);
}

function host_squad(room, clientId) {
  return room.players.find((p) => p.clientId === clientId).squad;
}

async function defaultAssignmentFor(socket, code, formation) {
  const opts = await emitAck(socket, 'lineup:options', { code });
  const o = opts.options.find((x) => x.formation === formation);
  return o.suggestedLineup.map((l) => l.squadIndex);
}

main().catch((e) => { console.error('[test4] HATA:', e); process.exit(1); });
