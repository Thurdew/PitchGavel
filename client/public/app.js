import { el, toast, confirmDialog } from './helpers.js';
// [KULLANICI İSTEĞİ] ses + haptik geri bildirim (dosyasız, WebAudio) — bkz. sfx.js
import { sfx } from './sfx.js';
import { applyTeamTheme } from './teams.js';
import { renderLobby, renderWaitingRoom, renderPrepWheel, renderDraft, renderTradeRound, renderLineup, renderMatch, renderMatchPlayback, renderPlayerDatabase, renderHowToPlay, renderLogin, renderDailyReward, renderStore, renderSharedResult, renderVerifyGate, isPrepWheelSpinActive, reactionDock, showReaction } from './views.js';
import { cosmeticOf, playStampSound } from './cosmetics.js';
// [YASAL — KVKK / ÇEREZ ONAYI] bkz. legal.js
import { renderPrivacy, renderNotFound, mountConsentBanner, resetConsent } from './legal.js';

const LS_CLIENT_ID = 'kk_clientId';
// [GÜVENLİK — KOLTUK ELE GEÇİRME] clientId odadaki herkese görünür; koltuğun sahibi olduğunu bu
// sekmeye özel GİZLİ anahtar kanıtlar (sunucu sadece hash'ini tutar, kimseye yayınlamaz).
const LS_CLIENT_SECRET = 'kk_clientSecret';
const LS_NAME = 'kk_name';
const LS_CODE = 'kk_code';

