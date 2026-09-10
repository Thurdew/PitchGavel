// Faz 8 doğrulama scripti: Hazırlık Çarkı (bkz. claude.md "Hazırlık Çarkı" + "Hazırlık Çarkı
// Tam Sürüm") — kör draft/açık arttırma için isteğe bağlı, formasyon kurasından ÖNCE, SIRAYLA
// (turn-based — Çark Modu'ndaki nextWheelTurn ile aynı desen) çevrilen bir perk çarkı.
//  (A) Saf birim testleri (sunucu ayağa kaldırmadan) — applyPrepPerk'in 9 segment türünü de
//      doğru uyguladığını, personalMaxBid/submitBid'in ceiling_reduction/anti_snipe_shield'ı
//      doğru işlediğini, 🃏 Joker Turu'nun nextRound'da rekabetsiz+ücretsiz kazandırdığını,
//      👁️ Gözcü'nün (peekBids) SADECE çağırana teklifleri açtığını ve bir kereye mahsus olduğunu.
//  (B) Uçtan uca bot testi (gerçek socket) — TURN-BASED faz geçişleri (sırası gelmeyen biri
//      çeviremez/atlayamaz — NOT_YOUR_TURN), süre dolunca otomatik "risk almadan devam et",
//      ve perk'li bir draftın normal şekilde tamamlandığını.
const assert = require('assert');

