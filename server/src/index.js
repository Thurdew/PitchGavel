// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] bkz. claude.md — dotenv paketi
// eklemeden `server/.env`'i (Resend API key gibi sırları) yükler. Diğer TÜM require'lardan
// ÖNCE çalışmalı ki env okuyan modüller (AuthService, EmailService...) doğru değerleri görsün.
require('./loadEnv').loadEnvFile();

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { RoomManager } = require('./rooms/RoomManager');
const { registerRoomSockets } = require('./sockets/roomSockets');
const { registerDraftSockets } = require('./sockets/draftSockets');
const { registerLineupSockets } = require('./sockets/lineupSockets');
const { registerMatchSockets } = require('./sockets/matchSockets');
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU]
const { registerTradeSockets } = require('./sockets/tradeSockets');
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ SONRASI FAZ 4, "Yabancılarla Online Eşleşme"]
const { registerMatchmakingSockets } = require('./sockets/matchmakingSockets');
const { DraftEngine } = require('./draft/DraftEngine');
const { TradeEngine } = require('./trade/TradeEngine');
const { Matchmaker } = require('./matchmaking/Matchmaker');
const { loadPlayerData } = require('./playerData');
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 1] bkz. claude.md.
const { db, ready: dbReady, usingTurso } = require('./db/db');
const { AuthService, SESSION_TTL_MS } = require('./auth/AuthService');
const { LoginRateLimiter } = require('./auth/LoginRateLimiter');
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÜVENLİK SERTLEŞTİRME] bkz. claude.md.
const { RegisterRateLimiter } = require('./auth/RegisterRateLimiter');
const { parseCookies, serializeCookie } = require('./auth/cookies');
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] bkz. claude.md.
const { sendVerificationEmail } = require('./auth/EmailService');
const { ResendVerificationRateLimiter } = require('./auth/ResendVerificationRateLimiter');
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 2] bkz. claude.md.
const { RewardsService } = require('./rewards/RewardsService');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Render gibi bir reverse proxy arkasında `req.ip` aksi halde HERKES için proxy'nin IP'si olur —
// IP bazlı register/login rate limiter'ları tüm kullanıcıları tek bir kişi sayıp topluca bloklardı.
// Sadece production'da (tek proxy katmanı) X-Forwarded-For'a güveniyoruz; dev'de sahte header ile
// limiter atlatılamasın diye kapalı.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÜVENLİK SERTLEŞTİRME] `helmet` gibi bir paket
// eklemeden (yeni bağımlılık yok kararı, bkz. claude.md) düşük riskli/hiçbir şeyi bozmayan temel
// güvenlik header'ları. Content-Security-Policy BİLEREK eklenmedi — GTM/GA4 (googletagmanager.com)
// harici script yüklüyor, sıkı bir CSP dikkatli test edilmeden siteyi bozabilir; bu daha büyük/
// ayrı bir iş olarak not düşülüyor, şimdilik kapsam dışı.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); // tarayıcı bir dosyayı içeriğine göre "farklı" bir tür sanıp çalıştırmasın
  res.setHeader('X-Frame-Options', 'DENY'); // başka bir sitenin iframe'i içine gömülüp clickjacking'e alet edilmesin
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // dış linklere tam URL (ör. oda kodu içeren bir yol) sızdırılmasın
  next();
});

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
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] Bu ikisi mod-bağımsız/statik
    // (draft başlamadan, oda kurma formunda gerekiyor) — o YÜZDEN per-draft wheelSegments'in
    // aksine burada, /api/config'te kalıyor. Bkz. client renderLobby wheel segment checklist'i.
    WHEEL_SEGMENT_CATALOG: cfg.WHEEL_SEGMENT_CATALOG,
    WHEEL_CUSTOM_PICK_COUNT: cfg.WHEEL_CUSTOM_PICK_COUNT,
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] Mod-bağımsız/statik (draft başlamadan,
    // oda kurma formunda "hangi perkler olabilir" ipucu için gerekiyor) — WHEEL_SEGMENT_CATALOG
    // ile aynı mantık.
    PREP_WHEEL_SEGMENTS: cfg.PREP_WHEEL_SEGMENTS,
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] İstemci geri sayımı ve "x/2 takas"
    // limitini bu sabitlerden okur.
    TRADE_ROUND_DURATION_SECONDS: cfg.TRADE_ROUND_DURATION_SECONDS,
    TRADE_MAX_PER_PAIR: cfg.TRADE_MAX_PER_PAIR,
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
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — REYTİNG KAYNAĞI ŞEFFAFLIĞI] "Draft'ta yan yana çıkan
      // iki oyuncudan biri EA'nın verdiği reytingle, diğeri bizim formülümüzle hesaplanmış
      // olabilir" — bu alan zaten etl/run.js'te hesaplanıyordu (bkz. fc26RatingOverrides.js) ama
      // client'a hiç yansıtılmıyordu. Artık oyuncu veritabanı sayfasında/kartlarda küçük bir
      // rozet olarak gösteriliyor (bkz. client helpers.js playerCard, views.js renderPlayerDatabase).
      ratingOverrideSource: p.ratingOverrideSource || null,
    }));
  }
  res.json({ players: leanPlayersCache });
});

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 1] Kayıt/giriş/çıkış/"ben kimim" —
// oyun mantığından (RoomManager/DraftEngine, anonim sessionStorage clientId) TAMAMEN AYRI/
// bağımsız bir HTTP kimlik katmanı; hiçbiri socket üzerinden değil. İsteğe bağlı: kayıt olmadan
// oynama akışı hiç değişmedi. Global bir "her request'te req.user doldur" middleware'i YOK —
// proje zaten sadece 2 app.use() içeriyor, örtük bir DB lookup'ı bu minimalizmi bozardı; her
// route kendi cookie'sini okuyup authService.getUserByToken() çağırıyor.
const authService = new AuthService(db);
const loginRateLimiter = new LoginRateLimiter();
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÜVENLİK SERTLEŞTİRME] bkz. claude.md — IP+e-posta değil
// SADECE IP başına (register'da e-posta her denemede değişir, bir enumeration/spam script'i
// bunu farklı e-postalarla dener).
const registerRateLimiter = new RegisterRateLimiter();
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] bkz. claude.md.
const resendVerificationRateLimiter = new ResendVerificationRateLimiter();
const SESSION_COOKIE_NAME = 'kk_session';

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'Lax', secure: process.env.NODE_ENV === 'production',
    path: '/', maxAgeMs: SESSION_TTL_MS,
  }));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE_NAME, '', {
    httpOnly: true, sameSite: 'Lax', secure: process.env.NODE_ENV === 'production',
    path: '/', maxAgeMs: 0,
  }));
}
function isValidEmail(v) { return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }
function isValidPassword(v) { return typeof v === 'string' && v.length >= 8 && v.length <= 200; }
function isValidDisplayName(v) { return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 24; }

