import { el, toast } from './helpers.js';
// [KULLANICI İSTEĞİ] ses + haptik geri bildirim (dosyasız, WebAudio) — bkz. sfx.js
import { sfx } from './sfx.js';
import { renderLobby, renderWaitingRoom, renderPrepWheel, renderDraft, renderTradeRound, renderLineup, renderMatch, renderMatchPlayback, renderPlayerDatabase, renderHowToPlay, isPrepWheelSpinActive } from './views.js';

const LS_CLIENT_ID = 'kk_clientId';
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

const state = {
  clientId: getOrCreateClientId(),
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
};
const PATH_TO_PAGE = Object.fromEntries(Object.entries(PAGE_PATHS).map(([page, path]) => [path, page]));
// draftMode ('live'/'blind'/'wheel') <-> ilgili lobi sayfası arasında çift yönlü eşleme —
// URL'den lobiye (doğrudan /cark'a girmek) ve lobiden URL'e (pill'e tıklamak) ikisi de bunu kullanır.
const DRAFT_MODE_BY_PAGE = { 'mode-live': 'live', 'mode-blind': 'blind', 'mode-wheel': 'wheel' };
const PAGE_BY_DRAFT_MODE = { live: 'mode-live', blind: 'mode-blind', wheel: 'mode-wheel' };

function pathForPage(page) { return PAGE_PATHS[page] || '/'; }
function pageForPath(pathname) { return PATH_TO_PAGE[pathname] || null; }

const PAGE_META = {
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
};
function metaFor(page) { return PAGE_META[page] || PAGE_META.default; }

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
  if (offline) {
    connBanner.textContent = state.room
      ? '🔌 Bağlantı koptu — yeniden bağlanılıyor. Sıra sana gelirse sunucu otomatik oynar.'
      : '🔌 Bağlantı koptu — yeniden bağlanılıyor...';
  }
}

// İlk bağlantı ile GERÇEK bir yeniden bağlanma ayrımı — sayfa ilk açılışta da
// state.connected false olduğu için, bu flag olmadan her açılış "bağlantı geri geldi" derdi.
let everConnected = false;

// Ses aç/kapat — üst bara bir kez enjekte edilir (bkz. sfx.js).
let sfxBtn = null;
function ensureSfxButton() {
  if (sfxBtn) return;
  const host = document.getElementById('topbarStatus');
  if (!host || !host.parentElement) return;
  sfxBtn = el('button', {
    type: 'button', class: 'sfx-toggle', title: 'Ses efektleri',
    onclick: () => { sfx.toggle(); syncSfxButton(); },
  });
  host.parentElement.appendChild(sfxBtn);
  syncSfxButton();
}
function syncSfxButton() {
  if (!sfxBtn) return;
  const on = sfx.isEnabled();
  sfxBtn.textContent = on ? '🔊' : '🔇';
  sfxBtn.classList.toggle('off', !on);
}

function updateTopbar() {
  ensureSfxButton();
  updateConnBanner();
  const bits = [];
  bits.push(state.connected ? '🟢 bağlı' : '🔴 bağlantı yok');
  if (state.code) bits.push(`Oda: ${state.code}`);
  if (state.name) bits.push(state.name);
  // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] Çark Modu'nda bütçe hiç kullanılmıyor — üst barda
  // gösterilmesi kafa karıştırıyordu.
  if (state.draft && state.draft.players && state.room && state.room.draftMode !== 'wheel') {
    const me = state.draft.players.find((p) => p.clientId === state.clientId);
    if (me) bits.push(`💰 ${me.budget}₺`);
  }
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] Draft sırasında sürekli aktif kalan
  // perk'ler (anti_snipe_shield/ceiling_reduction/free_backup henüz kullanılmadıysa) unutulmasın
  // diye üst barda hep görünür — anlık etkiler (bütçe +/-, kumarbaz) zaten bütçeye yansıdığı ve
  // bir daha bir şey "beklemediği" için burada AYRICA gösterilmiyor.
  if (state.room && state.room.status === 'draft') {
    const mePerk = state.room.players.find((p) => p.clientId === state.clientId)?.prepPerk;
    if (mePerk && mePerk.active) bits.push(`${mePerk.label}${mePerk.kind === 'free_backup' ? ' (kullanılmadı)' : ''}`);
  }
  topbarStatus.textContent = bits.join('  ·  ');
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
  const savedFocus = captureFocus();
  const prevViewKey = route._viewKey;
  const prevScrollY = window.scrollY;
  appRoot.innerHTML = '';
  updateTopbar();
  updateHead();
  playersNavBtn.classList.toggle('active', state.page === 'players');
  howToPlayNavBtn.classList.toggle('active', state.page === 'how-to-play');
  // Zaten ana sayfadaysak (oda yoksa) ayrılacak bir şey yok — buton gizlensin.
  homeNavBtn.style.display = state.room ? '' : 'none';

  function finish() {
    restoreFocus(savedFocus);
    const newViewKey = currentViewKey();
    if (prevViewKey === newViewKey) window.scrollTo(0, prevScrollY);
    route._viewKey = newViewKey;
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
  finish();
}

const actions = {
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] wheelSegmentLabels: host'un elle
  // işaretlediği tam WHEEL_CUSTOM_PICK_COUNT etiket (bkz. views.js renderLobby wheel checklist'i)
  // ya da boş dizi/undefined (işaretlemediyse — sunucu auto-balance'a düşer).
  async createRoom(name, draftMode, playerPool, wheelSegmentLabels, prepWheelEnabled, tradeRoundEnabled) {
    state.name = name;
    sessionStorage.setItem(LS_NAME, name);
    const res = await emitAck('room:create', { clientId: state.clientId, name, draftMode, playerPool, wheelSegmentLabels, prepWheelEnabled, tradeRoundEnabled });
    if (res.error) return toast('Oda oluşturulamadı: ' + res.error);
    state.room = res.room;
    setCode(res.room.code);
    pushDataLayer('room_create', { draft_mode: draftMode, player_pool: playerPool, trade_round: !!tradeRoundEnabled });
    syncUrlToRoomMode(res.room);
    route();
  },
  async joinRoom(name, code) {
    state.name = name;
    sessionStorage.setItem(LS_NAME, name);
    const res = await emitAck('room:join', { clientId: state.clientId, name, code: code.toUpperCase() });
    if (res.error) return toast('Odaya katılınamadı: ' + res.error);
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
      const ok = window.confirm('Devam eden bir oyundasın. Odadan çıkarsan rakibin oyunda kalır, sen ana sayfaya döneceksin. Emin misin?');
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
    const res = await emitAck('room:reconnect', { clientId: state.clientId, code: state.code });
    if (res.error) {
      toast('Odaya yeniden bağlanılamadı: ' + res.error);
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

socket.on('room:state', (room) => { state.room = room; route(); });

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
      sfx.play(entry.clientId === state.clientId ? 'win' : 'sold');
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
  sfx.play(mine ? 'win' : 'sold');
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