// ÖNEMLİ: sessionStorage kullanılıyor (localStorage DEĞİL). localStorage aynı tarayıcının
// TÜM sekmeleri arasında paylaşılır — iki oyuncuyu tek bilgisayarda iki sekmede test
// ederken ikisi de aynı clientId'yi paylaşıp sunucu ikinci sekmeyi "zaten odadaki oyuncu"
// sanırdı. sessionStorage sekmeye özeldir, her sekme kendi kimliğini alır; sayfa
// yenilendiğinde (aynı sekme) hâlâ kalıcıdır, bu da reconnect senaryosu için yeterlidir.
function getOrCreateClientId() {
  let id = sessionStorage.getItem(LS_CLIENT_ID);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random()}`);
    sessionStorage.setItem(LS_CLIENT_ID, id);
  }
  return id;
}

function randomSecret() {
  if (crypto.randomUUID) return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function getOrCreateClientSecret() {
  let secret = sessionStorage.getItem(LS_CLIENT_SECRET);
  if (!secret || secret.length < 16) {
    secret = randomSecret();
    sessionStorage.setItem(LS_CLIENT_SECRET, secret);
  }
  return secret;
}

const state = {
  clientId: getOrCreateClientId(),
  clientSecret: getOrCreateClientSecret(),
  name: sessionStorage.getItem(LS_NAME) || '',
  code: sessionStorage.getItem(LS_CODE) || null,
  room: null,
  draft: null,
  blindBidUi: null, // kör draft — kendi kilitlediğin teklif (sunucu miktarı geri yansıtmaz, bkz. views.js)
  lineupOptions: null,
  lineupSubmitted: {},
  matchResult: null,
  matchPlayback: null, // [KULLANICI İSTEĞİ] maç anlatımı oynatma durumu — bkz. views.js renderMatchPlayback
  config: null,
  connected: false,
  // [KULLANICI İSTEĞİ] "Bir sayfaya oyundaki bütün oyuncuların ratingleri yazabilir" — oda/draft
  // durumundan TAMAMEN bağımsız, üst bardan her an açılıp kapatılabilen ayrı bir "sayfa" modu
  // (bkz. route(), #playersNavBtn). null iken normal oda akışı gösterilir.
  page: null,
  playerDb: null,
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] "🙈 Kör İlk Tur" perk'inin istemci-yerel
  // tüketim durumu — bkz. views.js blindFirstRoundActive.
  blindFirstRoundConsumed: false,
  blindFirstRoundKey: null,
  // [KULLANICI İSTEĞİ] "Draft geçmişi / kim neyi kaça aldı" — sunucu geçmiş tutmuyor, her
  // draft:update yalnızca O ANKİ event'i taşıyor; burada istemci tarafında biriktiriliyor
  // (bkz. views.js draftHistoryPanel). Draft bitince de duruyor: dizilim ekranında da okunuyor.
  draftHistory: [],
  // [KULLANICI İSTEĞİ] "Bağlantı koparsa kullanıcı ne gördüğünü bilmiyor" — kopuş anındaki
  // toplam seçim sayısı burada saklanıp bağlantı dönünce farkı "N tur sen yokken tamamlandı"
  // olarak bildiriliyor.
  offlineSnapshot: null,
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] Sunucudan gelen kişiye özel takas görünümü
  // (teklifler pazarlık aşamasında sadece iki tarafa gönderilir) — bkz. server trade/TradeEngine.
  trade: null,
  tradeUi: null,
  lastHighBidder: null, // teklifin geçilmesini (outbid sesi) tespit etmek için
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 1] `state.clientId`'den BAĞIMSIZ bir
  // kimlik — oda/oyun kimliği (sessionStorage clientId) hiç değişmedi, bu sadece "giriş yapmış
  // mısın" bilgisini taşıyan ayrı bir HTTP hesap katmanı (bkz. /api/auth/*). Bu fazda RoomManager'a
  // hiç bağlanmıyor. null = misafir (giriş yapılmamış), { id, email, displayName } = giriş yapılmış.
  user: null,
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 2] Günlük reklam-ödül çarkı durumu
  // (bkz. views.js renderDailyReward) — `/api/rewards/status` cache'i. `dailyRewardSpin` sadece
  // İSTEMCİ-YEREL bir animasyon "hold" state'i (Hazırlık Çarkı'ndaki `prepWheelSpin` ile aynı desen).
  dailyReward: null,
  dailyRewardSpin: null,
  // [TASARIM v2] Çark durunca kaybolmasın diye son kazanılan perk'i hatırlar (banner + envanterde
  // yeşil vurgu) — bkz. views.js renderDailyReward.
  dailyRewardLastWin: null,
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ SONRASI FAZ 4, "Yabancılarla Online
  // Eşleşme"] Kuyrukta bekleme durumu — `{draftMode, playerPool}` doluyken lobi "Rakip
  // aranıyor..." ekranını gösterir (bkz. views.js renderLobby). Eşleşince sunucu `matchmaking:matched`
  // gönderir, bu null'a döner; asıl oda verisi zaten var olan `room:state` dinleyicisiyle gelir.
  matchmaking: null,
};

// Odadaki TÜM kadrolardaki oyuncu sayısı — "ben yokken kaç tur tamamlandı" farkı için.
function totalPicks(draft) {
  if (!draft || !draft.players) return 0;
  return draft.players.reduce((n, p) => n + (p.squad ? p.squad.length : 0), 0);
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "İlk maç x-y oluyor sonra y-x oluyor sonra diğer maçlara
// geçiyor — öyle yapma, karışık şekilde oynat, hep değiştir." — N>2 odada anlatım eskiden her
// eşleşmeyi (fixture) sırayla, kendi içinde match1->match2 oynatıyordu (x-y, y-x, x-z, z-x, ...).
// Artık TÜM eşleşmelerin TÜM maçları (2 * fixtures.length tanesi) tek düz bir listede karışık
// sırayla oynatılıyor.
// [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "3 arkadaş oynuyoruz, herkesin ekranında o sırada
// farklı maç oynanıyor, spoiler yiyoruz — herkesin ekranında aynı anda aynı maç olması lazım."
// Kök neden: bu sıralama eskiden BURADA, her istemcinin KENDİ Math.random()'ıyla bağımsız
// üretiliyordu — aynı sonuca (fixtures) rağmen her ekran farklı bir anlatım sırası izliyordu.
// Artık sıra sunucuda TEK SEFERDE belirlenip result.matchOrder olarak geliyor (bkz.
// matchSockets.js buildMatchOrder) — TÜM istemciler AYNI diziyi oynatıyor. Sunucudan bir
// sebeple gelmezse (ör. eski bir cache/reconnect senaryosu) yerel üretime düşülür — anlatım
// yine de çalışsın diye, ama bu artık sadece bir savunma satırı.
function buildMatchOrderFallback(fixtureCount) {
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

// Sonuç sunucudan geldiğinde direkt göstermek yerine anlatım oynatmasını başlatır.
// İki kez tetiklenebilir (ack cevabı + broadcast) — ikinci seferde playback zaten
// kurulu olduğu için (state.matchPlayback dolu) elden geçirilmez, kullanıcı akışı bozulmaz.
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — sonuç artık {fixtures, standings}
// şeklinde (N>2 odada birden fazla eşleşme oynanır); anlatım artık pb.order'daki karışık sırayı
// tek tek izler.
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Sonuca geç için bütün oyuncuların onayı gereksin — ya
// herkes sonuca geçecek ya da herkes aynı şekilde izleyecek, hızlı da dahil." — daha önce hız
// (pb.speed) ve "Sonuca Geç" (pb.done) tamamen KİŞİSEL/yerel bir tercihti: bir oyuncu Hızlı'ya
// geçip/atlayıp maçın sonucunu diğerlerinden ÖNCE görebiliyordu — sıra karıştırma bug'ı
// düzeltilse bile (bkz. yukarıdaki "3 arkadaş oynuyoruz, spoiler yiyoruz" notu) bu hâlâ bir
// spoiler kaynağıydı. Artık hız/skip sunucuda OY BİRLİĞİ (bkz. matchSockets.js
// match:playbackSpeedVote/match:playbackSkipToggle) gerektiriyor — `pb.speed`/`pb.done` artık
// yerel tıklamayla değil, SADECE sunucudan gelen `match:playbackSync` broadcast'iyle değişiyor;
// `pb.sync` en son oy durumunu (kim ne oyladı) taşır ki istemci "X/Y kişi Hızlı istiyor" gibi bir
// ipucu gösterebilsin (bkz. views.js renderMatchPlayback).
function applyPlaybackSync(sync) {
  const pb = state.matchPlayback;
  if (!pb || !sync) return;
  pb.sync = sync;
  if (sync.speed && sync.speed !== pb.speed) pb.speed = sync.speed;
  if (sync.skip && !pb.done) pb.done = true; // herkes anlaştı — tüm istemciler AYNI ANDA sonuç ekranına geçer
}

function applyMatchResult(result) {
  state.matchResult = result;
  if (!state.matchPlayback) {
    pushDataLayer('match_result', { fixtures_count: (result.fixtures || []).length });
    state.matchPlayback = {
      order: result.matchOrder || buildMatchOrderFallback((result.fixtures || []).length),
      pos: 0,
      clock: 0,
      shown: [],
      score: { home: 0, away: 0 },
      speed: (result.playbackSync && result.playbackSync.speed) || 'slow',
      done: false,
      pendingReveal: null, // [KULLANICI İSTEĞİ] gerilim akışı — bkz. views.js renderMatchPlayback
      sync: result.playbackSync || { speed: 'slow', skip: false, speedVotes: {}, skipVotes: [] },
    };
  } else if (result.playbackSync) {
    applyPlaybackSync(result.playbackSync);
  }
}

// [KULLANICI İSTEĞİ] "GTM'de nasıl etiketler kurmam lazım, güzel bir analiz yapabilmek için" —
// GA4/GTM'in kendiliğinden yakalayamayacağı oyuna özgü aksiyonları (oda kurma, teklif verme,
// draft/maç tamamlanması vb.) dataLayer'a itiyor; GTM tarafında bunlara karşılık gelen "Custom
// Event" trigger'ları + GA4 Event tag'leri kurulabilir (bkz. sohbetteki kurulum rehberi).
// SPA sayfa geçişleri (/ ↔ /players) de burada elle itiliyor — GA4'ün otomatik page_view'i
// SADECE ilk yüklemede (gtag.js config çağrısıyla) tetiklenir, pushState ile değişen sonraki
// URL'leri kendiliğinden YAKALAMAZ.
function pushDataLayer(event, params = {}) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

const socket = io();
const appRoot = document.getElementById('app');
const topbarStatus = document.getElementById('topbarStatus');
const playersNavBtn = document.getElementById('playersNavBtn');
const howToPlayNavBtn = document.getElementById('howToPlayNavBtn');
const authNavBtn = document.getElementById('authNavBtn');
const dailyRewardNavBtn = document.getElementById('dailyRewardNavBtn');
const storeNavBtn = document.getElementById('storeNavBtn');

// [KULLANICI İSTEĞİ, "SEO uyumlu yap, URL'leri ayarla"] Bu SPA hiç URL değiştirmiyordu — oyuncu
// veritabanı sayfası da dahil her şey "/" üzerinde sadece `state.page` ile ayrışıyordu. Bu hem
// arama motorları için (paylaşılabilir/indexlenebilir tek bir URL yok) hem de kullanıcı için
// (geri/ileri tuşu, sayfayı yenileme, linki paylaşma çalışmıyordu) sorunluydu. Sadece HERKESE
// AÇIK/kalıcı iki sayfa gerçek bir yol alıyor: "/" (lobi) ve "/players" (oyuncu veritabanı) —
// oda/draft/maç ekranları BİLEREK yol DEĞİŞTİRMİYOR: bunlar oda koduyla girilen özel/geçici
// oturumlar, indexlenmesi ya da doğrudan URL ile paylaşılması anlamlı değil (bkz. robots.txt/
// sitemap.xml sadece bu iki yolu listeliyor). Sunucu tarafında zaten TÜM /api ve /socket.io
// dışı yollar index.html'e düşüyor (bkz. server/src/index.js) — bu yüzden "/players"e doğrudan
// girmek ya da sayfayı yenilemek de çalışıyor.
// [KULLANICI İSTEĞİ] "URL'leri her sayfa için farklı yap. Analizlerde hangi oyun daha fazla
// oynanmış görmek istiyorum, mesela çark modunda pitchgavel/çark gibi" — GTM/GA4 sayfa yolu
// (page_path) kırılımından "hangi draft modu daha çok seçiliyor" görülebilsin diye, lobide
// "Oda Kur" akışında seçilen draft modu artık KENDİ URL'ine sahip. Slug'lar bilerek ASCII
// (çark → /cark) — paylaşılan linkte %-encoding'e düşmesin diye. `players` sayfasıyla AYNI
// pathForPage/navigateToPage/popstate deseni genelleştirildi.
const PAGE_PATHS = {
  players: '/players',
  'mode-live': '/canli-arttirma',
  'mode-blind': '/kor-draft',
  'mode-wheel': '/cark',
  // [KULLANICI İSTEĞİ] "Son rötuşlar — Nasıl Oynanır içeriği" — yeni ziyaretçi direkt Oda Kur/
  // Katıl ekranıyla karşılaşıyordu, kuralları hiçbir yerde anlatmıyorduk. Kendi URL'i olan ayrı
  // bir sayfa: hem onboarding hem SEO (SPA'nın ilk HTML'i neredeyse boş — Google'ın bulacağı
  // gerçek metin içeriği burada).
  'how-to-play': '/nasil-oynanir',
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 1] Giriş/Kayıt sayfası — `players`/
  // `how-to-play` ile AYNI desen (kendi URL'i, üst bar butonu).
  login: '/giris',
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 2] `players`/`login` ile AYNI desen.
  dailyReward: '/gunluk-odul',
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Mağaza — misafire de açık (katalog).
  store: '/magaza',
  // [YASAL — KVKK] Gizlilik ve çerez politikası (aydınlatma metni).
  privacy: '/gizlilik',
};
// [GÜVENLİK/YASAL] Oda/eşleşme hata kodlarının Türkçe karşılıkları.
const ROOM_ERRORS = {
  ROOM_NOT_FOUND: 'Oda bulunamadı.',
  ROOM_FULL: 'Oda dolu.',
  ROOM_IN_PROGRESS: 'Bu odada oyun zaten başladı.',
  SEAT_TAKEN: 'Bu oyuncu koltuğu başka bir sekmeye ait.',
  CLIENT_ID_TAKEN: 'Bu kimlik başka bir sekmede kullanılıyor — sayfayı yenile.',
  INVALID_IDENTITY: 'Oturum bilgisi geçersiz — sayfayı yenile.',
  PLAYER_NOT_IN_ROOM: 'Bu odada kaydın bulunamadı.',
  SERVER_ERROR: 'Sunucuda bir hata oluştu, tekrar dene.',
};
const PATH_TO_PAGE = Object.fromEntries(Object.entries(PAGE_PATHS).map(([page, path]) => [path, page]));
// draftMode ('live'/'blind'/'wheel') <-> ilgili lobi sayfası arasında çift yönlü eşleme —
// URL'den lobiye (doğrudan /cark'a girmek) ve lobiden URL'e (pill'e tıklamak) ikisi de bunu kullanır.
const DRAFT_MODE_BY_PAGE = { 'mode-live': 'live', 'mode-blind': 'blind', 'mode-wheel': 'wheel' };
const PAGE_BY_DRAFT_MODE = { live: 'mode-live', blind: 'mode-blind', wheel: 'mode-wheel' };

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAYLAŞILAN SONUÇ] /sonuc/:id dinamik yol — PAGE_PATHS'te sabit
// bir karşılığı yok, id state.sharedResultId'de tutulur.
const SHARED_RESULT_RE = /^\/sonuc\/([A-Za-z0-9_-]{6,32})$/;
function pathForPage(page) {
  if (page === 'sharedResult' && state.sharedResultId) return `/sonuc/${state.sharedResultId}`;
  return PAGE_PATHS[page] || '/';
}
// [SEO] Tanınmayan bir yol artık sessizce lobiyi göstermiyor — "Sayfa bulunamadı" görünümü
// (sunucu da bu yollar için 404 durum kodu döner, bkz. server index.js SPA_ROUTES).
function pageForPath(rawPathname) {
  const pathname = (rawPathname || '/').replace(/\/+$/, '') || '/';
  const shared = SHARED_RESULT_RE.exec(pathname);
  if (shared) {
    if (state.sharedResultId !== shared[1]) state.sharedResult = null;
    state.sharedResultId = shared[1];
    return 'sharedResult';
  }
  if (PATH_TO_PAGE[pathname]) return PATH_TO_PAGE[pathname];
  return !pathname || pathname === '/' ? null : 'notFound';
}

const PAGE_META = {
  privacy: {
    title: 'Gizlilik ve Çerez Politikası — PitchGavel',
    description: 'PitchGavel KVKK aydınlatma metni: hangi verileri neden işliyoruz, çerezler ve hakların.',
  },
  notFound: {
    title: 'Sayfa bulunamadı — PitchGavel',
    description: 'Aradığın sayfa bulunamadı.',
  },
  default: {
    title: 'PitchGavel — Açık Arttırmalı Kadro Kurma',
    description: 'Rakibinle canlı açık arttırmada 11 kişilik kadro topla, ev sahibi + deplasman iki maçlık seride üstünlüğü kanıtla.',
  },
  players: {
    title: 'Oyuncu Veritabanı — PitchGavel',
    description: '3.500+ aktif futbolcu ve 38 efsane oyuncunun PitchGavel reytinglerini kulüp, lig ve milliyete göre filtrele, sırala, keşfet.',
  },
  'mode-live': {
    title: 'Canlı Açık Arttırma — PitchGavel',
    description: 'Rakibinle eş zamanlı, süreli açık arttırmayla 11 kişilik kadro topla — teklifler anlık görünür, en yüksek teklif kazanır.',
  },
  'mode-blind': {
    title: 'Kör Draft — PitchGavel',
    description: 'Tek seferlik gizli teklif ver, rakibinkini göremezsin — en yüksek teklif oyuncuyu kazanır.',
  },
  'mode-wheel': {
    title: 'Çark Modu — PitchGavel',
    description: 'Bütçe yok! Sırayla çarkı çevir, çıkan reyting bandından (ya da rakipten çal, en iyini ver gibi özel dilimlerden) ücretsiz oyuncu seç.',
  },
  'how-to-play': {
    title: 'Nasıl Oynanır? — PitchGavel',
    description: 'Oda kurmadan kura, draft modları, kaskad açık arttırma ve maç simülasyonuna kadar PitchGavel\'in tüm kurallarını adım adım öğren.',
  },
  login: {
    title: 'Giriş Yap / Kayıt Ol — PitchGavel',
    description: 'PitchGavel hesabınla giriş yap ya da yeni hesap oluştur.',
  },
  dailyReward: {
    title: 'Günlük Ödül — PitchGavel',
    description: 'Reklam izleyip günlük çarkı çevir, ileride odada kullanabileceğin perk\'ler biriktir.',
  },
  sharedResult: {
    title: 'Maç Sonucu — PitchGavel',
    description: 'PitchGavel maç sonucu: puan tablosu, skorlar, goller ve maç hikâyesi.',
  },
  store: {
    title: 'Mağaza — PitchGavel',
    description: 'Maç kazanarak topladığın coinlerle takımının renklerinde premium formalar al.',
  },
};
function metaFor(page) { return PAGE_META[page] || PAGE_META.default; }

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 1] Sunucunun döndürdüğü hata kodlarını
// (bkz. server/src/index.js /api/auth/*) kullanıcıya okunabilir Türkçe mesaja çevirir.
const AUTH_ERROR_MESSAGES = {
  EMAIL_TAKEN: 'Bu e-posta zaten kayıtlı.',
  INVALID_CREDENTIALS: 'E-posta veya parola hatalı.',
  RATE_LIMITED: 'Çok fazla deneme yaptın, birkaç dakika sonra tekrar dene.',
  INVALID_INPUT: 'Bilgileri kontrol et (parola en az 8 karakter olmalı).',
  INVALID_OR_EXPIRED_TOKEN: 'Sıfırlama linki geçersiz ya da süresi dolmuş — yeni bir link iste.',
  KIT_NOT_OWNED: 'Bu forma senin değil — önce mağazadan al.',
  COSMETIC_NOT_OWNED: 'Bu ürün senin değil — önce mağazadan al.',
  INSUFFICIENT_COINS: 'Yeterli coinin yok.',
  ALREADY_OWNED: 'Bu ürün zaten sende.',
  EMAIL_NOT_VERIFIED: 'Satın almak için önce e-postanı doğrula.',
  NOT_LOGGED_IN: 'Önce giriş yapmalısın.',
};

// document.title + meta description/canonical/OG/Twitter etiketlerini o an gösterilen sayfaya
// göre günceller. Bu SPA'da tek statik index.html tüm yollara servis edildiği için (bkz. yukarı)
// statik meta etiketler sadece "/" için doğru olurdu — Googlebot JS çalıştırdığı için (ve link
// paylaşım botlarının bir kısmı da) bu çalışma-anı güncellemesi her sayfanın kendi başlık/
// açıklamasıyla indexlenmesini sağlıyor.
function updateHead() {
  const meta = metaFor(state.page);
  const url = `https://pitchgavel.com${pathForPage(state.page)}`;
  document.title = meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description);
  document.getElementById('canonicalLink')?.setAttribute('href', url);
  document.getElementById('ogTitle')?.setAttribute('content', meta.title);
  document.getElementById('ogDescription')?.setAttribute('content', meta.description);
  document.getElementById('ogUrl')?.setAttribute('content', url);
  document.getElementById('twitterTitle')?.setAttribute('content', meta.title);
  document.getElementById('twitterDescription')?.setAttribute('content', meta.description);
}

// Bir mod sayfasına (mode-live/mode-blind/mode-wheel) girildiğinde lobi state'ini o moda göre
// önceden kurar — hem "Oda Kur" akışındaki pill'e tıklayınca (navigateToPage üzerinden) hem
// doğrudan /cark gibi bir URL'e girilince (popstate/ilk yükleme) AYNI senkronu sağlar.
function syncLobbyUiForPage(page) {
  const draftMode = DRAFT_MODE_BY_PAGE[page];
  if (!draftMode) return;
  if (!state.lobbyUi) state.lobbyUi = { mode: null, name: '', code: '', draftMode: 'live', playerPool: 'all' };
  state.lobbyUi.mode = 'create';
  state.lobbyUi.draftMode = draftMode;
}

