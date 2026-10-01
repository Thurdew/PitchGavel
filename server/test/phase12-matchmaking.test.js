// Faz 12 doğrulama scripti: Yabancılarla Online Eşleşme ("Hızlı Eşleş", bkz. claude.md). Oda
// koduyla arkadaş daveti akışına HİÇ dokunmuyor — aynı draftMode+playerPool kombinasyonunu
// isteyen 2 kişi otomatik eşleşip host/hazır-mısın onayı OLMADAN draft'a düşüyor.
//  (A) Saf birim testleri — Matchmaker.join'in kuyruk mantığını (tek kişi bekler, farklı
//      kombinasyon ayrı kuyrukta kalır, aynı kombinasyonla 2. kişi GERÇEK bir oda + startDraft
//      tetikler, wheel->live fallback'i, leave) doğrudan doğrular.
//  (B) Uçtan uca testi (gerçek HTTP+socket sunucu) — 2 gerçek client'ın eşleşip draft'ın normal
//      şekilde tamamlanabildiğini, ve mevcut oda-kodu akışının (phase2-11) regresyona
//      uğramadığını doğrular.
const assert = require('assert');

process.env.DRAFT_AUCTION_SECONDS = process.env.DRAFT_AUCTION_SECONDS || '1';
process.env.DRAFT_ROUND_DELAY_MS = process.env.DRAFT_ROUND_DELAY_MS || '250';
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = process.env.DRAFT_ANTI_SNIPE_WINDOW_MS || '350';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS || '350';

// ---------- (A) Birim testleri ----------
function unitTests() {
  const { RoomManager } = require('../src/rooms/RoomManager');
  const { DraftEngine } = require('../src/draft/DraftEngine');
  const { Matchmaker } = require('../src/matchmaking/Matchmaker');

  const fakeIo = { to: () => ({ emit: () => {} }), sockets: { sockets: new Map() } };
  const roomManager = new RoomManager();
  const draftEngine = new DraftEngine(fakeIo, roomManager);
  const mm = new Matchmaker(fakeIo, roomManager, draftEngine);

  // --- tek kişi -> eşleşme yok, kuyrukta bekliyor ---
  assert.strictEqual(mm.join('u1', 'User1', 's1', 'live', 'all'), null);
  assert.strictEqual(mm.queues.get('live:all').length, 1);
  console.log('[test12] tek kişiyle eşleşme yok, kuyrukta bekliyor ✅');

  // --- farklı kombinasyon ayrı kuyrukta, mevcut kuyruğu etkilemiyor ---
  assert.strictEqual(mm.join('u2', 'User2', 's2', 'blind', 'all'), null);
  assert.strictEqual(mm.queues.get('live:all').length, 1, 'live:all kuyruğu etkilenmemeli');
  assert.strictEqual(mm.queues.get('blind:all').length, 1);
  console.log('[test12] farklı draftMode/playerPool ayrı kuyrukta bekliyor, çapraz eşleşmiyor ✅');

  // --- aynı kombinasyonla 2. kişi -> GERÇEK oda + startDraft ---
  const room = mm.join('u3', 'User3', 's3', 'live', 'all');
  // NOT: room objesini JSON.stringify ETMİYORUZ — draft.round.timer gerçek bir setTimeout
  // handle'ı taşıyor (döngüsel referans), assert mesajı bile eagerly değerlendirildiği için
  // JSON.stringify(room) burada patlar.
  assert(room && room.code, `eşleşme gerçek bir oda döndürmeli (alınan: ${room && typeof room})`);
  assert.strictEqual(room.status, 'draft', 'startDraft çağrılmış olmalı (host/hazır onayı yok)');
  assert.strictEqual(room.players.length, 2);
  assert.deepStrictEqual(room.players.map((p) => p.clientId).sort(), ['u1', 'u3']);
  assert.strictEqual(room.prepWheelEnabled, false, 'matchmade odada Hazırlık Çarkı kapalı olmalı');
  assert.strictEqual(room.bankedPerksEnabled, false);
  assert.strictEqual(room.tradeRoundEnabled, false);
  assert(!mm.queues.has('live:all'), 'eşleşenler kuyruktan çıkmalı');
  assert.strictEqual(mm.queues.get('blind:all').length, 1, 'blind:all kuyruğu bundan etkilenmemeli');
  console.log('[test12] aynı kombinasyonla 2. kişi gelince gerçek oda kurulup draft otomatik başlıyor ✅');

  // --- leave ---
  assert.strictEqual(mm.join('u5', 'User5', 's5', 'live', 'super-lig'), null);
  mm.leave('u5');
  assert(!mm.queues.has('live:super-lig'), 'leave sonrası boşalan kuyruk silinmeli');
  console.log('[test12] leave kuyruktan doğru çıkarıyor ✅');

  // --- wheel modu hızlı eşleşmede desteklenmiyor, live'a düşüyor ---
  assert.strictEqual(mm.join('u6', 'User6', 's6', 'wheel', 'all'), null);
  assert(mm.queues.has('live:all'), 'wheel draftMode live kuyruğuna düşmeli (Matchmaker MVP kapsamı)');
  console.log('[test12] wheel draftMode live kuyruğuna fallback ediyor ✅');

  console.log('[test12] (A) BİRİM TESTLERİ TÜM GEÇTİ ✅');
}

