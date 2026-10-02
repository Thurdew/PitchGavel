// Faz 18 doğrulama scripti: Bilgisayara Karşı Oyna (bot, bkz. claude.md).
//  (A) Birim testleri — BotBrain'in değerleme/teklif/dizilim kararları.
//  (B) Uçtan uca — gerçek sunucuda canlı, kör ve çark modunda bota karşı tam bir oyun: draft
//      tamamlanıyor, bot kendi dizilimini gönderiyor, maç tek insan onayıyla başlıyor, coin
//      verilmiyor, duraklatma ve tekrar oyna çalışıyor.
const assert = require('assert');

process.env.DRAFT_AUCTION_SECONDS = process.env.DRAFT_AUCTION_SECONDS || '2';
process.env.DRAFT_BLIND_SECONDS = process.env.DRAFT_BLIND_SECONDS || '2';
process.env.DRAFT_WHEEL_SECONDS = process.env.DRAFT_WHEEL_SECONDS || '3';
process.env.DRAFT_WHEEL_AUTO_RESOLVE_MS = process.env.DRAFT_WHEEL_AUTO_RESOLVE_MS || '200';
process.env.DRAFT_ROUND_DELAY_MS = process.env.DRAFT_ROUND_DELAY_MS || '200';
process.env.DRAFT_ANTI_SNIPE_WINDOW_MS = process.env.DRAFT_ANTI_SNIPE_WINDOW_MS || '300';
process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS = process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS || '300';
process.env.BOT_TICK_MS = process.env.BOT_TICK_MS || '80';
process.env.BOT_WHEEL_PICK_DELAY_MS = process.env.BOT_WHEEL_PICK_DELAY_MS || '150';
process.env.RESEND_API_KEY = '';

