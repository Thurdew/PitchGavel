// Faz 7 doğrulama scripti: Çark Modu v2 (draftMode='wheel') — round artık TEK KİŞİLİK bir tur
// (bkz. DraftEngine.nextWheelTurn/openWheelTurn): sırası gelen katılımcı server-otoriter olarak
// çarkı çevirir, segmentine göre (reyting bandı / efsane havuzu / lig-milliyet piyangosu /
// rakipten çal / en iyisini ver / şanssız tur) bir sonuç uygulanır. Herkes KENDİ 11'i dolana
// kadar sıraya girmeye devam eder — "rakipten çal" bir başkasının kadrosunu küçültebildiği için
// mağdur taraf da (slotsNeeded yeniden pozitif olduğu için) otomatik olarak tekrar sıraya girer.
// Hızlı çalışması için DRAFT_WHEEL_SECONDS ve DRAFT_WHEEL_AUTO_RESOLVE_MS küçük tutulur (bkz.
// package.json "test:draft:wheel").
process.env.DRAFT_WHEEL_SECONDS = process.env.DRAFT_WHEEL_SECONDS || '1';
process.env.DRAFT_WHEEL_AUTO_RESOLVE_MS = process.env.DRAFT_WHEEL_AUTO_RESOLVE_MS || '150';
process.env.DRAFT_ROUND_DELAY_MS = process.env.DRAFT_ROUND_DELAY_MS || '300';

const { server, io, roomManager } = require('../src/index');
const { io: ioClient } = require('socket.io-client');
const { SQUAD_SIZE, STARTING_BUDGET, WHEEL_SEGMENT_CATALOG, WHEEL_CUSTOM_PICK_COUNT } = require('../src/shared/gameConfig');

const PORT = 3994;