app.post('/api/auth/register', async (req, res) => {
  const ip = req.ip;
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÜVENLİK SERTLEŞTİRME] Kitlesel sahte hesap açmayı ve
  // EMAIL_TAKEN hatasının hızlı/otomatik e-posta enumeration'da kullanılmasını yavaşlatır —
  // doğrulamadan (isValidEmail vb.) ÖNCE kontrol ediliyor ki geçersiz girdi denemeleri de sayılsın.
  if (registerRateLimiter.isBlocked(ip)) {
    return res.status(429).json({ error: 'RATE_LIMITED' });
  }
  registerRateLimiter.recordAttempt(ip);

  const { email, password, displayName } = req.body || {};
  if (!isValidEmail(email) || !isValidPassword(password) || !isValidDisplayName(displayName)) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }
  const result = await authService.register(email, password, displayName);
  if (result.error) {
    return res.status(result.error === 'EMAIL_TAKEN' ? 409 : 400).json({ error: result.error });
  }
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] Token asla response body'sinde
  // DÖNMÜYOR (sadece e-posta linkinde) — e-posta gönderimi başarısız olsa bile (bkz. EmailService
  // dev-fallback notu) KAYIT engellenmez, kullanıcı "tekrar gönder" ile sonra deneyebilir.
  const verificationToken = await authService.createVerificationToken(result.user.id);
  await sendVerificationEmail(result.user.email, verificationToken);
  setSessionCookie(res, result.token);
  res.status(201).json({ user: result.user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }
  const ip = req.ip;
  if (loginRateLimiter.isBlocked(ip, email)) {
    return res.status(429).json({ error: 'RATE_LIMITED' });
  }
  const result = await authService.login(email, password);
  if (result.error) {
    loginRateLimiter.recordFailure(ip, email);
    return res.status(401).json({ error: result.error });
  }
  loginRateLimiter.recordSuccess(ip, email);
  setSessionCookie(res, result.token);
  res.json({ user: result.user });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (token) await authService.logout(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  res.json({ user: await authService.getUserByToken(token) });
});

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] Bu, bir e-posta istemcisinden tıklanan
// bir tarayıcı navigasyonu (GET) — JSON değil, `/giris?verified=1|0`'a REDIRECT dönüyor ki
// istemci sonucu bir toast ile göstersin (bkz. client app.js açılış kontrolü).
app.get('/api/auth/verify', async (req, res) => {
  const result = await authService.verifyEmailToken(String(req.query.token || ''));
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Doğrulama koduyla giriş yapabilmeliyim" — link tıklanan
  // TARAYICIYA da bir oturum açılıyor (kayıt olunan cihazdan farklı olsa bile).
  if (result.ok) setSessionCookie(res, result.sessionToken);
  res.redirect(result.ok ? '/giris?verified=1' : '/giris?verified=0');
});

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 2] Günlük reklam-ödül çarkı — SADECE
// kayıtlı kullanıcılar için (buradaki 401, /api/auth/me'nin aksine GERÇEK bir hata: bu özellik
// misafirlere hiç açık değil). RoomManager/DraftEngine'e hiç dokunmuyor, tamamen bağımsız.
const rewardsService = new RewardsService(db);
async function requireUser(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  const user = await authService.getUserByToken(token);
  if (!user) { res.status(401).json({ error: 'NOT_LOGGED_IN' }); return null; }
  return user;
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] Giriş yapmış olmak şart (requireUser) —
// kullanıcı ID başına saatte 3 ile sınırlı (ResendVerificationRateLimiter), kendi Resend
// kotasını/gelen kutusunu spamlamasın diye.
app.post('/api/auth/resendVerification', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.emailVerified) return res.status(400).json({ error: 'ALREADY_VERIFIED' });
  if (resendVerificationRateLimiter.isBlocked(user.id)) return res.status(429).json({ error: 'RATE_LIMITED' });
  resendVerificationRateLimiter.recordAttempt(user.id);

  const verificationToken = await authService.createVerificationToken(user.id);
  await sendVerificationEmail(user.email, verificationToken);
  res.json({ ok: true });
});