// ---------- (A) Birim testleri ----------
function unitTests() {
  const { DraftEngine, personalMaxBid, slotCounts } = require('../src/draft/DraftEngine');
  const {
    PREP_WHEEL_SEGMENTS, PREP_WHEEL_BUDGET_BONUS, PREP_WHEEL_BUDGET_PENALTY,
    PREP_WHEEL_GAMBLER_AMOUNT, PREP_WHEEL_CEILING_REDUCTION, MIN_PLAYER_PRICE,
  } = require('../src/shared/gameConfig');

  const fakeIo = { to: () => ({ emit: () => {} }) };
  const fakeRoomManager = { toPublicState: () => ({}) };
  const engine = new DraftEngine(fakeIo, fakeRoomManager);

  function makePlayer(budget = 1000) {
    return { clientId: 'p1', budget, squad: [], prepPerk: null };
  }

  // --- applyPrepPerk: 9 segment türünün her biri ---
  assert.strictEqual(PREP_WHEEL_SEGMENTS.length, 9, 'katalog tam 9 segment olmalı (7 MVP + joker + spy)');
  for (const seg of PREP_WHEEL_SEGMENTS) {
    assert(seg.description && seg.description.length > 10, `${seg.kind} bir açıklama içermeli (kullanıcı isteği: "çarktaki şeylerin özelliklerini açıkla")`);
    const player = makePlayer(1000);
    const perk = engine.applyPrepPerk(player, seg);
    assert.strictEqual(perk.kind, seg.kind, `perk.kind seg.kind ile eşleşmeli: ${seg.kind}`);
    assert.strictEqual(perk.description, seg.description, 'perk.description taşınmalı');
    if (seg.kind === 'budget_bonus') {
      assert.strictEqual(player.budget, 1000 + PREP_WHEEL_BUDGET_BONUS);
      assert.strictEqual(perk.active, false);
    } else if (seg.kind === 'budget_penalty') {
      assert.strictEqual(player.budget, 1000 - PREP_WHEEL_BUDGET_PENALTY);
      assert.strictEqual(perk.active, false);
    } else if (seg.kind === 'gambler') {
      assert(player.budget === 1000 + PREP_WHEEL_GAMBLER_AMOUNT || player.budget === 1000 - PREP_WHEEL_GAMBLER_AMOUNT);
      assert.strictEqual(perk.active, false);
    } else {
      // anti_snipe_shield / free_backup / ceiling_reduction / blind_first_round / joker / spy
      assert.strictEqual(player.budget, 1000, `${seg.kind} bütçeyi DEĞİŞTİRMEMELİ`);
      assert.strictEqual(perk.active, true, `${seg.kind} tüketilene kadar active:true kalmalı`);
    }
  }
  console.log('[test8] applyPrepPerk 9 segment türü de doğru uygulandı (açıklamalar dahil) ✅');

  // --- personalMaxBid: ceiling_reduction ---
  const baseCap = personalMaxBid(makePlayer(1000));
  const reducedPlayer = makePlayer(1000);
  reducedPlayer.prepPerk = { kind: 'ceiling_reduction', active: true };
  const reducedCap = personalMaxBid(reducedPlayer);
  assert.strictEqual(reducedCap, Math.floor(baseCap * (1 - PREP_WHEEL_CEILING_REDUCTION)));
  console.log(`[test8] personalMaxBid ceiling_reduction doğru çalışıyor (${baseCap} -> ${reducedCap}) ✅`);

  // --- submitBid: anti_snipe_shield ---
  const engine2 = new DraftEngine(fakeIo, fakeRoomManager);
  engine2.emitDraft = () => {}; // broadcast şeklini değil, sadece deadline matematiğini doğruluyoruz
  function makeRoundRoom(bidderPerk) {
    const bidder = { clientId: 'b1', budget: 1000, squad: [], prepPerk: bidderPerk };
    return {
      draft: {
        paused: false,
        round: {
          kind: 'auction', participantIds: ['b1'], bids: new Map(),
          highestBid: 0, highestBidderClientId: null,
          deadline: Date.now() + 100, // DRAFT_ANTI_SNIPE_WINDOW_MS=350 (aşağıda) > 100 -> kalkansız tetiklenmeli
          timer: null,
        },
      },
      players: [bidder],
    };
  }
  const roomNoShield = makeRoundRoom(null);
  const deadlineBefore1 = roomNoShield.draft.round.deadline;
  assert(engine2.submitBid(roomNoShield, 'b1', MIN_PLAYER_PRICE).ok);
  assert(roomNoShield.draft.round.deadline > deadlineBefore1, 'kalkan YOKKEN anti-snipe deadline\'ı uzatmalı');
  // [ÖNEMLİ] Bu GERÇEK bir setTimeout kurdu — sahte/eksik odayla ateşlenirse çökebilir (daha önce
  // tam olarak bu şekilde bulunmuş bir bug). Testin geri kalanı çalışırken arka planda patlamasın.
  clearTimeout(roomNoShield.draft.round.timer);

  const roomWithShield = makeRoundRoom({ kind: 'anti_snipe_shield', active: true });
  const deadlineBefore2 = roomWithShield.draft.round.deadline;
  assert(engine2.submitBid(roomWithShield, 'b1', MIN_PLAYER_PRICE).ok);
  assert.strictEqual(roomWithShield.draft.round.deadline, deadlineBefore2, 'kalkan VARKEN anti-snipe deadline\'ı uzatMAMALI');
  console.log('[test8] anti_snipe_shield perk\'i deadline uzatmasını doğru şekilde engelliyor ✅');

  // --- 🃏 Joker Turu: nextRound rekabetsiz + ücretsiz kazandırmalı ---
  const engine3 = new DraftEngine(fakeIo, fakeRoomManager);
  let jokerEvent = null;
  engine3.emitDraft = (room, extra) => { if (extra && extra.event) jokerEvent = extra.event; };
  const formation = '4-4-2';
  const jokerPlayer = { clientId: 'j1', budget: 1000, squad: [], slotsNeeded: slotCounts(formation), prepPerk: { kind: 'joker', label: '🃏 Joker Turu', active: true } };
  const otherPlayer = { clientId: 'j2', budget: 1000, squad: [], slotsNeeded: slotCounts(formation), prepPerk: null };
  const jokerRoom = {
    status: 'draft', draftMode: 'live', playerPool: 'all',
    draft: { paused: false, takenIds: new Set(), round: null, history: [], bigGapSlots: new Set(), cascade: null },
    players: [jokerPlayer, otherPlayer],
  };
  engine3.nextRound(jokerRoom);
  assert.strictEqual(jokerPlayer.prepPerk.active, false, 'joker kullanılınca tükenmeli');
  assert.strictEqual(jokerPlayer.squad.length, 1, 'joker sahibine bir oyuncu atanmalı');
  assert.strictEqual(jokerPlayer.squad[0].price, 0, 'joker ile kazanılan oyuncu 0₺ olmalı (tamamen ücretsiz)');
  assert.strictEqual(jokerPlayer.squad[0].reason, 'joker');
  assert.strictEqual(otherPlayer.squad.length, 0, 'diğer oyuncu bu turdan etkilenmemeli');
  assert(jokerEvent && jokerEvent.type === 'joker_used' && jokerEvent.clientId === 'j1', 'joker_used event\'i yayınlanmalı: ' + JSON.stringify(jokerEvent));
  // [ÖNEMLİ] nextRound'un joker dalı da bir setTimeout kurdu (ROUND_RESULT_DELAY_MS sonra tekrar
  // nextRound çağırır) — sahte odayı DRAFT durumundan çıkarıp o zincirin devam etmesini engelliyoruz.
  jokerRoom.status = 'cancelled-for-test-cleanup';
  console.log('[test8] 🃏 Joker Turu — rekabetsiz + ücretsiz (0₺) kazanım doğru çalışıyor ✅');

  // --- 👁️ Gözcü: peekBids SADECE çağırana teklifleri açmalı, bir kereye mahsus ---
  const engine4 = new DraftEngine(fakeIo, fakeRoomManager);
  const spyPlayer = { clientId: 's1', budget: 1000, squad: [], prepPerk: { kind: 'spy', label: '👁️ Gözcü', active: true } };
  const otherBidder = { clientId: 's2', budget: 1000, squad: [], prepPerk: null };
  const bids = new Map();
  bids.set('s2', { amount: 42, at: Date.now() });
  const spyRoom = { draft: { round: { kind: 'blind_auction', participantIds: ['s1', 's2'], bids } }, players: [spyPlayer, otherBidder] };
  const peekRes = engine4.peekBids(spyRoom, 's1');
  assert(peekRes.ok, 'gözcü hakkı kullanılabilmeli: ' + JSON.stringify(peekRes));
  assert.strictEqual(peekRes.bids.s2, 42, 'rakibin kilitlediği teklif görünmeli');
  assert.strictEqual(peekRes.bids.s1, null, 'kendi teklif vermemişse null dönmeli');
  assert.strictEqual(spyPlayer.prepPerk.active, false, 'gözcü kullanılınca tükenmeli');
  const peekRes2 = engine4.peekBids(spyRoom, 's1');
  assert.strictEqual(peekRes2.error, 'NO_SPY_AVAILABLE', 'ikinci kez kullanılmaya çalışılınca reddedilmeli: ' + JSON.stringify(peekRes2));
  // Katılımcı olmayan biri de kullanamaz.
  const peekResOutsider = engine4.peekBids(spyRoom, 'nobody');
  assert.strictEqual(peekResOutsider.error, 'NOT_A_PARTICIPANT');
  console.log('[test8] 👁️ Gözcü — SADECE çağırana açılıyor, bir kereye mahsus ✅');

  console.log('[test8] (A) BİRİM TESTLERİ TÜM GEÇTİ ✅');
}