// Tek bir yerden state.page + URL'i birlikte değiştiren ortak fonksiyon — üst bardaki
// #playersNavBtn, oyuncu veritabanı içindeki "← Geri dön" butonu ve lobideki draft modu
// pill'leri (bkz. views.js) bunu kullanır ki hiçbir geçiş URL'i state'in gerisinde bırakmasın.
function navigateToPage(page) {
  state.page = page;
  syncLobbyUiForPage(page);
  const path = pathForPage(page);
  if (location.pathname !== path) history.pushState({ page }, '', path);
  pushDataLayer('page_view', { page_path: path, page_title: metaFor(page).title });
  route();
}

// Lobide "Oda Kur"/"Odaya Katıl"/"← Geri" seçimini URL ile senkron tutan ortak fonksiyon (bkz.
// views.js renderLobby). "create" seçilince o an seçili draft moduna karşılık gelen URL'e gider
// (varsayılan 'live'); "join"/null (geri) seçilince, EĞER o an bir mod-URL'indeysek "/"e döner —
// "Odaya Katıl" ayrı bir URL almıyor (bilerek — bkz. claude.md SEO notu, sadece kalıcı/paylaşılan
// sayfalar yol alıyor), sadece mod-URL'lerinden çıkışı temizliyor.
function selectLobbyMode(mode) {
  if (!state.lobbyUi) state.lobbyUi = { mode: null, name: '', code: '', draftMode: 'live', playerPool: 'all' };
  if (mode === 'create') {
    navigateToPage(PAGE_BY_DRAFT_MODE[state.lobbyUi.draftMode] || 'mode-live');
    return;
  }
  state.lobbyUi.mode = mode;
  if (DRAFT_MODE_BY_PAGE[state.page]) {
    navigateToPage(null);
  } else {
    route();
  }
}

// [KULLANICI İSTEĞİ, BUG FIX] "Sadece odayı kuranda açık arttırma yazıyor URL'de, diğerlerinde
// sadece pitchgavel yazıyor" — host'un URL'i doğru çıkıyordu çünkü "Oda Kur" formunda draft modu
// pill'ine tıklarken zaten navigateToPage üzerinden geçiyordu (bkz. selectLobbyMode/
// draftModePicker). Ama "Odaya Katıl" akışı bu formdan HİÇ geçmiyordu — joinRoom sonrası
// state.page hiç değişmiyordu, URL "/"te kalıyordu. Kök neden: URL, "kim hangi formu doldurdu"ya
// bağlıydı; oysa "bu odanın GERÇEK draftMode'u ne"ye bağlı olmalıydı. Artık oda bilgisi elimize
// HANGİ yoldan geçerse geçsin (kurma, katılma, ya da sayfa yenileyip yeniden bağlanma) URL o
// odanın gerçek draftMode'una göre senkronlanıyor — host/misafir farkı olmadan herkes aynı URL'i
// görür (bkz. createRoom/joinRoom/socket 'connect' handler'ındaki çağrılar).
function syncUrlToRoomMode(room) {
  const page = room && PAGE_BY_DRAFT_MODE[room.draftMode];
  if (page) navigateToPage(page);
}

playersNavBtn.addEventListener('click', () => {
  navigateToPage(state.page === 'players' ? null : 'players');
});
howToPlayNavBtn.addEventListener('click', () => {
  navigateToPage(state.page === 'how-to-play' ? null : 'how-to-play');
});
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 2] Sadece giriş yapılmışken görünür
// (bkz. route()'taki .style.display toggle'ı) — misafirken bu sayfaya gitmenin bir anlamı yok.
dailyRewardNavBtn.addEventListener('click', () => {
  navigateToPage(state.page === 'dailyReward' ? null : 'dailyReward');
});
storeNavBtn.addEventListener('click', () => {
  navigateToPage(state.page === 'store' ? null : 'store');
});
// Tarayıcının geri/ileri tuşları — URL'e göre state.page'i (ve mod-URL'iyse lobi state'ini)
// senkronlar (pushState çağırmadan, zaten tarayıcı geçmişte gezindi).
window.addEventListener('popstate', () => {
  state.page = pageForPath(location.pathname);
  syncLobbyUiForPage(state.page);
  pushDataLayer('page_view', { page_path: location.pathname, page_title: metaFor(state.page).title });
  route();
});
// [KULLANICI İSTEĞİ] "Header'a ana sayfaya dönmek için buton ekle" — her ekrandan erişilebilen
// sabit bir üst bar butonu (bkz. index.html #homeNavBtn), tıklanınca actions.leaveRoom() ile
// aynı yolu kullanır (devam eden bir oyundaysa önce onay ister — bkz. leaveRoom).
const homeNavBtn = document.getElementById('homeNavBtn');
homeNavBtn.addEventListener('click', () => { actions.leaveRoom(); });
// [KULLANICI İSTEĞİ] "Header'daki logoya tıklayınca ana sayfaya atsın" — odadaysa leaveRoom
// (aktif oyunda onay ister), değilse sadece lobiye döner.
const brandEl = document.querySelector('.topbar .brand');
if (brandEl) {
  brandEl.style.cursor = 'pointer';
  brandEl.setAttribute('role', 'link');
  brandEl.setAttribute('tabindex', '0');
  brandEl.setAttribute('title', 'Ana sayfa');
  const goHome = () => { if (state.room) actions.leaveRoom(); else navigateToPage(null); };
  brandEl.addEventListener('click', goHome);
  brandEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });
}

function setCode(code) {
  state.code = code;
  if (code) sessionStorage.setItem(LS_CODE, code); else sessionStorage.removeItem(LS_CODE);
}

function emitAck(event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

// [design.md "Yerleşim"] "Sürekli görünen bir skorbord üst şeridi olsun (bütçe... her zaman
// görünür, oyunun neresinde olursan ol)" — draft'tayken kendi bütçen bu şeride eklenir (her
// draft:update zaten route()'u tetiklediği için güvenilir şekilde senkron kalır). Maç anlatımı
// skoru ve geri sayım BİLEREK tekrarlanmadı: ikisi de kendi ekranlarında (bkz. .scoreline,
// .timer-wrap) DOM'u route() dışında doğrudan mutasyonla güncelleniyor — buraya da bağlamak
// ayrı bir senkron yolu ve gerçek bir "stale veri" riski katardı.
// [KULLANICI İSTEĞİ] "Bağlanıyor" durumu — kopuşta ekranın üstünde kalıcı, net bir şerit
// (toast kaybolur, bu kalır) + geri döndüğünde kısa bir "bağlandı" bildirimi.
let connBanner = null;
function updateConnBanner() {
  if (!connBanner) {
    connBanner = el('div', { class: 'conn-banner', role: 'status' });
    document.body.appendChild(connBanner);
  }
  const offline = !state.connected;
  connBanner.className = `conn-banner ${offline ? 'show' : ''}`;
  // [KULLANICI İSTEĞİ] Bağlantı bandı v3: dönen halka + başlık + tek satır açıklama.
  if (offline) {
    connBanner.replaceChildren(
      el('span', { class: 'cb-spin' }),
      el('span', { class: 'cb-text' }, [
        el('b', {}, 'Bağlantı koptu'),
        el('span', {}, state.room ? 'Yeniden bağlanılıyor. Sıra sana gelirse sunucu senin yerine oynar.' : 'Yeniden bağlanılıyor…'),
      ]),
    );
  }
}

// İlk bağlantı ile GERÇEK bir yeniden bağlanma ayrımı — sayfa ilk açılışta da
// state.connected false olduğu için, bu flag olmadan her açılış "bağlantı geri geldi" derdi.
let everConnected = false;

// Ses aç/kapat + SEVİYE — üst bara bir kez enjekte edilir (bkz. sfx.js).
// [KULLANICI İSTEĞİ] "Ses seviyesi sadece aç/kapa, kısma yok." Düğme artık ikiye ayrıldı:
// hoparlör ikonu sesi kapatır/açar, yanındaki oka basınca küçük bir panelde kaydırıcı açılır.
// Panel state tutmuyor — değer sfx.js içinde kalıcı, bu yüzden her açılışta oradan okunuyor.
// [KULLANICI İSTEĞİ] "Header'daki butonlar çok kötü ve basit duruyor" — üst bar v2: emoji yerine
// tek çizgi ağırlığında SVG ikonlar, segmentli nav, durum çipleri, avatar + hesap menüsü.
const TB_ICONS = {
  leave: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  players: '<path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-6"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  spk: '<path d="M11 5 6 9H2v6h4l5 4V5z"/>',
  w1: '<path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  w2: '<path d="M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.2A3 3 0 0 0 12 8c-1.7 0-3 .9-3 2s1.3 1.6 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-2.5-1.2"/><path d="M12 6.5V8"/><path d="M12 16v1.5"/>',
  shop: '<path d="M3 9h18l-1.5 11a1 1 0 0 1-1 .9H5.5a1 1 0 0 1-1-.9L3 9z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/>',
};
const tbSvg = (paths, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
function tbIco(name, size = 16) {
  const s = document.createElement('span');
  s.className = 'tb-ico';
  s.innerHTML = tbSvg(TB_ICONS[name], size);
  return s;
}
function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + ((parts[1] || '')[0] || '')).toLocaleUpperCase('tr-TR');
}

