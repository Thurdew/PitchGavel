const { STATUS } = require('../rooms/RoomManager');
const { playRoundRobin } = require('../match/orchestrate');

// [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "3 arkadaş oynuyoruz, herkesin ekranında o sırada
// FARKLI maç oynanıyor, spoiler yiyoruz — herkesin ekranında aynı anda aynı maç olması lazım."
// Kök neden: anlatım SIRASI (bkz. client app.js buildMatchOrder) her istemcide KENDİ
// Math.random()'ıyla, BİRBİRİNDEN BAĞIMSIZ karıştırılıyordu — aynı sonuç verisine (fixtures)
// rağmen her ekran farklı bir sırayla oynatıyordu. Artık sıra SADECE BURADA, sunucuda, TEK
// SEFERDE belirlenip result.matchOrder olarak TÜM istemcilere (hem ack cevabıyla hem
// broadcast'le) AYNI dizi gönderiliyor — client artık kendi sırasını üretmiyor, sunucununkini
// oynatıyor (bkz. app.js applyMatchResult).
function buildMatchOrder(fixtureCount) {
  const order = [];
  for (let i = 0; i < fixtureCount; i++) {
    order.push({ fixtureIndex: i, matchIndex: 0 });
    order.push({ fixtureIndex: i, matchIndex: 1 });
  }
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Sonuca geç için bütün oyuncuların onayı gereksin — ya
// herkes sonuca geçecek ya da herkes aynı şekilde izleyecek, hızlı da dahil." — daha önce anlatım
// hızı (slow/fast) ve "Sonuca Geç" tamamen İSTEMCİ-YEREL bir tercihti: sıra artık sunucuda senkron
// olsa bile (bkz. buildMatchOrder) bir oyuncu Hızlı'ya geçip ya da direkt atlayıp sonucu
// diğerlerinden ÖNCE görebiliyordu — spoiler riski. Artık ikisi de OY BİRLİĞİ gerektiriyor:
// `room.playbackSync` odadaki TÜM oyuncular (room.players, sadece bağlı olanlar değil — diğer
// oy mekanizmalarıyla aynı sertlikte) aynı hızı/skip'i oylayana kadar değişmez.
function initPlaybackSync(room) {
  room.playbackSync = { speed: 'slow', skip: false, speedVotes: {}, skipVotes: new Set() };
}
function playbackSyncPublic(room) {
  const ps = room.playbackSync || { speed: 'slow', skip: false, speedVotes: {}, skipVotes: new Set() };
  return { speed: ps.speed, skip: ps.skip, speedVotes: { ...ps.speedVotes }, skipVotes: [...ps.skipVotes] };
}

function registerMatchSockets(io, socket, ctx) {
  const { roomManager } = ctx;

  // [KULLANICI İSTEĞİ] "Maç başlarken de iki oyuncuda hazır versin." — status FINISHED ise
  // (sonuç zaten var) her zaman olduğu gibi cache'ten döner (reconnect senaryosu). Aksi halde
  // artık tek çağrı maçı BAŞLATMIYOR — her çağrı caller'ın "hazırım" oyunu açıp/kapatıyor,
  // sadece iki oy da varken gerçek simülasyon tetiklenir (draft:start ile aynı desen).
  socket.on('match:simulate', ({ code } = {}, cb) => {
    const room = roomManager.getRoom((code || socket.data.roomCode || '').toUpperCase());
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const isMember = room.players.some((p) => p.clientId === socket.data.clientId);
    if (!isMember) return cb?.({ error: 'NOT_IN_ROOM' });

    if (room.status === STATUS.FINISHED && room.matchState) {
      // [BUG ÖNLEME] room.matchState.playbackSync sadece OLUŞTURULDUĞU andaki anlık görüntüydü —
      // reconnect gibi bir senaryoda bu cache'ten dönüşte oylar değişmiş olabilir, taze okunmalı.
      cb?.({ ok: true, result: { ...room.matchState, playbackSync: playbackSyncPublic(room) }, cached: true });
      return;
    }
    if (room.status !== STATUS.MATCH) return cb?.({ error: 'NOT_READY_FOR_MATCH' });

    const clientId = socket.data.clientId;
    if (room.readyVotes.has(clientId)) room.readyVotes.delete(clientId);
    else room.readyVotes.add(clientId);
    io.to(room.code).emit('room:state', roomManager.toPublicState(room));

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — eşik odadaki TÜM oyuncu sayısı.
    if (room.readyVotes.size < room.players.length) {
      return cb?.({ ok: true, waiting: true });
    }
    room.readyVotes = new Set();

    const result = playRoundRobin(room);
    if (result.error) return cb?.({ error: result.error });
    result.matchOrder = buildMatchOrder((result.fixtures || []).length);

    room.matchState = result;
    room.status = STATUS.FINISHED;
    room.updatedAt = Date.now();
    initPlaybackSync(room);
    result.playbackSync = playbackSyncPublic(room);

    cb?.({ ok: true, result });
    // room.status değişikliğini yay (bkz. lineupSockets.js'deki aynı desen) — aksi halde
    // istemcideki eski 'match' durumu güncellenmez ve sonuç ekranına geçilmez.
    io.to(room.code).emit('room:state', roomManager.toPublicState(room));
    io.to(room.code).emit('match:result', result);
  });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Anlatım hızı OY: sadece bu oyuncunun oyu kaydedilir —
  // gerçek değişiklik SADECE room.players'ın TAMAMI aynı hızı oyladığında uygulanır (bkz. yukarıdaki
  // playbackSyncPublic/initPlaybackSync notu). Zaten anlaşılmış bir hızdan farklı bir öneri oy
  // birliğine ulaşana kadar mevcut anlaşılan hız DEĞİŞMEDEN kalır — "herkes aynı şekilde izler".
  socket.on('match:playbackSpeedVote', ({ code, speed } = {}, cb) => {
    const room = roomManager.getRoom((code || socket.data.roomCode || '').toUpperCase());
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const clientId = socket.data.clientId;
    if (!room.players.some((p) => p.clientId === clientId)) return cb?.({ error: 'NOT_IN_ROOM' });
    if (!room.matchState) return cb?.({ error: 'NO_MATCH_RESULT' });
    if (speed !== 'slow' && speed !== 'fast') return cb?.({ error: 'INVALID_SPEED' });

    if (!room.playbackSync) initPlaybackSync(room);
    const ps = room.playbackSync;
    if (!ps.skip) {
      ps.speedVotes[clientId] = speed;
      const allAgree = room.players.length > 0 && room.players.every((p) => ps.speedVotes[p.clientId] === speed);
      if (allAgree) ps.speed = speed;
    }
    const payload = playbackSyncPublic(room);
    cb?.({ ok: true, playbackSync: payload });
    io.to(room.code).emit('match:playbackSync', payload);
  });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Sonuca Geç" artık tek taraflı değil — toggle (tekrar
  // basmak oyu geri çeker, readyToggle/pauseToggle ile aynı desen), TÜM oyuncular oy verince
  // (room.players.length'e ulaşınca) `skip` kalıcı olarak true olur ve herkes AYNI ANDA sonuç
  // ekranına geçer (bkz. app.js applyPlaybackSync).
  socket.on('match:playbackSkipToggle', ({ code } = {}, cb) => {
    const room = roomManager.getRoom((code || socket.data.roomCode || '').toUpperCase());
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const clientId = socket.data.clientId;
    if (!room.players.some((p) => p.clientId === clientId)) return cb?.({ error: 'NOT_IN_ROOM' });
    if (!room.matchState) return cb?.({ error: 'NO_MATCH_RESULT' });

    if (!room.playbackSync) initPlaybackSync(room);
    const ps = room.playbackSync;
    if (!ps.skip) {
      if (ps.skipVotes.has(clientId)) ps.skipVotes.delete(clientId); else ps.skipVotes.add(clientId);
      if (room.players.length > 0 && ps.skipVotes.size >= room.players.length) ps.skip = true;
    }
    const payload = playbackSyncPublic(room);
    cb?.({ ok: true, playbackSync: payload });
    io.to(room.code).emit('match:playbackSync', payload);
  });
}

module.exports = { registerMatchSockets };
