const { STATUS } = require('../rooms/RoomManager');
const { roomCode } = require('./safeHandlers');
const { playRoundRobin } = require('../match/orchestrate');
const crypto = require('crypto');
const { db } = require('../db/db');

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAYLAŞILAN SONUÇ] "Paylaş deyince atılan linkte turun
// detayları görünsün." — maç sonucu kalıcı bir anlık görüntü olarak kaydedilir, /sonuc/:id herkese
// açık. clientId'ler oturum kimliği olduğu için (bkz. app.js LS_CLIENT_ID) dışarı verilmez —
// sırayla p0, p1… takma adlarına çevrilir. Kayıt hatası maç akışını bozmaz.
function saveSharedResult(room, result) {
  const id = crypto.randomBytes(8).toString('base64url');
  const players = room.players.map((p, i) => ({ alias: `p${i}`, clientId: p.clientId, name: p.name, teamId: p.teamId || null, kitId: p.kitId || null }));
  let json = JSON.stringify({
    createdAt: Date.now(),
    draftMode: room.draftMode || null,
    players: players.map((p) => ({ clientId: p.clientId, name: p.name, teamId: p.teamId, kitId: p.kitId })),
    standings: result.standings,
    fixtures: result.fixtures,
    winnerClientId: result.winnerClientId,
  });
  for (const p of players) if (p.clientId) json = json.split(p.clientId).join(p.alias);
  if (json.length > 600000) return null;
  db.run('INSERT INTO shared_results (id, payload, created_at) VALUES (?, ?, ?)', id, json, Date.now())
    .catch((e) => console.error('[share] sonuç kaydedilemedi:', e.message));
  return id;
}

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
    const room = roomManager.getRoom(roomCode(code) || roomCode(socket.data.roomCode));
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
    // Coin ödülü (aşağıda) bu kimlikle eşleşir — rövanşta eski ödül yeni sonuca karışmasın.
    result.resultId = `${room.code}-${Date.now()}`;
    try { result.shareId = saveSharedResult(room, result); } catch (e) { result.shareId = null; }

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
    awardCoins(room, result);
  });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Maç sonucu kesinleşince sunucuda
  // ödül yazılır (istemci "kazandım" diyemez). Sonuç her oyuncuya KENDİ socket'ine gönderilir;
  // istemci bunu anlatım bitene kadar göstermez (skoru önceden söylememek için). Veritabanı
  // hatası maç akışını asla bozmaz — sadece loglanır.
  function awardCoins(room, result) {
    const accounts = {};
    for (const p of room.players) if (p.account) accounts[p.clientId] = p.account;
    if (Object.keys(accounts).length === 0) return;
    ctx.coinService.awardRoomResult(result.fixtures, accounts, room.players.map((p) => p.clientId))
      .then((awards) => {
        for (const p of room.players) {
          const award = awards[p.clientId];
          if (!award || !p.socketId) continue;
          io.to(p.socketId).emit('coins:awarded', { resultId: result.resultId, ...award });
        }
      })
      .catch((e) => console.error('[coins] maç ödülü yazılamadı:', e.message));
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Anlatım hızı OY: sadece bu oyuncunun oyu kaydedilir —
  // gerçek değişiklik SADECE room.players'ın TAMAMI aynı hızı oyladığında uygulanır (bkz. yukarıdaki
  // playbackSyncPublic/initPlaybackSync notu). Zaten anlaşılmış bir hızdan farklı bir öneri oy
  // birliğine ulaşana kadar mevcut anlaşılan hız DEĞİŞMEDEN kalır — "herkes aynı şekilde izler".
  socket.on('match:playbackSpeedVote', ({ code, speed } = {}, cb) => {
    const room = roomManager.getRoom(roomCode(code) || roomCode(socket.data.roomCode));
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
    const room = roomManager.getRoom(roomCode(code) || roomCode(socket.data.roomCode));
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