let sfxBtn = null;
let sfxPop = null;
let sfxRange = null;
function ensureSfxButton() {
  if (sfxBtn) return;
  const host = document.getElementById('topbarStatus');
  if (!host || !host.parentElement) return;

  sfxBtn = el('button', {
    type: 'button', class: 'sfx-toggle', title: 'Ses efektleri (gol, düdük, direk, teklif)',
    'data-sfx': 'off', 'aria-label': 'Ses efektlerini aç/kapat',
    onclick: () => { sfx.toggle(); syncSfxButton(); },
  });

  const volBtn = el('button', {
    type: 'button', class: 'sfx-vol-btn', 'data-sfx': 'off',
    title: 'Ses seviyesi', 'aria-label': 'Ses seviyesi',
    onclick: (e) => { e.stopPropagation(); toggleSfxPop(); },
  }, tbIco('chev', 13));

  sfxRange = el('input', {
    type: 'range', min: '0', max: '100', step: '5', class: 'sfx-range',
    'aria-label': 'Ses seviyesi',
    oninput: (e) => {
      sfx.setVolume(Number(e.target.value) / 100, false);
      syncSfxButton();
    },
    // Bırakınca kısa bir örnek ses çalsın — kullanıcı seviyeyi kulakla ayarlayabilsin.
    onchange: () => sfx.play('click'),
  });

  sfxPop = el('div', { class: 'sfx-pop', onclick: (e) => e.stopPropagation() }, [
    el('div', { class: 'sfx-pop-title' }, 'Ses seviyesi'),
    el('div', { class: 'sfx-pop-row' }, [
      el('span', { class: 'sfx-pop-ico' }, '🔈'),
      sfxRange,
      el('span', { class: 'sfx-pop-val' }, '80%'),
    ]),
    el('div', { class: 'sfx-pop-note' }, 'Gol, düdük, kart ve buton sesleri'),
  ]);

  const wrap = el('div', { class: 'sfx-wrap' }, [sfxBtn, volBtn, sfxPop]);
  host.after(wrap);

  // Panel dışına tıklayınca kapansın (tek kez bağlanır).
  document.addEventListener('click', () => { if (sfxPop) sfxPop.classList.remove('open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sfxPop) sfxPop.classList.remove('open'); });
  syncSfxButton();
}
function toggleSfxPop() {
  if (!sfxPop) return;
  sfxPop.classList.toggle('open');
  if (sfxPop.classList.contains('open')) syncSfxButton();
}
function syncSfxButton() {
  if (!sfxBtn) return;
  const vol = sfx.getVolume();
  const on = sfx.isEnabled() && vol > 0;
  sfxBtn.innerHTML = tbSvg(TB_ICONS.spk + (!on ? TB_ICONS.mute : TB_ICONS.w1 + (vol >= 0.5 ? TB_ICONS.w2 : '')), 17);
  sfxBtn.classList.toggle('off', !on);
  if (sfxRange) sfxRange.value = String(Math.round(vol * 100));
  if (sfxPop) {
    const val = sfxPop.querySelector('.sfx-pop-val');
    if (val) val.textContent = `${Math.round(vol * 100)}%`;
  }
}

// [KULLANICI İSTEĞİ] "Butonları dahil hallet" — oyundaki TÜM butonlara kısık bir dokunma sesi.
// Tek tek onclick'lere eklemek yerine tek bir yakalama (capture) dinleyicisi: her butonda
// çalar, kendi sesi olan aksiyonlarda (teklif, kabul, çark, hazırım) o aksiyonun kendi sesi
// zaten üstüne biner. data-sfx="off" ile bir butonu hariç tutabilirsin.
let uiClickBound = false;
function bindUiClickSound() {
  if (uiClickBound) return;
  uiClickBound = true;
  document.addEventListener('pointerdown', (e) => {
    const t = e.target instanceof Element ? e.target.closest('button, .btn, .tab, .pill, summary') : null;
    if (!t || t.disabled || t.dataset.sfx === 'off') return;
    sfx.play(t.classList.contains('tab') || t.tagName === 'SUMMARY' ? 'toggle' : 'click');
  }, { capture: true, passive: true });
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 1] Üst bar butonunu giriş durumuna
// göre günceller — misafirken sayfaya götürür, giriş yapılmışken tıklanınca doğrudan çıkış yapar
// (ayrı bir "hesabım" sayfası bu fazda yok, sadece giriş/kayıt/çıkış).
let acctMenu = null;
let acctMenuBound = false;
function closeAcctMenu() {
  if (acctMenu) acctMenu.classList.remove('open');
  authNavBtn.setAttribute('aria-expanded', 'false');
}
function updateAuthNav() {
  authNavBtn.replaceChildren();
  authNavBtn.classList.toggle('tb-cta', !state.user);
  authNavBtn.classList.toggle('tb-acct', !!state.user);
  if (!state.user) {
    if (acctMenu) { acctMenu.remove(); acctMenu = null; }
    authNavBtn.removeAttribute('aria-haspopup');
    authNavBtn.removeAttribute('aria-expanded');
    authNavBtn.title = 'Giriş yap veya kayıt ol';
    authNavBtn.append(tbIco('login'), el('span', {}, 'Giriş Yap'));
    authNavBtn.onclick = () => navigateToPage(state.page === 'login' ? null : 'login');
    return;
  }
  const u = state.user;
  authNavBtn.title = u.displayName;
  authNavBtn.setAttribute('aria-haspopup', 'menu');
  authNavBtn.append(el('span', { class: 'tb-avatar' }, initialsOf(u.displayName)), el('span', { class: 'tb-acct-name' }, u.displayName), tbIco('chev', 14));
  if (!acctMenu) {
    acctMenu = el('div', { class: 'tb-menu', role: 'menu', onclick: (e) => e.stopPropagation() });
    authNavBtn.parentElement.appendChild(acctMenu);
  }
  const item = (icon, label, fn, cls = '') => el('button', {
    type: 'button', class: `tb-menu-item ${cls}`, role: 'menuitem',
    onclick: () => { closeAcctMenu(); fn(); },
  }, [tbIco(icon), el('span', {}, label)]);
  acctMenu.replaceChildren(
    el('div', { class: 'tb-menu-head' }, [
      el('span', { class: 'tb-avatar lg' }, initialsOf(u.displayName)),
      el('div', { class: 'tb-menu-id' }, [
        el('div', { class: 'tb-menu-name' }, u.displayName),
        u.email ? el('div', { class: 'tb-menu-mail' }, u.email) : null,
      ]),
    ]),
    el('div', { class: `tb-menu-state ${u.emailVerified ? 'ok' : 'wait'}` }, u.emailVerified ? 'E-posta doğrulandı' : 'Onay bekliyor'),
    item('user', 'Hesabım', () => navigateToPage('login')),
    item('gift', 'Günlük Ödül', () => navigateToPage('dailyReward')),
    item('shop', 'Mağaza', () => navigateToPage('store')),
    el('div', { class: 'tb-menu-sep' }),
    item('logout', 'Çıkış Yap', () => actions.logout(), 'danger'),
  );
  authNavBtn.onclick = (e) => {
    e.stopPropagation();
    const open = !acctMenu.classList.contains('open');
    if (sfxPop) sfxPop.classList.remove('open');
    acctMenu.classList.toggle('open', open);
    authNavBtn.setAttribute('aria-expanded', String(open));
  };
  if (!acctMenuBound) {
    acctMenuBound = true;
    document.addEventListener('click', closeAcctMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAcctMenu(); });
  }
}

function updateTopbar() {
  bindUiClickSound();
  ensureSfxButton();
  updateConnBanner();
  updateAuthNav();
  const chips = [];
  chips.push(el('span', {
    class: `tb-chip conn ${state.connected ? 'on' : 'off'}`,
    title: state.connected ? 'Sunucuya bağlı' : 'Bağlantı yok — yeniden bağlanılıyor',
  }, [el('i', { class: 'tb-pulse' }), el('span', { class: 'tb-conn-t' }, state.connected ? 'Canlı' : 'Bağlantı yok')]));
  if (state.code) {
    chips.push(el('button', {
      type: 'button', class: 'tb-chip code', title: 'Oda kodunu kopyala',
      onclick: () => {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(state.code).then(() => toast('Oda kodu kopyalandı'), () => {});
      },
    }, [el('span', { class: 'tb-chip-k' }, 'Oda'), el('b', {}, state.code), tbIco('copy', 13)]));
  }
  if (state.name && state.room) chips.push(el('span', { class: 'tb-chip who' }, [tbIco('user', 13), el('span', {}, state.name)]));
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Giriş yapmışken coin bakiyesi;
  // tıklayınca mağaza.
  if (state.user) {
    chips.push(el('button', {
      type: 'button', class: 'tb-chip coins', title: 'Coin bakiyen — mağazaya git',
      onclick: () => navigateToPage('store'),
    }, [tbIco('coin', 14), el('b', {}, (state.user.coins || 0).toLocaleString('tr-TR'))]));
  }
  // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] Çark Modu'nda bütçe hiç kullanılmıyor — üst barda
  // gösterilmesi kafa karıştırıyordu.
  if (state.draft && state.draft.players && state.room && state.room.draftMode !== 'wheel') {
    const me = state.draft.players.find((p) => p.clientId === state.clientId);
    if (me) chips.push(el('span', { class: 'tb-chip money', title: 'Kalan bütçe' }, [el('span', { class: 'tb-chip-k' }, 'Bütçe'), el('b', {}, `${me.budget}₺`)]));
  }
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] Draft sırasında sürekli aktif kalan
  // perk'ler (anti_snipe_shield/ceiling_reduction/free_backup henüz kullanılmadıysa) unutulmasın
  // diye üst barda hep görünür — anlık etkiler (bütçe +/-, kumarbaz) zaten bütçeye yansıdığı ve
  // bir daha bir şey "beklemediği" için burada AYRICA gösterilmiyor.
  if (state.room && state.room.status === 'draft') {
    const mePerk = state.room.players.find((p) => p.clientId === state.clientId)?.prepPerk;
    if (mePerk && mePerk.active) chips.push(el('span', { class: 'tb-chip perk', title: 'Aktif perk' }, `${mePerk.label}${mePerk.kind === 'free_backup' ? ' (kullanılmadı)' : ''}`));
  }
  topbarStatus.replaceChildren(...chips);
}

// [KULLANICI İSTEĞİ] "Oyuncu ararken harfler teker teker giriliyor, bir harf girip tekrar
// tıklamak gerekiyor" — kök neden: route() her state değişikliğinde appRoot'u SIFIRDAN kuruyor
// (innerHTML=''), bu da odaklanmış bir <input>'un (ör. arama kutusu) her tuş vuruşunda
// odağını/imleç konumunu kaybetmesine yol açıyordu (arama kutusu her `oninput`'ta actions.route()
// çağırıyor). Çözüm: DOM'u yeniden kurmadan ÖNCE hangi elemanın odakta olduğunu (bir
// `data-focus-key` işaretiyle) kaydet, yeniden kurduktan SONRA aynı işarete sahip elemanı bulup
// odağı + imleç konumunu geri yükle. Bu, route()'u çağıran HERHANGİ bir input için genel bir
// çözüm — sadece arama kutusuna değil, `data-focus-key` taşıyan her elemana otomatik uygulanır.
// [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "X teklif verirken Y yazıyor, X'in teklifi anda
// Y'nin sayfası kendini yeniliyor ve yazdığı teklif kayboluyor" — kök neden: sadece odak/imleç
// konumu geri yükleniyordu, elemanın YAZILMIŞ DEĞERİ (`.value`) değil. Teklif kutusu gibi
// "kontrolsüz" (state'e değil DOM'a bağlı) inputlarda yeni render her zaman TAZE bir varsayılan
// değerle kuruluyordu — o an odakta olmasa bile (ör. az önce yazıp başka bir alana geçmiş
// olabilir) kullanıcının yazdığı metin sessizce siliniyordu. Artık `.value` da (odaktan
// bağımsız, DOM'da o key ile eşleşen HERHANGİ bir inputtan) yakalanıp geri yükleniyor —
// data-focus-key'in kapsamı round/turla eşleştiği için (ör. `bid-input-${roundKey}`) gerçekten
// YENİ bir tur başladığında (key değiştiğinde) eski değer zaten hiç aranmıyor, doğru şekilde
// sıfırlanıyor.
function captureFocus() {
  const active = document.activeElement;
  const focusedKey = active && appRoot.contains(active) && active.getAttribute
    ? active.getAttribute('data-focus-key') : null;
  const values = {};
  for (const node of appRoot.querySelectorAll('[data-focus-key]')) {
    const key = node.getAttribute('data-focus-key');
    if (key && 'value' in node) values[key] = node.value;
  }
  if (!focusedKey && Object.keys(values).length === 0) return null;
  return {
    key: focusedKey,
    selectionStart: focusedKey && typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: focusedKey && typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
    values,
  };
}
function restoreFocus(saved) {
  if (!saved) return;
  for (const node of appRoot.querySelectorAll('[data-focus-key]')) {
    const key = node.getAttribute('data-focus-key');
    if (key && Object.prototype.hasOwnProperty.call(saved.values, key) && 'value' in node) {
      node.value = saved.values[key];
    }
  }
  if (!saved.key) return;
  const el2 = appRoot.querySelector(`[data-focus-key="${saved.key}"]`);
  if (!el2) return;
  el2.focus();
  if (saved.selectionStart != null && el2.setSelectionRange) {
    try { el2.setSelectionRange(saved.selectionStart, saved.selectionEnd); } catch (e) { /* metin dışı input (ör. number) — yok say */ }
  }
}

// [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Bir kullanıcı kadrosunu/teklifini kaydederken benim
// ekranım da kendinin başına atıyor, sayfa yenileniyormuş gibi oluyor" — kök neden: route() her
// socket broadcast'inde (bir başkasının hamlesi dahil) appRoot'u sıfırdan kuruyor; tarayıcı yeni
// içerikle sayfanın en üstünden başladığı için scroll konumu sessizce sıfırlanıyordu. Aynı
// "görünüm" içindeysek (sayfa + oda durumu değişmediyse — sadece içerik güncellendiyse) eski
// scroll konumu geri yükleniyor; GERÇEK bir ekran geçişinde (ör. draft bitip dizilime geçmek)
// tarayıcının doğal "yeni sayfa üstten başlar" davranışına dokunulmuyor.
function currentViewKey() {
  return `${state.page || ''}|${state.room ? state.room.status : ''}`;
}

function route() {
  applyTeamTheme(state.user?.favoriteTeam);
  const savedFocus = captureFocus();
  const prevViewKey = route._viewKey;
  const prevScrollY = window.scrollY;
  appRoot.innerHTML = '';
  revealCoinAwardIfReady();
  syncRoomAccount();
  updateTopbar();
  updateHead();
  storeNavBtn.classList.toggle('active', state.page === 'store');
  playersNavBtn.classList.toggle('active', state.page === 'players');
  howToPlayNavBtn.classList.toggle('active', state.page === 'how-to-play');
  authNavBtn.classList.toggle('active', state.page === 'login');
  dailyRewardNavBtn.style.display = state.user ? '' : 'none';
  dailyRewardNavBtn.classList.toggle('active', state.page === 'dailyReward');
  // Bugünkü ücretsiz çevirme henüz kullanılmadıysa küçük amber nokta.
  dailyRewardNavBtn.classList.toggle('has-dot', !!(state.user && state.dailyReward && state.dailyReward.spinsUsedToday === 0));
  // Zaten ana sayfadaysak (oda yoksa) ayrılacak bir şey yok — buton gizlensin.
  homeNavBtn.style.display = state.room ? '' : 'none';

  function finish() {
    restoreFocus(savedFocus);
    const newViewKey = currentViewKey();
    if (prevViewKey === newViewKey) window.scrollTo(0, prevScrollY);
    route._viewKey = newViewKey;
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA ZORUNLULUĞU] "Doğrulamazsan siteye
  // giremesin" — giriş yapılmış ama e-postası doğrulanmamış bir kullanıcı, aktif bir oyunun
  // İÇİNDE DEĞİLSE (bkz. `!state.room` — bir draft/maçın ORTASINDA hesap durumu yüzünden dışarı
  // atılmak kötü bir deneyim olurdu, oyun hiçbir zaman hesaba bağlı değildi) HİÇBİR ekranı
  // (lobi, oyuncu veritabanı, nasıl oynanır, günlük ödül) göremez — SADECE bu duvarı görür.
  // `renderVerifyGate` kendi "tekrar gönder"/"çıkış yap" düğmelerini taşıyor, bu yüzden
  // /giris'i özel olarak muaf tutmaya gerek yok.
  // [YASAL] Gizlilik politikası ve 404 her durumda (doğrulama duvarı dahil) görülebilmeli.
  if (state.page === 'privacy') {
    appRoot.appendChild(renderPrivacy({ state, actions }));
    finish();
    return;
  }
  if (state.page === 'notFound') {
    appRoot.appendChild(renderNotFound({ state, actions }));
    finish();
    return;
  }
  // [PAYLAŞILAN SONUÇ] Herkese açık — doğrulama duvarının da önünde.
  if (state.page === 'sharedResult') {
    if (!state.sharedResult) actions.fetchSharedResult(state.sharedResultId);
    appRoot.appendChild(renderSharedResult({ state, actions }));
    finish();
    return;
  }

  if (state.user && !state.user.emailVerified && !state.room) {
    appRoot.appendChild(renderVerifyGate({ state, actions }));
    finish();
    return;
  }

  if (state.page === 'players') {
    appRoot.appendChild(renderPlayerDatabase({ state, actions }));
    finish();
    return;
  }

  if (state.page === 'how-to-play') {
    appRoot.appendChild(renderHowToPlay({ state, actions }));
    finish();
    return;
  }

  if (state.page === 'login') {
    appRoot.appendChild(renderLogin({ state, actions }));
    finish();
    return;
  }

  if (state.page === 'dailyReward') {
    appRoot.appendChild(renderDailyReward({ state, actions }));
    finish();
    return;
  }

  if (state.page === 'store') {
    appRoot.appendChild(renderStore({ state, actions }));
    finish();
    return;
  }

  if (!state.room) {
    appRoot.appendChild(renderLobby({ state, actions }));
    finish();
    return;
  }

  // [DÜZELTİLDİ — BUG, KULLANICI GERİ BİLDİRİMİ] "Çark bitince oyun hemen başlıyor" — bkz.
  // views.js isPrepWheelSpinActive yorumu: son kişi Hazırlık Çarkı'nı çevirince sunucu
  // room.status'u AYNI ANDA 'draft'a çevirebiliyordu, bu da çevirenin (ve izleyenlerin) henüz
  // bitmemiş yerel spin animasyonunu status'a bakan bu switch'in ATLAMASINA yol açıyordu. Artık
  // durum ne olursa olsun, yerel animasyon hold süresi dolmadan renderPrepWheel çizilmeye devam
  // ediyor — hold bitince normal switch akışı (aşağıdaki case'ler) devreye giriyor.
  if (isPrepWheelSpinActive(state)) {
    appRoot.appendChild(renderPrepWheel({ state, actions }));
    finish();
    return;
  }

  switch (state.room.status) {
    case 'lobby':
      appRoot.appendChild(renderWaitingRoom({ state, actions }));
      break;
    case 'prep_wheel':
      appRoot.appendChild(renderPrepWheel({ state, actions }));
      break;
    case 'draft':
      appRoot.appendChild(renderDraft({ state, actions }));
      break;
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] Draft ile dizilim seçimi arasındaki
    // isteğe bağlı faz (host oda kurarken açtıysa, üç draft modunda da).
    case 'trade':
      appRoot.appendChild(renderTradeRound({ state, actions }));
      break;
    case 'squad_select':
    case 'match':
      appRoot.appendChild(renderLineup({ state, actions }));
      break;
    case 'finished':
      if (state.matchResult && state.matchPlayback && !state.matchPlayback.done) {
        appRoot.appendChild(renderMatchPlayback({ state, actions }));
      } else {
        appRoot.appendChild(renderMatch({ state, actions }));
      }
      break;
    default:
      appRoot.appendChild(el('div', { class: 'panel' }, 'Bilinmeyen oda durumu.'));
  }
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Tepki paneli — maç anlatımı/sonuç hariç oda ekranlarında.
  if (['lobby', 'prep_wheel', 'draft', 'trade', 'squad_select'].includes(state.room.status) && state.room.players.length > 1) {
    appRoot.appendChild(reactionDock({ state, actions }));
  }
  finish();
}

