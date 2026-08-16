const { FORMATIONS } = require('../shared/football');
const {
  SQUAD_SIZE,
  MIN_PLAYER_PRICE,
  BACKUP_PLAYER_PRICE,
  MIN_RAISE,
  AUCTION_DURATION_SECONDS,
  BLIND_BID_DURATION_SECONDS,
  BACKUP_RATING_GAP,
  BIG_GAP_RATING_GAP,
  BIG_GAP_POSITIONS_COUNT,
} = require('../shared/gameConfig');
const { pickMainAndLadder, pickSingle } = require('./pool');
const { STATUS } = require('../rooms/RoomManager');

// Test ortamında turları hızlandırmak için env ile ezilebilir (bkz. gameConfig.js
// AUCTION_DURATION_SECONDS'daki aynı desen).
const ROUND_RESULT_DELAY_MS = Number(process.env.DRAFT_ROUND_DELAY_MS) || 4000; // sonucu göstermek için oyuncular arası kısa bekleme
const ANTI_SNIPE_WINDOW_MS = Number(process.env.DRAFT_ANTI_SNIPE_WINDOW_MS) || 3000; // son X sn içinde teklif gelirse süre uzatılır
const ANTI_SNIPE_EXTENSION_MS = Number(process.env.DRAFT_ANTI_SNIPE_EXTENSION_MS) || 3000;

function slotCounts(formationKey) {
  const slots = FORMATIONS[formationKey];
  const counts = {};
  for (const s of slots) counts[s] = (counts[s] || 0) + 1;
  return counts;
}

function totalRemaining(remainingSlots) {
  return Object.values(remainingSlots).reduce((a, b) => a + b, 0);
}

