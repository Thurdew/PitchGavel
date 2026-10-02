const { STATUS, isValidSecret } = require('../rooms/RoomManager');
const { str, roomCode } = require('./safeHandlers');
const { isValidTeamId, isValidKitId } = require('../shared/teams');
const { canonicalEmail } = require('../coins/CoinService');
const { REACTIONS, REACTION_LIMIT } = require('../shared/economy');

function registerRoomSockets(io, socket, ctx) {
  const { roomManager } = ctx;

  function broadcastState(room) {
    io.to(room.code).emit('room:state', roomManager.toPublicState(room));
  }

  // [GÜVENLİK] clientId makul bir string olmalı; clientSecret koltuğun sahiplik kanıtı (bkz.
  // RoomManager.verifySecret) — odadaki kimseye yayınlanmaz.
  function validIdentity(clientId, clientSecret) {
    return typeof clientId === 'string' && clientId.length > 0 && clientId.length <= 100 && isValidSecret(clientSecret);
  }

  socket.on('room:create', ({ clientId, clientSecret, name, draftMode, playerPool, wheelSegmentLabels, prepWheelEnabled, tradeRoundEnabled, bankedPerksEnabled } = {}, cb) => {
    if (!clientId) return cb?.({ error: 'CLIENT_ID_REQUIRED' });
    if (!validIdentity(clientId, clientSecret)) return cb?.({ error: 'INVALID_IDENTITY' });
    const room = roomManager.createRoom(clientId, str(name), str(draftMode), str(playerPool), wheelSegmentLabels, prepWheelEnabled, tradeRoundEnabled, bankedPerksEnabled, clientSecret);
    roomManager.bindSocket(room.code, clientId, socket.id);
    socket.join(room.code);
    socket.data.clientId = clientId;
    socket.data.roomCode = room.code;
    const state = roomManager.toPublicState(room);
    cb?.({ room: state });
    broadcastState(room);
  });

  socket.on('room:join', ({ clientId, clientSecret, name, code } = {}, cb) => {
    if (!clientId || !code) return cb?.({ error: 'MISSING_FIELDS' });
    if (!validIdentity(clientId, clientSecret) || !roomCode(code)) return cb?.({ error: 'INVALID_IDENTITY' });
    const result = roomManager.joinRoom(roomCode(code), clientId, str(name), clientSecret);
    if (result.error) return cb?.({ error: result.error });

    const { room } = result;
    roomManager.bindSocket(room.code, clientId, socket.id);
    socket.join(room.code);
    socket.data.clientId = clientId;
    socket.data.roomCode = room.code;

    const state = roomManager.toPublicState(room);
    cb?.({ room: state });
    broadcastState(room);

    // En az 2 kişi olup hepsi bağlandıysa (draft artık başlatılabilir durumda) bir sinyal —
    // "oda doldu" değil, sadece "host isterse başlatabilir" anlamında (bkz. RoomManager.allConnected).
    if (roomManager.allConnected(room) && room.status === STATUS.LOBBY) {
      io.to(room.code).emit('room:ready');
    }
  });

  // Sayfa yenilemesi/ağ kopması sonrası aynı clientId ile yeniden bağlanma.
  socket.on('room:reconnect', ({ clientId, clientSecret, code } = {}, cb) => {
    if (!clientId || !code) return cb?.({ error: 'MISSING_FIELDS' });
    const room = roomManager.getRoom(roomCode(code));
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player) return cb?.({ error: 'PLAYER_NOT_IN_ROOM' });
    // [GÜVENLİK — KOLTUK ELE GEÇİRME] clientId herkese açık; koltuğu sadece gizli anahtarın
    // sahibi geri alabilir. Aksi halde odadaki biri rakibinin clientId'siyle onun yerine geçip
    // bütçesiyle teklif verebiliyor, dizilişini değiştirebiliyordu.
    if (!roomManager.verifySecret(player, clientSecret)) return cb?.({ error: 'SEAT_TAKEN' });

    roomManager.bindSocket(room.code, clientId, socket.id);
    socket.join(room.code);
    socket.data.clientId = clientId;
    socket.data.roomCode = room.code;

    cb?.({ room: roomManager.toPublicState(room) });
    broadcastState(room);
  });

  // [KULLANICI İSTEĞİ] "Maç bittikten sonra tekrar oyna butonu gelsin." — maç bittiyse,
  // taraflardan biri odayı (aynı kod, aynı iki oyuncu) LOBBY'ye resetleyip yeni bir draft
  // başlatılabilir hale getirebilir. Maç zaten bittiği için (kaybedecek bir şey olmadığından)
  // tek taraflı onay yeterli — draft/açık arttırmadaki gibi iki taraflı bir onaya gerek yok.
  socket.on('room:rematch', ({ code } = {}, cb) => {
    const room = roomManager.getRoom(roomCode(code) || roomCode(socket.data.roomCode));
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const isMember = room.players.some((p) => p.clientId === socket.data.clientId);
    if (!isMember) return cb?.({ error: 'NOT_IN_ROOM' });
    if (room.status !== STATUS.FINISHED) return cb?.({ error: 'MATCH_NOT_FINISHED' });

    roomManager.resetForRematch(room);
    cb?.({ ok: true, room: roomManager.toPublicState(room) });
    io.to(room.code).emit('room:rematch');
    broadcastState(room);
  });

  // [KULLANICI İSTEĞİ] "Header'a ana sayfaya dönmek için buton, oyundayken de oyundan çıkmak
  // için bir şey ekle" — istemci tarafı zaten yerel state.room'u sıfırlayıp lobiye dönüyordu
  // ama socket bu odaya HÂLÂ join'li kalıyordu (bkz. socket.join(room.code) yukarıda) — bu
  // yüzden odadaki başka bir olay (ör. rakip "Tekrar Oyna"ya basınca) yayınlanan room:state/
  // room:rematch, ayrılmış istemciye de ulaşıp onu sessizce odaya geri sürükleyebiliyordu. Bu
  // event, gerçek bir socket kopması (disconnect) ile AYNI etkiyi (handleDisconnect — oyuncu
  // "bağlı değil" işaretlenir, hazırım oyu düşer, draft/maç durumu DOKUNULMAZ — rakip
  // reconnect'te olduğu gibi devam edebilir) kasıtlı/istemci tetiklemeli olarak uygular, ARTI
  // socket'i o odanın broadcast grubundan gerçekten çıkarır (socket.leave).
  socket.on('room:leave', ({ code } = {}, cb) => {
    const targetCode = roomCode(code) || roomCode(socket.data.roomCode);
    const room = roomManager.getRoom(targetCode);
    if (room) {
      const changed = roomManager.handleDisconnect(socket.id);
      socket.leave(room.code);
      if (changed) broadcastState(changed);
    }
    if (socket.data.roomCode === targetCode) socket.data.roomCode = null;
    cb?.({ ok: true });
  });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Giriş yapmış oyuncu hesabını
  // odadaki oyuncusuna bağlar (bkz. auth/RoomTickets.js — bilet HTTP'den, güncel cookie ile
  // alınır). Coin ödülü bu bağa göre yazılır. Takım/forma da artık istemcinin söylediğinden değil
  // veritabanından okunuyor (eski `room:setTeam` herkesin herhangi bir premium formayı
  // "giymesine" izin veriyordu). Matchmaking dahil her oda türünde çalışır; takım/forma
  // değiştirildiğinde istemci aynı event'i tekrar çağırır.
  socket.on('room:bindAccount', async ({ ticket } = {}, cb) => {
    const room = roomManager.getRoom(roomCode(socket.data.roomCode));
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const player = room.players.find((p) => p.clientId === socket.data.clientId);
    if (!player) return cb?.({ error: 'NOT_IN_ROOM' });
    const entry = ctx.roomTickets.consume(ticket);
    if (!entry) return cb?.({ error: 'INVALID_TICKET' });
    let user;
    try { user = await ctx.authService.getUserById(entry.userId); } catch (e) { return cb?.({ error: 'SERVER_ERROR' }); }
    if (!user) return cb?.({ error: 'INVALID_TICKET' });
    // Bir oyuncu oda ömrü boyunca tek bir hesaba bağlanır — sonradan başka bir hesaba
    // devredilemez (ör. biri o oyuncunun clientId'siyle bağlanıp kazancı kendine yazamasın).
    if (player.account && player.account.userId !== user.id) return cb?.({ error: 'ALREADY_LINKED' });
    const canonical = canonicalEmail(user.email);
    const clash = room.players.some((p) => p !== player && p.account
      && (p.account.userId === user.id || p.account.canonicalEmail === canonical));
    if (clash) return cb?.({ error: 'ACCOUNT_ALREADY_IN_ROOM' });

    let kitId = null;
    if (user.favoriteTeam && isValidTeamId(user.favoriteTeam)) {
      kitId = isValidKitId(user.favoriteKit) && (await ctx.coinService.ownsKit(user.id, user.favoriteKit)) ? user.favoriteKit : 'home';
    }
    player.account = { userId: user.id, canonicalEmail: canonical, verified: !!user.emailVerified, ip: entry.ip };
    // [KULLANICI İSTEĞİ] Kayıtlı kullanıcı odada hesabındaki görünen adla görünür.
    if (user.displayName) player.name = String(user.displayName).trim().slice(0, 24) || player.name;
    player.teamId = kitId ? user.favoriteTeam : null;
    player.kitId = kitId;
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Kozmetikler de DB'den, sahiplik süzgecinden
    // geçerek — istemci ne söylerse söylesin almadığı bir ürünü odada gösteremez.
    try {
      player.cosmetics = await ctx.coinService.equippedCosmetics(user.id, user.cosmetics);
      player.reactionPacks = await ctx.coinService.ownedReactionPacks(user.id);
    } catch (e) {
      player.cosmetics = null;
      player.reactionPacks = [];
    }
    cb?.({ ok: true });
    broadcastState(room);
  });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Draft/takas tepkileri. Oda içine yayınlanır;
  // odada kalıcı bir kaydı yok. Kova: en fazla REACTION_LIMIT.burst birikir, refillMs'de bir dolar.
  socket.on('room:react', ({ reactionId } = {}, cb) => {
    const room = roomManager.getRoom(roomCode(socket.data.roomCode));
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const player = room.players.find((p) => p.clientId === socket.data.clientId);
    if (!player) return cb?.({ error: 'NOT_IN_ROOM' });
    const def = Object.prototype.hasOwnProperty.call(REACTIONS, reactionId) ? REACTIONS[reactionId] : null;
    if (!def) return cb?.({ error: 'UNKNOWN_REACTION' });
    if (def.pack && !(player.reactionPacks || []).includes(def.pack)) return cb?.({ error: 'REACTION_NOT_OWNED' });
    const now = Date.now();
    const b = player.reactBucket || { tokens: REACTION_LIMIT.burst, at: now };
    const refill = Math.floor((now - b.at) / REACTION_LIMIT.refillMs);
    if (refill > 0) { b.tokens = Math.min(REACTION_LIMIT.burst, b.tokens + refill); b.at += refill * REACTION_LIMIT.refillMs; }
    if (b.tokens >= REACTION_LIMIT.burst) b.at = now;
    if (b.tokens <= 0) { player.reactBucket = b; return cb?.({ error: 'RATE_LIMITED' }); }
    b.tokens -= 1;
    player.reactBucket = b;
    io.to(room.code).emit('room:reaction', { clientId: player.clientId, reactionId, at: now });
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const room = roomManager.handleDisconnect(socket.id);
    if (room) broadcastState(room);
  });
}

module.exports = { registerRoomSockets };
