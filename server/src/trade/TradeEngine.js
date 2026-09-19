// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] "Takas turu gelebilir. Oyuncu satışı ve alışı
// mantıksız olabilir çünkü bir kullanıcı oyuncu sattı ama alamadı, bu sefer eksik başlar." —
// bu yüzden takas HER ZAMAN 1↔1: kadro sayısı asla değişmez, kimse eksik kadroyla maça çıkmaz.
// Para yoktur (bütçe draftta bitmiş sayılır), havuzdan serbest alım yoktur.
//
// Kurallar (kullanıcıyla netleşen hali):
//   · 1↔1, karşılıklı onay şart.
//   · Kaleciler takas edilemez (her kadroda tek GK var; takası hem anlamsız hem riskli).
//   · Mevki serbest: orta saha verip forvet alınabilir — takasın amacı tam olarak formasyon
//     değiştirmeyi mümkün kılmak ("4'lü orta saha geldi, bir orta saha verip forvet alıp
//     4-3-3 oynadım").
//   · TEK geçerlilik şartı: takastan sonra HER İKİ kadro da en az bir formasyon kurabilmeli
//     (bkz. lineup.js buildableFormations) — "hiç dizilim kuramıyorum" durumu imkânsız.
//   · Aynı kişiyle en fazla TRADE_MAX_PER_PAIR (2) takas.
//   · Tur süresi TRADE_ROUND_DURATION_SECONDS (5 dk) — ama HERKES "bitti" derse hemen kapanır.
//   · Kilit: bekleyen bir teklifte yer alan oyuncu başka teklife konu olamaz; bir takas
//     tamamlanınca o oyuncuları içeren diğer tüm teklifler otomatik iptal edilir (ilk onay kazanır).
//
// Üç draft modunun HEPSİNDE geçerlidir (live/blind/wheel) ve Hazırlık Çarkı gibi İSTEĞE BAĞLIDIR:
// host oda kurarken açar (room.tradeRoundEnabled), kapalıysa draft bitince doğrudan dizilim
// ekranına geçilir (eski davranış).
const { STATUS } = require('../rooms/RoomManager');
const { buildableFormations } = require('../lineup/lineup');
const { TRADE_ROUND_DURATION_SECONDS, TRADE_MAX_PER_PAIR } = require('../shared/gameConfig');

let offerSeq = 0;

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

function playerSummary(entry) {
  return {
    playerId: entry.player.id,
    name: entry.player.name,
    rating: entry.player.rating,
    position: entry.player.position,
    isIcon: !!entry.player.isIcon,
    slot: entry.slot,
    eligibleSlots: entry.player.eligibleSlots,
  };
}

class TradeEngine {
  constructor(io, roomManager) {
    this.io = io;
    this.roomManager = roomManager;
  }

  // ------------------------------------------------------------------ faz başlangıcı
  start(room) {
    room.status = STATUS.TRADE;
    room.trade = {
      startedAt: Date.now(),
      deadline: Date.now() + TRADE_ROUND_DURATION_SECONDS * 1000,
      offers: [],
      completed: [],
      doneVotes: new Set(),
      pairCounts: {},
      timer: null,
    };
    room.trade.timer = setTimeout(() => {
      if (room.status === STATUS.TRADE) this.finish(room, 'timeout');
    }, TRADE_ROUND_DURATION_SECONDS * 1000);
    room.trade.timer.unref?.();
    room.updatedAt = Date.now();

    this.emitState(room);
    this.emitTrade(room);
    this.io.to(room.code).emit('trade:started', {
      deadline: room.trade.deadline,
      maxPerPair: TRADE_MAX_PER_PAIR,
    });
  }

  finish(room, reason = 'done') {
    if (!room.trade) return;
    clearTimeout(room.trade.timer);
    room.trade.timer = null;
    // Bekleyen teklifler sessizce düşer — kadrolar olduğu gibi kalır (kimse eksik kalmaz).
    room.trade.offers = [];
    room.status = STATUS.SQUAD_SELECT;
    room.updatedAt = Date.now();
    this.emitState(room);
    this.emitTrade(room);
    this.io.to(room.code).emit('trade:complete', {
      reason,
      completed: room.trade.completed,
    });
  }

  // ------------------------------------------------------------------ yayın
  emitState(room) {
    this.io.to(room.code).emit('room:state', this.roomManager.toPublicState(room));
  }

  lockedPlayerIds(room) {
    const ids = new Set();
    for (const o of room.trade.offers) { ids.add(o.give.playerId); ids.add(o.get.playerId); }
    return ids;
  }

