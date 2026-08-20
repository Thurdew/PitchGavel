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
  WHEEL_PICK_DURATION_SECONDS,
  WHEEL_AUTO_RESOLVE_DELAY_MS,
} = require('../shared/gameConfig');
const {
  pickMainAndLadder, pickSingle, buildWheelSegments, poolForSlot,
  pickWheelRatingCandidates, pickWheelIconCandidates, pickWheelFieldCandidates, spinWheelSegment,
} = require('./pool');
const { STATUS } = require('../rooms/RoomManager');

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Bu iki segment "seçim gerektirmiyor" —
// sonuç spin sonrası otomatik uygulanır (bkz. DraftEngine.resolveAutoWheelOutcome). İkisi de
// çarkın 'kötü' havuzundan (bkz. gameConfig.js WHEEL_SPECIAL_SEGMENTS).
const AUTO_RESOLVE_KINDS = new Set(['forced_worst', 'give_best']);

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

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Rakipten çal" / "en iyisini rakibe ver"
// segmentlerinin "kaybeden" tarafı — assignPlayer'ın tam tersi: kadrodan çıkarır, o slot tipi
// tekrar ihtiyaç listesine döner (bkz. nextWheelTurn'ün bu oyuncuyu otomatik tekrar sıraya alması).
function removePlayerFromSquad(roomPlayer, slotType, playerId) {
  const idx = roomPlayer.squad.findIndex((e) => e.slot === slotType && e.player.id === playerId);
  if (idx === -1) return null;
  const [entry] = roomPlayer.squad.splice(idx, 1);
  roomPlayer.slotsNeeded[slotType] = (roomPlayer.slotsNeeded[slotType] || 0) + 1;
  return entry;
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

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çark Modu da (auction/blind_auction gibi) round.timer/
// round.deadline şeklinde tek bir zamanlayıcı taşır (bkz. openWheelTurn) — pause/resume bu
// üçünde ORTAK çalışabilir. 'one_sided' bilerek dışarıda: o round hiç timer taşımıyor (anında
// çözülüyor, ROUND_RESULT_DELAY_MS sadece kozmetik bir gösterim gecikmesi).
function hasPausableTimer(kind) {
  return kind === 'auction' || kind === 'blind_auction' || kind === 'wheel';
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
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kaskad açık arttırma — "N kullanıcı için N-1 açık
    // arttırma" — bu pozisyon-turunun kaçıncı aşamasında olduğumuzu (1-based) ve toplam kaç
    // aşama olduğunu istemciye taşır (K=2 odada 1/2 olur, istemci bunu ayrıca vurgulamaz —
    // bkz. views.js cascadeTotal>2 kontrolü). auction/blind_auction dışında anlamsız (null).
    cascadeStage: round.cascadeStage || null,
    cascadeTotal: round.cascadeTotal || null,
  };
  if (round.kind === 'blind_auction') {
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft — rakibin teklif MİKTARI round çözülene
    // kadar asla yayınlanmaz (highestBid/highestBidderClientId burada YOK), sadece "kim teklif
    // verdi" bilgisi paylaşılır — bu bilgi sızıntısı sayılmaz, miktarı açığa çıkarmaz.
    return { ...base, submittedClientIds: round.bids ? [...round.bids.keys()] : [] };
  }
  if (round.kind === 'wheel') {
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Round artık grup değil TEK KİŞİLİK bir
    // tur (bkz. DraftEngine.nextWheelTurn) — main/backups/bigGap/participantIds bu modda anlamsız
    // (base'ten miras kalır ama boş/null gelir). revealValue SADECE 'league'/'nation' segmentinde
    // dolu (o an hangi lig/milliyetin çekildiği — bkz. resolveSpin).
    return {
      ...base,
      clientId: round.clientId,
      currentSpin: round.currentSpin || null,
      phase: round.phase || 'awaiting_spin',
      revealValue: round.revealValue != null ? round.revealValue : null,
    };
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
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Her draftta çarktaki yazılar
      // değişsin" — segment seti artık global bir sabit değil, bu odanın draftına özel (bkz.
      // startDraft/buildWheelSegments). İstemci çark geometrisini bundan çizer.
      wheelSegments: room.draft ? room.draft.wheelSegments || null : null,
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
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kaskad açık arttırma — bkz. startAuctionRound/
      // startCascadeStage. Bir pozisyon-turu K katılımcıyı kapsıyorsa, bu turun ortasında
      // hangi aşamada olduğumuzu (hangi aday açık arttırmada, kimler hâlâ bekliyor) taşır.
      cascade: null,
    };

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Bu draftın SABİT çarkı — havuzlardan
    // (iyi/orta/kötü) seçilip draft boyunca değişmez (bkz. pool.js buildWheelSegments) — ve
    // katılımcıların çevirme sırası (round-robin, sıra sabit; kim aktif oynayacağı cursor'la
    // ilerler — bkz. nextWheelTurn).
    if (room.draftMode === 'wheel') {
      room.draft.wheelSegments = buildWheelSegments();
      room.draft.wheelOrder = shuffleInPlace(room.players.map((p) => p.clientId));
      room.draft.wheelCursor = 0;
    }

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

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Çark modunda round'lar artık pozisyon
    // bazlı SENKRON değil (bkz. gameConfig.js WHEEL_* notu) — kendi ayrı akışına devrediyoruz,
    // aşağıdaki "herkesin aynı anda aynı pozisyona ihtiyacı olsun" varsayımına dayalı auction/
    // blind/one_sided seçimi çark modu için hiç çalıştırılmaz.
    if (room.draftMode === 'wheel') {
      this.nextWheelTurn(room);
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

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "N kadar kullanıcı olduğunda bir tur içinde N-1 kadar
  // açık arttırma olması lazım — x için açık arttırma başlar, x'i alan bir sonraki turdan (y
  // için) çıkar, kalan 2 kişi y için yarışır, en son kalan tek kişiye z rakipsiz gider. Bu kör
  // ihale için de geçerli." — eskiden K katılımcı için TEK bir açık arttırma yapılıp kaybedenler
  // kendi ORİJİNAL tekliflerine göre yedek merdivenine otomatik dağıtılıyordu (gerçek bir ikinci
  // karar/teklif olmadan). Artık her pozisyon-turu bir KASKAD: 1 ana + (K-1) yedeklik ladder yine
  // baştan (tek seferde) çekilir/gösterilir, ama açık arttırma sırayla ilerler — bir aday için
  // kazanan belli olunca kaskaddan çıkar, kalan katılımcılar BİR SONRAKİ (bir alt reytingli) aday
  // için YENİDEN, taze bir açık arttırmaya girer. Sadece 1 kişi kalınca (rekabet yok) son aday
  // otomatik/rakipsiz gider (bkz. startCascadeStage). K=2 odada bu, eski davranışla BİREBİR aynı
  // sonucu üretir (1 açık arttırma + 1 rakipsiz atama) — sadece K>2 odalarda gerçek fark yaratır.
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

    room.draft.cascade = {
      slotType: type,
      candidates: [main, ...backups], // sabit ladder — draft başında bir kez çekilir
      bigGap: isBigGap,
      remaining: needyPlayers.map((p) => p.clientId), // henüz bu pozisyondan almamış katılımcılar
      stageIndex: 0, // candidates[stageIndex] şu an açık arttırmada olan aday
    };
    this.startCascadeStage(room);
  }

  // Kaskadın bir sonraki aşamasını açar: candidates[stageIndex] adayı, cascade.remaining'deki
  // katılımcılar arasında (canlı ya da kör) yeni bir açık arttırmaya çıkar. Sadece 1 katılımcı
  // kaldıysa rekabet yok — aday doğrudan (rakipsiz fiyata) atanır ve kaskad biter.
  startCascadeStage(room) {
    // [KULLANICI İSTEĞİ] Duraklatılmışken aşamalar arası geçiş de BAŞLATILMAZ — nextRound'daki
    // aynı erteleme deseni (bkz. resumeDraft'ın pendingNextRound işleyişi).
    if (room.draft.paused) {
      room.draft.pendingNextRound = true;
      return;
    }

    const c = room.draft.cascade;
    const candidate = c.candidates[c.stageIndex];
    if (!candidate) {
      // Ladder, backupCount'tan kısa kaldı (havuz tükenmiş) — kalan katılımcıların slotsNeeded'ı
      // düşmedi, bir sonraki turda tekrar aday olurlar (draft asla tıkanmaz).
      room.draft.cascade = null;
      this.nextRound(room);
      return;
    }

    const type = c.slotType;
    // Henüz sırası gelmemiş adaylar — reveal-row'da "sıradaki ladder" olarak gösterilmeye devam
    // eder (bkz. views.js) — son eleman HER ZAMAN candidates'ın son elemanı, yani nihayetinde
    // rakipsiz kalana giden aday (bkz. o dosyadaki tag mantığı).
    const laterCandidates = c.candidates.slice(c.stageIndex + 1);

    if (c.remaining.length === 1) {
      // Rekabet yok — son kalan katılımcıya son aday rakipsiz gider (bkz. startOneSidedRound
      // felsefesiyle aynı: BACKUP_PLAYER_PRICE, kaybettiği için değil rakibi kalmadığı için).
      const clientId = c.remaining[0];
      const player = findPlayer(room, clientId);
      this.assignPlayer(room, player, candidate, type, BACKUP_PLAYER_PRICE, 'cascade_uncontested');
      room.draft.round = { slotType: type, kind: 'one_sided', main: candidate, resolvedAt: Date.now() };
      room.draft.cascade = null;
      this.emitDraft(room, {
        event: {
          type: 'one_sided_assigned', slotType: type, clientId, player: candidate,
          price: BACKUP_PLAYER_PRICE, cascadeFinal: true,
        },
      });
      setTimeout(() => {
        if (room.status !== STATUS.DRAFT) return;
        room.draft.round = null;
        this.nextRound(room);
      }, ROUND_RESULT_DELAY_MS);
      return;
    }

    const participantIds = [...c.remaining];
    // [KULLANICI İSTEĞİ] "Bu kör ihale için de geçerli" — kaskad, draftMode'dan bağımsız aynı
    // akışı izler; sadece bu tekil aşamanın canlı mı kör mü açık arttırma olacağı değişir.
    if (room.draftMode === 'blind') {
      const deadline = Date.now() + BLIND_BID_DURATION_SECONDS * 1000;
      room.draft.round = {
        slotType: type,
        kind: 'blind_auction',
        main: candidate,
        backups: laterCandidates,
        participantIds,
        bigGap: c.bigGap,
        deadline,
        bids: new Map(), // clientId -> { amount, at }
        cascadeStage: c.stageIndex + 1,
        cascadeTotal: c.candidates.length,
        timer: setTimeout(() => this.resolveBlindRound(room), BLIND_BID_DURATION_SECONDS * 1000),
      };
      this.emitDraft(room);
      return;
    }

    const deadline = Date.now() + AUCTION_DURATION_SECONDS * 1000;
    room.draft.round = {
      slotType: type,
      kind: 'auction',
      main: candidate,
      backups: laterCandidates,
      participantIds,
      bigGap: c.bigGap,
      deadline,
      bids: new Map(),
      highestBid: 0,
      highestBidderClientId: null,
      cascadeStage: c.stageIndex + 1,
      cascadeTotal: c.candidates.length,
      timer: setTimeout(() => this.resolveAuctionRound(room), AUCTION_DURATION_SECONDS * 1000),
    };
    this.emitDraft(room);
  }

  // ============================== ÇARK MODU v2 ==============================
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Takımları çarktan çıkan sonuca göre kurma... Her oyuncu
  // 11 olana kadar çevirmeye devam etsin; biri diğerinden çalarsa mağdur olan da kendi 11'ine
  // ulaşana kadar çevirmeye devam etsin." — round artık pozisyon bazlı bir GRUP değil, TEK
  // KİŞİLİK bir tur: `room.draft.wheelOrder` (draft başında bir kez karıştırılmış sabit sıra) +
  // `room.draft.wheelCursor` ile round-robin ilerlenir; her turda sıradaki hâlâ ihtiyacı olan
  // (totalRemaining>0) katılımcı, KENDİ slotsNeeded'ından ağırlıklı rastgele bir pozisyon için
  // çevirir. Bir "rakipten çal"/"en iyisini ver" segmenti başka bir katılımcının slotsNeeded'ını
  // yeniden pozitif yaparsa, o katılımcı cursor bir sonraki turunda onu otomatik olarak tekrar
  // bulur — ayrı bir "mağdur kuyruğu" mekanizmasına gerek yok. GK her formasyonda TAM 1 slot
  // olduğu için (bkz. football.js FORMATIONS) ve çal/ver aynı slot tipini simetrik transfer
  // ettiği için, "1 kaleci zorunlu / son kalan ihtiyaç doğal olarak kaleci olur" invariant'ı
  // ekstra kod gerekmeden kendiliğinden sağlanıyor.

  // Sıradaki (hâlâ ihtiyacı olan) katılımcıyı bulup onun için yeni bir tur açar; kimse kalmadıysa
  // draft biter.
  nextWheelTurn(room) {
    const totalLeft = room.players.reduce((sum, p) => sum + totalRemaining(p.slotsNeeded), 0);
    if (totalLeft === 0) {
      this.finishDraft(room);
      return;
    }

    const order = room.draft.wheelOrder;
    let clientId = null;
    for (let tries = 0; tries < order.length; tries++) {
      const candidateId = order[room.draft.wheelCursor % order.length];
      room.draft.wheelCursor += 1;
      const p = findPlayer(room, candidateId);
      if (p && totalRemaining(p.slotsNeeded) > 0) { clientId = candidateId; break; }
    }
    if (!clientId) { this.finishDraft(room); return; } // [SAVUNMA] totalLeft>0 iken burada olmamalı

    const player = findPlayer(room, clientId);
    const remainingOwn = Object.fromEntries(Object.entries(player.slotsNeeded).filter(([, c]) => c > 0));
    const type = pickWeightedType([remainingOwn]);
    this.openWheelTurn(room, clientId, type);
  }

  openWheelTurn(room, clientId, type) {
    room.draft.round = {
      slotType: type,
      kind: 'wheel',
      clientId, // bu turun tek sahibi
      currentSpin: null, // henüz çevrilmediyse null; çevirince segment nesnesi
      revealValue: null, // 'league'/'nation' segmentinde o an çekilen spesifik değer
      phase: 'awaiting_spin', // 'awaiting_spin' | 'awaiting_pick'
      deadline: Date.now() + WHEEL_PICK_DURATION_SECONDS * 1000,
      timer: null,
    };
    const round = room.draft.round;
    // [SAVUNMA] Sırası gelen kişi hiç çevirmezse (bağlantı kopması vb.) draft asla tıkanmasın —
    // süre dolunca sunucu onun adına otomatik çevirir (bkz. autoSpinWheel).
    round.timer = setTimeout(() => this.autoSpinWheel(room), WHEEL_PICK_DURATION_SECONDS * 1000);
    this.emitDraft(room);
  }

  spinWheel(room, clientId) {
    const round = room.draft && room.draft.round;
    if (room.draft.paused) return { error: 'DRAFT_PAUSED' };
    if (!round || round.kind !== 'wheel') return { error: 'NO_ACTIVE_WHEEL' };
    if (round.clientId !== clientId) return { error: 'NOT_YOUR_TURN' };
    if (round.currentSpin) return { error: 'ALREADY_SPUN' };

    this.resolveSpin(room, round);
    return { ok: true, segment: round.currentSpin };
  }

  // Çarkı SUNUCU tarafında otoriter olarak çevirir (hile önleme — istemci sadece isteği yollar,
  // sonucu belirlemez). [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Bazı segmentler o an
  // uygulanamaz olabilir (steal: rakipte bu pozisyondan yok, icon: bu pozisyonda efsane kalmadı,
  // league/nation: pozisyon havuzu boş) — bu durumda draftın asla tıkanmaması için segment
  // sunucuda otomatik olarak "genel havuzdan seç"e (min:1,max:99 rating) düşürülür. league/nation
  // için (fallback dışında) o an havuzda MEVCUT bir lig/milliyet rastgele seçilip revealValue'ya
  // yazılır — böylece hiçbir zaman boş çıkmaz ve tur bazında bile çeşitlilik sağlar.
  resolveSpin(room, round) {
    const raw = spinWheelSegment(room.draft.wheelSegments);
    const type = round.slotType;
    let segment = raw;
    let revealValue = null;

    if (raw.kind === 'steal') {
      const hasStealable = room.players.some((o) => o.clientId !== round.clientId && o.squad.some((e) => e.slot === type));
      if (!hasStealable) segment = { kind: 'rating', label: `${raw.label} (kimsede yok — havuzdan seç)`, min: 1, max: 99 };
    } else if (raw.kind === 'icon') {
      if (pickWheelIconCandidates(type, room.draft.takenIds, room.playerPool).length === 0) {
        segment = { kind: 'rating', label: `${raw.label} (efsane kalmadı — havuzdan seç)`, min: 1, max: 99 };
      }
    } else if (raw.kind === 'league' || raw.kind === 'nation') {
      const field = raw.kind === 'league' ? 'league' : 'nation';
      const all = poolForSlot(type, room.draft.takenIds, room.playerPool);
      const values = [...new Set(all.map((p) => p[field]).filter(Boolean))];
      if (values.length === 0) {
        segment = { kind: 'rating', label: `${raw.label} (havuz boş — genel seç)`, min: 1, max: 99 };
      } else {
        revealValue = values[Math.floor(Math.random() * values.length)];
      }
    }

    round.currentSpin = segment;
    round.revealValue = revealValue;
    round.phase = 'awaiting_pick';
    round.deadline = Date.now() + WHEEL_PICK_DURATION_SECONDS * 1000;
    clearTimeout(round.timer);
    if (AUTO_RESOLVE_KINDS.has(segment.kind)) {
      // [KULLANICI İSTEĞİ] "Döndüğü belli olsun, sonuç ekrana gelsin" — seçim gerektirmeyen bu
      // segmentler bile istemcinin döndürme animasyonu bitene kadar (bkz. WHEEL_AUTO_RESOLVE_DELAY_MS)
      // sonucu açığa çıkarmaz.
      round.timer = setTimeout(() => this.resolveAutoWheelOutcome(room, round), WHEEL_AUTO_RESOLVE_DELAY_MS);
    } else {
      round.timer = setTimeout(() => this.autoPickWheel(room), WHEEL_PICK_DURATION_SECONDS * 1000);
    }
    this.emitDraft(room);
  }

  autoSpinWheel(room) {
    const round = room.draft && room.draft.round;
    if (!round || round.kind !== 'wheel' || round.currentSpin) return;
    this.resolveSpin(room, round);
  }

  // Seçim gerektiren segmentler için oyuncu havuzunu segment `kind`'ine göre çözer (rating bandı,
  // icon havuzu, ya da o an çekilen lig/milliyet). 'steal' burada YOK — kendi ownerClientId
  // gerektiren ayrı bir akışı var (bkz. submitWheelPick/autoPickWheel).
  candidatesForSegment(room, round) {
    const seg = round.currentSpin;
    if (seg.kind === 'icon') return pickWheelIconCandidates(round.slotType, room.draft.takenIds, room.playerPool);
    if (seg.kind === 'league') return pickWheelFieldCandidates(round.slotType, room.draft.takenIds, room.playerPool, 'league', round.revealValue);
    if (seg.kind === 'nation') return pickWheelFieldCandidates(round.slotType, room.draft.takenIds, room.playerPool, 'nation', round.revealValue);
    return pickWheelRatingCandidates(round.slotType, room.draft.takenIds, seg, room.playerPool).candidates;
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Rakipten istediğin oyuncuyu al." —
  // istemci hangi rakipten (ownerClientId) hangi oyuncuyu (playerId) çalmak istediğini gönderir;
  // sunucu bu oyuncunun GERÇEKTEN o rakibin kadrosunda ve bu turun pozisyon tipinde olduğunu
  // doğrular. Kaybeden tarafın slotsNeeded'ı otomatik olarak yeniden pozitif olur (bkz.
  // removePlayerFromSquad) — "Y eksik kalıyor, tamamlayana kadar çevirmeye devam ediyor" isteği.
  submitWheelPick(room, clientId, payload = {}) {
    const round = room.draft && room.draft.round;
    if (room.draft.paused) return { error: 'DRAFT_PAUSED' };
    if (!round || round.kind !== 'wheel') return { error: 'NO_ACTIVE_WHEEL' };
    if (round.clientId !== clientId) return { error: 'NOT_YOUR_TURN' };
    if (!round.currentSpin || round.phase !== 'awaiting_pick') return { error: 'SPIN_FIRST' };
    const seg = round.currentSpin;
    if (AUTO_RESOLVE_KINDS.has(seg.kind)) return { error: 'AUTO_RESOLVED' };

    const playerId = payload.playerId;

    if (seg.kind === 'steal') {
      const owner = findPlayer(room, payload.ownerClientId);
      if (!owner || owner.clientId === clientId) return { error: 'INVALID_PICK' };
      const entry = removePlayerFromSquad(owner, round.slotType, playerId);
      if (!entry) return { error: 'INVALID_PICK' };
      const taker = findPlayer(room, clientId);
      this.assignPlayer(room, taker, entry.player, round.slotType, 0, 'wheel_stolen');
      this.finishWheelTurn(room, round, clientId, entry.player, { kind: 'steal', fromClientId: owner.clientId });
      return { ok: true };
    }

    const candidates = this.candidatesForSegment(room, round);
    const chosen = candidates.find((p) => p.id === playerId);
    if (!chosen) return { error: 'INVALID_PICK' };
    room.draft.takenIds.add(chosen.id);
    this.assignPlayer(room, findPlayer(room, clientId), chosen, round.slotType, 0, 'wheel_pick');
    this.finishWheelTurn(room, round, clientId, chosen, { kind: seg.kind });
    return { ok: true };
  }

  // Süre dolunca (kişi seçimini yapmazsa) segment türüne göre rastgele bir sonuç otomatik atanır
  // — draftın tıkanmaması için (bkz. diğer modlardaki benzer "kenar durum" notları). forced_worst/
  // give_best zaten kendi otomatik-çözüm timer'ında (bkz. resolveSpin), burada TEKRAR işlenmez.
  autoPickWheel(room) {
    const round = room.draft && room.draft.round;
    if (!round || round.kind !== 'wheel' || !round.currentSpin) return;
    const seg = round.currentSpin;
    if (AUTO_RESOLVE_KINDS.has(seg.kind)) return;
    const clientId = round.clientId;

    if (seg.kind === 'steal') {
      const pool = [];
      for (const o of room.players) {
        if (o.clientId === clientId) continue;
        for (const e of o.squad) if (e.slot === round.slotType) pool.push({ owner: o, entry: e });
      }
      if (pool.length === 0) { this.skipWheelTurnType(room, round); return; }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const entry = removePlayerFromSquad(pick.owner, round.slotType, pick.entry.player.id);
      this.assignPlayer(room, findPlayer(room, clientId), entry.player, round.slotType, 0, 'wheel_stolen');
      this.finishWheelTurn(room, round, clientId, entry.player, { kind: 'steal', fromClientId: pick.owner.clientId });
      return;
    }

    const candidates = this.candidatesForSegment(room, round);
    if (candidates.length === 0) { this.skipWheelTurnType(room, round); return; }
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    room.draft.takenIds.add(chosen.id);
    this.assignPlayer(room, findPlayer(room, clientId), chosen, round.slotType, 0, 'wheel_pick');
    this.finishWheelTurn(room, round, clientId, chosen, { kind: seg.kind });
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] forced_worst ("şanssız tur" — o
  // pozisyondaki en düşük reytingli oyuncu otomatik atanır) ve give_best ("en iyisini ver" —
  // kendi kadrondaki, bir rakibin ihtiyaç duyduğu bir slotta en yüksek reytingli oyuncu o rakibe
  // verilir) burada, seçim beklemeden otomatik uygulanır.
  resolveAutoWheelOutcome(room, round) {
    if (room.status !== STATUS.DRAFT) return;
    const seg = round.currentSpin;

    if (seg.kind === 'forced_worst') {
      const all = poolForSlot(round.slotType, room.draft.takenIds, room.playerPool);
      if (all.length === 0) { this.skipWheelTurnType(room, round); return; }
      const worst = all.reduce((min, p) => (p.rating < min.rating ? p : min), all[0]);
      room.draft.takenIds.add(worst.id);
      this.assignPlayer(room, findPlayer(room, round.clientId), worst, round.slotType, 0, 'wheel_forced_worst');
      this.finishWheelTurn(room, round, round.clientId, worst, { kind: 'forced_worst' });
      return;
    }

    // give_best
    const giver = findPlayer(room, round.clientId);
    const opponents = room.players.filter((p) => p.clientId !== round.clientId);
    const eligible = giver.squad.filter((entry) => opponents.some((o) => (o.slotsNeeded[entry.slot] || 0) > 0));
    if (eligible.length === 0) {
      // Kimse ihtiyaç duymuyor (ya da kadro boş) — turu boşa harcamamak için nötr bir reyting
      // bandı seçim ekranına düşülür (bkz. resolveSpin'deki fallback deseniyle aynı yaklaşım).
      round.currentSpin = { kind: 'rating', label: '😱 En İyisini Ver (uygun alıcı yok — havuzdan seç)', min: 1, max: 99 };
      round.phase = 'awaiting_pick';
      round.deadline = Date.now() + WHEEL_PICK_DURATION_SECONDS * 1000;
      clearTimeout(round.timer);
      round.timer = setTimeout(() => this.autoPickWheel(room), WHEEL_PICK_DURATION_SECONDS * 1000);
      this.emitDraft(room);
      return;
    }
    eligible.sort((a, b) => b.player.rating - a.player.rating);
    const given = eligible[0];
    const recipients = opponents.filter((o) => (o.slotsNeeded[given.slot] || 0) > 0);
    const recipient = recipients[Math.floor(Math.random() * recipients.length)];
    const entry = removePlayerFromSquad(giver, given.slot, given.player.id);
    this.assignPlayer(room, recipient, entry.player, given.slot, 0, 'wheel_given');
    this.finishWheelTurn(room, round, round.clientId, entry.player, { kind: 'give_best', toClientId: recipient.clientId, slotType: given.slot });
  }

  // [SAVUNMA] Bir pozisyon tipi için havuz TAMAMEN tükendiyse (pratikte olası değil) o tipi bu
  // katılımcı için kapat ve hemen devam et — draft asla tıkanmasın.
  skipWheelTurnType(room, round) {
    findPlayer(room, round.clientId).slotsNeeded[round.slotType] = 0;
    clearTimeout(round.timer);
    room.draft.round = null;
    this.nextRound(room);
  }

  finishWheelTurn(room, round, clientId, player, extra = {}) {
    clearTimeout(round.timer);
    this.emitDraft(room, {
      event: {
        type: 'wheel_turn_resolved',
        clientId,
        slotType: extra.slotType || round.slotType,
        player,
        segmentKind: round.currentSpin.kind,
        band: round.currentSpin.label,
        revealValue: round.revealValue,
        ...extra,
      },
    });
    room.draft.round = null;
    setTimeout(() => {
      if (room.status !== STATUS.DRAFT) return;
      this.nextRound(room);
    }, ROUND_RESULT_DELAY_MS);
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
    if (round && hasPausableTimer(round.kind) && round.timer) {
      clearTimeout(round.timer);
      round.timer = null;
      round.pausedRemainingMs = Math.max(0, round.deadline - Date.now());
    }
    this.emitDraft(room);
  }

  resumeDraft(room) {
    room.draft.paused = false;
    const round = room.draft.round;
    if (round && hasPausableTimer(round.kind) && round.pausedRemainingMs != null) {
      const remaining = round.pausedRemainingMs;
      round.deadline = Date.now() + remaining;
      round.pausedRemainingMs = null;
      let resolve;
      if (round.kind === 'blind_auction') resolve = () => this.resolveBlindRound(room);
      else if (round.kind === 'auction') resolve = () => this.resolveAuctionRound(room);
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Hangi aşamada duraklatıldıysa (henüz
      // çevirmedi mi, çevirdi ama seçmedi mi, çevirdi ve seçim gerektirmeyen bir segment otomatik
      // uygulanmayı mı bekliyordu) devam ederken de AYNI aşamanın otomatik-tamamlama fonksiyonuna
      // dönmeli.
      else if (round.phase === 'awaiting_spin') resolve = () => this.autoSpinWheel(room);
      else if (round.currentSpin && AUTO_RESOLVE_KINDS.has(round.currentSpin.kind)) resolve = () => this.resolveAutoWheelOutcome(room, round);
      else resolve = () => this.autoPickWheel(room);
      round.timer = setTimeout(resolve, remaining);
    }
    this.emitDraft(room);
    if (room.draft.pendingNextRound) {
      room.draft.pendingNextRound = false;
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kaskad ortasında (bir aşama çözülüp bir sonrakine
      // geçilmeden önce) duraklatıldıysa, devam ederken de kaldığı aşamadan devam etmeli —
      // baştan nextRound()'a dönüp yeni bir pozisyon-turu başlatmamalı.
      if (room.draft.cascade) this.startCascadeStage(room);
      else this.nextRound(room);
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

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kaskad — bu artık K katılımcının TAMAMINI tek seferde
  // ladder'a dağıtmıyor: sadece BU aşamanın adayı için kazananı belirliyor, kazananı kaskaddan
  // düşürüyor ve (rekabet kaldıysa) bir sonraki aşamayı (bir alt reytingli aday için taze bir
  // açık arttırma) açıyor — bkz. startCascadeStage. Kaybedenler kendi ORİJİNAL bu-aşamadaki
  // tekliflerine göre otomatik atanmıyor; bir sonraki adayın açık arttırmasında YENİDEN, taze
  // bir teklif vermek zorundalar (kullanıcının "en çok parayı veren y oyuncusunu alıyor" örneği).
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

    this.emitDraft(room, {
      event: {
        type: 'blind_auction_resolved',
        slotType: type,
        winnerClientId: winnerId,
        price,
        main: round.main,
        // [KULLANICI İSTEĞİ] Artık toplu bir "yedek merdiveni" atanmıyor (bkz. yukarıdaki not) —
        // kalan katılımcılar bir sonraki aşamanın kendi sonuç panelinde ayrı ayrı görünecek.
        backups: [],
        cascadeStage: round.cascadeStage || null,
        cascadeTotal: round.cascadeTotal || null,
        // [KULLANICI İSTEĞİ] Kör Draft'ın "reveal" anı — round çözüldükten SONRA (SADECE bu
        // aşamanın katılımcılarının) teklifi açığa çıkar; artık bilgi sızıntısı değil, bitmiş
        // bir aşamanın sonucu.
        bids: revealBids(round),
      },
    });

    room.draft.round = null;
    const c = room.draft.cascade;
    if (c) {
      c.remaining = c.remaining.filter((id) => id !== winnerId);
      c.stageIndex += 1;
    }
    setTimeout(() => {
      if (room.status !== STATUS.DRAFT) return;
      if (room.draft.cascade) this.startCascadeStage(room);
      else this.nextRound(room);
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

    this.emitDraft(room, {
      event: {
        type: 'auction_resolved',
        slotType: type,
        winnerClientId: winnerId,
        price,
        main: round.main,
        // [KULLANICI İSTEĞİ] Artık toplu bir "yedek merdiveni" atanmıyor — kaybedenler bir
        // sonraki aşamanın (bir alt reytingli aday için) TAZE açık arttırmasına giriyor.
        backups: [],
        cascadeStage: round.cascadeStage || null,
        cascadeTotal: round.cascadeTotal || null,
        // [KULLANICI İSTEĞİ] "Teklif verdiğinde ... diğer kullanıcıların ne kadar teklif
        // verdiğini göster her seferinde" — SADECE bu aşamanın katılımcılarının teklifi.
        bids: revealBids(round),
      },
    });

    room.draft.round = null;
    const c = room.draft.cascade;
    if (c) {
      c.remaining = c.remaining.filter((id) => id !== winnerId);
      c.stageIndex += 1;
    }
    setTimeout(() => {
      if (room.status !== STATUS.DRAFT) return;
      if (room.draft.cascade) this.startCascadeStage(room);
      else this.nextRound(room);
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