const actions = {
  // [YASAL — ÇEREZ ONAYI] Politika sayfasındaki "tercihimi değiştir" düğmesi.
  resetConsent() { resetConsent(() => navigateToPage('privacy')); },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] wheelSegmentLabels: host'un elle
  // işaretlediği tam WHEEL_CUSTOM_PICK_COUNT etiket (bkz. views.js renderLobby wheel checklist'i)
  // ya da boş dizi/undefined (işaretlemediyse — sunucu auto-balance'a düşer).
  async createRoom(name, draftMode, playerPool, wheelSegmentLabels, prepWheelEnabled, tradeRoundEnabled, bankedPerksEnabled) {
    state.name = name;
    sessionStorage.setItem(LS_NAME, name);
    const res = await emitAck('room:create', { clientId: state.clientId, clientSecret: state.clientSecret, name, draftMode, playerPool, wheelSegmentLabels, prepWheelEnabled, tradeRoundEnabled, bankedPerksEnabled });
    if (res.error) return toast('Oda oluşturulamadı: ' + (ROOM_ERRORS[res.error] || res.error));
    state.room = res.room;
    setCode(res.room.code);
    pushDataLayer('room_create', { draft_mode: draftMode, player_pool: playerPool, trade_round: !!tradeRoundEnabled });
    syncUrlToRoomMode(res.room);
    route();
  },
  async joinRoom(name, code) {
    state.name = name;
    sessionStorage.setItem(LS_NAME, name);
    const res = await emitAck('room:join', { clientId: state.clientId, clientSecret: state.clientSecret, name, code: code.toUpperCase() });
    if (res.error) return toast('Odaya katılınamadı: ' + (ROOM_ERRORS[res.error] || res.error));
    state.room = res.room;
    setCode(res.room.code);
    pushDataLayer('room_join');
    syncUrlToRoomMode(res.room);
    route();
  },
  // [KULLANICI İSTEĞİ] "Header'a ana sayfaya dönmek için buton, oyundayken de oyundan çıkmak
  // için bir şey ekle." — draft/dizilim/maç sırasında (henüz bitmemiş bir oyunda) çıkmak
  // rakibi de etkileyeceği için önce onay istiyor; lobide/maç bittikten sonra (kaybedecek bir
  // şey olmadığı için) doğrudan çıkılıyor — `room:rematch`daki "tek taraflı onay yeterli"
  // mantığıyla aynı ayrım. Sunucuya `room:leave` gönderiyoruz ki socket o odanın broadcast
  // grubundan gerçekten ayrılsın (bkz. roomSockets.js) — aksi halde rakip daha sonra bir şey
  // yaptığında (ör. Tekrar Oyna) ayrılmış istemci sessizce odaya geri sürüklenebilirdi.
  async leaveRoom() {
    const room = state.room;
    const isActive = room && ['prep_wheel', 'draft', 'squad_select', 'match'].includes(room.status);
    if (isActive) {
      const ok = await confirmDialog({
        title: 'Oyundan çıkılsın mı?',
        body: 'Devam eden bir oyundasın. Çıkarsan rakibin oyunda kalır, sen ana sayfaya dönersin.',
        confirmLabel: 'Oyundan Çık', cancelLabel: 'Oyunda Kal', danger: true,
      });
      if (!ok) return false;
    }
    if (state.code) {
      try { await emitAck('room:leave', { code: state.code }); } catch (e) { /* bağlantı zaten kopmuş olabilir — yok say */ }
    }
    pushDataLayer('leave_room', { was_active: !!isActive });
    setCode(null);
    state.room = null;
    state.draft = null;
    state.blindBidUi = null;
    state.matchResult = null;
    state.matchPlayback = null;
    state.matchResultUi = null;
    state.blindFirstRoundConsumed = false;
    state.blindFirstRoundKey = null;
    navigateToPage(null);
    return true;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kişi gelirse gelsin, herkes hazır verdikten
  // sonra oda sahibi başlatsın" — bu artık SADECE kendi "hazırım" oyunu açıp/kapatıyor, draftı
  // asla kendiliğinden başlatmıyor (bkz. draftSockets.js `draft:readyToggle`). Oy sayısı
  // room.readyVotes üzerinden room:state ile gelir.
  async toggleDraftReady() {
    const res = await emitAck('draft:readyToggle', { code: state.code });
    if (res.error) toast('İşlem başarısız: ' + res.error);
    return res;
  },
  // Draftı fiilen başlatan host-only aksiyon (bkz. draftSockets.js `draft:start`).
  async startDraft() {
    const res = await emitAck('draft:start', { code: state.code });
    if (res.error) toast('Draft başlatılamadı: ' + res.error);
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] Her oyuncu kendi kararını verir — çevir
  // (risk var, iyi/kötü bir perk gelebilir) ya da atla (hiç risk almadan draft'a öylece geç).
  async spinPrepWheel() {
    const res = await emitAck('draft:prepWheelSpin', { code: state.code });
    if (res.error) toast('Çevrilemedi: ' + res.error);
    return res;
  },
  async skipPrepWheel() {
    const res = await emitAck('draft:prepWheelSkip', { code: state.code });
    if (res.error) toast('İşlem başarısız: ' + res.error);
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI "TAM SÜRÜM"] "👁️ Gözcü" — sonuç sadece
  // BU çağırana ACK ile döner (bkz. draftSockets.js/DraftEngine.peekBids), broadcast edilmez.
  async peekBids() {
    const res = await emitAck('draft:peekBids', { code: state.code });
    if (res.error) toast('Gözcü hakkı kullanılamadı: ' + res.error);
    return res;
  },
  async submitBid(amount) {
    const res = await emitAck('draft:bid', { code: state.code, amount });
    if (res.error) { sfx.play('error'); toast('Teklif reddedildi: ' + res.error); }
    else { sfx.play('bid'); pushDataLayer('bid_placed', { amount }); }
    return res;
  },
  // [KULLANICI İSTEĞİ] "Açık arttırmada durdurma gelsin, iki oyuncu da onayladığında oyun
  // duraklatılsın" — oy ekle/çıkar, sunucu iki oy da varken duraklatır.
  async togglePause() {
    const res = await emitAck('draft:pauseToggle', { code: state.code });
    if (res.error) toast('İşlem başarısız: ' + res.error);
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çark Modu — sonuç sunucuda belirlenir (hile önleme),
  // istemci sadece isteği yollar (bkz. DraftEngine.spinWheel).
  async spinWheel() {
    const res = await emitAck('draft:spinWheel', { code: state.code });
    if (res.error) toast('Çark çevrilemedi: ' + res.error);
    else pushDataLayer('wheel_spin');
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] `ownerClientId` sadece 'steal' segmentinde
  // ("rakipten istediğin oyuncuyu al") anlamlı — diğer segment türlerinde undefined geçilir,
  // sunucu yok sayar.
  async submitWheelPick(playerId, ownerClientId) {
    const res = await emitAck('draft:wheelPick', { code: state.code, playerId, ownerClientId });
    if (res.error) toast('Seçim reddedildi: ' + res.error);
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kullanıcı karar vermek istemezse bilgisayar atasın." —
  // sırası gelen oyuncu süre dolmasını beklemeden aynı otomatik-seçim mantığını hemen tetikler
  // (bkz. DraftEngine.requestAutoPick). Sonuç zaten normal `draft:update` broadcast'iyle gelir,
  // burada ayrıca bir şey yapmaya gerek yok — sadece hata varsa haber ver.
  async requestWheelAutoPick() {
    const res = await emitAck('draft:wheelAutoPick', { code: state.code });
    if (res.error) toast('Otomatik seçim yapılamadı: ' + res.error);
    return res;
  },
  // ---------------- [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] ----------------
  // Tüm kural/doğrulama sunucuda (bkz. trade/TradeEngine.js); istemci sadece istek gönderir ve
  // kendi görünümünü 'trade:state' ile alır.
  async syncTrade() {
    const res = await emitAck('trade:sync', { code: state.code });
    if (res && res.error && res.error !== 'TRADE_ROUND_NOT_ACTIVE') toast('Takas turu alınamadı: ' + res.error);
    return res;
  },
  async sendTradeOffer(toClientId, givePlayerId, getPlayerId) {
    const res = await emitAck('trade:offer', { code: state.code, toClientId, givePlayerId, getPlayerId });
    if (res.error) { sfx.play('error'); toast('Teklif gönderilemedi: ' + (TRADE_ERRORS[res.error] || res.error)); }
    else { sfx.play('bid'); toast('Teklif gönderildi — onay bekleniyor.'); }
    return res;
  },
  async acceptTrade(offerId) {
    const res = await emitAck('trade:accept', { code: state.code, offerId });
    if (res.error) { sfx.play('error'); toast('Takas yapılamadı: ' + (TRADE_ERRORS[res.error] || res.error)); }
    return res;
  },
  async cancelTrade(offerId) {
    const res = await emitAck('trade:cancel', { code: state.code, offerId });
    if (res.error) toast('İşlem başarısız: ' + (TRADE_ERRORS[res.error] || res.error));
    return res;
  },
  async toggleTradeDone() {
    const res = await emitAck('trade:doneToggle', { code: state.code });
    if (res.error) toast('İşlem başarısız: ' + (TRADE_ERRORS[res.error] || res.error));
    return res;
  },
  async fetchLineupOptions() {
    const res = await emitAck('lineup:options', { code: state.code });
    if (res.error) { toast('Dizilim seçenekleri alınamadı: ' + res.error); return null; }
    state.lineupOptions = res;
    return res;
  },
  // [KULLANICI İSTEĞİ] "Kadro diziliminde agresif/sakin oyna, atak/dengeli/defansif oyna
  // seçenekleri gelsin" — style/tactic formasyon+dizilimle birlikte kaydedilir.
  async submitLineup(matchSide, formation, assignment, style, tactic) {
    const res = await emitAck('lineup:submit', { code: state.code, matchSide, formation, assignment, style, tactic });
    if (res.error) toast('Dizilim reddedildi: ' + JSON.stringify(res.detail || res.error));
    else pushDataLayer('lineup_submit', { match_side: matchSide, formation, tactic });
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Ya herkes sonuca geçecek ya da herkes aynı şekilde
  // izleyecek, hızlı da dahil." — bu artık kendi pb.speed'ini DEĞİŞTİRMİYOR, sadece bir OY
  // gönderiyor; sunucu odadaki HERKES aynı hızı oylayınca gerçek değişikliği `match:playbackSync`
  // broadcast'iyle uyguluyor (bkz. applyPlaybackSync).
  async votePlaybackSpeed(speed) {
    const res = await emitAck('match:playbackSpeedVote', { code: state.code, speed });
    if (res.error) { toast('Hız oyu gönderilemedi: ' + res.error); return res; }
    if (res.playbackSync) { applyPlaybackSync(res.playbackSync); route(); }
    return res;
  },
  // Toggle — tekrar tıklamak oyu geri çeker (readyToggle/pauseToggle ile aynı desen).
  async votePlaybackSkip() {
    const res = await emitAck('match:playbackSkipToggle', { code: state.code });
    if (res.error) { toast('İşlem başarısız: ' + res.error); return res; }
    if (res.playbackSync) { applyPlaybackSync(res.playbackSync); route(); }
    return res;
  },
  // [KULLANICI İSTEĞİ] "Maç başlarken de iki oyuncuda hazır versin." — tek tık artık maçı
  // başlatmıyor, kendi "hazırım" oyunu açıp/kapatıyor (bkz. matchSockets.js).
  async toggleMatchReady() {
    const res = await emitAck('match:simulate', { code: state.code });
    if (res.error) { toast('İşlem başarısız: ' + res.error); return res; }
    if (res.result) { applyMatchResult(res.result); route(); }
    return res;
  },
  // [KULLANICI İSTEĞİ] "Maç bittikten sonra tekrar oyna butonu gelsin." — aynı oda/rakiple,
  // oda kodunu yeniden paylaşmadan sıfırdan bir draft başlatılabilir hale getirir.
  async rematch() {
    const res = await emitAck('room:rematch', { code: state.code });
    if (res.error) { toast('Tekrar oyna başarısız: ' + res.error); return; }
    pushDataLayer('rematch');
    resetMatchLocalState();
    state.room = res.room;
    route();
  },
  // [KULLANICI İSTEĞİ] "Bir sayfaya oyundaki bütün oyuncuların ratingleri yazabilir" —
  // draft/oda durumundan bağımsız, plain REST çağrısı (socket ack gerekmiyor). Sonuç
  // state.playerDb'de tutulup bir daha çekilmiyor (bkz. views.js renderPlayerDatabase).
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAYLAŞILAN SONUÇ] Tek seferlik; hata durumunda tekrar denemez.
  async fetchSharedResult(id) {
    if (!id || (state.sharedResult && state.sharedResult.id === id)) return;
    state.sharedResult = { id, loading: true };
    try {
      const r = await fetch(`/api/results/${encodeURIComponent(id)}`);
      const body = await r.json();
      state.sharedResult = r.ok && body.result ? { id, data: body.result } : { id, error: body.error || 'NOT_FOUND' };
    } catch (e) {
      state.sharedResult = { id, error: 'NETWORK' };
    }
    if (state.page === 'sharedResult') route();
  },
  async fetchPlayerDb() {
    if (state.playerDb && state.playerDb.status === 'ready') return state.playerDb;
    state.playerDb = { status: 'loading', all: [] };
    try {
      const res = await fetch('/api/players/all');
      const json = await res.json();
      state.playerDb = { status: 'ready', all: json.players || [] };
    } catch (e) {
      state.playerDb = { status: 'error', all: [] };
    }
    return state.playerDb;
  },
  navigateToPage,
  selectLobbyMode,
  route,
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 1] Socket değil, düz `fetch` — oyun
  // protokolünden (socket.io) TAMAMEN AYRI bir HTTP kimlik sistemi (bkz. server/src/index.js
  // /api/auth/*). fetchPlayerDb ile aynı "plain REST" deseni.
  async register(email, password, displayName, favoriteTeam = null) {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName, favoriteTeam }),
    }).then((r) => r.json());
    if (res.error) { toast(AUTH_ERROR_MESSAGES[res.error] || res.error); return res; }
    state.user = res.user;
    state.store = null; state.storeError = null; // hesap değişti — önceki kullanıcının mağaza verisi kalmasın
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA ZORUNLULUĞU] Bir sonraki route()
    // çağrısında (navigateToPage aracılığıyla) `renderVerifyGate` otomatik devreye girecek —
    // burada özel bir yönlendirme gerekmiyor. Spam uyarısı — kullanıcı geri bildirimi: Resend'in
    // varsayılan test göndereni doğrulanmamış bir alan adından geldiği için sık sık spam'e düşüyor.
    toast('Hesabın oluşturuldu! E-postana bir doğrulama linki gönderdik — gelmezse spam/gereksiz klasörüne bak.');
    navigateToPage(null);
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKIM TEMASI]
  async setFavoriteTeam(teamId) {
    const res = await fetch('/api/auth/team', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: teamId || null }),
    }).then((r) => r.json());
    if (res.error) { toast(AUTH_ERROR_MESSAGES[res.error] || res.error); return res; }
    state.user = res.user;
    route();
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — FORMA ÇEŞİTLERİ]
  async setFavoriteKit(kitId) {
    const res = await fetch('/api/auth/kit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kitId }),
    }).then((r) => r.json());
    if (res.error) { toast(AUTH_ERROR_MESSAGES[res.error] || res.error); return res; }
    state.user = res.user;
    route();
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Mağaza — `fetchDailyReward` ile
  // aynı plain-REST deseni.
  // [DÜZELTİLDİ — BUG] Başarısız istekte `storeError` işaretleniyor: views.js ensureStore bunu
  // görünce otomatik tekrar denemiyor (eskiden 404/ağ hatasında saniyede ~100 istekle sonsuz
  // döngüye girip sayfayı sürekli yeniden çiziyordu). Tekrar deneme sadece kullanıcı düğmesiyle.
  async fetchStore() {
    try {
      const r = await fetch('/api/store');
      const res = await r.json();
      if (!r.ok || res.error) throw new Error(res.error || `HTTP ${r.status}`);
      state.store = res;
      state.storeError = null;
    } catch (e) {
      state.storeError = e.message || 'NETWORK';
    }
  },
  async buyItem(itemId, { wear = false, equip = null } = {}) {
    const res = await fetch('/api/store/buy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    }).then((r) => r.json());
    if (res.error) { toast(AUTH_ERROR_MESSAGES[res.error] || res.error); return res; }
    state.user = res.user;
    if (state.store) {
      state.store.balance = res.user.coins;
      state.store.owned = res.owned;
      state.store.items = state.store.items.map((i) => ({ ...i, owned: res.owned.includes(i.id) }));
    }
    sfx.play('gavel');
    toast(res.item && res.item.type === 'kit' ? 'Satın alındı! Forma dolabına eklendi.' : 'Satın alındı!');
    if (wear && res.item && res.item.kitId) return actions.setFavoriteKit(res.item.kitId);
    if (equip && equip.slot) return actions.setCosmetic(equip.slot, equip.key);
    route();
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Kozmetik tak/çıkar (key null = varsayılan).
  // Odadaysa syncRoomAccount anahtarı değiştiği için yeniden bağlanır, oda yeni görünümü görür.
  async setCosmetic(slot, key) {
    const res = await fetch('/api/auth/cosmetic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, key }),
    }).then((r) => r.json());
    if (res.error) { toast(AUTH_ERROR_MESSAGES[res.error] || res.error); return res; }
    state.user = res.user;
    route();
    return res;
  },
  async sendReaction(reactionId) {
    const res = await emitAck('room:react', { reactionId });
    if (res && res.error === 'RATE_LIMITED') toast('Biraz yavaş — birkaç saniye sonra tekrar dene.');
    else if (res && res.error === 'REACTION_NOT_OWNED') toast('Bu tepki paketi sende yok.');
    return res;
  },
  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then((r) => r.json());
    if (res.error) { toast(AUTH_ERROR_MESSAGES[res.error] || res.error); return res; }
    state.user = res.user;
    state.store = null; state.storeError = null; // hesap değişti — önceki kullanıcının mağaza verisi kalmasın
    navigateToPage(null);
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAROLA SIFIRLAMA] Sunucu e-posta kayıtlı olsa da olmasa
  // da aynı yanıtı veriyor (enumeration yok) — bu yüzden ekrandaki mesaj da koşullu ("kayıtlıysa").
  async forgotPassword(email) {
    const res = await fetch('/api/auth/forgotPassword', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).then((r) => r.json());
    if (res.error) { toast(AUTH_ERROR_MESSAGES[res.error] || res.error); return res; }
    state.authUi.resetRequested = true;
    route();
    return res;
  },
  async resetPassword(password) {
    const res = await fetch('/api/auth/resetPassword', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.authUi.resetToken, password }),
    }).then((r) => r.json());
    if (res.error) { toast(AUTH_ERROR_MESSAGES[res.error] || res.error); return res; }
    state.user = res.user;
    state.store = null; state.storeError = null; // hesap değişti — önceki kullanıcının mağaza verisi kalmasın
    state.authUi = null;
    toast('✅ Parolan değişti ve giriş yaptın. Diğer cihazlardaki oturumların kapatıldı.');
    navigateToPage(null);
    return res;
  },
  async logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    state.user = null;
    state.store = null; state.storeError = null; // hesap değişti — önceki kullanıcının mağaza verisi kalmasın
    route();
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 2] `fetchPlayerDb` ile AYNI "plain
  // REST" deseni. `spinDailyReward` sonucu geldiğinde animasyonu (spin süresi boyunca) yönetmek
  // views.js `renderDailyReward`'ın kendi işi — burada sadece `state.dailyRewardSpin` dolduruluyor
  // (Hazırlık Çarkı'nın `prepWheel:resolved` handler'ıyla aynı desen).
  async fetchDailyReward() {
    try {
      const res = await fetch('/api/rewards/status').then((r) => r.json());
      if (!res.error) state.dailyReward = res;
    } catch (e) { /* sessizce yut, renderDailyReward hata durumunu ayrıca ele almıyor (isteğe bağlı bir özellik) */ }
  },
  async spinDailyReward() {
    const res = await fetch('/api/rewards/spin', { method: 'POST' }).then((r) => r.json());
    if (res.error) { toast(res.error === 'NO_SPIN_LEFT' ? 'Bugünkü ücretsiz çevirmeni kullandın — yarın tekrar gel.' : res.error); return res; }
    state.dailyReward = res.status;
    state.dailyRewardSpin = { perk: res.perk, startedAt: Date.now() };
    route();
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 3] Socket DEĞİL, HTTP — bkz. claude.md
  // "kimlik doğrulama tasarımı" notu. Gerçek sonuç (kim ne kazandı) mevcut `prepWheel:resolved`
  // socket dinleyicisiyle (aşağıda) ZATEN tüm odaya ulaşıyor — burada sadece isteği gönderip
  // kendi envanterimizi tazeliyoruz.
  async redeemBankedPerk(kind) {
    const res = await fetch('/api/rewards/redeemInRoom', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: state.code, clientId: state.clientId, kind }),
    }).then((r) => r.json());
    if (res.error) { toast('Perk kullanılamadı: ' + res.error); return res; }
    await actions.fetchDailyReward();
    return res;
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ SONRASI FAZ 4, "Yabancılarla Online
  // Eşleşme"] Oda kur/katıl akışına HİÇ dokunmuyor — üçüncü, bağımsız bir yol. Eşleşme
  // gerçekleşirse sunucu ayrıca `matchmaking:matched` gönderir (bkz. aşağıdaki socket.on).
  async quickMatch(name, draftMode, playerPool) {
    state.name = name;
    sessionStorage.setItem(LS_NAME, name);
    const res = await emitAck('matchmaking:join', { clientId: state.clientId, clientSecret: state.clientSecret, name, draftMode, playerPool });
    if (res.error) return toast('Eşleşmeye girilemedi: ' + (ROOM_ERRORS[res.error] || res.error));
    state.matchmaking = { draftMode, playerPool };
    pushDataLayer('matchmaking_join', { draft_mode: draftMode, player_pool: playerPool });
    route();
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — BİLGİSAYARA KARŞI] Oyuncu + bot ile oda kurulur, draft
  // sunucuda hemen başlar; oda verisi createRoom'daki gibi ack'ten gelir.
  async playVsBot(name, draftMode, playerPool) {
    state.name = name;
    sessionStorage.setItem(LS_NAME, name);
    const res = await emitAck('room:createBot', { clientId: state.clientId, clientSecret: state.clientSecret, name, draftMode, playerPool });
    if (res.error) return toast('Oyun başlatılamadı: ' + (ROOM_ERRORS[res.error] || res.error));
    state.room = res.room;
    setCode(res.room.code);
    pushDataLayer('bot_game_start', { draft_mode: draftMode, player_pool: playerPool });
    syncUrlToRoomMode(res.room);
    route();
  },
  async cancelQuickMatch() {
    await emitAck('matchmaking:leave', {});
    state.matchmaking = null;
    route();
  },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] Socket değil, düz fetch — diğer
  // /api/auth/* aksiyonlarıyla AYNI desen.
  async resendVerification() {
    const res = await fetch('/api/auth/resendVerification', { method: 'POST' }).then((r) => r.json());
    if (res.error) {
      const messages = { ALREADY_VERIFIED: 'E-postan zaten doğrulanmış.', RATE_LIMITED: 'Çok fazla denedin, biraz sonra tekrar dene.', NOT_LOGGED_IN: 'Önce giriş yapmalısın.' };
      toast(messages[res.error] || res.error);
      return res;
    }
    toast('Doğrulama e-postası yeniden gönderildi — gelmezse spam/gereksiz klasörüne bak.');
    return res;
  },
};