// ---------- (A) Birim testleri ----------
function unitTests() {
  const brain = require('../src/bot/BotBrain');
  const { FORMATIONS } = require('../src/shared/football');
  const { MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');

  for (const f of Object.keys(FORMATIONS)) {
    const w = brain.groupWeights(f);
    assert(w.GK > 0 && w.DF > 0 && w.MF > 0 && w.FW > 0, `${f}: tüm ağırlıklar pozitif olmalı`);
    assert(w.GK > w.MF, `${f}: tek kaleci puanı bir orta saha puanından değerli olmalı`);
  }
  console.log('[test18] mevki ağırlıkları maç motorundan türetiliyor ✅');

  const mk = (rating) => ({ id: `p${rating}`, rating, eligibleSlots: [{ slot: 'ST' }] });
  const bot = { clientId: 'bot', budget: 1000, squad: [], slotsNeeded: { GK: 1, CB: 2, LB: 1, RB: 1, CM: 2, LM: 1, RM: 1, ST: 2 } };
  const room = { formation: '4-4-2', draft: { bigGapSlots: new Set(['GK']) }, players: [bot, { clientId: 'h', budget: 1000, squad: [] }] };
  const normal = { slotType: 'ST', main: mk(85), backups: [mk(80)], participantIds: ['bot', 'h'], highestBid: 0, highestBidderClientId: null };
  const huge = { ...normal, main: mk(88), backups: [mk(70)] };
  const none = { ...normal, main: mk(80), backups: [mk(80)] };
  const cNormal = brain.auctionCeiling(room, bot, normal);
  const cHuge = brain.auctionCeiling(room, bot, huge);
  const cNone = brain.auctionCeiling(room, bot, none);
  assert(cHuge > cNormal, `büyük fark turu daha değerli olmalı (${cHuge} > ${cNormal})`);
  assert.strictEqual(cNone, MIN_PLAYER_PRICE, 'yedekle aynı reytingteki ana oyuncuya fazladan para verilmemeli');
  assert(cNormal < 200, `ilk turda bütçenin çoğu tek oyuncuya gitmemeli (${cNormal})`);

  const lastBot = { clientId: 'bot', budget: 400, squad: new Array(10).fill({}), slotsNeeded: { ST: 1 } };
  const lastRoom = { ...room, players: [lastBot, room.players[1]] };
  assert.strictEqual(brain.auctionCeiling(lastRoom, lastBot, normal), 400, 'son slotta bütçenin tamamı açılmalı');
  console.log('[test18] tavan fiyat: fark büyüdükçe artıyor, farksız turda min, son slotta tüm bütçe ✅');

  assert.strictEqual(brain.liveBidDecision(room, bot, { ...normal, highestBid: 50, highestBidderClientId: 'bot' }), null, 'öndeyken teklif vermemeli');
  assert.strictEqual(brain.liveBidDecision(room, bot, { ...normal, highestBid: 0 }), MIN_PLAYER_PRICE, 'ilk teklif minimum');
  assert.strictEqual(brain.liveBidDecision(room, bot, { ...normal, highestBid: cNormal, highestBidderClientId: 'h' }), null, 'tavanı aşınca bırakmalı');
  console.log('[test18] canlı teklif: minimum artış, öndeyken bekleme, tavanda bırakma ✅');

  const poor = { clientId: 'h', budget: 120, squad: new Array(5).fill({}), slotsNeeded: {} };
  const poorRoom = { ...room, players: [bot, poor] };
  const blind = brain.blindBidDecision(poorRoom, bot, huge, [{ ratio: 5 }]);
  assert(blind <= 120 - 5 * MIN_PLAYER_PRICE + 1, `rakibin tavanını 1 geçmek yeterli (${blind})`);
  assert.strictEqual(brain.blindBidDecision(room, bot, normal, [{ ratio: 5 }, { ratio: 5 }]), MIN_PLAYER_PRICE, 'geçemeyeceği turda en düşük teklif');
  console.log('[test18] kör teklif: rakip tavanı + 1, kaybedilecek turda en düşük fiyat ✅');

  const t = brain.expectedPoints({ GK: 80, DF: 80, MF: 80, FW: 80 }, 'balanced', { GK: 60, DF: 60, MF: 60, FW: 60 }, 'balanced', true);
  assert(t > 2, `güçlü takım evinde beklenen puan yüksek olmalı (${t})`);
  console.log('[test18] beklenen puan hesabı ✅');
}

// ---------- (B) Uçtan uca ----------
async function e2eTest() {
  const { server, roomManager } = require('../src/index');
  const { io: ioClient } = require('socket.io-client');
  const { SQUAD_SIZE, STARTING_BUDGET } = require('../src/shared/gameConfig');
  const { validateAssignment } = require('../src/lineup/lineup');
  const PORT = 3983;

  function connect() { return ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] }); }
  function once(socket, event) { return new Promise((resolve) => socket.once(event, resolve)); }
  function emitAck(socket, event, payload) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('[test18] sunucu ayakta, port', PORT);

  async function playAgainstBot(draftMode) {
    const s = connect();
    await once(s, 'connect');
    const clientId = `human-${draftMode}-${Date.now()}`;
    let coinsAwarded = false;
    s.on('coins:awarded', () => { coinsAwarded = true; });
    let latest = null;
    s.on('draft:update', (m) => { latest = m; });

    const res = await emitAck(s, 'room:createBot', { clientId, clientSecret: `seat-secret-${clientId}`, name: 'İnsan', draftMode, playerPool: 'all' });
    assert(res.room && res.room.code, 'oda kurulmalı: ' + JSON.stringify(res));
    const code = res.room.code;
    assert.strictEqual(res.room.status, 'draft', 'draft hemen başlamalı');
    assert.strictEqual(res.room.players.length, 2);
    const botPub = res.room.players.find((p) => p.isBot);
    assert(botPub && botPub.connected, 'botta isBot + connected olmalı');
    const room = roomManager.getRoom(code);
    const bot = room.players.find((p) => p.isBot);
    // Draft başı geri sayımı: ilk tur ~5 sn boyunca açılmaz.
    assert.strictEqual(room.draft.round, null, 'geri sayım bitmeden tur açılmamalı');
    assert(room.draft.startsAt - Date.now() > 3500, 'geri sayım ~5 sn olmalı');
    await sleep(2000);
    assert.strictEqual(room.draft.round, null, 'geri sayım sürerken hâlâ tur yok');

    // İnsan: canlıda bazen az teklif verir, körde rastgele yazar, çarkta çevirip bilgisayara seçtirir.
    let lastKey = null;
    let pausedOnce = false;
    const started = Date.now();
    while (room.status === 'draft' && Date.now() - started < 150_000) {
      const r = latest && latest.round;
      if (r && r.participantIds && r.participantIds.includes(clientId)) {
        const key = `${r.main && r.main.id}@${r.deadline}`;
        if (r.kind === 'auction' && key !== lastKey && Math.random() < 0.5) {
          lastKey = key;
          await emitAck(s, 'draft:bid', { code, amount: (r.highestBid || 0) + 5 + Math.floor(Math.random() * 30) });
        } else if (r.kind === 'blind_auction' && key !== lastKey) {
          lastKey = key;
          await emitAck(s, 'draft:bid', { code, amount: 10 + Math.floor(Math.random() * 60) });
        }
      }
      if (r && r.kind === 'wheel' && r.clientId === clientId) {
        if (r.phase === 'awaiting_spin') await emitAck(s, 'draft:spinWheel', { code });
        else if (r.phase === 'awaiting_pick') await emitAck(s, 'draft:wheelAutoPick', { code });
      }
      // Bir kez duraklat: bot da oy verip duraklatmayı tamamlamalı, sonra devam.
      if (!pausedOnce && room.draft && room.draft.round && bot.squad.length >= 2) {
        pausedOnce = true;
        await emitAck(s, 'draft:pauseToggle', { code });
        await sleep(400);
        assert.strictEqual(room.draft.paused, true, 'tek insan duraklatınca bot da katılmalı');
        await emitAck(s, 'draft:pauseToggle', { code });
        await sleep(400);
        assert.strictEqual(room.draft.paused, false, 'insan vazgeçince devam etmeli');
      }
      await sleep(60);
    }
    assert.notStrictEqual(room.status, 'draft', `${draftMode}: draft zaman aşımına uğradı`);

    for (const p of room.players) {
      assert.strictEqual(p.squad.length, SQUAD_SIZE, `${draftMode}: ${p.name} kadrosu ${SQUAD_SIZE} olmalı`);
      assert(p.budget >= 0, 'bütçe eksiye düşmemeli');
    }
    const human = room.players.find((p) => p.clientId === clientId);
    const ids = new Set(human.squad.map((e) => e.player.id));
    assert(!bot.squad.some((e) => ids.has(e.player.id)), 'münhasır sahiplik');
    if (draftMode !== 'wheel') {
      const botWins = bot.squad.filter((e) => e.reason === 'auction_won' || e.reason === 'blind_auction_won').length;
      assert(botWins > 0, `${draftMode}: bot en az bir açık arttırma kazanmalı`);
      assert(bot.budget < STARTING_BUDGET, 'bot para harcamalı');
    }
    console.log(`[test18] ${draftMode}: draft bota karşı tamamlandı (bot kalan bütçe ${bot.budget}, duraklatma çalıştı) ✅`);

    // Bot dizilimini kendisi gönderir.
    await sleep(500);
    const bs = room.squads[bot.clientId];
    assert(bs && bs.home && bs.away, 'bot ev+deplasman dizilimini göndermeli');
    for (const side of ['home', 'away']) {
      const assignment = bs[side].lineup.map((e) => e.squadIndex);
      assert(validateAssignment(bot.squad, bs[side].formation, assignment).valid, `bot ${side} dizilimi geçerli olmalı`);
      assert(['balanced', 'attack', 'defensive', 'counter'].includes(bs[side].tactic));
    }

    const opts = await emitAck(s, 'lineup:options', { code });
    const pick = opts.options.find((o) => o.feasible);
    const assignment = pick.suggestedLineup.map((e) => e.squadIndex);
    await emitAck(s, 'lineup:submit', { code, matchSide: 'home', formation: pick.formation, assignment });
    await emitAck(s, 'lineup:submit', { code, matchSide: 'away', formation: pick.formation, assignment });
    await sleep(300);
    assert.strictEqual(room.status, 'match', 'iki taraf dizilimi gönderince maç fazı');

    const sim = await emitAck(s, 'match:simulate', { code });
    assert(sim.ok && sim.result && sim.result.fixtures.length === 1, 'tek insan onayıyla maç oynanmalı: ' + JSON.stringify(sim).slice(0, 200));
    await sleep(300);
    assert.strictEqual(coinsAwarded, false, 'bota karşı coin verilmemeli');

    const skip = await emitAck(s, 'match:playbackSkipToggle', { code });
    assert.strictEqual(skip.playbackSync.skip, true, 'sonuca geç tek insan oyuyla geçerli olmalı');
    console.log(`[test18] ${draftMode}: bot dizilimi geçerli, maç tek onayla oynandı, coin yok, sonuca geç çalıştı ✅`);
    return { s, code, room, clientId };
  }

  await playAgainstBot('live');
  await playAgainstBot('blind');
  const { s, code, room, clientId } = await playAgainstBot('wheel');

  // Tekrar oyna: lobiye döner, bot hazır olur, insan hazır + başlat ile yeni draft başlar.
  const re = await emitAck(s, 'room:rematch', { code });
  assert(re.ok);
  await sleep(300);
  const bot = room.players.find((p) => p.isBot);
  assert(room.readyVotes.has(bot.clientId), 'bot lobide hazır görünmeli');
  await emitAck(s, 'draft:readyToggle', { code });
  const st = await emitAck(s, 'draft:start', { code });
  assert(st.ok, 'tekrar oyna sonrası draft başlamalı: ' + JSON.stringify(st));
  assert.strictEqual(room.status, 'draft');
  assert.strictEqual(room.hostClientId, clientId, 'host insan kalmalı');
  console.log('[test18] tekrar oyna: bot hazır, draft yeniden başladı ✅');

  s.close();
  await sleep(200);
  assert.strictEqual(room.hostClientId, clientId, 'insan ayrılınca host bota geçmemeli');
  console.log('[test18] (B) UÇTAN UCA TESTİ TÜM GEÇTİ ✅');
  server.close();
}

async function main() {
  unitTests();
  await e2eTest();
  console.log('[test18] TÜM TESTLER GEÇTİ ✅');
  process.exit(0);
}

main().catch((e) => { console.error('[test18] HATA:', e); process.exit(1); });
