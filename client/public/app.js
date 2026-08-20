import { el, toast } from './helpers.js';
import { renderLobby, renderWaitingRoom, renderDraft, renderLineup, renderMatch, renderMatchPlayback, renderPlayerDatabase } from './views.js';

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
};

// Sonuç sunucudan geldiğinde direkt göstermek yerine anlatım oynatmasını başlatır.
// İki kez tetiklenebilir (ack cevabı + broadcast) — ikinci seferde playback zaten
// kurulu olduğu için (state.matchPlayback dolu) elden geçirilmez, kullanıcı akışı bozulmaz.
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — sonuç artık {fixtures, standings}
// şeklinde (N>2 odada birden fazla eşleşme oynanır); anlatım tüm fixtures[] listesini sırayla
// (her biri kendi match1 -> match2 sırasıyla) oynatır.
function applyMatchResult(result) {
  state.matchResult = result;
  if (!state.matchPlayback) {
    pushDataLayer('match_result', { fixtures_count: (result.fixtures || []).length });
    state.matchPlayback = {
      fixtureIndex: 0,
      matchIndex: 0,
      clock: 0,
      shown: [],
      score: { home: 0, away: 0 },
      speed: 'slow',
      done: false,
      pendingReveal: null, // [KULLANICI İSTEĞİ] gerilim akışı — bkz. views.js renderMatchPlayback
    };
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

playersNavBtn.addEventListener('click', () => {
  navigateToPage(state.page === 'players' ? null : 'players');
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
function updateTopbar() {
  const bits = [];
  bits.push(state.connected ? '🟢 bağlı' : '🔴 bağlantı yok');
  if (state.code) bits.push(`Oda: ${state.code}`);
  if (state.name) bits.push(state.name);
  if (state.draft && state.draft.players) {
    const me = state.draft.players.find((p) => p.clientId === state.clientId);
    if (me) bits.push(`💰 ${me.budget}₺`);
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
function captureFocus() {
  const active = document.activeElement;
  if (!active || !appRoot.contains(active)) return null;
  const key = active.getAttribute && active.getAttribute('data-focus-key');
  if (!key) return null;
  return {
    key,
    selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
  };
}
function restoreFocus(saved) {
  if (!saved) return;
  const el2 = appRoot.querySelector(`[data-focus-key="${saved.key}"]`);
  if (!el2) return;
  el2.focus();
  if (saved.selectionStart != null && el2.setSelectionRange) {
    try { el2.setSelectionRange(saved.selectionStart, saved.selectionEnd); } catch (e) { /* metin dışı input (ör. number) — yok say */ }
  }
}

function route() {
  const savedFocus = captureFocus();
  appRoot.innerHTML = '';
  updateTopbar();
  updateHead();
  playersNavBtn.classList.toggle('active', state.page === 'players');
  // Zaten ana sayfadaysak (oda yoksa) ayrılacak bir şey yok — buton gizlensin.
  homeNavBtn.style.display = state.room ? '' : 'none';

  if (state.page === 'players') {
    appRoot.appendChild(renderPlayerDatabase({ state, actions }));
    restoreFocus(savedFocus);
    return;
  }

  if (!state.room) {
    appRoot.appendChild(renderLobby({ state, actions }));
    restoreFocus(savedFocus);
    return;
  }

  switch (state.room.status) {
    case 'lobby':
      appRoot.appendChild(renderWaitingRoom({ state, actions }));
      break;
    case 'draft':
      appRoot.appendChild(renderDraft({ state, actions }));
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
  restoreFocus(savedFocus);
}

const actions = {
  async createRoom(name, draftMode, playerPool) {
    state.name = name;
    sessionStorage.setItem(LS_NAME, name);
    const res = await emitAck('room:create', { clientId: state.clientId, name, draftMode, playerPool });
    if (res.error) return toast('Oda oluşturulamadı: ' + res.error);
    state.room = res.room;
    setCode(res.room.code);
    pushDataLayer('room_create', { draft_mode: draftMode, player_pool: playerPool });
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
    const isActive = room && ['draft', 'squad_select', 'match'].includes(room.status);
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
    state.page = null;
    if (location.pathname !== '/') history.pushState({ page: null }, '', '/');
    route();
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
  async submitBid(amount) {
    const res = await emitAck('draft:bid', { code: state.code, amount });
    if (res.error) toast('Teklif reddedildi: ' + res.error);
    else pushDataLayer('bid_placed', { amount });
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
  state.blindBidUi = null;
  state.lineupOptions = null;
  state.lineupUi = null;
  state.lineupSubmitted = {};
  state.matchResult = null;
  state.matchPlayback = null;
  state.matchResultUi = null;
}

socket.on('connect', async () => {
  state.connected = true;
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
    }
  }
  route();
});

socket.on('disconnect', () => { state.connected = false; updateTopbar(); });

socket.on('room:state', (room) => { state.room = room; route(); });

socket.on('room:ready', () => { toast('Oda doldu — draft başlatılabilir.'); route(); });

socket.on('room:rematch', () => {
  toast('Tekrar oyna — oda sıfırlandı, yeni draft başlatılabilir.');
  resetMatchLocalState();
  route();
});

socket.on('draft:started', ({ formation }) => {
  toast(`Kura: ${formation} formasyonu ile draft başlıyor!`);
  pushDataLayer('draft_start', { formation, draft_mode: state.room?.draftMode, player_pool: state.room?.playerPool });
});

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — round sonucu artık tek bir "loser"
// değil, ranking sırasına göre dağıtılan bir "backups" listesi taşıyor (bkz. DraftEngine).
function nameOf(clientId) {
  const p = state.room?.players.find((pp) => pp.clientId === clientId);
  return p ? p.name : '?';
}
socket.on('draft:update', (msg) => {
  state.draft = msg;
  if (msg.event) {
    if (msg.event.type === 'auction_resolved' || msg.event.type === 'blind_auction_resolved') {
      const prefix = msg.event.type === 'blind_auction_resolved' ? '🔓 ' : '';
      const backupsText = (msg.event.backups || []).length
        ? ` — ${msg.event.backups.map((b) => `${nameOf(b.clientId)}→${b.player.name}`).join(', ')}`
        : '';
      toast(`${prefix}${nameOf(msg.event.winnerClientId)} → ${msg.event.main.name} (${msg.event.price}₺)${backupsText}`);
    } else if (msg.event.type === 'one_sided_assigned') {
      toast(`${nameOf(msg.event.clientId)} rakipsiz aldı: ${msg.event.player.name}`);
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
      } else if ((ev.segmentKind === 'league' || ev.segmentKind === 'nation') && ev.revealValue) {
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

socket.on('lineup:update', (msg) => {
  state.lineupSubmitted = msg.submitted || state.lineupSubmitted;
  route();
});

socket.on('match:ready', () => { toast('İki taraf da hazır — maç simüle edilebilir.'); route(); });

socket.on('match:result', (result) => { applyMatchResult(result); route(); });

// İlk yüklemede state.page'i URL'den başlat ki "/players" ya da "/cark" gibi bir yola doğrudan
// girmek ya da sayfayı yenilemek doğru sayfayı (ve mod-URL'iyse önceden seçili draft modunu)
// göstersin (bkz. yukarıdaki pathForPage/popstate notu).
state.page = pageForPath(location.pathname);
syncLobbyUiForPage(state.page);
route();
