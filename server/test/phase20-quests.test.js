// Faz 20 doğrulama scripti: Görevler (bkz. claude.md, shared/quests.js).
//  Birim (bellek içi DB, gerçek initSchema): dönem anahtarları (UTC gün, pazartesi başlangıçlı
//  hafta), maç istatistikleri, ilerleme birikmesi, günlük/haftalık sıfırlanma, tek seferlik
//  görevin kalıcılığı, Topla (tamamlanmamış, çift toplama, eşzamanlı toplama, bilinmeyen görev),
//  coin_ledger kaydı, eski satır temizliği. Maç sonu → ilerleme yolu phase15'te uçtan uca test edilir.
process.env.RESEND_API_KEY = '';
process.env.DRAFT_ROUND_DELAY_MS = '1'; // motor testlerinde tur sonrası zamanlayıcı hemen bitsin

const assert = require('assert');

(async () => {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const { wrapSqlite } = require('../src/db/adapter');
    const { initSchema } = require('../src/db/db');
    const { AuthService } = require('../src/auth/AuthService');
    const { CoinService } = require('../src/coins/CoinService');
    const { QuestService, periodOf, resetsAtOf, statsOf } = require('../src/quests/QuestService');
    const { QUESTS } = require('../src/shared/quests');

    // Dönemler — 2026-10-07 çarşamba; haftası 2026-10-05 pazartesi.
    const wed = Date.UTC(2026, 9, 7, 15, 30);
    assert.strictEqual(periodOf('daily', wed), 'D2026-10-07');
    assert.strictEqual(periodOf('weekly', wed), 'W2026-10-05');
    assert.strictEqual(periodOf('weekly', Date.UTC(2026, 9, 11, 23, 59)), 'W2026-10-05', 'pazar aynı hafta');
    assert.strictEqual(periodOf('weekly', Date.UTC(2026, 9, 12, 0, 0)), 'W2026-10-12', 'pazartesi yeni hafta');
    assert.strictEqual(periodOf('weekly', Date.UTC(2026, 9, 5, 0, 0)), 'W2026-10-05');
    assert.strictEqual(periodOf('once', wed), 'O');
    assert.strictEqual(resetsAtOf('daily', wed), Date.UTC(2026, 9, 8));
    assert.strictEqual(resetsAtOf('weekly', wed), Date.UTC(2026, 9, 12));
    assert.strictEqual(resetsAtOf('once', wed), null);
    console.log('[test20] dönem anahtarları ve sıfırlanma zamanları ✅');

    assert.deepStrictEqual(statsOf([{ gf: 4, ga: 0 }, { gf: 1, ga: 1 }, { gf: 0, ga: 2 }]), { play: 3, win: 1, goals: 5, cleanSheet: 1, bigWin: 1, oneNil: 0, goalRain: 0, superLigWin: 0, blindWin: 0, wheelWin: 0 });
    const niche = statsOf([{ gf: 1, ga: 0, draftMode: 'blind', playerPool: 'super-lig' }, { gf: 5, ga: 2, draftMode: 'wheel', playerPool: 'all' }, { gf: 0, ga: 1, draftMode: 'blind', playerPool: 'super-lig' }]);
    assert.deepStrictEqual([niche.oneNil, niche.goalRain, niche.superLigWin, niche.blindWin, niche.wheelWin, niche.bigWin], [1, 1, 1, 1, 1, 1]);
    assert.strictEqual(new Set(QUESTS.map((q) => q.id)).size, QUESTS.length, 'görev id\'leri benzersiz');
    assert(QUESTS.some((q) => q.stat === 'win' && q.target === 5 && q.reward === 200), 'kullanıcının örneği: 5 galibiyet = 200 coin');
    console.log('[test20] maç istatistikleri + katalog ✅');

    const raw = new DatabaseSync(':memory:');
    const db = wrapSqlite(raw);
    await initSchema(db);
    const auth = new AuthService(db);
    clearInterval(auth._sweepTimer);
    const coins = new CoinService(db);
    const qs = new QuestService(db, coins);
    const uid = (await auth.register('q@example.com', 'parola1234', 'q')).user.id;
    const get = async (now, id) => (await qs.list(uid, now)).quests.find((q) => q.id === id);

    let l = await qs.list(uid, wed);
    assert.strictEqual(l.quests.length, QUESTS.length);
    assert.strictEqual(l.claimableCount, 0);
    assert.strictEqual((await qs.claim(uid, 'd_win1', wed)).error, 'NOT_COMPLETED');
    assert.strictEqual((await qs.claim(uid, 'yok', wed)).error, 'UNKNOWN_QUEST');

    await qs.recordMatches(uid, [{ gf: 3, ga: 0 }], wed);
    await qs.recordMatches(uid, [{ gf: 1, ga: 2 }, { gf: 2, ga: 2 }], wed + 1000);
    assert.strictEqual((await get(wed, 'd_play2')).progress, 2);
    assert.strictEqual((await get(wed, 'd_goals5')).progress, 5);
    assert.strictEqual((await get(wed, 'w_win5')).progress, 1);
    assert.strictEqual((await get(wed, 'w_clean3')).progress, 1);
    assert.strictEqual((await get(wed, 'w_bigwin2')).progress, 1);
    assert.strictEqual((await get(wed, 'o_goals100')).progress, 6);
    l = await qs.list(uid, wed);
    assert.deepStrictEqual(l.quests.filter((q) => q.claimable).map((q) => q.id).sort(), ['d_goals5', 'd_play2', 'd_win1']);
    assert.strictEqual(l.claimableCount, 3);
    console.log('[test20] ilerleme birikiyor, tamamlananlar toplanabilir ✅');

    // Eşzamanlı iki "Topla": sadece biri ödül alır.
    const [r1, r2] = await Promise.all([qs.claim(uid, 'd_win1', wed), qs.claim(uid, 'd_win1', wed)]);
    assert.strictEqual([r1, r2].filter((r) => r.ok).length, 1, JSON.stringify([r1, r2]));
    assert.strictEqual([r1, r2].find((r) => r.error).error, 'ALREADY_CLAIMED');
    assert.strictEqual(await coins.balance(uid), 60);
    const ledger = raw.prepare("SELECT amount, reason, meta FROM coin_ledger WHERE user_id = ? AND reason = 'quest'").all(uid);
    assert.strictEqual(ledger.length, 1);
    assert.strictEqual(JSON.parse(ledger[0].meta).questId, 'd_win1');
    assert((await get(wed, 'd_win1')).claimed);
    assert(!(await get(wed, 'd_win1')).claimable);
    console.log('[test20] Topla tek kullanımlık + coin_ledger ✅');

    // Ertesi gün: günlükler sıfır, haftalık/tek seferlik sürüyor.
    const thu = wed + 24 * 60 * 60 * 1000;
    assert.strictEqual((await get(thu, 'd_play2')).progress, 0);
    assert.strictEqual((await get(thu, 'd_win1')).claimed, false);
    assert.strictEqual((await get(thu, 'w_win5')).progress, 1);
    // Günlük toplanmamış ödül dönem geçince toplanamaz.
    assert.strictEqual((await qs.claim(uid, 'd_play2', thu)).error, 'NOT_COMPLETED');
    // Yeni hafta: haftalık sıfır, tek seferlik kalıcı.
    const nextMon = Date.UTC(2026, 9, 12, 8);
    assert.strictEqual((await get(nextMon, 'w_win5')).progress, 0);
    assert.strictEqual((await get(nextMon, 'o_goals100')).progress, 6);
    console.log('[test20] günlük/haftalık sıfırlanma, tek seferlik kalıcı ✅');

    // Hedefi aşan ilerleme gösterimde hedefte kırpılır; 5. galibiyetle haftalık tamamlanır.
    await qs.recordMatches(uid, [1, 2, 3, 4, 5, 6].map(() => ({ gf: 1, ga: 0 })), nextMon);
    const w = await get(nextMon, 'w_win5');
    assert.strictEqual(w.progress, 5);
    assert(w.claimable);
    assert.strictEqual((await qs.claim(uid, 'w_win5', nextMon)).reward, 200);
    console.log('[test20] haftalık 5 galibiyet = 200 coin ✅');

    // Temizlik: 2 haftadan eski günlük/haftalık satırlar silinir, tek seferlik kalır.
    await qs.sweep(nextMon + 30 * 24 * 60 * 60 * 1000);
    const left = raw.prepare('SELECT period FROM quest_progress WHERE user_id = ?').all(uid).map((r) => r.period);
    assert(left.length > 0 && left.every((p) => p === 'O'), JSON.stringify(left));
    console.log('[test20] eski dönem temizliği ✅');

    // ---- Niş: draft olayları sadece geçerli maçla yazılır ----
    const uid2 = (await auth.register('n@example.com', 'parola1234', 'n')).user.id;
    const get2 = async (id) => (await qs.list(uid2, wed)).quests.find((q) => q.id === id);
    await qs.recordMatches(uid2, [], wed, { blindMin: 1 });
    assert.strictEqual((await get2('n_blind_min')).progress, 0, 'geçerli maç yoksa draft olayı yazılmaz');
    await qs.recordMatches(uid2, [{ gf: 1, ga: 0, draftMode: 'blind', playerPool: 'super-lig' }], wed, { blindMin: 1, liveSnipe: 2, hack: 50, trade: -3 });
    assert.strictEqual((await get2('n_blind_min')).progress, 1);
    assert.strictEqual((await get2('n_live_snipe')).progress, 2);
    assert.strictEqual((await get2('n_trade')).progress, 0, 'negatif değer yok sayılır');
    assert.strictEqual((await get2('n_one_nil')).progress, 1);
    assert.strictEqual((await get2('n_superlig')).progress, 1);
    assert.strictEqual((await get2('o_blind10')).progress, 1);
    assert.strictEqual((await get2('n_blind_min')).group, 'niche');
    assert((await get2('n_blind_min')).desc.includes('10₺'));
    assert(!raw.prepare('SELECT 1 FROM quest_progress WHERE quest_id = ?').get('hack'), 'bilinmeyen istatistik görev üretmez');
    console.log('[test20] niş: draft olayları + maç detayları, geçerli maç şartı ✅');

    // ---- Niş: DraftEngine olay noktaları ----
    const { DraftEngine } = require('../src/draft/DraftEngine');
    const { MIN_PLAYER_PRICE } = require('../src/shared/gameConfig');
    const ioStub = { to: () => ({ emit: () => {} }) };
    const rmStub = { toPublicState: () => ({}) };
    const engine = new DraftEngine(ioStub, rmStub);
    engine.emitDraft = () => {};
    const mkRoom = (draftMode) => ({
      code: 'TEST1', status: 'finished', draftMode, questLog: {},
      players: ['a', 'b'].map((id) => ({ clientId: id, budget: 1000, squad: [], slotsNeeded: { GK: 1 } })),
      draft: { round: null, history: [], cascade: null },
    });
    const main = { id: 'p1', name: 'X', rating: 80 };
    const blind = (bids, participants = ['a', 'b']) => {
      const room = mkRoom('blind');
      room.draft.round = { kind: 'blind_auction', slotType: 'GK', participantIds: participants, main, bids: new Map(Object.entries(bids).map(([k, v], i) => [k, { amount: v, at: i }])) };
      engine.resolveBlindRound(room);
      return room.questLog.a || {};
    };
    assert.strictEqual(blind({ a: MIN_PLAYER_PRICE }).blindMin, 1, 'rakipli turda 10₺ ile kazanmak');
    assert.strictEqual(blind({ a: MIN_PLAYER_PRICE }, ['a']).blindMin, undefined, 'tek katılımcılı tur sayılmaz');
    assert.strictEqual(blind({ a: 50 }).blindMin, undefined);
    assert.strictEqual(blind({ a: 145, b: 140 }).blindNarrow, 1, "kullanıcının örneği: 140'a karşı 145");
    assert.strictEqual(blind({ a: 50, b: 41 }).blindNarrow, 1, '9₺ fark sayılır');
    assert.strictEqual(blind({ a: 50, b: 50 }).blindNarrow, 1, 'eşit teklif (önce gönderen kazanır) sayılır');
    assert.strictEqual(blind({ a: 50, b: 40 }).blindNarrow, undefined, "10₺ fark sayılmaz (10'dan az olmalı)");
    assert.strictEqual(blind({ a: 145, b: 140 }, ['a', 'b', 'c']).blindNarrow, 1, 'çok kişilik turda ikinci en yüksek teklife bakılır');
    assert.strictEqual(blind({ a: 50 }).blindNarrow, undefined, 'rakip teklif vermediyse kıl payı yok');

    const live = (bids) => {
      const room = mkRoom('live');
      room.draft.round = { kind: 'auction', slotType: 'GK', participantIds: ['a', 'b'], main, bids: new Map(Object.entries(bids).map(([k, v], i) => [k, { ...v, at: i }])) };
      engine.resolveAuctionRound(room);
      return room.questLog.a || {};
    };
    assert.strictEqual(live({ a: { amount: 60, late: true }, b: { amount: 55 } }).liveSnipe, 1, 'son saniyede kapmak');
    assert.strictEqual(live({ a: { amount: 60, late: false }, b: { amount: 55 } }).liveSnipe, undefined);
    assert.strictEqual(live({ a: { amount: 60, late: true } }).liveSnipe, undefined, 'rakipsiz son saniye sayılmaz');

    const stealRoom = mkRoom('wheel');
    engine.assignPlayer(stealRoom, stealRoom.players[0], main, 'GK', 0, 'wheel_stolen');
    engine.assignPlayer(stealRoom, stealRoom.players[1], main, 'GK', 0, 'wheel_pick');
    assert.strictEqual(stealRoom.questLog.a.wheelSteal, 1);
    assert.strictEqual((stealRoom.questLog.b || {}).wheelSteal, undefined);

    const finish = (draftMode) => {
      const room = mkRoom(draftMode);
      room.players[0].squad = [{ player: { isIcon: true } }, { player: { isIcon: true } }, { player: { isIcon: false } }];
      room.players[0].budget = 300;
      room.players[1].squad = [{ player: { isIcon: true } }];
      room.players[1].budget = 299;
      engine.finishDraft(room);
      return room.questLog;
    };
    let log = finish('blind');
    assert.deepStrictEqual([log.a.icons2, log.a.saver, (log.b || {}).icons2, (log.b || {}).saver], [1, 1, undefined, undefined]);
    log = finish('wheel');
    assert.strictEqual(log.a.saver, undefined, 'çark modunda bütçe yok — kumbaracı sayılmaz');
    console.log('[test20] niş: DraftEngine olay noktaları (kelepir, kıl payı, son saniye, çalma, efsaneler, kumbaracı) ✅');

    console.log('[test20] TÜM TESTLER GEÇTİ ✅');
    process.exit(0);
  } catch (e) {
    console.error('[test20] BAŞARISIZ ❌', e);
    process.exit(1);
  }
})();
