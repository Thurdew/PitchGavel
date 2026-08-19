const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { RoomManager } = require('./rooms/RoomManager');
const { registerRoomSockets } = require('./sockets/roomSockets');
const { registerDraftSockets } = require('./sockets/draftSockets');
const { registerLineupSockets } = require('./sockets/lineupSockets');
const { registerMatchSockets } = require('./sockets/matchSockets');
const { DraftEngine } = require('./draft/DraftEngine');
const { loadPlayerData } = require('./playerData');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Client: build aracı olmadan doğrudan sunulan statik dosyalar (bkz. client/public).
const CLIENT_PUBLIC = path.join(__dirname, '..', '..', 'client', 'public');
app.use(express.static(CLIENT_PUBLIC));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.get('/api/config', (req, res) => {
  const cfg = require('./shared/gameConfig');
  const { FORMATIONS } = require('./shared/football');
  res.json({
    SQUAD_SIZE: cfg.SQUAD_SIZE,
    STARTING_BUDGET: cfg.STARTING_BUDGET,
    MIN_PLAYER_PRICE: cfg.MIN_PLAYER_PRICE,
    BACKUP_PLAYER_PRICE: cfg.BACKUP_PLAYER_PRICE,
    MIN_RAISE: cfg.MIN_RAISE,
    AUCTION_DURATION_SECONDS: cfg.AUCTION_DURATION_SECONDS,
    BLIND_BID_DURATION_SECONDS: cfg.BLIND_BID_DURATION_SECONDS,
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Segmentler artık global bir sabit
    // DEĞİL — her draft kendi çarkını (bkz. pool.js buildWheelSegments) draft başında kurar ve
    // draft:update/draft:started ile odaya özel yayınlar (bkz. DraftEngine.emitDraft
    // `wheelSegments`). Burada sadece mod-bağımsız kalan süre sabiti kalıyor.
    WHEEL_PICK_DURATION_SECONDS: cfg.WHEEL_PICK_DURATION_SECONDS,
    FORMATIONS,
  });
});

app.get('/api/players/meta', (req, res) => {
  const data = loadPlayerData();
  res.json({
    generatedAt: data.generatedAt,
    counts: data.counts,
    ratingScale: data.ratingScale,
  });
});

// [KULLANICI İSTEĞİ] "Bir sayfaya oyundaki bütün oyuncuların ratingleri yazabilir... insanların
// oyuncuları öğrenmesi için iyi olur" — draft/oda durumundan bağımsız, herkese açık bir oyuncu
// veritabanı sayfası (bkz. client `renderPlayerDatabase`). Ağır alanlar (imageUrl/sourceUrl/
// subPositionRaw) burada gönderilmiyor — sayfa sadece filtreleme/sıralama/gösterim için gerekli
// alanları taşır, payload'ı gereksiz büyütmesin diye. İlk çağrıda bir kez düzleştirilip
// belleğe alınıyor (players.json zaten `loadPlayerData` içinde cache'li).
let leanPlayersCache = null;
app.get('/api/players/all', (req, res) => {
  if (!leanPlayersCache) {
    const data = loadPlayerData();
    leanPlayersCache = data.players.map((p) => ({
      id: p.id,
      name: p.name,
      nation: p.nation,
      club: p.club,
      league: p.league,
      country: p.country,
      position: p.position,
      eligibleSlots: p.eligibleSlots,
      rating: p.rating,
      marketValueEUR: p.marketValueEUR ?? null,
      peakValueEUR: p.peakValueEUR ?? null,
      // [KULLANICI İSTEĞİ] "10 gol 10 asist yapmış" gibi bağlamın gösterim tarafı — reytingin
      // NEDEN öyle olduğunu anlatan bu sezonki gerçek katkı (bkz. etl/run.js seasonStats) +
      // büyük turnuva bonusu ("Trossard Dünya Kupası'nda çeyrek final oynadı" — bkz. majorTournament).
      seasonStats: p.seasonStats ?? null,
      majorTournament: p.majorTournament ?? null,
      // [KULLANICI İSTEĞİ] "lig şampiyonu oldu, Şampiyonlar Ligi'nde final oynadı" — kulüp
      // başarısı bonusu (bkz. etl/run.js clubAchievement).
      clubAchievement: p.clubAchievement ?? null,
      isIcon: p.isIcon,
    }));
  }
  res.json({ players: leanPlayersCache });
});

app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  res.sendFile(path.join(CLIENT_PUBLIC, 'index.html'));
});

const roomManager = new RoomManager();
const draftEngine = new DraftEngine(io, roomManager);
const ctx = { roomManager, draftEngine };

io.on('connection', (socket) => {
  registerRoomSockets(io, socket, ctx);
  registerDraftSockets(io, socket, ctx);
  registerLineupSockets(io, socket, ctx);
  registerMatchSockets(io, socket, ctx);
});

// Sunucu başlarken veri setini bir kez belleğe al (eksikse net hata ver).
try {
  const data = loadPlayerData();
  console.log(`[data] ${data.counts.total} oyuncu yüklendi (aktif: ${data.counts.active}, icon: ${data.counts.icons}).`);
} catch (e) {
  console.error(`[data] ${e.message}`);
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[server] PitchGavel backend http://localhost:${PORT} adresinde çalışıyor`);
  });
}

module.exports = { app, server, io, roomManager, draftEngine };