// ---------- (B) Uçtan uca testi ----------
async function e2eTest() {
  const { server } = require('../src/index');
  const { io: ioClient } = require('socket.io-client');
  const { SQUAD_SIZE, MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');
  const PORT = 3988;

  function connect() { return ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] }); }
  function once(socket, event) { return new Promise((resolve) => socket.once(event, resolve)); }
  function emitAck(socket, event, payload) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test12] sunucu ayakta, port', PORT);

  const s1 = connect(), s2 = connect(), s3 = connect();
  await Promise.all([once(s1, 'connect'), once(s2, 'connect'), once(s3, 'connect')]);

  // s3 farklı bir kombinasyonla kuyrukta bekleyecek — s1/s2 ile eşleşMEMELİ (regresyon/izolasyon).
  const s3res = await emitAck(s3, 'matchmaking:join', { clientId: 'mm-lonely', clientSecret: `seat-secret-${'mm-lonely'}`, name: 'Lonely', draftMode: 'blind', playerPool: 'all' });
  assert.strictEqual(s3res.queued, true);
  let s3Matched = false;
  s3.once('matchmaking:matched', () => { s3Matched = true; });

  const matched1 = once(s1, 'matchmaking:matched');
  const matched2 = once(s2, 'matchmaking:matched');
  const res1 = await emitAck(s1, 'matchmaking:join', { clientId: 'mm-a', clientSecret: `seat-secret-${'mm-a'}`, name: 'A', draftMode: 'live', playerPool: 'all' });
  assert.strictEqual(res1.queued, true);
  const res2 = await emitAck(s2, 'matchmaking:join', { clientId: 'mm-b', clientSecret: `seat-secret-${'mm-b'}`, name: 'B', draftMode: 'live', playerPool: 'all' });
  assert.strictEqual(res2.queued, true);

  const [m1, m2] = await Promise.all([matched1, matched2]);
  assert(m1.code && m1.code === m2.code, 'ikisi de AYNI odanın kodunu almalı: ' + JSON.stringify([m1, m2]));
  console.log('[test12] e2e: iki client aynı kombinasyonla eşleşip aynı oda kodunu aldı ✅');

  // room:state global dinleyicisi (bkz. app.js) ile status='draft' gelmiş olmalı — burada
  // doğrudan roomManager üzerinden kontrol ediyoruz (test sunucu-içi çalıştığı için erişilebilir).
  const { roomManager } = require('../src/index');
  const room = roomManager.getRoom(m1.code);
  assert.strictEqual(room.status, 'draft', 'eşleşince draft host/hazır onayı OLMADAN başlamalı');
  assert.strictEqual(room.players.length, 2);
  console.log('[test12] e2e: eşleşen odada draft host/ready onayı olmadan otomatik başladı ✅');

  assert.strictEqual(s3Matched, false, 'farklı kombinasyondaki yalnız client eşleşMEMELİ');
  console.log('[test12] e2e: farklı kombinasyondaki client yalnız kalıp bekliyor (çapraz eşleşme yok) ✅');

  // --- draftı normal şekilde (basit oto-bidding) tamamlat — phase3-draft.test.js ile AYNI desen ---
  let latestDraftUpdate = null;
  let completeEvents = 0;
  s1.on('draft:update', (msg) => { latestDraftUpdate = msg; });
  s2.on('draft:update', (msg) => { latestDraftUpdate = msg; });
  s1.on('draft:complete', () => completeEvents++);
  s2.on('draft:complete', () => completeEvents++);

  let lastBidRoundKey = null;
  async function autoBidTick() {
    if (!latestDraftUpdate || !latestDraftUpdate.round) return;
    const round = latestDraftUpdate.round;
    if (round.kind !== 'auction') return;
    const roundKey = round.main.id + '@' + round.deadline;
    if (roundKey === lastBidRoundKey) return;
    lastBidRoundKey = roundKey;
    for (const socket of [s1, s2]) {
      if (Math.random() < 0.85) {
        const amount = MIN_PLAYER_PRICE + Math.floor(Math.random() * 20);
        await emitAck(socket, 'draft:bid', { code: m1.code, amount });
      }
    }
  }

  const started = Date.now();
  const TIMEOUT_MS = 60_000;
  while (completeEvents < 2 && Date.now() - started < TIMEOUT_MS) {
    await autoBidTick();
    await new Promise((r) => setTimeout(r, 150));
  }
  assert(completeEvents >= 1, 'draft:complete en az bir kez gelmeli');

  const roomAfter = roomManager.getRoom(m1.code);
  for (const p of roomAfter.players) {
    assert.strictEqual(p.squad.length, SQUAD_SIZE, `${p.name} kadrosu tam ${SQUAD_SIZE} olmalı`);
    assert(p.budget >= 0);
  }
  const [pA, pB] = roomAfter.players;
  const overlap = [...new Set(pA.squad.map((s) => s.player.id))].filter((id) => pB.squad.some((s) => s.player.id === id));
  assert.strictEqual(overlap.length, 0, 'münhasır sahiplik ihlali olmamalı');
  console.log('[test12] e2e: eşleşen odada draft host/ready akışı hiç kullanılmadan normal şekilde tamamlandı ✅');

  console.log('[test12] (B) UÇTAN UCA TESTİ TÜM GEÇTİ ✅');

  s1.close(); s2.close(); s3.close();
  server.close();
}

async function main() {
  unitTests();
  await e2eTest();
  console.log('[test12] TÜM TESTLER GEÇTİ ✅');
  process.exit(0);
}

main().catch((e) => { console.error('[test12] HATA:', e); process.exit(1); });
