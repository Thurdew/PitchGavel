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

const socket = io();
const appRoot = document.getElementById('app');
const topbarStatus = document.getElementById('topbarStatus');
const playersNavBtn = document.getElementById('playersNavBtn');
playersNavBtn.addEventListener('click', () => {
  state.page = state.page === 'players' ? null : 'players';
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
    route();
  },
  async joinRoom(name, code) {
    state.name = name;
    sessionStorage.setItem(LS_NAME, name);
    const res = await emitAck('room:join', { clientId: state.clientId, name, code: code.toUpperCase() });
    if (res.error) return toast('Odaya katılınamadı: ' + res.error);
    state.room = res.room;
    setCode(res.room.code);
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
    setCode(null);
    state.room = null;
    state.draft = null;
    state.blindBidUi = null;
    state.matchResult = null;
    state.matchPlayback = null;
    state.matchResultUi = null;
    state.page = null;
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

socket.on('draft:started', ({ formation }) => { toast(`Kura: ${formation} formasyonu ile draft başlıyor!`); });

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

socket.on('draft:complete', () => { toast('Draft tamamlandı! Dizilim seçim aşamasına geçiliyor.'); });

socket.on('lineup:update', (msg) => {
  state.lineupSubmitted = msg.submitted || state.lineupSubmitted;
  route();
});

socket.on('match:ready', () => { toast('İki taraf da hazır — maç simüle edilebilir.'); route(); });

socket.on('match:result', (result) => { applyMatchResult(result); route(); });

route();