app.get('/api/rewards/status', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json(await rewardsService.getStatus(user.id));
});

app.post('/api/rewards/spin', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const result = await rewardsService.spin(user.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  res.sendFile(path.join(CLIENT_PUBLIC, 'index.html'));
});

const roomManager = new RoomManager();
const draftEngine = new DraftEngine(io, roomManager);
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] Draft bitince (host açtıysa) takas turunu
// TradeEngine açar — DraftEngine'e setter ile enjekte ediliyor (döngüsel require yok).
const tradeEngine = new TradeEngine(io, roomManager);
draftEngine.setTradeEngine(tradeEngine);
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 3] Faz 2'de biriktirilen bir perk'in
// Hazırlık Çarkı turunda harcanabilmesi — aynı setter deseni, döngüsel require yok.
draftEngine.setRewardsService(rewardsService);
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ SONRASI FAZ 4, "Yabancılarla Online
// Eşleşme"] Yeni bir draft/oda motoru YOK — roomManager/draftEngine'in mevcut metodlarını
// (createRoom/joinRoom/bindSocket/startDraft) birebir reuse ediyor.
const matchmaker = new Matchmaker(io, roomManager, draftEngine);
const ctx = { roomManager, draftEngine, tradeEngine, matchmaker };

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 3] Socket EVENT'İ DEĞİL, HTTP —
// bkz. claude.md "kimlik doğrulama tasarımı" notu: bir socket'in handshake cookie'si bağlantı
// kurulduğu ANKİ tarayıcı durumunu yansıtır, sayfa yenilenmeden giriş yapılırsa bayat kalabilir.
// Bu route mevcut /api/rewards/* ile AYNI, her zaman güncel cookie mekanizmasını kullanıyor;
// gerçek sonuç (kim ne kazandı) yine socket broadcast'iyle (prepWheel:resolved) TÜM odaya ulaşır.
app.post('/api/rewards/redeemInRoom', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { roomCode, clientId, kind } = req.body || {};
  const room = roomManager.getRoom(String(roomCode || '').toUpperCase());
  if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND' });
  const result = await draftEngine.redeemBankedPerk(room, clientId, kind, user.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

io.on('connection', (socket) => {
  registerRoomSockets(io, socket, ctx);
  registerDraftSockets(io, socket, ctx);
  registerLineupSockets(io, socket, ctx);
  registerMatchSockets(io, socket, ctx);
  registerMatchmakingSockets(io, socket, ctx);
  registerTradeSockets(io, socket, ctx);
});

// Sunucu başlarken veri setini bir kez belleğe al (eksikse net hata ver).
try {
  const data = loadPlayerData();
  console.log(`[data] ${data.counts.total} oyuncu yüklendi (aktif: ${data.counts.active}, icon: ${data.counts.icons}).`);
} catch (e) {
  console.error(`[data] ${e.message}`);
}

// [TURSO] Şema hazır olmadan (uzak DB'de ağ gecikmesi var) istek kabul etmeye başlama — DB'ye
// hiç ulaşılamıyorsa açılışta net bir hatayla çık, Render yeniden denesin.
if (require.main === module) {
  dbReady.then(() => {
    console.log(`[db] ${usingTurso ? 'Turso (uzak)' : 'yerel SQLite dosyası'} hazır.`);
    server.listen(PORT, () => {
      console.log(`[server] PitchGavel backend http://localhost:${PORT} adresinde çalışıyor`);
    });
  }).catch((e) => {
    console.error('[db] Veritabanı başlatılamadı:', e.message);
    process.exit(1);
  });
}

// `db` export'u SADECE testlerin işi (ör. e-posta doğrulama token'ını response body'sine hiç
// koymadığımız için doğrudan DB'den okuyabilmeleri) — uygulama kodunun kendisi index.js dışından
// bu export'u hiç kullanmıyor.
module.exports = { app, server, io, roomManager, draftEngine, db, dbReady };