  // Pazarlık aşaması SADECE iki tarafa görünür (kullanıcı kararı); tamamlanan takaslar herkese.
  // Bu yüzden her oyuncuya kendi görünümü ayrı emit edilir.
  emitTrade(room) {
    if (!room.trade) return;
    const t = room.trade;
    const squads = {};
    for (const p of room.players) squads[p.clientId] = p.squad.map(playerSummary);
    const locked = [...this.lockedPlayerIds(room)];

    for (const p of room.players) {
      if (!p.socketId) continue;
      this.io.to(p.socketId).emit('trade:state', {
        status: room.status,
        deadline: t.deadline,
        maxPerPair: TRADE_MAX_PER_PAIR,
        squads,
        lockedPlayerIds: locked,
        pairCounts: this.pairCountsFor(room, p.clientId),
        doneVotes: [...t.doneVotes],
        completed: t.completed,
        incoming: t.offers.filter((o) => o.toClientId === p.clientId).map((o) => this.publicOffer(o)),
        outgoing: t.offers.filter((o) => o.fromClientId === p.clientId).map((o) => this.publicOffer(o)),
      });
    }
  }

  publicOffer(o) {
    return {
      id: o.id, fromClientId: o.fromClientId, toClientId: o.toClientId,
      give: o.give, get: o.get, at: o.at,
    };
  }

  pairCountsFor(room, clientId) {
    const out = {};
    for (const other of room.players) {
      if (other.clientId === clientId) continue;
      out[other.clientId] = room.trade.pairCounts[pairKey(clientId, other.clientId)] || 0;
    }
    return out;
  }

  // ------------------------------------------------------------------ doğrulama
  // Takas sonrası iki kadronun da en az bir formasyon kurabildiğini kontrol eder.
  // Döner: { ok, error?, fromFormations, toFormations }
  simulateSwap(fromPlayer, toPlayer, giveEntry, getEntry) {
    const fromSquad = fromPlayer.squad
      .filter((e) => e.player.id !== giveEntry.player.id)
      .concat([{ ...getEntry, slot: getEntry.player.position, reason: 'trade' }]);
    const toSquad = toPlayer.squad
      .filter((e) => e.player.id !== getEntry.player.id)
      .concat([{ ...giveEntry, slot: giveEntry.player.position, reason: 'trade' }]);

    const fromFormations = buildableFormations(fromSquad).filter((o) => o.feasible).map((o) => o.formation);
    const toFormations = buildableFormations(toSquad).filter((o) => o.feasible).map((o) => o.formation);
    if (fromFormations.length === 0) return { ok: false, error: 'SENDER_LINEUP_IMPOSSIBLE', fromFormations, toFormations };
    if (toFormations.length === 0) return { ok: false, error: 'RECEIVER_LINEUP_IMPOSSIBLE', fromFormations, toFormations };
    return { ok: true, fromFormations, toFormations };
  }

  // ------------------------------------------------------------------ aksiyonlar
  createOffer(room, clientId, { toClientId, givePlayerId, getPlayerId } = {}) {
    if (room.status !== STATUS.TRADE || !room.trade) return { error: 'TRADE_ROUND_NOT_ACTIVE' };
    if (Date.now() > room.trade.deadline) return { error: 'TRADE_ROUND_OVER' };
    if (!toClientId || toClientId === clientId) return { error: 'INVALID_TARGET' };

    const from = room.players.find((p) => p.clientId === clientId);
    const to = room.players.find((p) => p.clientId === toClientId);
    if (!from || !to) return { error: 'PLAYER_NOT_FOUND' };

    const key = pairKey(clientId, toClientId);
    if ((room.trade.pairCounts[key] || 0) >= TRADE_MAX_PER_PAIR) return { error: 'PAIR_LIMIT_REACHED' };

    const giveEntry = from.squad.find((e) => e.player.id === givePlayerId);
    const getEntry = to.squad.find((e) => e.player.id === getPlayerId);
    if (!giveEntry || !getEntry) return { error: 'PLAYER_NOT_IN_SQUAD' };

    // Kaleci takas edilemez — her iki taraf için de.
    if (giveEntry.player.position === 'GK' || getEntry.player.position === 'GK'
      || giveEntry.slot === 'GK' || getEntry.slot === 'GK') {
      return { error: 'GOALKEEPER_NOT_TRADABLE' };
    }

    const locked = this.lockedPlayerIds(room);
    if (locked.has(giveEntry.player.id) || locked.has(getEntry.player.id)) return { error: 'PLAYER_LOCKED_IN_OFFER' };

    const sim = this.simulateSwap(from, to, giveEntry, getEntry);
    if (!sim.ok) return { error: sim.error };

    const offer = {
      id: `t${++offerSeq}`,
      fromClientId: clientId,
      toClientId,
      give: playerSummary(giveEntry),
      get: playerSummary(getEntry),
      at: Date.now(),
    };
    room.trade.offers.push(offer);
    // Yeni bir teklif gönderen kişi artık "bitti" saymıyor (aksi halde herkes bitti derken
    // ortada bekleyen bir teklif kalabilir).
    room.trade.doneVotes.delete(clientId);
    room.updatedAt = Date.now();

    this.emitTrade(room);
    // Karşı tarafa kısa bir bildirim (toast) — pazarlık gizli olduğu için sadece alıcıya.
    if (to.socketId) {
      this.io.to(to.socketId).emit('trade:incoming', {
        from: from.name, give: offer.give.name, get: offer.get.name,
      });
    }
    return { ok: true, offerId: offer.id, formations: sim.fromFormations };
  }