// Rematch sırasında (hem başlatan hem rakip tarafında) önceki draft/dizilim/maç durumunun
// kalıntısı kalmasın diye tüm eşleşme-özel istemci durumu sıfırlanır.
function resetMatchLocalState() {
  state.draft = null;
  state.draftHistory = [];
  state.lastHighBidder = null;
  state.trade = null;
  state.tradeUi = null;
  state.blindBidUi = null;
  state.lineupOptions = null;
  state.lineupUi = null;
  state.lineupSubmitted = {};
  state.matchResult = null;
  state.matchPlayback = null;
  state.matchResultUi = null;
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] "Kör İlk Tur" tüketim durumu bir
  // sonraki draftta (rematch) sıfırdan başlamalı — sunucu tarafında da p.prepPerk resetForRematch
  // ile null'a dönüyor (bkz. RoomManager.js).
  state.blindFirstRoundConsumed = false;
  state.blindFirstRoundKey = null;
}

socket.on('connect', async () => {
  const wasOffline = everConnected && state.connected === false;
  everConnected = true;
  state.connected = true;
  if (wasOffline) { sfx.play('online'); toast('🟢 Bağlantı geri geldi.'); }
  if (!state.config) {
    try { state.config = await fetch('/api/config').then((r) => r.json()); } catch (e) { /* ignore */ }
  }
  if (state.code) {
    const res = await emitAck('room:reconnect', { clientId: state.clientId, clientSecret: state.clientSecret, code: state.code });
    if (res.error) {
      toast('Odaya yeniden bağlanılamadı: ' + (ROOM_ERRORS[res.error] || res.error));
      setCode(null);
    } else {
      state.room = res.room;
      // [KULLANICI İSTEĞİ, BUG FIX] Sayfa yenilenince (reconnect) URL de odanın gerçek
      // draftMode'una göre senkronlansın — bkz. syncUrlToRoomMode.
      syncUrlToRoomMode(res.room);
    }
  }
  route();
});