function connect() { return ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] }); }
function once(socket, event) { return new Promise((resolve) => socket.once(event, resolve)); }
function emitAck(socket, event, payload) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test7] sunucu ayakta, port', PORT);

  // Bant/lig/milliyet/icon filtreleme için oyuncu havuzunu bir kez çek (test istemcisinin
  // "hangi oyuncu hangi bantta/pozisyonda/ligde/milliyette uygun" bilgisini bilmesi için).
  const allRes = await fetch(`http://localhost:${PORT}/api/players/all`);
  const { players: allPlayers } = await allRes.json();

  const hostId = 'wheel-host';
  const guestId = 'wheel-guest';
  const host = connect();
  const guest = connect();
  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);

  const created = await emitAck(host, 'room:create', { clientId: hostId, name: 'Host', draftMode: 'wheel' });
  const code = created.room.code;
  console.assert(created.room.draftMode === 'wheel', 'oda draftMode=wheel olmalı: ' + JSON.stringify(created.room));
  await emitAck(guest, 'room:join', { clientId: guestId, name: 'Guest', code });
  console.log('[test7] oda hazır:', code, 'draftMode:', created.room.draftMode);

  let latestDraftUpdate = null;
  let completeEvents = 0;
  const errors = [];
  const kindsSeen = new Set();

  host.on('draft:update', (msg) => { latestDraftUpdate = msg; });
  guest.on('draft:update', (msg) => { latestDraftUpdate = msg; });
  host.on('draft:complete', () => completeEvents++);
  guest.on('draft:complete', () => completeEvents++);

  await emitAck(host, 'draft:readyToggle', { code });
  await emitAck(guest, 'draft:readyToggle', { code });
  const startRes = await emitAck(host, 'draft:start', { code });
  console.assert(startRes.ok, 'draft başlamalı: ' + JSON.stringify(startRes));
  console.log('[test7] draft başladı');

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Her draftta çarktaki yazılar değişsin,
  // 3 havuzdan da (iyi/orta/kötü) belli miktarda getir" — draft:update her zaman bu draftın
  // sabit segment setini taşıyor (bkz. DraftEngine.emitDraft `wheelSegments`); üç havuzdan da
  // temsil olduğunu doğrula.
  console.assert(latestDraftUpdate && Array.isArray(latestDraftUpdate.wheelSegments) && latestDraftUpdate.wheelSegments.length > 0,
    'draft:update bu draftın wheelSegments listesini taşımalı');
  const poolsSeen = new Set((latestDraftUpdate.wheelSegments || []).map((s) => s.pool));
  console.assert(['iyi', 'orta', 'kötü'].every((k) => poolsSeen.has(k)),
    'çark 3 havuzdan da (iyi/orta/kötü) segment içermeli, görülen: ' + [...poolsSeen].join(','));
  console.log('[test7] bu draftın çarkı:', latestDraftUpdate.wheelSegments.map((s) => `${s.label}(${s.pool})`).join(', '));

  const socketByClientId = { [hostId]: host, [guestId]: guest };
  let lastActedKey = null;
  let autoPickTested = false;

  function takenIdSet() {
    const ids = new Set();
    for (const p of latestDraftUpdate.players) for (const s of p.squad) ids.add(s.player.id);
    return ids;
  }

  async function tick() {
    if (!latestDraftUpdate || !latestDraftUpdate.round) return;
    const round = latestDraftUpdate.round;
    if (round.kind !== 'wheel') { errors.push(`beklenmeyen round.kind: ${round.kind}`); return; }
    const turnClientId = round.clientId;
    if (!turnClientId) return;
    const actKey = `${round.slotType}@${turnClientId}@${round.phase}@${round.deadline}`;
    if (actKey === lastActedKey) return;
    lastActedKey = actKey;

    const sock = socketByClientId[turnClientId];
    if (round.phase === 'awaiting_spin') {
      const res = await emitAck(sock, 'draft:spinWheel', { code });
      if (res.error) { errors.push('spin: ' + res.error); return; }
      kindsSeen.add(res.segment.kind);
      return;
    }
    if (round.phase !== 'awaiting_pick' || !round.currentSpin) return;

    const seg = round.currentSpin;
    // forced_worst/give_best/respin seçim GEREKTİRMEZ — sunucu kendi otomatik-çözüm
    // zamanlayıcısıyla (bkz. WHEEL_AUTO_RESOLVE_DELAY_MS) uygular, test hiçbir aksiyon
    // göndermemeli (göndermeye çalışsa AUTO_RESOLVED hatası alır). respin sonrası round
    // 'awaiting_spin'e döndüğünde bot zaten yukarıdaki genel spin dalıyla otomatik devam eder.
    if (seg.kind === 'forced_worst' || seg.kind === 'give_best' || seg.kind === 'respin') return;

    if (seg.kind === 'steal') {
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Rakipten istediğin oyuncuyu al" — adaylar
      // state.draft.players[].squad'dan (rakiplerin GERÇEK anlık kadrosu), test-yerel bir
      // havuzdan DEĞİL.
      let target = null;
      for (const p of latestDraftUpdate.players) {
        if (p.clientId === turnClientId) continue;
        const s = p.squad.find((sq) => sq.slot === round.slotType);
        if (s) { target = { ownerClientId: p.clientId, playerId: s.player.id }; break; }
      }
      if (!target) return; // resolveSpin zaten bu durumda 'rating' fallback'ine düşürür, buraya pratikte gelinmez
      const res = await emitAck(sock, 'draft:wheelPick', { code, playerId: target.playerId, ownerClientId: target.ownerClientId });
      if (res.error) errors.push('steal pick: ' + res.error);
      return;
    }

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kullanıcı karar vermek istemezse bilgisayar atasın" —
    // gerçek bir manuel-seçim turunda BİR KEZ, elle bir aday aramak yerine yeni
    // draft:wheelAutoPick endpoint'ini deneyip süre dolmadan hemen bir sonuç doğduğunu doğrula.
    if (!autoPickTested && seg.kind === 'rating') {
      autoPickTested = true;
      const res = await emitAck(sock, 'draft:wheelAutoPick', { code });
      if (res.error) errors.push('wheelAutoPick: ' + res.error);
      return;
    }

    // rating / icon / league / nation / club — hepsi gerçek havuzdan (allPlayers, sunucudaki
    // draft:update.players[].squad ile kesişimi hesaplanmış "alınmamış" alt kümesi) filtrelenir.
    const taken = takenIdSet();
    let candidate = null;
    if (seg.kind === 'icon') {
      candidate = allPlayers.find((p) => !taken.has(p.id) && p.position === round.slotType && p.isIcon);
    } else if (seg.kind === 'league') {
      candidate = allPlayers.find((p) => !taken.has(p.id) && p.position === round.slotType && p.league === round.revealValue);
    } else if (seg.kind === 'nation') {
      candidate = allPlayers.find((p) => !taken.has(p.id) && p.position === round.slotType && p.nation === round.revealValue);
    } else if (seg.kind === 'club') {
      candidate = allPlayers.find((p) => !taken.has(p.id) && p.position === round.slotType && p.club === round.revealValue);
    } else {
      const { min, max } = seg;
      candidate = allPlayers.find((p) => !taken.has(p.id) && p.position === round.slotType && p.rating >= min && p.rating <= max);
    }
    if (!candidate) {
      // Bu segmentte (test istemcisinin bildiği kadarıyla) kimse kalmadı — sunucu otomatik
      // genişletir/atar, test bu turu bilerek atlar (autoPickWheel zaman aşımıyla devreye girer).
      return;
    }
    const res = await emitAck(sock, 'draft:wheelPick', { code, playerId: candidate.id });
    if (res.error) errors.push('pick: ' + res.error);
  }

  // [NOT] pauseDraft/resumeDraft'ın round.timer'ı duraklatıp doğru aşamaya (awaiting_spin/
  // awaiting_pick/otomatik-çözüm) göre doğru fonksiyonla devam ettirdiğini de doğrula.
  let pauseTested = false;

  const started = Date.now();
  const TIMEOUT_MS = 60_000;
  while (completeEvents < 2 && Date.now() - started < TIMEOUT_MS) {
    if (!pauseTested && latestDraftUpdate && latestDraftUpdate.round && latestDraftUpdate.round.kind === 'wheel') {
      pauseTested = true;
      const p1 = await emitAck(host, 'draft:pauseToggle', { code });
      const p2 = await emitAck(guest, 'draft:pauseToggle', { code });
      console.assert(p2.ok && p2.paused, 'iki oyuncu da onaylayınca duraklamalı: ' + JSON.stringify(p2));
      await new Promise((r) => setTimeout(r, 200));
      const r1 = await emitAck(host, 'draft:pauseToggle', { code });
      const r2 = await emitAck(guest, 'draft:pauseToggle', { code });
      console.assert(r2.ok && !r2.paused, 'ikisi de geri çekince devam etmeli: ' + JSON.stringify(r2));
      console.log('[test7] pause/resume denendi (round.kind=wheel iken)');
    }
    await tick();
    await new Promise((r) => setTimeout(r, 80));
  }

  console.assert(completeEvents >= 1, 'draft:complete en az bir kez gelmeli');
  console.log('[test7] draft tamamlandı, complete event sayısı:', completeEvents);
  console.log('[test7] beklenmeyen hatalar:', errors);
  console.log('[test7] görülen segment türleri:', [...kindsSeen].sort());
  console.log('[test7] draft:wheelAutoPick denendi mi:', autoPickTested);

  const room = roomManager.getRoom(code);
  console.log('[test7] formasyon:', room.formation, 'status:', room.status);
  let allFree = true;
  let allExactlyOneGk = true;
  for (const p of room.players) {
    const gkCount = p.squad.filter((s) => s.slot === 'GK').length;
    console.log(`[test7] ${p.name}: kadro=${p.squad.length}/${SQUAD_SIZE} GK=${gkCount} bütçe=${p.budget} (başlangıç bütçesiyle AYNI kalmalı — ücretsiz mod)`);
    console.assert(p.squad.length === SQUAD_SIZE, `${p.name} kadrosu tam 11 olmalı, oldu: ${p.squad.length}`);
    const ids = new Set(p.squad.map((s) => s.player.id));
    console.assert(ids.size === p.squad.length, `${p.name} kadrosunda tekrarlanan oyuncu olmamalı`);
    // [KULLANICI İSTEĞİ] "1 kaleci almak zorunda kullanıcılar" — çal/ver mekanikleri slotsNeeded'ı
    // simetrik transfer ettiği için (bkz. DraftEngine removePlayerFromSquad/assignPlayer) bu
    // invariant EKSTRA kod olmadan sağlanmalı; burada doğrudan doğrulanıyor.
    if (gkCount !== 1) allExactlyOneGk = false;
    for (const s of p.squad) {
      if (s.price !== 0) allFree = false;
    }
  }
  console.assert(allFree, 'çark modunda TÜM seçimler price=0 olmalı (bütçe hiç düşmemeli)');
  console.assert(allExactlyOneGk, 'her kadroda TAM 1 kaleci olmalı');

  const [pA, pB] = room.players;
  const idsA = new Set(pA.squad.map((s) => s.player.id));
  const idsB = new Set(pB.squad.map((s) => s.player.id));
  const overlap = [...idsA].filter((id) => idsB.has(id));
  console.assert(overlap.length === 0, 'iki takım arasında oyuncu çakışması olmamalı (münhasır sahiplik — çal/ver dahil): ' + overlap);
  console.log('[test7] çakışan oyuncu sayısı:', overlap.length, '— bütçeler değişmeden kaldı mı:', allFree);

  const budgetsUnchanged = room.players.every((p) => p.budget === STARTING_BUDGET);
  console.assert(budgetsUnchanged, 'çark modunda bütçe hiç düşmemeli');

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] Host'un elle işaretlediği TAM
  // WHEEL_CUSTOM_PICK_COUNT etiket, draftın SABİT çarkına birebir (sırasız) yansımalı; geçersiz
  // bir sayı (ör. 3) gönderilirse sunucu sessizce eski dengeli-rastgele davranışa düşmeli.
  const host2 = connect();
  const guest2 = connect();
  await Promise.all([once(host2, 'connect'), once(guest2, 'connect')]);
  const customLabels = WHEEL_SEGMENT_CATALOG.slice(0, WHEEL_CUSTOM_PICK_COUNT).map((s) => s.label);
  const created2 = await emitAck(host2, 'room:create', {
    clientId: 'wheel-host-2', name: 'Host2', draftMode: 'wheel', wheelSegmentLabels: customLabels,
  });
  const code2 = created2.room.code;
  await emitAck(guest2, 'room:join', { clientId: 'wheel-guest-2', name: 'Guest2', code: code2 });
  let draftUpdate2 = null;
  host2.on('draft:update', (msg) => { if (!draftUpdate2) draftUpdate2 = msg; });
  await emitAck(host2, 'draft:readyToggle', { code: code2 });
  await emitAck(guest2, 'draft:readyToggle', { code: code2 });
  await emitAck(host2, 'draft:start', { code: code2 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const gotLabels = new Set((draftUpdate2?.wheelSegments || []).map((s) => s.label));
  const customApplied = gotLabels.size === WHEEL_CUSTOM_PICK_COUNT && customLabels.every((l) => gotLabels.has(l));
  console.log('[test7] özelleştirilmiş çark uygulandı mı:', customApplied, '— seçilen:', [...gotLabels].join(', '));
  console.assert(customApplied, 'host\'un işaretlediği 10 etiket draftın çarkına birebir yansımalı');
  host2.close(); guest2.close();

  const host3 = connect();
  const guest3 = connect();
  await Promise.all([once(host3, 'connect'), once(guest3, 'connect')]);
  const created3 = await emitAck(host3, 'room:create', {
    clientId: 'wheel-host-3', name: 'Host3', draftMode: 'wheel', wheelSegmentLabels: customLabels.slice(0, 3),
  });
  const code3 = created3.room.code;
  await emitAck(guest3, 'room:join', { clientId: 'wheel-guest-3', name: 'Guest3', code: code3 });
  let draftUpdate3 = null;
  host3.on('draft:update', (msg) => { if (!draftUpdate3) draftUpdate3 = msg; });
  await emitAck(host3, 'draft:readyToggle', { code: code3 });
  await emitAck(guest3, 'draft:readyToggle', { code: code3 });
  await emitAck(host3, 'draft:start', { code: code3 });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const invalidFellBackToAuto = (draftUpdate3?.wheelSegments || []).length === 9; // eski 3+3+3 davranışı
  console.log('[test7] geçersiz sayı (3) auto-balance\'a düştü mü:', invalidFellBackToAuto, '— segment sayısı:', draftUpdate3?.wheelSegments?.length);
  console.assert(invalidFellBackToAuto, 'geçersiz (10 olmayan) sayıda etiket sessizce auto-balance\'a düşmeli');
  host3.close(); guest3.close();

  const allOk = errors.length === 0 && overlap.length === 0 && allFree && allExactlyOneGk && budgetsUnchanged
    && completeEvents >= 1 && customApplied && invalidFellBackToAuto;
  console.log(allOk ? '[test7] TÜM TESTLER GEÇTİ ✅' : '[test7] BAZI KONTROLLER BAŞARISIZ ❌');

  host.close(); guest.close(); io.close(); server.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('[test7] HATA:', e); process.exit(1); });