// ---------- (B) Uçtan uca bot testi ----------
process.env.DRAFT_AUCTION_SECONDS = process.env.DRAFT_AUCTION_SECONDS || '1';
process.env.DRAFT_ROUND_DELAY_MS = process.env.DRAFT_ROUND_DELAY_MS || '250';
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = process.env.DRAFT_ANTI_SNIPE_WINDOW_MS || '350';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS || '350';
process.env.DRAFT_PREP_WHEEL_SECONDS = process.env.DRAFT_PREP_WHEEL_SECONDS || '2';

async function e2eTest() {
  const { server, io, roomManager } = require('../src/index');
  const { io: ioClient } = require('socket.io-client');
  const { SQUAD_SIZE, MIN_PLAYER_PRICE, PREP_WHEEL_SEGMENTS } = require('../src/shared/gameConfig');
  const validKinds = new Set(PREP_WHEEL_SEGMENTS.map((s) => s.kind));

  const PORT = 3992;
  function connect() { return ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] }); }
  function once(socket, event) { return new Promise((resolve) => socket.once(event, resolve)); }
  function emitAck(socket, event, payload) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test8] sunucu ayakta, port', PORT);

  // --- Regresyon: prepWheelEnabled verilmezse (varsayılan kapalı) draft doğrudan başlamalı ---
  {
    const s0 = connect(), s1 = connect();
    await Promise.all([once(s0, 'connect'), once(s1, 'connect')]);
    const created = await emitAck(s0, 'room:create', { clientId: 'reg-0', name: 'R0' });
    assert.strictEqual(created.room.prepWheelEnabled, false, 'varsayılan prepWheelEnabled false olmalı');
    await emitAck(s1, 'room:join', { clientId: 'reg-1', name: 'R1', code: created.room.code });
    await emitAck(s0, 'draft:readyToggle', { code: created.room.code });
    await emitAck(s1, 'draft:readyToggle', { code: created.room.code });
    const start = await emitAck(s0, 'draft:start', { code: created.room.code });
    assert(start.ok, 'draft başlamalı: ' + JSON.stringify(start));
    const room = roomManager.getRoom(created.room.code);
    assert.strictEqual(room.status, 'draft', 'prepWheelEnabled kapalıyken doğrudan draft\'a geçmeli, oldu: ' + room.status);
    s0.close(); s1.close();
    console.log('[test8] regresyon: prepWheelEnabled kapalıyken prep_wheel fazı ATLANIYOR ✅');
  }

  // --- Regresyon: Çark Modu'nda prepWheelEnabled=true gönderilse bile sunucu zorla kapatmalı ---
  {
    const s0 = connect();
    await once(s0, 'connect');
    const created = await emitAck(s0, 'room:create', { clientId: 'wheelreg-0', name: 'W0', draftMode: 'wheel', prepWheelEnabled: true });
    assert.strictEqual(created.room.prepWheelEnabled, false, 'Çark Modu\'nda prepWheelEnabled her zaman false olmalı: ' + JSON.stringify(created.room));
    s0.close();
    console.log('[test8] regresyon: Çark Modu\'nda Hazırlık Çarkı zorla kapalı ✅');
  }

  // --- Asıl test: prepWheelEnabled=true, N=3, TURN-BASED sıra + bağımsız kararlar ---
  const N = 3;
  const ids = Array.from({ length: N }, (_, i) => `pw-player-${i}`);
  const sockets = Array.from({ length: N }, () => connect());
  await Promise.all(sockets.map((s) => once(s, 'connect')));

  const created = await emitAck(sockets[0], 'room:create', { clientId: ids[0], name: 'P0', prepWheelEnabled: true });
  assert.strictEqual(created.room.prepWheelEnabled, true, 'oda prepWheelEnabled:true ile kurulmalı');
  const code = created.room.code;
  for (let i = 1; i < N; i++) await emitAck(sockets[i], 'room:join', { clientId: ids[i], name: `P${i}`, code });
  for (let i = 0; i < N; i++) await emitAck(sockets[i], 'draft:readyToggle', { code });

  const resolvedEvents = [];
  for (const s of sockets) s.on('prepWheel:resolved', (ev) => resolvedEvents.push(ev));

  const startRes = await emitAck(sockets[0], 'draft:start', { code });
  assert(startRes.ok, 'draft:start (prep wheel fazına girmeli) başarılı olmalı: ' + JSON.stringify(startRes));
  let room = roomManager.getRoom(code);
  assert.strictEqual(room.status, 'prep_wheel', 'draft:start sonrası status prep_wheel olmalı, oldu: ' + room.status);
  assert.strictEqual(room.prepWheel.cursor, 0, 'faz cursor=0 ile başlamalı');
  assert.strictEqual(room.prepWheel.order.length, N, 'sıra TÜM oyuncuları kapsamalı');
  assert.strictEqual(new Set(room.prepWheel.order).size, N, 'sırada her clientId TEK kez olmalı');
  console.log('[test8] draft:start sonrası faz doğru: prep_wheel, sıra kuruldu ✅');

  const firstTurnId = room.prepWheel.order[0];
  const firstTurnIdx = ids.indexOf(firstTurnId);
  const secondSocketIdx = ids.findIndex((id, i) => i !== firstTurnIdx); // sıradaki herhangi biri (henüz sırası gelmemiş)

  // TURN-BASED: sırası gelmeyen biri çeviremez/atlayamaz.
  const wrongTurnSpin = await emitAck(sockets[secondSocketIdx], 'draft:prepWheelSpin', { code });
  assert.strictEqual(wrongTurnSpin.error, 'NOT_YOUR_TURN', 'sırası gelmeyen biri çeviremez: ' + JSON.stringify(wrongTurnSpin));
  const wrongTurnSkip = await emitAck(sockets[secondSocketIdx], 'draft:prepWheelSkip', { code });
  assert.strictEqual(wrongTurnSkip.error, 'NOT_YOUR_TURN', 'sırası gelmeyen biri atlayamaz: ' + JSON.stringify(wrongTurnSkip));
  console.log('[test8] sırası gelmeyen oyuncu çeviremiyor/atlayamıyor (NOT_YOUR_TURN) ✅');

  // 1. sıradaki oyuncu çevirir.
  const spinRes = await emitAck(sockets[firstTurnIdx], 'draft:prepWheelSpin', { code });
  assert(spinRes.ok, 'sırası gelen çevirebilmeli: ' + JSON.stringify(spinRes));
  assert(validKinds.has(spinRes.perk.kind), `dönen perk kataloğa ait olmalı: ${spinRes.perk.kind}`);
  console.log(`[test8] 1. sıradaki (${firstTurnId}) çevirdi: ${spinRes.perk.label} (${spinRes.perk.kind})`);

  room = roomManager.getRoom(code);
  assert.strictEqual(room.prepWheel.cursor, 1, 'çevirince sıra bir sonrakine geçmeli');
  // Artık sırası geçmiş olan ilk oyuncu tekrar karar veremez.
  const pastTurnAgain = await emitAck(sockets[firstTurnIdx], 'draft:prepWheelSpin', { code });
  assert.strictEqual(pastTurnAgain.error, 'NOT_YOUR_TURN', 'sırası geçmiş biri tekrar çeviremez: ' + JSON.stringify(pastTurnAgain));

  // 2. sıradaki oyuncu risk almadan devam eder.
  const secondTurnId = room.prepWheel.order[1];
  const secondTurnIdx = ids.indexOf(secondTurnId);
  const skipRes = await emitAck(sockets[secondTurnIdx], 'draft:prepWheelSkip', { code });
  assert(skipRes.ok && skipRes.perk === null, 'sırası gelen atlayabilmeli: ' + JSON.stringify(skipRes));
  console.log(`[test8] 2. sıradaki (${secondTurnId}) risk almadan devam etti ✅`);

  room = roomManager.getRoom(code);
  assert.strictEqual(room.prepWheel.cursor, 2, 'atlayınca da sıra bir sonrakine geçmeli');
  assert.strictEqual(room.status, 'prep_wheel', '3. oyuncu henüz karar vermedi, faz hâlâ prep_wheel olmalı');

  // 3. (son) sıradaki oyuncu HİÇBİR ŞEY yapmaz — süre dolunca otomatik "risk almadan devam et".
  const thirdTurnId = room.prepWheel.order[2];
  const beforeAuto = Date.now();
  while (roomManager.getRoom(code).status === 'prep_wheel' && Date.now() - beforeAuto < 10_000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  room = roomManager.getRoom(code);
  assert.strictEqual(room.status, 'draft', 'süre dolunca faz otomatik olarak draft\'a geçmeli, oldu: ' + room.status);
  assert(room.formation, 'draft\'a geçince formasyon kurası çekilmiş olmalı');
  console.log('[test8] 3. sıradaki karar vermedi, süre doldu, sunucu otomatik "risk almadan devam et" seçip draft\'ı başlattı ✅');

  const firstFinal = room.players.find((p) => p.clientId === firstTurnId);
  const secondFinal = room.players.find((p) => p.clientId === secondTurnId);
  const thirdFinal = room.players.find((p) => p.clientId === thirdTurnId);
  assert(firstFinal.prepPerk && firstFinal.prepPerk.kind === spinRes.perk.kind, '1. oyuncunun perk\'i draft state\'inde de görünmeli');
  assert.strictEqual(secondFinal.prepPerk, null, '2. oyuncu hiç perk almamalı (skip etti)');
  assert.strictEqual(thirdFinal.prepPerk, null, '3. oyuncu hiç perk almamalı (auto-skip)');
  console.log('[test8] herkesin prepPerk durumu (herkese açık görünürlük) doğru ✅');

  const autoEvent = resolvedEvents.find((e) => e.clientId === thirdTurnId);
  assert(autoEvent && autoEvent.auto === true, '3. oyuncu için auto:true ile bir prepWheel:resolved event\'i gelmeli: ' + JSON.stringify(autoEvent));

  // ---------- Draftın geri kalanını normal şekilde tamamla (regresyon: perk'li draft da normal biter) ----------
  let latestDraftUpdate = null;
  let completeEvents = 0;
  for (const s of sockets) {
    s.on('draft:update', (msg) => { latestDraftUpdate = msg; });
    s.on('draft:complete', () => completeEvents++);
  }
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
  const started = Date.now();
  while (completeEvents < N && Date.now() - started < 120_000) {
    await autoBidTick();
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(completeEvents >= 1, 'draft:complete en az bir kez gelmeli');

  const roomAfter = roomManager.getRoom(code);
  let overlapFound = false;
  const allIds = new Set();
  let freeBackupObserved = false;
  let jokerObserved = false;
  for (const p of roomAfter.players) {
    assert.strictEqual(p.squad.length, SQUAD_SIZE, `${p.name} kadrosu tam ${SQUAD_SIZE} olmalı, oldu: ${p.squad.length}`);
    assert(p.budget >= 0, `${p.name} bütçesi negatif olamaz: ${p.budget}`);
    for (const entry of p.squad) {
      if (allIds.has(entry.player.id)) overlapFound = true;
      allIds.add(entry.player.id);
      if (entry.price === 0) {
        // live/blind modda price:0 SADECE free_backup ya da joker perk'iyle mümkün olabilir.
        assert(entry.reason === 'cascade_uncontested' || entry.reason === 'joker',
          `price:0 beklenmedik bir reason'la geldi: ${entry.reason}`);
        if (entry.reason === 'cascade_uncontested') {
          freeBackupObserved = true;
          assert.strictEqual(p.prepPerk && p.prepPerk.kind, 'free_backup', `${p.name}'in perk'i free_backup olmalıydı: ${JSON.stringify(p.prepPerk)}`);
        } else {
          jokerObserved = true;
          assert.strictEqual(p.prepPerk && p.prepPerk.kind, 'joker', `${p.name}'in perk'i joker olmalıydı: ${JSON.stringify(p.prepPerk)}`);
        }
        assert.strictEqual(p.prepPerk.active, false, `${entry.reason} kullanılınca active:false olmalı`);
      }
    }
  }
  assert(!overlapFound, 'münhasır sahiplik ihlali olmamalı');
  console.log(`[test8] draft normal şekilde tamamlandı — kadrolar tam, bütçeler negatif değil, çakışma yok (free_backup: ${freeBackupObserved}, joker: ${jokerObserved}) ✅`);

  console.log('[test8] (B) UÇTAN UCA TESTİ TÜM GEÇTİ ✅');

  for (const s of sockets) s.close();
  io.close(); server.close();
}

async function main() {
  unitTests();
  await e2eTest();
  console.log('[test8] TÜM TESTLER GEÇTİ ✅');
  process.exit(0);
}

main().catch((e) => { console.error('[test8] HATA:', e); process.exit(1); });