socket.on('disconnect', () => {
  state.connected = false;
  // Kopuş anındaki seçim sayısını sakla (sadece gerçekten bağlanmışken anlamlı) — bağlantı dönünce "kaç tur kaçırdım" farkı için.
  if (state.draft) state.offlineSnapshot = { picks: totalPicks(state.draft), at: Date.now() };
  sfx.play('offline');
  updateTopbar();
});

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Giriş yapmışken hesabımı odadaki
// oyuncuma bağla (coin ödülü + takım/forma buna göre). Önce HTTP'den tek kullanımlık bilet alınır
// (güncel cookie), sonra socket ile kullanılır — bkz. server/src/auth/RoomTickets.js. Takım ya da
// forma değişince anahtar değiştiği için yeniden bağlanır (sunucu takımı/formayı DB'den okur).
// route() her çizimde çağırır; bağlıysa ve anahtar aynıysa hemen döner. Misafirde hiçbir şey
// gönderilmez.
function syncRoomAccount() {
  const me = state.room?.players?.find((p) => p.clientId === state.clientId);
  if (!me || !state.user) return;
  const wantTeam = state.user.favoriteTeam || null;
  const wantKit = wantTeam ? (state.user.favoriteKit || 'home') : null;
  // [MAĞAZA v2] Kozmetik ya da satın alma (coin değişir → yeni tepki paketi olabilir) de yeniden bağlar.
  const key = `${state.room.code}:${state.user.id}:${wantTeam}:${wantKit}:${JSON.stringify(state.user.cosmetics || {})}:${(state.store && state.store.owned || []).length}`;
  const s = syncRoomAccount;
  if ((me.accountLinked && s._done === key) || s._pending === key || s._failed === key) return;
  s._pending = key;
  (async () => {
    try {
      const t = await fetch('/api/rooms/ticket', { method: 'POST' }).then((r) => r.json());
      if (!t.ticket) { s._failed = key; return; }
      const res = await emitAck('room:bindAccount', { ticket: t.ticket });
      if (res && res.error) {
        s._failed = key;
        if (res.error === 'ACCOUNT_ALREADY_IN_ROOM') toast('Bu hesap odada başka bir oyuncuya zaten bağlı — bu odada coin kazanamazsın.');
      } else {
        s._done = key;
      }
    } catch (e) {
      s._failed = key;
    } finally {
      s._pending = null;
    }
  })();
}

socket.on('room:state', (room) => { state.room = room; route(); });
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Tepkiler — route() çağırmadan, üst katmanda.
socket.on('room:reaction', (msg) => showReaction(state, msg));

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Ödül maç HESAPLANIR hesaplanmaz
// gelir ama anlatım bitmeden gösterilmez (skoru önceden söylememek için) — bkz.
// revealCoinAwardIfReady. Üst bardaki bakiye de o ana kadar eski değerinde kalır.
socket.on('coins:awarded', (award) => { state.coinAward = { ...award, revealed: false }; route(); });

function revealCoinAwardIfReady() {
  const a = state.coinAward;
  if (!a || a.revealed || !state.matchResult || a.resultId !== state.matchResult.resultId) return;
  if (state.matchPlayback && !state.matchPlayback.done) return;
  a.revealed = true;
  if (state.user && typeof a.balance === 'number') state.user.coins = a.balance;
  if (a.earned > 0) {
    sfx.play('win');
    toast(`+${a.earned} coin kazandın!`);
  }
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ SONRASI FAZ 4] Asıl oda verisi zaten
// yukarıdaki `room:state` dinleyicisiyle geliyor (matchmaker sockets'i room.code'a join ettiriyor,
// draftEngine.startDraft kendi broadcast'ini yapıyor) — bu SADECE "artık aramıyorsun" sinyali.
socket.on('matchmaking:matched', ({ code }) => {
  state.matchmaking = null;
  setCode(code);
  pushDataLayer('matchmaking_matched');
  toast('⚡ Rakip bulundu!');
  route();
});

socket.on('room:ready', () => { toast('Oda doldu — draft başlatılabilir.'); route(); });

socket.on('room:rematch', () => {
  toast('Tekrar oyna — oda sıfırlandı, yeni draft başlatılabilir.');
  resetMatchLocalState();
  route();
});

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] Görünürlük "herkese açık" — kim ne
// perk aldığı (ya da risk almadan geçtiği) odadaki herkese toast olarak da bildiriliyor.
socket.on('prepWheel:resolved', ({ clientId, perk, auto }) => {
  const name = state.room?.players.find((p) => p.clientId === clientId)?.name || '?';
  if (!perk) {
    toast(auto ? `⏭ ${name} süre doldu, risksiz devam etti` : `⏭ ${name} risk almadan devam etti`);
  } else {
    toast(`🎡 ${name}: ${perk.label}${perk.detail ? ` (${perk.detail})` : ''}`);
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Çark çevirirken diğer kullanıcılar izleyebilsin" —
    // sunucu sonucu ATOMİK döndürüyor (sıra da hemen ilerliyor); istemci bilerek bir süre
    // gizleyip görsel çarkı döndürüyor (bkz. views.js renderPrepWheel). Broadcast HERKESE
    // (yaklaşık) aynı anda ulaştığı için tüm istemciler aynı anda aynı animasyonu izliyor.
    state.prepWheelSpin = { clientId, perk, startedAt: Date.now() };
  }
  route();
});