  cancelOffer(room, clientId, offerId) {
    if (!room.trade) return { error: 'TRADE_ROUND_NOT_ACTIVE' };
    const idx = room.trade.offers.findIndex((o) => o.id === offerId && (o.fromClientId === clientId || o.toClientId === clientId));
    if (idx < 0) return { error: 'OFFER_NOT_FOUND' };
    const [removed] = room.trade.offers.splice(idx, 1);
    room.updatedAt = Date.now();
    this.emitTrade(room);
    return { ok: true, offer: this.publicOffer(removed) };
  }

  acceptOffer(room, clientId, offerId) {
    if (room.status !== STATUS.TRADE || !room.trade) return { error: 'TRADE_ROUND_NOT_ACTIVE' };
    if (Date.now() > room.trade.deadline) return { error: 'TRADE_ROUND_OVER' };

    const offer = room.trade.offers.find((o) => o.id === offerId);
    if (!offer) return { error: 'OFFER_NOT_FOUND' };
    if (offer.toClientId !== clientId) return { error: 'NOT_YOUR_OFFER' };

    const from = room.players.find((p) => p.clientId === offer.fromClientId);
    const to = room.players.find((p) => p.clientId === offer.toClientId);
    if (!from || !to) return { error: 'PLAYER_NOT_FOUND' };

    const key = pairKey(from.clientId, to.clientId);
    if ((room.trade.pairCounts[key] || 0) >= TRADE_MAX_PER_PAIR) return { error: 'PAIR_LIMIT_REACHED' };

    const giveIdx = from.squad.findIndex((e) => e.player.id === offer.give.playerId);
    const getIdx = to.squad.findIndex((e) => e.player.id === offer.get.playerId);
    // Araya başka bir takas girmiş olabilir (ilk onay kazanır) — o durumda teklif düşer.
    if (giveIdx < 0 || getIdx < 0) {
      room.trade.offers = room.trade.offers.filter((o) => o.id !== offerId);
      this.emitTrade(room);
      return { error: 'PLAYER_ALREADY_TRADED' };
    }

    const giveEntry = from.squad[giveIdx];
    const getEntry = to.squad[getIdx];
    const sim = this.simulateSwap(from, to, giveEntry, getEntry);
    if (!sim.ok) {
      room.trade.offers = room.trade.offers.filter((o) => o.id !== offerId);
      this.emitTrade(room);
      return { error: sim.error };
    }

    // --- takası uygula (1↔1, kadro boyutu değişmez) ---
    from.squad.splice(giveIdx, 1);
    to.squad.splice(getIdx, 1);
    from.squad.push({ ...getEntry, slot: getEntry.player.position, reason: 'trade' });
    to.squad.push({ ...giveEntry, slot: giveEntry.player.position, reason: 'trade' });

    room.trade.pairCounts[key] = (room.trade.pairCounts[key] || 0) + 1;
    const record = {
      at: Date.now(),
      aClientId: from.clientId, aName: from.name,
      bClientId: to.clientId, bName: to.name,
      aGave: offer.give, bGave: offer.get,
      pairCount: room.trade.pairCounts[key],
    };
    room.trade.completed.unshift(record);

    // İlk onay kazanır: bu iki oyuncuyu içeren TÜM diğer teklifler iptal.
    const affected = new Set([offer.give.playerId, offer.get.playerId]);
    const cancelled = room.trade.offers.filter((o) => o.id !== offerId
      && (affected.has(o.give.playerId) || affected.has(o.get.playerId)));
    room.trade.offers = room.trade.offers.filter((o) => o.id !== offerId
      && !affected.has(o.give.playerId) && !affected.has(o.get.playerId));
    room.updatedAt = Date.now();

    this.emitState(room); // squadCount aynı ama kadro içeriği değişti — istemciler tazelenmeli
    this.emitTrade(room);
    this.io.to(room.code).emit('trade:resolved', record);
    for (const c of cancelled) {
      const owner = room.players.find((p) => p.clientId === c.fromClientId);
      if (owner && owner.socketId) {
        this.io.to(owner.socketId).emit('trade:cancelled', {
          reason: 'PLAYER_TRADED', give: c.give.name, get: c.get.name,
        });
      }
    }
    return { ok: true, record };
  }

  toggleDone(room, clientId) {
    if (room.status !== STATUS.TRADE || !room.trade) return { error: 'TRADE_ROUND_NOT_ACTIVE' };
    const t = room.trade;
    if (t.doneVotes.has(clientId)) t.doneVotes.delete(clientId);
    else t.doneVotes.add(clientId);
    room.updatedAt = Date.now();
    this.emitTrade(room);

    // [KULLANICI İSTEĞİ] "5 dk olsun ama herkes 'takas turu bitti' derse bitsin."
    const connected = room.players.filter((p) => p.connected);
    const target = connected.length >= 2 ? connected : room.players;
    const allDone = target.length > 0 && target.every((p) => t.doneVotes.has(p.clientId));
    if (allDone) this.finish(room, 'unanimous');
    return { ok: true, doneVotes: [...t.doneVotes] };
  }
}

module.exports = { TradeEngine, TRADE_MAX_PER_PAIR };