// Bir kullanıcının o an verebileceği azami teklif — KİŞİSEL bütçe güvenlik tavanı
// (bkz. AUCTION-GAME-CLAUDE.md "Açık Arttırma Sistemi" formülü).
function personalMaxBid(player) {
  const remainingSlotsTotal = SQUAD_SIZE - player.squad.length;
  if (remainingSlotsTotal <= 0) return 0;
  return player.budget - (remainingSlotsTotal - 1) * MIN_PLAYER_PRICE;
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — N oyunculu odada her turda hangi
// pozisyonun geleceğini, TÜM oyuncuların o an ihtiyaç duyduğu slot tiplerinden ağırlıklı
// rastgele seçer (bir oyuncunun aynı tipten 2 boş slotu varsa torbada 2 kez yer alır — eski
// 2 kişilik davranışın doğal genellemesi).
function pickWeightedType(remainingMaps) {
  const bag = [];
  for (const remaining of remainingMaps) {
    for (const [type, count] of Object.entries(remaining)) {
      for (let i = 0; i < count; i++) bag.push(type);
    }
  }
  if (bag.length === 0) return null;
  return bag[Math.floor(Math.random() * bag.length)];
}

function findPlayer(room, clientId) {
  return room.players.find((p) => p.clientId === clientId);
}

// Fisher-Yates — teklif vermeyen katılımcıların yedek merdiveninde hangi sırayla
// dizileceğini rastgele belirlemek için (bkz. doküman "Yedek atama sırası").
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Yedek atama sırası" — bir turun katılımcılarını
// (anayı kazanan dahil) teklif miktarına göre azalan sırada; hiç teklif vermeyenleri sona,
// aralarında rastgele sıralar. round.bids bir clientId -> {amount, at} Map'idir.
function rankParticipants(participantIds, bids) {
  const bidders = participantIds.filter((id) => bids.has(id));
  const nonBidders = shuffleInPlace(participantIds.filter((id) => !bids.has(id)));
  bidders.sort((a, b) => {
    const ba = bids.get(a);
    const bb = bids.get(b);
    if (bb.amount !== ba.amount) return bb.amount - ba.amount;
    return ba.at - bb.at; // eşit teklifte önce gönderen kazanır
  });
  // Doküman hiç teklif verilmemesi durumunu tanımlamıyor — draftın tıkanmaması için rastgele
  // bir katılımcı minimum fiyata "kazanan" sayılır (mevcut 2 kişilik kenar durumun N-genel hali).
  return bidders.length ? [...bidders, ...nonBidders] : nonBidders;
}

// 'auction' (canlı) ve 'blind_auction' (kör) turları çoğu ortak akışta (pause/resume, teklif
// kabul penceresi) aynı şekilde davranır — sadece çözüm/görünürlük mantığı farklıdır.
function isAuctionKind(kind) {
  return kind === 'auction' || kind === 'blind_auction';
}

function publicRoundState(round) {
  if (!round) return null;
  const base = {
    slotType: round.slotType,
    kind: round.kind, // 'auction' | 'blind_auction' | 'one_sided'
    main: round.main,
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — tek bir "backup" yerine azalan
    // reytingte bir merdiven (K-1 eleman, K = o pozisyona ihtiyacı olan oyuncu sayısı).
    backups: round.backups || [],
    // Bu turda kimin dahil olduğu (o pozisyona ihtiyacı olan oyuncular) — N-kişilik odada
    // herkes değil, sadece bu alt küme teklif verebilir.
    participantIds: round.participantIds || [],
    bigGap: round.bigGap || false, // [KULLANICI İSTEĞİ] "büyük fark" pozisyonu mu?
    deadline: round.deadline || null,
    // [KULLANICI İSTEĞİ] Duraklatılmışken sunucu deadline'ı artık ilerletmiyor (donmuş
    // kalır) — istemci bunun yerine bu dondurulmuş kalan süreyi statik göstermeli.
    pausedRemainingMs: round.pausedRemainingMs != null ? round.pausedRemainingMs : null,
  };
  if (round.kind === 'blind_auction') {
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft — rakibin teklif MİKTARI round çözülene
    // kadar asla yayınlanmaz (highestBid/highestBidderClientId burada YOK), sadece "kim teklif
    // verdi" bilgisi paylaşılır — bu bilgi sızıntısı sayılmaz, miktarı açığa çıkarmaz.
    return { ...base, submittedClientIds: round.bids ? [...round.bids.keys()] : [] };
  }
  // [KULLANICI İSTEĞİ] "Teklif verdiğinde diğer kullanıcıların ne kadar teklif verdiğini göster"
  // — canlı ("kör" OLMAYAN) modda miktarlar zaten hiç gizli değil, bu yüzden en yüksek teklifin
  // yanında HERKESİN o anki teklifi de anlık olarak paylaşılır (kör moddan farkı: burada bilgi
  // sızıntısı diye bir kavram yok, açık artırmanın doğası bu).
  const liveBids = {};
  if (round.bids) for (const [id, b] of round.bids) liveBids[id] = b.amount;
  return { ...base, highestBid: round.highestBid || 0, highestBidderClientId: round.highestBidderClientId || null, bids: liveBids };
}

// [KULLANICI İSTEĞİ] Round çözüldüğünde ("her seferinde") tüm katılımcıların teklifini (verdiyse)
// açığa çıkarır — canlı modda zaten görünür olan bilginin bir özeti, kör modda ise round'un
// "reveal" anı. Hem resolveAuctionRound hem resolveBlindRound aynı şekilde kullanır.
function revealBids(round) {
  const out = {};
  for (const id of round.participantIds) {
    const b = round.bids.get(id);
    out[id] = b ? b.amount : null;
  }
  return out;
}

class DraftEngine {
  constructor(io, roomManager) {
    this.io = io;
    this.roomManager = roomManager;
  }

  emitState(room) {
    this.io.to(room.code).emit('room:state', this.roomManager.toPublicState(room));
  }

  emitDraft(room, extra = {}) {
    this.io.to(room.code).emit('draft:update', {
      status: room.status,
      formation: room.formation,
      round: publicRoundState(room.draft && room.draft.round),
      // [KULLANICI İSTEĞİ] "Açık arttırmada durdurma gelsin, iki oyuncu da onayladığında
      // oyun duraklatılsın" — bkz. togglePauseVote/pauseDraft/resumeDraft.
      paused: !!(room.draft && room.draft.paused),
      pauseVotes: room.draft ? [...room.draft.pauseVotes] : [],
      players: room.players.map((p) => ({
        clientId: p.clientId,
        name: p.name,
        budget: p.budget,
        squad: p.squad,
        remainingSlots: room.draft ? totalRemaining(p.slotsNeeded) : null,
      })),
      ...extra,
    });
  }

  startDraft(room) {
    if (room.status !== STATUS.LOBBY) return { error: 'DRAFT_ALREADY_STARTED' };
    if (!this.roomManager.allConnected(room)) return { error: 'BOTH_PLAYERS_REQUIRED' };

    const formationKeys = Object.keys(FORMATIONS);
    const formation = formationKeys[Math.floor(Math.random() * formationKeys.length)];
    room.formation = formation;
    room.status = STATUS.DRAFT;

    for (const p of room.players) {
      p.slotsNeeded = slotCounts(formation);
      p.squad = [];
    }

    // [KULLANICI İSTEĞİ] "Sadece 2 pozisyonda iki oyuncu arasındaki fark çok olsun, rastgele
    // bir şekilde" — formasyondaki benzersiz slot tiplerinden rastgele BIG_GAP_POSITIONS_COUNT
    // kadarı bu draft için "büyük fark" pozisyonu olarak seçilir; o slotlar her tur geldiğinde
    // (formasyonda birden fazla kez geçiyorsa dahil) BIG_GAP_RATING_GAP kullanılır.
    const uniqueSlotTypes = Object.keys(slotCounts(formation));
    const shuffled = [...uniqueSlotTypes].sort(() => Math.random() - 0.5);
    const bigGapSlots = new Set(shuffled.slice(0, Math.min(BIG_GAP_POSITIONS_COUNT, shuffled.length)));

    room.draft = {
      takenIds: new Set(),
      round: null,
      history: [],
      bigGapSlots,
      // [KULLANICI İSTEĞİ] Açık arttırma duraklatma durumu (bkz. togglePauseVote).
      paused: false,
      pauseVotes: new Set(),
      pendingNextRound: false,
    };

    this.emitState(room);
    this.io.to(room.code).emit('draft:started', { formation, bigGapSlots: [...bigGapSlots] });
    this.nextRound(room);
    return { ok: true };
  }

  nextRound(room) {
    // [KULLANICI İSTEĞİ] Duraklatılmışken yeni bir tur/açık arttırma BAŞLATILMAZ — devam
    // etmesi gereken geçiş resumeDraft() tarafından tetiklenmek üzere ertelenir.
    if (room.draft.paused) {
      room.draft.pendingNextRound = true;
      return;
    }
    const totalLeft = room.players.reduce((sum, p) => sum + totalRemaining(p.slotsNeeded), 0);
    if (totalLeft === 0) {
      this.finishDraft(room);
      return;
    }

    const remainingMaps = room.players.map((p) =>
      Object.fromEntries(Object.entries(p.slotsNeeded).filter(([, c]) => c > 0)));
    const type = pickWeightedType(remainingMaps);

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — o pozisyona ihtiyacı olan
    // oyuncu sayısı K = needyPlayers.length. K=1 ise tek taraflı (rekabetsiz), K>=2 ise
    // 1 ana + (K-1) yedek merdivenli açık arttırma/kör teklif.
    const needyPlayers = room.players.filter((p) => (p.slotsNeeded[type] || 0) > 0);

    if (needyPlayers.length === 1) {
      this.startOneSidedRound(room, type, needyPlayers[0]);
    } else {
      this.startAuctionRound(room, type, needyPlayers);
    }
  }

  startOneSidedRound(room, type, needyPlayer) {
    // Tek taraflı ihtiyaç: rekabet yok, ana oyuncu doğrudan düşük/minimum sabit fiyata gider,
    // yedek hiç gösterilmeden iptal edilir (bkz. doküman "Tek taraflı ihtiyaç durumu").
    const main = pickSingle(type, room.draft.takenIds, room.playerPool);
    if (!main) {
      // Bu slot tipi için havuz tükendi (pratikte olası değil) — bu tipi atlayıp devam et.
      needyPlayer.slotsNeeded[type] = 0;
      this.nextRound(room);
      return;
    }
    room.draft.takenIds.add(main.id);
    this.assignPlayer(room, needyPlayer, main, type, MIN_PLAYER_PRICE, 'one_sided');

    room.draft.round = { slotType: type, kind: 'one_sided', main, resolvedAt: Date.now() };
    this.emitDraft(room, { event: { type: 'one_sided_assigned', slotType: type, clientId: needyPlayer.clientId, player: main, price: MIN_PLAYER_PRICE } });

    setTimeout(() => {
      if (room.status !== STATUS.DRAFT) return;
      room.draft.round = null;
      this.nextRound(room);
    }, ROUND_RESULT_DELAY_MS);
  }

  startAuctionRound(room, type, needyPlayers) {
    const isBigGap = room.draft.bigGapSlots && room.draft.bigGapSlots.has(type);
    const ratingGap = isBigGap ? BIG_GAP_RATING_GAP : BACKUP_RATING_GAP;
    // K oyuncu rekabet ediyorsa 1 ana + (K-1) yedeklik bir merdiven gerekir.
    const backupCount = needyPlayers.length - 1;
    const { main, backups } = pickMainAndLadder(type, room.draft.takenIds, backupCount, ratingGap, room.playerPool);
    if (!main) {
      // Havuz tükendi — bu tipi tüm ihtiyacı olan oyuncular için kapat ve devam et (savunma amaçlı).
      for (const p of needyPlayers) p.slotsNeeded[type] = 0;
      this.nextRound(room);
      return;
    }
    room.draft.takenIds.add(main.id);
    for (const b of backups) room.draft.takenIds.add(b.id);

    const participantIds = needyPlayers.map((p) => p.clientId);

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft modu — oda kurulurken sabitlenen mod
    // 'blind' ise, açık arttırma yerine gizli/tek seferlik teklif turu başlatılır (bkz.
    // submitBlindBid/resolveBlindRound). Ana+yedek reveal mantığı canlı modla birebir aynı.
    if (room.draftMode === 'blind') {
      const deadline = Date.now() + BLIND_BID_DURATION_SECONDS * 1000;
      room.draft.round = {
        slotType: type,
        kind: 'blind_auction',
        main,
        backups,
        participantIds,
        bigGap: isBigGap,
        deadline,
        bids: new Map(), // clientId -> { amount, at }
        timer: setTimeout(() => this.resolveBlindRound(room), BLIND_BID_DURATION_SECONDS * 1000),
      };
      this.emitDraft(room);
      return;
    }

    const deadline = Date.now() + AUCTION_DURATION_SECONDS * 1000;
    room.draft.round = {
      slotType: type,
      kind: 'auction',
      main,
      backups,
      participantIds,
      bigGap: isBigGap,
      deadline,
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — canlı modda da her katılımcının
      // kendi teklifi ayrıca tutulur (yedek merdiveni "teklif sırasına göre" dağıtabilmek için,
      // bkz. resolveAuctionRound/rankParticipants); highestBid/highestBidderClientId ise anlık
      // "en yüksek teklif" göstergesi olarak aynen korunur.
      bids: new Map(),
      highestBid: 0,
      highestBidderClientId: null,
      timer: setTimeout(() => this.resolveAuctionRound(room), AUCTION_DURATION_SECONDS * 1000),
    };

    this.emitDraft(room);
  }

  // [KULLANICI İSTEĞİ] "Açık arttırmada durdurma gelsin. İki oyuncu da onayladığında oyun
  // duraklatılsın." — [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod: eşik artık
  // odadaki TÜM oyuncu sayısı (2 kişilik odalarda davranış birebir aynı kalır); taraflardan
  // biri oyunu geri çekince hemen devam eder — bağlantı kopması gibi durumlarda oyunun kilitli
  // kalmaması için kasıtlı olarak asimetrik.
  togglePauseVote(room, clientId) {
    if (!room.draft) return { error: 'DRAFT_NOT_ACTIVE' };
    const isMember = room.players.some((p) => p.clientId === clientId);
    if (!isMember) return { error: 'NOT_IN_ROOM' };

    if (room.draft.pauseVotes.has(clientId)) room.draft.pauseVotes.delete(clientId);
    else room.draft.pauseVotes.add(clientId);

    const shouldPause = room.draft.pauseVotes.size >= room.players.length;
    if (shouldPause && !room.draft.paused) this.pauseDraft(room);
    else if (!shouldPause && room.draft.paused) this.resumeDraft(room);
    else this.emitDraft(room); // sadece oy durumu değişti, duraklama durumu aynı kaldı

    return { ok: true, paused: room.draft.paused };
  }

  pauseDraft(room) {
    room.draft.paused = true;
    const round = room.draft.round;
    if (round && isAuctionKind(round.kind) && round.timer) {
      clearTimeout(round.timer);
      round.timer = null;
      round.pausedRemainingMs = Math.max(0, round.deadline - Date.now());
    }
    this.emitDraft(room);
  }

  resumeDraft(room) {
    room.draft.paused = false;
    const round = room.draft.round;
    if (round && isAuctionKind(round.kind) && round.pausedRemainingMs != null) {
      const remaining = round.pausedRemainingMs;
      round.deadline = Date.now() + remaining;
      round.pausedRemainingMs = null;
      const resolve = round.kind === 'blind_auction'
        ? () => this.resolveBlindRound(room)
        : () => this.resolveAuctionRound(room);
      round.timer = setTimeout(resolve, remaining);
    }
    this.emitDraft(room);
    if (room.draft.pendingNextRound) {
      room.draft.pendingNextRound = false;
      this.nextRound(room);
    }
  }

  submitBid(room, clientId, amount) {
    const round = room.draft && room.draft.round;
    if (room.draft && room.draft.paused) return { error: 'DRAFT_PAUSED' };
    if (!round || !isAuctionKind(round.kind)) return { error: 'NO_ACTIVE_AUCTION' };
    if (Date.now() > round.deadline) return { error: 'AUCTION_CLOSED' };

    if (round.kind === 'blind_auction') return this.submitBlindBid(room, round, clientId, amount);

    const bidder = findPlayer(room, clientId);
    if (!bidder) return { error: 'NOT_IN_ROOM' };
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — sadece bu turda o pozisyona
    // ihtiyacı olan oyuncular (participantIds) teklif verebilir.
    if (round.participantIds && !round.participantIds.includes(clientId)) return { error: 'NOT_A_PARTICIPANT' };

    amount = Math.floor(Number(amount));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'INVALID_AMOUNT' };

    const minAcceptable = round.highestBid > 0 ? round.highestBid + MIN_RAISE : MIN_PLAYER_PRICE;
    if (amount < minAcceptable) return { error: 'BID_TOO_LOW', minAcceptable };

    const cap = personalMaxBid(bidder);
    if (amount > cap) return { error: 'EXCEEDS_PERSONAL_CAP', cap };

    round.bids.set(clientId, { amount, at: Date.now() });
    round.highestBid = amount;
    round.highestBidderClientId = clientId;

    // Anti-snipe: son saniyelerde teklif gelirse süreyi biraz uzat (canlı/eş zamanlı
    // adalet için mantıklı bir teknik ekleme — dokümanda zorunlu değil).
    const msLeft = round.deadline - Date.now();
    if (msLeft < ANTI_SNIPE_WINDOW_MS) {
      round.deadline += ANTI_SNIPE_EXTENSION_MS;
      clearTimeout(round.timer);
      round.timer = setTimeout(() => this.resolveAuctionRound(room), round.deadline - Date.now());
    }

    this.emitDraft(room);
    return { ok: true };
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft — teklif miktarı round çözülene kadar
  // RAKİBE asla yayınlanmaz (bkz. publicRoundState), bu yüzden "önceki tekliften yüksek olma"
  // kuralı (canlı moddaki minAcceptable) burada anlamsız — sadece MIN_PLAYER_PRICE tabanı ve
  // kişisel bütçe tavanı geçerli. Kendi teklifini süre/round bitene kadar istediği kadar
  // değiştirebilir (üzerine yazılır) — hiçbir bilgi sızmadığı için bunun adaletsiz bir yanı yok.
  submitBlindBid(room, round, clientId, amount) {
    const bidder = findPlayer(room, clientId);
    if (!bidder) return { error: 'NOT_IN_ROOM' };
    if (round.participantIds && !round.participantIds.includes(clientId)) return { error: 'NOT_A_PARTICIPANT' };

    amount = Math.floor(Number(amount));
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'INVALID_AMOUNT' };
    if (amount < MIN_PLAYER_PRICE) return { error: 'BID_TOO_LOW', minAcceptable: MIN_PLAYER_PRICE };

    const cap = personalMaxBid(bidder);
    if (amount > cap) return { error: 'EXCEEDS_PERSONAL_CAP', cap };

    round.bids.set(clientId, { amount, at: Date.now() });
    // Yayınlanan durum sadece "kim teklif verdi" bilgisini içerir (publicRoundState), miktar
    // hiçbir zaman round çözülmeden dışarı çıkmaz.
    this.emitDraft(room);

    // TÜM katılımcılar kilitlediyse süreyi beklemeye gerek yok — hemen çöz (canlı moddaki
    // anti-snipe gerginliği zaten yok, bu yüzden erken çözüm oyunu hızlandırmaktan başka bir
    // şey yapmaz). [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod: eşik artık
    // room.players.length değil, bu turun katılımcı sayısı (participantIds.length).
    if (round.bids.size >= round.participantIds.length) {
      clearTimeout(round.timer);
      this.resolveBlindRound(room);
    }

    return { ok: true };
  }

  resolveBlindRound(room) {
    const round = room.draft.round;
    if (!round || round.kind !== 'blind_auction') return;
    clearTimeout(round.timer);

    const type = round.slotType;
    const ranking = rankParticipants(round.participantIds, round.bids);
    const winnerId = ranking[0];
    const winner = findPlayer(room, winnerId);
    const winnerBid = round.bids.get(winnerId);
    const price = winnerBid ? winnerBid.amount : MIN_PLAYER_PRICE;

    this.assignPlayer(room, winner, round.main, type, price, 'blind_auction_won');

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Yedek atama sırası" — anayı kazanamayan katılımcılar
    // arasında yedekler ranking sırasına göre (en yüksek teklif -> en iyi yedek) dağıtılır.
    // Havuz kısa kaldıysa (backups.length < K-1) sıradaki katılımcılar bu turda boş kalır,
    // slotsNeeded'ları düşmediği için bir sonraki tur tekrar aday olurlar.
    const backups = round.backups || [];
    const laddered = [];
    for (let i = 1; i < ranking.length; i++) {
      const backupPlayer = backups[i - 1];
      if (!backupPlayer) break;
      const loserId = ranking[i];
      const loser = findPlayer(room, loserId);
      this.assignPlayer(room, loser, backupPlayer, type, BACKUP_PLAYER_PRICE, 'backup');
      laddered.push({ clientId: loserId, player: backupPlayer, price: BACKUP_PLAYER_PRICE });
    }

    this.emitDraft(room, {
      event: {
        type: 'blind_auction_resolved',
        slotType: type,
        winnerClientId: winnerId,
        price,
        main: round.main,
        backups: laddered,
        // [KULLANICI İSTEĞİ] Kör Draft'ın "reveal" anı — round çözüldükten SONRA tüm
        // katılımcıların teklifi (verdiyse) açığa çıkar; artık bilgi sızıntısı değil, bitmiş
        // bir turun sonucu.
        bids: revealBids(round),
      },
    });

    room.draft.round = null;
    setTimeout(() => {
      if (room.status !== STATUS.DRAFT) return;
      this.nextRound(room);
    }, ROUND_RESULT_DELAY_MS);
  }

  resolveAuctionRound(room) {
    const round = room.draft.round;
    if (!round || round.kind !== 'auction') return;
    clearTimeout(round.timer);

    const type = round.slotType;
    const ranking = rankParticipants(round.participantIds, round.bids);
    const winnerId = ranking[0];
    const winner = findPlayer(room, winnerId);
    const winnerBid = round.bids.get(winnerId);
    const price = winnerBid ? winnerBid.amount : MIN_PLAYER_PRICE;

    this.assignPlayer(room, winner, round.main, type, price, 'auction_won');

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — "Yedek atama sırası": anayı
    // kazanamayan katılımcılar arasında yedekler teklif sırasına göre (en yüksek teklif veren,
    // ama kazanmayan, en iyi yedeği alır) dağıtılır; hiç teklif vermeyenler ranking'de zaten
    // sona (ve aralarında rastgele) sıralanmış durumda (bkz. rankParticipants).
    const backups = round.backups || [];
    const laddered = [];
    for (let i = 1; i < ranking.length; i++) {
      const backupPlayer = backups[i - 1];
      if (!backupPlayer) break; // havuz kısa kaldıysa kalan katılımcılar bu turda boş kalır
      const loserId = ranking[i];
      const loser = findPlayer(room, loserId);
      this.assignPlayer(room, loser, backupPlayer, type, BACKUP_PLAYER_PRICE, 'backup');
      laddered.push({ clientId: loserId, player: backupPlayer, price: BACKUP_PLAYER_PRICE });
    }

    this.emitDraft(room, {
      event: {
        type: 'auction_resolved',
        slotType: type,
        winnerClientId: winnerId,
        price,
        main: round.main,
        backups: laddered,
        // [KULLANICI İSTEĞİ] "Teklif verdiğinde ... diğer kullanıcıların ne kadar teklif
        // verdiğini göster her seferinde" — canlı moddaki tüm katılımcı teklifleri de blind
        // moddakiyle aynı şekilde round sonucunda özetlenir (client sonuç panelinde gösterir).
        bids: revealBids(round),
      },
    });

    room.draft.round = null;
    setTimeout(() => {
      if (room.status !== STATUS.DRAFT) return;
      this.nextRound(room);
    }, ROUND_RESULT_DELAY_MS);
  }

  assignPlayer(room, roomPlayer, player, slotType, price, reason) {
    roomPlayer.budget -= price;
    roomPlayer.squad.push({ slot: slotType, price, reason, player });
    roomPlayer.slotsNeeded[slotType] = Math.max(0, (roomPlayer.slotsNeeded[slotType] || 0) - 1);
    room.draft.history.push({ clientId: roomPlayer.clientId, slotType, price, reason, playerId: player.id, at: Date.now() });
  }

  finishDraft(room) {
    room.status = STATUS.SQUAD_SELECT;
    room.draft.round = null;
    this.emitState(room);
    this.emitDraft(room, { event: { type: 'draft_complete' } });
    this.io.to(room.code).emit('draft:complete', {
      players: room.players.map((p) => ({ clientId: p.clientId, squad: p.squad, budget: p.budget })),
    });
  }
}

module.exports = { DraftEngine, personalMaxBid, slotCounts };