socket.on('draft:started', ({ formation }) => {
  state.draftHistory = [];
  sfx.play('start');
  toast(`Kura: ${formation} formasyonu ile draft başlıyor!`);
  pushDataLayer('draft_start', { formation, draft_mode: state.room?.draftMode, player_pool: state.room?.playerPool });
});

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kaskad açık arttırma — msg.event.backups artık her zaman
// boş (bkz. DraftEngine): bir aşama sadece TEK bir kazananı belirler, kaybedenler bir sonraki
// aşamanın kendi toast'unda ayrı ayrı görünür. backupsText bu yüzden fiilen hep boş string olur,
// ama olası eski/önbelleklenmiş bir event şekliyle uyumluluk için kod aynen bırakıldı.
function nameOf(clientId) {
  const p = state.room?.players.find((pp) => pp.clientId === clientId);
  return p ? p.name : '?';
}
socket.on('draft:update', (msg) => {
  state.draft = msg;

  // [KULLANICI İSTEĞİ] Bağlantı kopukken tamamlanan turlar — fark ilk gelen güncellemede bildirilir.
  if (state.offlineSnapshot) {
    const missed = totalPicks(msg) - state.offlineSnapshot.picks;
    if (missed > 0) toast(`⏭ Bağlantın kopukken ${missed} tur tamamlandı — geçmişten bakabilirsin.`);
    state.offlineSnapshot = null;
  }

  // [KULLANICI İSTEĞİ] Teklifin geçilince sesli/haptik uyarı (canlı açık arttırma).
  const round = msg.round;
  const highBidder = round ? round.highestBidderClientId : null;
  if (state.lastHighBidder === state.clientId && highBidder && highBidder !== state.clientId) {
    sfx.play('outbid');
  }
  state.lastHighBidder = highBidder || null;

  if (msg.event) {
    // [KULLANICI İSTEĞİ] "Kim neyi kaça aldı" — tur sonuçları istemcide biriktirilir.
    const ev = msg.event;
    const entry = { type: ev.type, at: Date.now(), slot: ev.slotType || null };
    if (ev.type === 'auction_resolved' || ev.type === 'blind_auction_resolved') {
      entry.clientId = ev.winnerClientId; entry.player = ev.main; entry.price = ev.price; entry.bids = ev.bids || null;
    } else if (ev.type === 'one_sided_assigned') {
      entry.clientId = ev.clientId; entry.player = ev.player; entry.price = ev.price;
    } else if (ev.type === 'joker_used') {
      entry.clientId = ev.clientId; entry.player = ev.player; entry.price = 0;
    } else if (ev.type === 'wheel_turn_resolved') {
      entry.clientId = ev.clientId; entry.player = ev.player; entry.price = 0; entry.band = ev.band || ev.revealValue || null;
    }
    if (entry.player) {
      state.draftHistory.push(entry);
      if (state.draftHistory.length > 80) state.draftHistory.shift();
      sfx.play(entry.clientId === state.clientId ? 'win' : 'gavel');
    }
    // [MAĞAZA v2] Açık arttırmayı kazananın satıldı damgası sesi (damganın kendisi views.js'te).
    if (msg.event.type === 'auction_resolved' || msg.event.type === 'blind_auction_resolved') {
      const st = cosmeticOf(state.room && state.room.players.find((p) => p.clientId === msg.event.winnerClientId), 'stamp');
      if (st) setTimeout(() => playStampSound(st), 260);
    }

    if (msg.event.type === 'auction_resolved' || msg.event.type === 'blind_auction_resolved') {
      const prefix = msg.event.type === 'blind_auction_resolved' ? '🔓 ' : '';
      const backupsText = (msg.event.backups || []).length
        ? ` — ${msg.event.backups.map((b) => `${nameOf(b.clientId)}→${b.player.name}`).join(', ')}`
        : '';
      toast(`${prefix}${nameOf(msg.event.winnerClientId)} → ${msg.event.main.name} (${msg.event.price}₺)${backupsText}`);
    } else if (msg.event.type === 'one_sided_assigned') {
      toast(`${nameOf(msg.event.clientId)} rakipsiz aldı: ${msg.event.player.name}`);
    } else if (msg.event.type === 'joker_used') {
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI "TAM SÜRÜM"] "🃏 Joker Turu" perk'i.
      toast(`🃏 ${nameOf(msg.event.clientId)} Joker Turu kullandı — ücretsiz: ${msg.event.player.name}`);
    } else if (msg.event.type === 'wheel_turn_resolved') {
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Segment türüne göre farklı toast
      // metni — özel aksiyonlar (çal/ver/şanssız tur) normal bir "band → oyuncu" seçiminden
      // görsel olarak da ayrışsın.
      const ev = msg.event;
      if (ev.segmentKind === 'steal') {
        toast(`🎁 ${nameOf(ev.clientId)}, ${nameOf(ev.fromClientId)}'den ${ev.player.name}'i çaldı!`);
      } else if (ev.segmentKind === 'give_best') {
        toast(`😱 ${nameOf(ev.clientId)}, en iyisi ${ev.player.name}'i ${nameOf(ev.toClientId)}'e verdi!`);
      } else if (ev.segmentKind === 'forced_worst') {
        toast(`💀 ${nameOf(ev.clientId)} şanssız turda ${ev.player.name}'i aldı`);
      } else if ((ev.segmentKind === 'league' || ev.segmentKind === 'nation' || ev.segmentKind === 'club') && ev.revealValue) {
        toast(`🎡 ${nameOf(ev.clientId)}: ${ev.revealValue} → ${ev.player.name}`);
      } else {
        toast(`🎡 ${nameOf(ev.clientId)}: ${ev.band} → ${ev.player.name}`);
      }
    }
  }
  route();
});

socket.on('draft:complete', () => {
  toast('Draft tamamlandı! Dizilim seçim aşamasına geçiliyor.');
  pushDataLayer('draft_complete');
});

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] Sunucu hata kodlarının Türkçe karşılıkları —
// kullanıcı "GOALKEEPER_NOT_TRADABLE" değil, ne olduğunu okumalı.
const TRADE_ERRORS = {
  TRADE_ROUND_NOT_ACTIVE: 'Takas turu kapalı.',
  TRADE_ROUND_OVER: 'Takas turunun süresi doldu.',
  INVALID_TARGET: 'Geçersiz rakip.',
  PLAYER_NOT_FOUND: 'Oyuncu bulunamadı.',
  PLAYER_NOT_IN_SQUAD: 'Bu oyuncu artık o kadroda değil.',
  PAIR_LIMIT_REACHED: 'Bu kişiyle takas limitin doldu.',
  GOALKEEPER_NOT_TRADABLE: 'Kaleciler takas edilemez.',
  PLAYER_LOCKED_IN_OFFER: 'Bu oyuncu başka bir teklifte kilitli.',
  PLAYER_ALREADY_TRADED: 'Oyuncu az önce takas edildi — teklif düştü.',
  SENDER_LINEUP_IMPOSSIBLE: 'Bu takastan sonra senin kadron hiçbir formasyon kuramaz.',
  RECEIVER_LINEUP_IMPOSSIBLE: 'Bu takastan sonra rakibin kadrosu hiçbir formasyon kuramaz.',
  OFFER_NOT_FOUND: 'Teklif bulunamadı.',
  NOT_YOUR_OFFER: 'Bu teklif sana ait değil.',
};

socket.on('trade:started', () => {
  sfx.play('start');
  toast('⇄ Takas turu açıldı — 5 dakika (herkes bitti derse daha erken kapanır).');
  route();
});

// Kişiye özel görünüm (pazarlık gizli) — bkz. TradeEngine.emitTrade.
socket.on('trade:state', (msg) => { state.trade = msg; route(); });

socket.on('trade:incoming', ({ from, give, get }) => {
  sfx.play('outbid');
  toast(`⇄ ${from} teklif etti: ${give} ⇄ ${get}`);
});

socket.on('trade:resolved', (record) => {
  const mine = record.aClientId === state.clientId || record.bClientId === state.clientId;
  sfx.play(mine ? 'trade' : 'sold');
  toast(`⇄ ${record.aName} ⇄ ${record.bName}: ${record.aGave.name} ⇄ ${record.bGave.name}`);
  // Kadro değişti — dizilim seçenekleri (varsa) baştan alınmalı.
  state.lineupOptions = null;
  state.lineupUi = null;
  route();
});

socket.on('trade:cancelled', ({ give, get }) => {
  toast(`Teklifin düştü (${give} ⇄ ${get}) — oyuncu başka bir takasa gitti.`);
});

socket.on('trade:complete', ({ reason }) => {
  toast(reason === 'unanimous'
    ? 'Takas turu herkesin onayıyla kapandı — dizilim seçimine geçiliyor.'
    : 'Takas turu bitti — dizilim seçimine geçiliyor.');
  state.tradeUi = null;
  // Takaslar sonrası kadro değişmiş olabilir; dizilim seçenekleri taze çekilsin.
  state.lineupOptions = null;
  state.lineupUi = null;
  route();
});

socket.on('lineup:update', (msg) => {
  state.lineupSubmitted = msg.submitted || state.lineupSubmitted;
  route();
});

socket.on('match:ready', () => { toast('İki taraf da hazır — maç simüle edilebilir.'); route(); });

socket.on('match:result', (result) => { applyMatchResult(result); route(); });
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Hız/Sonuca Geç oy birliği sonucu — bkz. applyPlaybackSync.
socket.on('match:playbackSync', (sync) => { applyPlaybackSync(sync); route(); });

// İlk yüklemede state.page'i URL'den başlat ki "/players" ya da "/cark" gibi bir yola doğrudan
// girmek ya da sayfayı yenilemek doğru sayfayı (ve mod-URL'iyse önceden seçili draft modunu)
// göstersin (bkz. yukarıdaki pathForPage/popstate notu).
state.page = pageForPath(location.pathname);
syncLobbyUiForPage(state.page);
route();
// [YASAL — ÇEREZ ONAYI] Henüz seçim yapılmadıysa alt şeritte onay sor (bkz. legal.js).
mountConsentBanner(() => navigateToPage('privacy'));

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — E-POSTA DOĞRULAMA] E-postadaki doğrulama linki
// `/api/auth/verify`'ye gidip oradan `/giris?verified=1|0`'a REDIRECT ediyor (bkz. server
// index.js) — burada tek seferlik bir toast gösterip query string'i temizliyoruz (sayfa
// yenilenince toast tekrar çıkmasın diye).
const verifiedParam = new URLSearchParams(location.search).get('verified');
if (verifiedParam != null) {
  toast(verifiedParam === '1' ? '✅ E-posta doğrulandı!' : '⚠️ Doğrulama linki geçersiz ya da süresi dolmuş.');
  history.replaceState({}, '', location.pathname);
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — PAROLA SIFIRLAMA] E-postadaki link `/giris?reset=TOKEN`.
// Token state'e alınıp URL'den HEMEN siliniyor — adres çubuğunda/tarayıcı geçmişinde kalmasın,
// sayfadaki dış linklere Referer olarak sızmasın diye.
const resetParam = new URLSearchParams(location.search).get('reset');
if (resetParam) {
  state.authUi = { mode: 'reset', email: '', password: '', displayName: '', resetToken: resetParam };
  history.replaceState({}, '', location.pathname);
  route();
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — KULLANICI ÇEKME] "Tıkla-katıl" linki — bir arkadaşın
// paylaştığı `?join=KOD` linkine tıklayınca doğrudan "Odaya Katıl" formunu, kod alanı ÖNCEDEN
// DOLU olarak açar (bkz. views.js renderWaitingRoom `inviteText`) — WhatsApp/Discord'da
// paylaşmayı, elle kod yazmaktan çok daha az sürtünmeli hale getiriyor.
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) {
  if (!state.lobbyUi) state.lobbyUi = { mode: null, name: '', code: '', draftMode: 'live', playerPool: 'all', wheelSegments: [], prepWheelEnabled: false, tradeRoundEnabled: false, bankedPerksEnabled: false };
  state.lobbyUi.mode = 'join';
  state.lobbyUi.code = joinParam.toUpperCase();
  history.replaceState({}, '', location.pathname);
  route();
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HESAP SİSTEMİ, FAZ 1] "Ben kimim" — ilk render'ı
// BEKLETMEDEN (misafir varsayımıyla anında çizilir), sonuç gelince giriş yapılmışsa üst bar/
// sayfa güncellenir. Cookie yoksa/geçersizse sunucu HATA değil `{user:null}` döner (bkz.
// GET /api/auth/me) — misafir zaten normal/beklenen bir durum.
fetch('/api/auth/me').then((r) => r.json()).then((json) => {
  state.user = json.user || null;
  // /magaza doğrudan açılınca mağaza bu cevaptan ÖNCE misafir olarak yüklenmiş olabilir.
  if (state.user) { state.store = null; state.storeError = null; }
  route();
}).catch(() => {});
