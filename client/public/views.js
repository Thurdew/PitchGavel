import { sfx } from './sfx.js';
import { el, toast, playerCard, squadChip, slotGroup, fmtMoney, countUpMoney, fmtRatingSource, ratingSourceTitle } from './helpers.js';

// [KULLANICI İSTEĞİ] "Oyundayken oyundan çıkmak için bir şey ekle" — üst bardaki genel
// "🏠 Ana Sayfa" butonuna (bkz. index.html/app.js) ek olarak, oyunun İÇİNDEYKEN (draft/dizilim)
// bağlamsal bir çıkış kontrolü — actions.leaveRoom() zaten devam eden bir oyunda onay istiyor
// (bkz. app.js), burada sadece o aksiyona bağlanan küçük bir buton üretiliyor.
function leaveGameButton(actions) {
  return el('button', {
    type: 'button', class: 'btn small secondary',
    onclick: () => actions.leaveRoom(),
  }, '🚪 Oyundan Çık');
}

// ============================== LOBBY ==============================
// [KULLANICI İSTEĞİ] "İki farklı kutu değilde tek kutuda göster. Oda kur veya odaya katıl
// seçeneği koy. Değer seçildikten sonra ad ve kod yazma yeri gelsin." — önce tek bir kartta
// mod seçimi (Oda Kur / Odaya Katıl), seçim yapılınca altında ilgili alanlar açılıyor.

// [KULLANICI İSTEĞİ] "Son 3 saniye" sesi — geri sayım tick'i 150ms'de bir çalıştığı için
// saniye başına tek bir bip çalınsın diye en son çalınan saniye hatırlanıyor.
let lastTickSecond = null;
function countdownTick(leftMs) {
  const sec = Math.ceil(leftMs / 1000);
  if (sec === lastTickSecond) return;
  lastTickSecond = sec;
  if (sec <= 0 || sec > 3) return;
  sfx.play(sec === 1 ? 'tickLast' : 'tick');
}

// [KULLANICI İSTEĞİ] "Bütçe ve boş slot hatalarını önceden göster" — kullanıcı tavana çarpıp
// 'Reddedildi' görmeden ÖNCE: kalan bütçe, kaç slot doldurulacak, her biri için ayrılan asgari
// tutar ve güvenli tavan tek bir blokta; tavana yaklaşınca blok uyarı rengine geçer.
function bidGuard({ state, cap, planned }) {
  const d = state.draft;
  const me = d && d.players ? d.players.find((p) => p.clientId === state.clientId) : null;
  if (!me) return null;
  const minPrice = state.config?.MIN_PLAYER_PRICE || 10;
  const slotsLeft = Math.max(0, me.remainingSlots || 0);
  const reserved = Math.max(0, (slotsLeft - 1)) * minPrice;
  const ratio = cap > 0 && planned ? planned / cap : 0;
  const level = cap <= minPrice ? 'danger' : ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warn' : '';

  const rows = [
    ['Kalan bütçe', fmtMoney(me.budget)],
    ['Doldurulacak slot', `${slotsLeft} oyuncu`],
    ['Diğer slotlara ayrılan', fmtMoney(reserved)],
    ['Güvenli tavan', fmtMoney(Math.max(0, cap))],
  ];
  const notes = [];
  if (cap <= minPrice) notes.push(`Bütçen bitti: kalan ${slotsLeft} slot için asgari fiyatı korumak zorundasın, bu turda yükselemezsin.`);
  else if (ratio >= 1) notes.push('Yazdığın teklif güvenli tavanın üstünde — sunucu reddeder.');
  else if (ratio >= 0.8) notes.push('Tavanın %80\'ini geçtin. Bu turu alırsan kalan slotlar için sadece asgari fiyat kalır.');
  if (slotsLeft > 1) notes.push(`Kalan ${slotsLeft - 1} slot için ${fmtMoney(reserved)} bloke — bu tutara teklif veremezsin.`);

  return el('div', { class: `bid-guard ${level}` }, [
    el('div', { class: 'bid-guard-grid' }, rows.map(([k, val]) => el('div', { class: 'bid-guard-cell' }, [
      el('span', { class: 'bid-guard-k' }, k),
      el('span', { class: 'bid-guard-v' }, val),
    ]))),
    notes.length ? el('div', { class: 'bid-guard-note' }, notes.join(' ')) : null,
  ]);
}

// [KULLANICI İSTEĞİ] "Draft geçmişi — kim neyi kaça aldı" — sunucu geçmiş tutmadığı için
// app.js draft:update sırasında biriktiriyor (state.draftHistory). Hem draft sırasında hem
// draft bittikten sonra (dizilim ekranı) aynı panel kullanılıyor.
export function draftHistoryPanel(state, { open = false } = {}) {
  const items = (state.draftHistory || []).slice().reverse();
  const nameOf = (id) => (state.room?.players.find((p) => p.clientId === id) || {}).name || '?';
  if (!state.draftUi) state.draftUi = { squadsOpen: false, historyOpen: open };
  const spent = {};
  for (const h of items) spent[h.clientId] = (spent[h.clientId] || 0) + (h.price || 0);

  return el('details', {
    class: 'panel draft-history',
    open: state.draftUi.historyOpen ? '' : undefined,
    ontoggle: (e) => { state.draftUi.historyOpen = e.target.open; },
  }, [
    el('summary', {}, `Draft Geçmişi (${items.length} tur)`),
    items.length === 0
      ? el('div', { class: 'muted', style: 'margin-top:10px' }, 'Henüz tamamlanmış bir tur yok.')
      : el('div', { class: 'dh-wrap' }, [
          el('div', { class: 'dh-totals' }, Object.keys(spent).map((id) => el('div', { class: `dh-total ${id === state.clientId ? 'me' : ''}` }, [
            el('span', { class: 'dh-total-name' }, nameOf(id) + (id === state.clientId ? ' (sen)' : '')),
            el('span', { class: 'dh-total-v' }, fmtMoney(spent[id])),
          ]))),
          el('div', { class: 'dh-list' }, items.map((h) => el('div', { class: `dh-row ${h.clientId === state.clientId ? 'me' : ''}` }, [
            el('span', { class: `pos-badge pos-${slotGroup(h.slot || (h.player && h.player.position) || 'CM')}` }, h.slot || (h.player && h.player.position) || '—'),
            el('span', { class: 'dh-player' }, [
              el('b', {}, h.player ? h.player.name : '—'),
              el('span', { class: 'dh-rating' }, h.player ? String(h.player.rating) : ''),
            ]),
            el('span', { class: 'dh-buyer' }, nameOf(h.clientId) + (h.clientId === state.clientId ? ' (sen)' : '')),
            el('span', { class: `dh-price ${!h.price ? 'free' : ''}` }, h.price ? fmtMoney(h.price) : (h.band ? h.band : 'ücretsiz')),
          ]))),
        ]),
  ]);
}

export function renderLobby({ state, actions }) {
  if (!state.lobbyUi) state.lobbyUi = { mode: null, name: '', code: '', draftMode: 'live', playerPool: 'all', wheelSegments: [], prepWheelEnabled: false, tradeRoundEnabled: false };
  const ui = state.lobbyUi;

  const nameInput = el('input', {
    type: 'text', maxlength: '24', value: ui.name || state.name, placeholder: 'Adın',
    oninput: (e) => { ui.name = e.target.value; },
  });
  const codeInput = el('input', {
    type: 'text', maxlength: '5', placeholder: 'ODA KODU', style: 'text-transform:uppercase',
    value: ui.code, oninput: (e) => { ui.code = e.target.value; },
  });

  function submit() {
    if (!nameInput.value.trim()) return toast('Önce adını yaz.');
    if (ui.mode === 'create') {
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] Ya hiç seçilmemiş (auto-balance)
      // ya da TAM WHEEL_CUSTOM_PICK_COUNT seçilmiş olmalı — arada bir sayı gönderirsek sunucu
      // zaten sessizce auto-balance'a düşer (bkz. RoomManager._sanitizeWheelSegmentLabels), ama
      // kullanıcıya "yarım bıraktın" diye burada erken haber vermek daha iyi bir deneyim.
      const need = state.config?.WHEEL_CUSTOM_PICK_COUNT || 10;
      const picked = ui.wheelSegments || [];
      if (ui.draftMode === 'wheel' && picked.length > 0 && picked.length !== need) {
        return toast(`Çark segmentlerinde ya tam ${need} tane seç ya da hiç seçme (sistem dengeli bir çark kursun).`);
      }
      actions.createRoom(nameInput.value.trim(), ui.draftMode, ui.playerPool, picked, ui.prepWheelEnabled, ui.tradeRoundEnabled);
    } else {
      if (!codeInput.value.trim()) return toast('Oda kodunu gir.');
      actions.joinRoom(nameInput.value.trim(), codeInput.value.trim());
    }
  }
  const submitOnEnter = (e) => { if (e.key === 'Enter') submit(); };
  nameInput.addEventListener('keydown', submitOnEnter);
  codeInput.addEventListener('keydown', submitOnEnter);

  // [KULLANICI İSTEĞİ] "URL'leri her sayfa için farklı yap... çark modunda pitchgavel/çark
  // gibi" — mod seçimi artık URL ile senkron (bkz. app.js selectLobbyMode/navigateToPage);
  // Oyuncu Havuzu (Tek Lig Modu) bu kapsamın dışında bırakıldı, sadece draft modu (Canlı/Kör/
  // Çark) ayrı bir URL alıyor — istenen "hangi oyun modu daha çok oynanıyor" ölçümü için yeterli.
  function selectMode(mode) { actions.selectLobbyMode(mode); }
  function selectDraftMode(draftMode) {
    ui.draftMode = draftMode;
    actions.navigateToPage(draftMode === 'wheel' ? 'mode-wheel' : draftMode === 'blind' ? 'mode-blind' : 'mode-live');
  }
  function selectPlayerPool(playerPool) { ui.playerPool = playerPool; actions.route(); }

  // [KULLANICI İSTEĞİ] "Oda kur/katıl ekranları güzel gözükmüyor, çok kalabalık duruyor" —
  // önceden bir mod seçilince (Oda Kur/Odaya Katıl) ÜSTTEKİ büyük kart çifti tam boyutta
  // kalmaya devam ediyor, ALTINDA da Draft Modu ve Oyuncu Havuzu için AYNI büyük kart deseni
  // (ikon+başlık+açıklama) tekrarlanıyordu — 3 büyük kart grubu üst üste. Artık: (1) üstteki
  // mod kartları SADECE seçim yapılmadan önce görünüyor (seçilince kompakt başlık zaten
  // "➕ Oda Kur" diyor, tekrar göstermeye gerek yok). (2) Draft Modu/Oyuncu Havuzu artık büyük
  // kart değil, dizilim ekranındaki formasyon seçiciyle AYNI kompakt "hap" (pill) düğmeler —
  // açıklama metni native tooltip'e (title) taşındı, ekranda ayrı bir satır kaplamıyor.
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Lobi ekranı çok çok çok kötü" — "01"/"02" numaraları
  // Oda Kur/Odaya Katıl'ın birbirini takip eden bir SIRA değil, birbirini DIŞLAYAN iki seçenek
  // olduğu gerçeğiyle çelişiyordu (yanlış bir "önce bunu sonra onu yap" hissi veriyordu).
  // Numaralar yerine artık markanın kendi motifi: 🔨 (PitchGavel'in "gavel"i — yeni bir açık
  // arttırma AÇMAK) ve 🎫 (elindeki kodla girmek, bir bilet gibi). `big` bayrağı bu ekrandaki
  // İKİ karta (bu sayfanın tek gerçek kararı) daha fazla görsel ağırlık veriyor — Nasıl Oynanır
  // sayfasındaki kompakt 3'lü mod listesi (lobbyModeCardLink) aynı temel bileşeni küçük haliyle
  // kullanmaya devam ediyor.
  function lobbyModeCard(icon, label, desc, onClick, big) {
    return el('button', { class: `lobby-mode-btn ${big ? 'big' : ''}`, onclick: onClick }, [
      el('div', { class: 'lobby-mode-num' }, icon),
      el('div', { class: 'lobby-mode-body' }, [
        el('div', { class: 'lobby-mode-label-row' }, [
          el('div', { class: 'lobby-mode-label' }, label),
          el('div', { class: 'lobby-mode-arrow' }, '→'),
        ]),
        el('div', { class: 'lobby-mode-desc' }, desc),
      ]),
    ]);
  }

  const modePicker = ui.mode ? null : el('div', { class: 'lobby-mode-picker' }, [
    lobbyModeCard('🔨', 'Oda Kur', 'Yeni bir açık arttırma başlat, kodu rakibine gönder', () => selectMode('create'), true),
    lobbyModeCard('🎫', 'Odaya Katıl', 'Rakibinden aldığın kodla gir', () => selectMode('join'), true),
  ]);

  // Kompakt hap-düğme grubu — bkz. yukarıdaki not. Dizilim ekranındaki `.formation-pick`/
  // `.formation-option` ile AYNI sınıfları kullanıyor (yeni CSS gerekmiyor, görsel tutarlılık).
  // [KULLANICI İSTEĞİ] "İlk ekranda kötü, modlara bilgilendiriciler ekleyelim" — açıklama
  // sadece hover tooltip'inde kalınca (bkz. önceki tur) bilgi görünmez oluyordu; artık SEÇİLİ
  // seçeneğin açıklaması düğmelerin altında tek satır, hep görünür bir ipucu olarak duruyor —
  // hem kompakt hem bilgilendirici (tam kart kadar yer kaplamıyor, ama bilgi kaybolmuyor).
  function pillToggle(label, options, current, onSelect) {
    const activeDesc = (options.find((o) => o[0] === current) || options[0])[2];
    return el('div', { class: 'field' }, [
      el('label', {}, label),
      el('div', { class: 'formation-pick' }, options.map(([value, text, desc]) => el('button', {
        type: 'button',
        class: `formation-option ${current === value ? 'selected' : ''}`,
        title: desc,
        onclick: () => onSelect(value),
      }, text))),
      el('div', { class: 'pill-hint' }, activeDesc),
    ]);
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft / Çark Modu — sadece host, oda kurarken seçer;
  // oda ömrü boyunca sabit kalır (bkz. claude.md "Ek Mod Fikirleri" / RoomManager.createRoom).
  const draftModePicker = ui.mode === 'create' ? pillToggle('Draft Modu', [
    ['live', '⏱️ Canlı Açık Arttırma', 'Teklifler anlık görünür, süre bitene kadar yükselir'],
    ['blind', '🙈 Kör Draft', 'Tek seferlik gizli teklif — rakibinkini göremezsin'],
    ['wheel', '🎡 Çark Modu', 'Bütçe yok — sırayla çark çevirip çıkan reyting bandından ücretsiz seç'],
  ], ui.draftMode, selectDraftMode) : null;

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Tek Lig Modu — draftMode'dan bağımsız ikinci bir
  // anahtar: havuzu Süper Lig + Türk icon'lara daraltır (bkz. claude.md "Ek Mod Fikirleri" /
  // RoomManager.createRoom / draft/pool.js).
  const playerPoolPicker = ui.mode === 'create' ? pillToggle('Oyuncu Havuzu', [
    ['all', '🌍 Tüm Ligler', 'Süper Lig + büyük 5 Avrupa ligi + tüm icon\'lar'],
    ['super-lig', '🇹🇷 Süper Lig', 'Sadece Süper Lig kadroları + Türk icon\'lar'],
  ], ui.playerPool, selectPlayerPool) : null;

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] "10 zorunlu seçim olacak, hepsini
  // iyi seçer ister kötü seçer ister karışık yapar, o kullanıcının bileceği iş... kullanıcı
  // seçmek istemezse bilgisayar dengeli bir şekilde atama yapar." — Çark Modu seçiliyken, host
  // WHEEL_SEGMENT_CATALOG'daki 13 olası segmentten (7 reyting bandı + 6 özel aksiyon) istediği
  // TAM WHEEL_CUSTOM_PICK_COUNT tanesini serbestçe işaretleyebilir (pool zorunluluğu YOK); hiç
  // işaretlemezse sunucu eski dengeli-rastgele çarkı kurar (bkz. pool.js buildWheelSegments).
  function wheelSegmentPicker() {
    if (ui.mode !== 'create' || ui.draftMode !== 'wheel') return null;
    const catalog = state.config?.WHEEL_SEGMENT_CATALOG || [];
    const need = state.config?.WHEEL_CUSTOM_PICK_COUNT || 10;
    if (catalog.length === 0) return null; // config henüz yüklenmediyse checklist'i gösterme — auto-balance zaten çalışır
    if (!ui.wheelSegments) ui.wheelSegments = [];
    const picked = ui.wheelSegments;

    const poolMeta = { iyi: '🟢 İyi', orta: '🟠 Orta', kötü: '🔴 Kötü' };
    const groups = ['iyi', 'orta', 'kötü'].map((poolKey) => el('div', { class: 'wheel-seg-group' }, [
      el('div', { class: 'wheel-seg-group-label' }, poolMeta[poolKey]),
      el('div', { class: 'formation-pick' }, catalog.filter((s) => s.pool === poolKey).map((s) => {
        const isOn = picked.includes(s.label);
        return el('button', {
          type: 'button',
          class: `formation-option ${isOn ? 'selected' : ''}`,
          onclick: () => {
            if (isOn) {
              ui.wheelSegments = picked.filter((l) => l !== s.label);
            } else {
              if (picked.length >= need) { toast(`En fazla ${need} tane seçebilirsin.`); return; }
              ui.wheelSegments = [...picked, s.label];
            }
            actions.route();
          },
        }, s.label);
      })),
    ]));

    const count = picked.length;
    const hint = count === 0
      ? `İstersen tam ${need} tanesini kendin seç (hepsi iyi, hepsi kötü ya da karışık — sen bilirsin) — hiç seçmezsen sistem dengeli bir çark kurar.`
      : count === need
        ? `✅ ${count}/${need} seçildi — bu odanın çarkı bu ${need} dilimden oluşacak.`
        : `${count}/${need} seçildi — devam etmek için ya tam ${need} tane seç ya da hepsini kaldır (sistem seçsin).`;

    return el('div', { class: 'field' }, [
      el('label', {}, `Çark Segmentleri (isteğe bağlı — ${count}/${need})`),
      ...groups,
      el('div', { class: 'pill-hint' }, hint),
    ]);
  }
  const wheelSegmentPickerEl = wheelSegmentPicker();

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] "Bu kör draft ve açık arttırma için
  // geçerli... bu çark eklentisi isteğe bağlı olsun, lobide moderatör (host) karar verir." —
  // Çark Modu'nda hiç anlamlı olmadığı için (o modun zaten kendi çarkı var) sadece live/blind'te
  // gösteriliyor. Her oyuncunun kendi çevirip çevirmeyeceği (risk) DRAFT SIRASINDA ayrı bir
  // karar — bu toggle sadece "bu odada bu eklenti var mı yok mu"yu belirliyor.
  const prepWheelToggle = (ui.mode === 'create' && ui.draftMode !== 'wheel') ? pillToggle('Hazırlık Çarkı', [
    [false, 'Kapalı', 'Draft doğrudan formasyon kurasıyla başlar — ekstra bir şey yok'],
    [true, '🎡 Açık', 'Formasyon kurasından önce herkes SIRAYLA (bir bir) İSTEĞE BAĞLI bir perk çarkı çevirir — çıkan bütçe/kalkan/joker gibi iyi/kötü etkiler herkese açık gösterilir. Çevirmek zorunlu değil, risksiz başlamak da her zaman mümkün'],
  ], !!ui.prepWheelEnabled, (v) => { ui.prepWheelEnabled = v; actions.route(); }) : null;

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] "Çark gibi isteğe bağlı özellik olarak
  // gelsin, 3 modda da geçerli olsun." — Hazırlık Çarkı'nın aksine mod kısıtı YOK; çark modunda
  // da draft sonunda kadrolar hazır olduğu için takas aynen anlamlı.
  const tradeRoundToggle = ui.mode === 'create' ? pillToggle('Takas Turu', [
    [false, 'Kapalı', 'Draft bitince doğrudan dizilim seçimine geçilir'],
    [true, '⇄ Açık', 'Draft bitince 5 dakikalık bir takas turu açılır: kadrondan bir oyuncu verip rakipten bir oyuncu alırsın (1↔1, para yok, kaleci hariç). Mevki serbest — orta saha verip forvet alıp formasyonunu değiştirebilirsin. Herkes "bitti" derse tur erken kapanır'],
  ], !!ui.tradeRoundEnabled, (v) => { ui.tradeRoundEnabled = v; actions.route(); }) : null;

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kullanıcı oynayacağını lobide sorma" — oda
  // kurulurken bir hedef oyuncu sayısı SORULMUYOR; oda kaç kişi gelirse gelsin (2-8) katılım
  // kabul eder, host odadaki herkes hazır olunca kendisi başlatır (bkz. renderWaitingRoom).

  const formSection = ui.mode ? el('div', { class: 'lobby-form' }, [
    el('div', { class: 'field' }, [el('label', {}, 'Adın'), nameInput]),
    ui.mode === 'join' ? el('div', { class: 'field' }, [el('label', {}, 'Oda Kodu'), codeInput]) : null,
    draftModePicker,
    playerPoolPicker,
    wheelSegmentPickerEl,
    prepWheelToggle,
    tradeRoundToggle,
    el('button', { class: 'btn block', onclick: submit }, ui.mode === 'create' ? 'Oda Kur' : 'Katıl'),
    el('button', { class: 'lobby-back', onclick: () => actions.selectLobbyMode(null) }, '← Geri'),
  ]) : null;

  // [KULLANICI İSTEĞİ] Bir mod seçilince (form açılınca) eski dar/kompakt düzen aynen kalıyor —
  // odaklanmış, sade bir form ekranı olması için split/dekoratif düzeni SADECE ilk açılış
  // ekranında (mod seçilmeden önceki hâlde) kullanıyoruz.
  if (ui.mode) {
    const hero = el('div', { class: 'lobby-hero' }, [
      el('h1', { class: 'lobby-title compact' }, ui.mode === 'create' ? 'Oda Kur' : 'Odaya Katıl'),
    ]);
    return el('div', { class: 'lobby-shell' }, [
      hero,
      el('div', { class: 'center-col' }, [
        el('div', { class: 'panel lobby-card' }, [formSection]),
      ]),
    ]);
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Lobi ekranı çok çok çok kötü" — bkz. CSS'teki
  // .lobby-hero-wide notu: solda-metin/sağda-dar-kart-sütunu düzeni terk edildi. Artık TEK bir
  // ortalanmış, geniş sütun: başlık → İKİ BÜYÜK aksiyon kartı (bu ekranın tek gerçek kararı,
  // artık sayfanın kenarına sıkışmış küçük bir yan panel değil) → özellik şeridi, hepsi AYNI
  // genişliği tam kullanıyor. Dekoratif kartlar artık içerik sütununun dışına (sol/sağ kenarlara)
  // taşıp gerçekten görünür bir opaklıkta (bkz. CSS) — metnin üstüne binip "hayalet" gibi
  // durmuyorlar.
  const FEATURES = [
    ['LV', 'Canlı Açık Arttırma', 'Teklifler anlık, heyecan bitmiyor'],
    ['DB', '3500+ Oyuncu', '6 lig, gerçek piyasa verisiyle'],
    ['SM', 'Maç Simülasyonu', 'Ev sahibi + deplasman, dakika dakika'],
    ['IC', '38 Efsane', 'Icon oyuncularla kadronu güçlendir'],
  ];
  const featureStrip = el('div', { class: 'lobby-features' }, FEATURES.map(([code, title, desc]) => el('div', { class: 'lobby-feature' }, [
    el('div', { class: 'lobby-feature-code' }, code),
    el('div', {}, [
      el('div', { class: 'lobby-feature-title' }, title),
      el('div', { class: 'lobby-feature-desc' }, desc),
    ]),
  ])));

  const decorA = playerCard({ rating: 96, name: 'Erling Haaland', club: 'Man City', league: 'Premier Lig', isIcon: false }, { slot: 'ST' });
  decorA.classList.add('lobby-decor-card', 'a');
  const decorB = playerCard({ rating: 99, name: 'Pelé', nation: 'Brezilya', isIcon: true }, { slot: 'ST' });
  decorB.classList.add('lobby-decor-card', 'b');
  const decor = el('div', { class: 'lobby-decor', 'aria-hidden': 'true' }, [decorA, decorB]);

  const heroContent = el('div', { class: 'lobby-hero-content' }, [
    el('div', { class: 'lobby-hero-badge' }, 'CANLI AÇIK ARTTIRMA'),
    el('h1', { class: 'lobby-title' }, ['Kendi ', el('span', {}, '11'), '\'ini kur.']),
    el('p', { class: 'lobby-sub' }, 'Rakibinle canlı açık arttırmada kadro topla, formasyonunu seç, ev sahibi + deplasman iki maçlık seride üstünlüğü kanıtla.'),
    modePicker,
    featureStrip,
  ]);

  return el('div', { class: 'lobby-shell' }, [
    el('div', { class: 'lobby-hero-wide' }, [decor, heroContent]),
  ]);
}

// ============================== NASIL OYNANIR ==============================
// [KULLANICI İSTEĞİ] "Son rötuşlar — Nasıl Oynanır içeriği" — kendi URL'i olan (bkz. app.js
// 'how-to-play' → /nasil-oynanir), her ekrandan üst bardaki ❓ butonuyla erişilebilen, saf
// içerik/kural sayfası. Yeni bir ziyaretçinin ilk gördüğü ekran (Oda Kur/Katıl) hiçbir kural
// anlatmıyordu; bu hem onboarding hem SEO açısından bir boşluktu (SPA'nın ilk HTML'i neredeyse
// boş — Google'ın indexleyebileceği gerçek metin içeriği artık burada). Yeni CSS gerektirmiyor —
// mevcut `.panel`/`.lobby-feature`/`.lobby-title` sözlüğü yeniden kullanılıyor.
function howToStep(code, title, desc) {
  return el('div', { class: 'lobby-feature' }, [
    el('div', { class: 'lobby-feature-code' }, code),
    el('div', {}, [
      el('div', { class: 'lobby-feature-title' }, title),
      el('div', { class: 'lobby-feature-desc' }, desc),
    ]),
  ]);
}

export function renderHowToPlay({ state, actions }) {
  const root = el('div', { class: 'view' });

  root.appendChild(el('button', {
    class: 'btn small secondary', style: 'align-self:flex-start',
    onclick: () => actions.navigateToPage(null),
  }, '← Geri dön'));

  root.appendChild(el('div', { class: 'lobby-hero', style: 'margin-top:0' }, [
    el('h1', { class: 'lobby-title compact' }, 'Nasıl Oynanır?'),
    el('p', { class: 'lobby-sub', style: 'margin-top:10px' },
      'PitchGavel, iki ya da daha fazla kullanıcının canlı bir açık arttırmayla 11 kişilik futbol kadrosu kurup birbirine karşı simüle edilmiş maçlarda yarıştığı bir oyun. Aşağıda tüm akış adım adım.'),
  ]));

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Oyun Akışı'),
    howToStep('01', 'Oda Kur ya da Katıl', 'Bir oda açıp kısa kodu arkadaşlarına gönder, ya da aldığın kodla mevcut bir odaya katıl. 2-8 kişi aynı odada oynayabilir.'),
    howToStep('02', 'Kura — Ortak Formasyon', 'Draft başlamadan önce herkes için AYNI formasyon (ör. 4-4-2, 4-3-3) rastgele belirlenir — böylece pozisyon ihtiyacı draft boyunca adil kalır.'),
    howToStep('03', 'Draft', 'Sistem sırayla pozisyon getirir, sen (seçtiğiniz moda göre) açık arttırma, gizli teklif ya da çark ile o pozisyonu doldurursun. 11 kişi tamamlanınca draft biter.'),
    howToStep('04', 'Dizilim', 'Elindeki oyuncuların pozisyon uygunluğuna göre, kurulabilir bir formasyon seç ve kadronu sahaya diz — ev sahibi ve deplasman maçı için ayrı ayrı.'),
    howToStep('05', 'Maç Simülasyonu', 'Kadrolar hücum/orta saha/defans/kaleci güçlerine göre dakika dakika simüle edilir — sonuç önceden bilinmez, sen de anlatımı izlersin.'),
    howToStep('06', 'Puan Tablosu', 'Her maç kendi başına 3/1/0 puan dağıtır (gerçek lig usülü) — birden fazla kullanıcılı odada round-robin sonunda 1. sırada olan şampiyon olur.'),
  ]));

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Draft Modları — birini oda kurarken seçersin'),
    el('div', { class: 'lobby-mode-picker' }, [
      lobbyModeCardLink(actions, '⏱️', 'Canlı Açık Arttırma', 'Teklifler anlık görünür, süre bitene kadar yükselir. En yüksek teklifi veren kazanır.', 'mode-live'),
      lobbyModeCardLink(actions, '🙈', 'Kör Draft', 'Herkes tek seferlik, gizli bir teklif verir — rakibinkini göremezsin. En yüksek teklif kazanır.', 'mode-blind'),
      lobbyModeCardLink(actions, '🎡', 'Çark Modu', 'Bütçe yok! Sırayla çarkı çevirip çıkan reyting bandından (ya da rakipten çal, en iyisini ver gibi özel dilimlerden) ücretsiz oyuncu seçersin.', 'mode-wheel'),
    ]),
  ]));

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Açık Arttırma Nasıl İşliyor'),
    howToStep('👥', 'Ana oyuncu + yedek merdiveni', 'Her pozisyon turunda, o pozisyona ihtiyacı olan kişi sayısı kadar aday gösterilir: en güçlüsünden en zayıfına doğru bir "merdiven".'),
    howToStep('🔁', 'Kaskad açık arttırma', 'N kişi bir pozisyona ihtiyaç duyuyorsa, N-1 gerçek açık arttırma olur: en güçlü aday için herkes yarışır, kazanan çıkar, kalanlar bir sonraki (biraz daha zayıf) aday için YENİDEN açık arttırmaya girer. En son kalan tek kişiye son aday rakipsiz gider.'),
    howToStep('🛡️', 'Bütçe güvenliği', 'Bir teklifin üst sınırı otomatik hesaplanır: kalan bütçen, kalan boş slotların için gereken minimum tutarı hiç aşmaz. "Param bitti, kadrom eksik kaldı" diye bir durum yaşanmaz.'),
    howToStep('⚡', 'Sürpriz pozisyonlar', 'Her draftta rastgele 2 pozisyon "büyük fark" olarak işaretlenir — o pozisyonlarda ana oyuncu ile yedek arasındaki reyting farkı normalden çok daha büyük olur.'),
  ]));

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Reyting Sistemi & Oyuncu Havuzu'),
    el('p', { class: 'muted', style: 'line-height:1.6' },
      'Süper Lig + Avrupa\'nın büyük 5 ligindeki 3.500+ aktif futbolcu ve 38 efsane (icon) oyuncudan oluşan bağımsız bir reyting sistemi (1-99 ölçek) kullanıyoruz. Oda kurarken havuzu "Tüm Ligler" ya da sadece "Süper Lig + Türk icon\'lar" ile sınırlayabilirsin.'),
    el('button', {
      class: 'btn small secondary', style: 'margin-top:10px',
      onclick: () => actions.navigateToPage('players'),
    }, '📊 Oyuncu Veritabanına Bak'),
  ]));

  root.appendChild(el('div', { style: 'text-align:center;margin-top:6px' }, [
    el('button', {
      class: 'btn', onclick: () => actions.navigateToPage(null),
    }, 'Hemen Oyna →'),
  ]));

  return root;
}

// Draft modu kartlarını tıklanabilir yapar — direkt o modun URL'ine (bkz. app.js
// navigateToPage/DRAFT_MODE_BY_PAGE) götürüp Oda Kur formunu o mod seçiliyken açar.
function lobbyModeCardLink(actions, emoji, title, desc, page) {
  return el('button', {
    class: 'lobby-mode-btn', type: 'button',
    onclick: () => actions.navigateToPage(page),
  }, [
    el('div', { class: 'lobby-mode-num' }, emoji),
    el('div', { class: 'lobby-mode-body' }, [
      el('div', { class: 'lobby-mode-label-row' }, [
        el('div', { class: 'lobby-mode-label' }, title),
        el('div', { class: 'lobby-mode-arrow' }, '→'),
      ]),
      el('div', { class: 'lobby-mode-desc' }, desc),
    ]),
  ]);
}

// ============================== WAITING ROOM ==============================
// Bekleme Odası v2 — "Yayın Kontrol Odası" düzeni.
// [KULLANICI İSTEĞİ] "Lobi ekranı çok kötü, daha profesyonel olsun, çok basit ve yapay duruyor"
// — v1 ortalanmış LED kod bloğu + tam genişlikte turuncu "KADRO AÇIKLANDI" bandı + emoji
// rozetlerden oluşuyordu; ikisi de ekranın gerçek işini (odaya adam çağırmak + kimin hazır
// olduğunu görmek) küçük bir köşeye sıkıştırıyordu. v2 asimetrik: solda odanın TÜM kontenjanını
// gösteren 8 satırlık kadro kağıdı, sağda davet + hazırlık. Turuncu sadece kod, CTA ve kaptan
// işaretinde. Stiller: styles.css "Bekleme Odası v2" bölümü (.wr-*), mobil ≤760px orada.
export function renderWaitingRoom({ state, actions }) {
  const { room } = state;
  const votes = room.readyVotes || [];
  const iAmReady = votes.includes(state.clientId);
  const amIHost = room.hostClientId === state.clientId;
  const maxPlayers = room.maxPlayers || 8;
  const filled = room.players.length;
  const allReady = filled >= 2 && room.players.every((p) => p.connected) && votes.length === filled;

  const modeLabel = room.draftMode === 'blind' ? 'Kör draft'
    : room.draftMode === 'wheel' ? 'Çark modu'
    : 'Canlı açık arttırma';
  const poolLabel = room.playerPool === 'super-lig' ? 'Süper Lig' : 'Tüm ligler';

  const copyText = async (text, ok) => {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch (e) { toast('Kopyalanamadı — elle seçip kopyalayabilirsin'); }
  };
  // [NOT] app.js'te oda kodunu URL'den okuyan bir yol YOK (bkz. app.js route()) — o yüzden
  // "davet" bir deep link değil, paylaşıma hazır KISA BİR METİN: adres + kod. Deep link
  // eklenirse (örn. ?oda=KOD) burayı tek satırda URL'e çevirebilirsin.
  const inviteText = `PitchGavel'de oda kurdum — ${location.origin} adresine gir, oda kodu: ${room.code}`;

  const metaCell = (k, v) => el('div', {}, [
    el('div', { class: 'wr-meta-k' }, k),
    el('div', { class: 'wr-meta-v' }, v),
  ]);

  // Kadro kağıdı: dolu satırlar + boş kontenjan satırları — oda kaç kişilik, bir bakışta.
  const rows = [];
  for (let i = 0; i < maxPlayers; i++) {
    const p = room.players[i];
    const isMe = p && p.clientId === state.clientId;
    const isHost = p && p.clientId === room.hostClientId;
    const isReady = p && votes.includes(p.clientId);
    const offline = p && !p.connected;
    const cls = ['wr-row', p ? 'taken' : '', isMe ? 'me' : '', isReady ? 'ready' : '', offline ? 'offline' : '']
      .filter(Boolean).join(' ');
    rows.push(el('div', { class: cls }, [
      el('div', { class: 'wr-row-num' }, String(i + 1)),
      el('div', { class: 'wr-row-who' }, [
        el('div', { class: 'wr-avatar' }, p ? p.name.charAt(0).toUpperCase() : '–'),
        el('div', { style: 'min-width:0' }, [
          el('div', { class: 'wr-row-name' }, p ? p.name + (isMe ? ' (sen)' : '') : 'Boş'),
          el('div', { class: 'wr-row-sub' }, p
            ? (offline ? 'bağlantı yok' : isHost ? 'kaptan · bağlı' : 'bağlı')
            : 'katılım bekleniyor'),
        ]),
      ]),
      el('div', { class: 'wr-row-tag' }, p
        ? (offline ? 'Kopuk' : isReady ? 'Hazır' : 'Bekliyor')
        : 'Boş'),
    ]));
  }

  return el('div', { class: 'view wr' }, [
    el('div', { class: 'wr-head' }, [
      el('div', { class: 'wr-head-left' }, [
        el('div', { class: 'wr-live' }, 'Oda canlı'),
        el('h1', { class: 'wr-title' }, 'Bekleme Odası'),
        el('div', { class: 'wr-title-sub' }, 'Kadro tamamlanınca kaptan draftı başlatır.'),
      ]),
      el('div', { class: 'wr-meta' }, [
        metaCell('Draft', modeLabel),
        metaCell('Havuz', poolLabel),
        metaCell('Kontenjan', `2–${maxPlayers} kişi`),
      ]),
    ]),

    el('div', { class: 'wr-grid' }, [
      el('div', { class: 'wr-card wr-sheet' }, [
        el('div', { class: 'wr-sheet-head' }, [
          el('div', { class: 'wr-sheet-title' }, 'Kadro Kağıdı'),
          el('div', { class: 'wr-sheet-count' }, [
            el('b', {}, String(filled)),
            el('span', {}, `/ ${maxPlayers} oyuncu · ${maxPlayers - filled} yer boş`),
          ]),
        ]),
        ...rows,
      ]),

      el('div', { class: 'wr-aside' }, [
        el('div', { class: 'wr-card pad wr-invite' }, [
          el('div', { class: 'wr-label' }, 'Kapı kodu'),
          el('div', { class: 'wr-code-box' }, [
            el('span', { class: 'wr-code' }, room.code),
            el('button', {
              type: 'button', class: 'wr-code-copy', title: 'Kodu kopyala',
              onclick: () => copyText(room.code, 'Oda kodu kopyalandı'),
            }, '⧉'),
          ]),
          el('div', { class: 'wr-invite-row' }, [
            el('button', {
              type: 'button', class: 'btn',
              onclick: () => copyText(room.code, 'Oda kodu kopyalandı'),
            }, 'Kodu kopyala'),
            el('button', {
              type: 'button', class: 'btn secondary',
              onclick: () => copyText(inviteText, 'Davet metni kopyalandı'),
            }, 'Daveti kopyala'),
          ]),
          el('div', { class: 'wr-hint' }, 'Arkadaşların ana sayfadan "Odaya Katıl" ile bu kodu girer.'),
        ]),

        el('div', { class: 'wr-card pad wr-ready' }, [
          el('div', { class: 'wr-label', style: 'margin-bottom:12px' }, 'Hazırlık'),
          el('div', { class: 'wr-ready-row' }, [
            el('span', {}, 'Hazır oyuncu'),
            el('b', {}, [String(votes.length), el('i', {}, `/${filled}`)]),
          ]),
          el('div', { class: 'wr-bar' }, el('div', {
            style: `width:${filled ? (votes.length / filled) * 100 : 0}%`,
          })),
          el('button', {
            type: 'button', class: `wr-cta ${iAmReady ? 'on' : ''}`,
            onclick: () => actions.toggleDraftReady(),
          }, iAmReady ? 'Hazırsın' : 'Hazırım'),
          el('div', { class: 'wr-hint' }, iAmReady
            ? 'Geri çekmek için tekrar tıkla.'
            : filled < 2
              ? `En az 2 oyuncu gerekiyor — ${maxPlayers} kişiye kadar katılabilir.`
              : amIHost
                ? 'Herkes hazır olduğunda draftı sen başlatacaksın.'
                : 'Herkes hazır olduğunda kaptan draftı başlatır.'),
          amIHost
            ? el('button', {
                type: 'button', class: `wr-cta start ${allReady ? '' : 'wait'}`,
                disabled: allReady ? null : '',
                onclick: () => { if (allReady) actions.startDraft(); },
              }, allReady ? 'Draftı Başlat' : 'Herkes hazır değil')
            : null,
        ]),
      ]),
    ]),
  ]);
}

// ============================== HAZIRLIK ÇARKI ==============================
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Bu kör draft ve açık arttırma için geçerli, oyun
// başlamadan önce (formasyon kurasından ÖNCE) bütün kullanıcılar çark çevirecek — çevirmek
// isteğe bağlı, hiç risk almadan da devam edilebilir. Görünürlük herkese açık." — room.status
// 'prep_wheel' iken (bkz. app.js route()) bu ekran gösterilir.
//
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — "TAM SÜRÜM"] "Çarkı sıra sıra çevirsinler, ilk başta
// 1. oyuncu, ona çıkan şeyi herkes görsün, sonra diğer oyuncuya geçsin. Çarktaki şeylerin
// özelliklerini açıkla, oyuncular bilsin." — ekran baştan yazıldı: (1) sıra artık `room.prepWheel
// .order[cursor]`'a göre TEK KİŞİLİK — sadece o kişi çevirebilir/atlayabilir, diğerleri "X'in
// sırası" görüp aynı geri sayımı izler. (2) Her zaman görünen bir "Olası Perk'ler" kataloğu
// (açıklamalarıyla) eklendi — kullanıcı çevirmeden ÖNCE bile neyin ne yaptığını bilsin.
function prepWheelCatalog(state) {
  const catalog = state.config?.PREP_WHEEL_SEGMENTS || [];
  const poolMeta = { iyi: '🟢 İyi', orta: '🟠 Nötr', kötü: '🔴 Kötü' };
  const isBlind = state.room?.draftMode === 'blind';
  const groups = ['iyi', 'orta', 'kötü'].map((poolKey) => {
    const items = catalog.filter((s) => s.pool === poolKey && (isBlind || s.kind !== 'spy'));
    if (items.length === 0) return null;
    return el('div', { class: 'prep-wheel-catalog-group' }, [
      el('div', { class: 'prep-wheel-catalog-group-label' }, poolMeta[poolKey]),
      ...items.map((s) => el('div', { class: 'prep-wheel-catalog-item' }, [
        el('div', { class: 'prep-wheel-catalog-item-label' }, s.label),
        el('div', { class: 'prep-wheel-catalog-item-desc' }, s.description),
      ])),
    ]);
  }).filter(Boolean);
  return el('details', { class: 'prep-wheel-catalog panel' }, [
    el('summary', {}, `🎡 Olası Perk'ler (${catalog.length - (isBlind ? 0 : 1)} tane) — neler çıkabilir?`),
    ...groups,
  ]);
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kör draft moduna çark özelliği ekledik (zaten Canlı modda
// da aktif — bkz. yukarıdaki not), o çark normal çevrilsin, çark gözüksün, üzerinde neler
// gelebileceği yazsın, kullanıcı çevirirken diğer kullanıcılar izleyebilsin." — Hazırlık Çarkı
// sunucuda ATOMİK/senkron çözülüyor (bkz. DraftEngine.spinPrepWheel — sonuç tek bir
// `prepWheel:resolved` broadcast'iyle geliyor, Çark Modu'ndaki gibi iki fazlı bir round state'i
// YOK). Çark Modu'nun kullandığı numara burada da uygulanıyor: sonuç aslında anında biliniyor
// ama istemci bilerek `PREP_WHEEL_SPIN_HOLD_MS` kadar gizleyip önce döndürme animasyonunu
// oynatıyor. Broadcast TÜM istemcilere (yaklaşık) aynı anda ulaştığı için herkes aynı anda aynı
// animasyonu (aynı hedef dilime doğru) izliyor (bkz. app.js `prepWheel:resolved` handler'ı —
// `state.prepWheelSpin`'i dolduran taraf). Sunucu bu arada sırayı zaten ilerletmiş olsa bile
// (room.prepWheel.cursor güncel), animasyon bitene kadar BURADA o TURUN görünümü gösterilmeye
// devam ediyor — aksi halde animasyon tamamlanmadan sıradaki kişinin turu görünürdü.
const prepWheelSpinAnimated = new Map(); // spinKey -> final rotation (deg) — wheelSpinAnimated ile AYNI desen, ayrı isim uzayı
const prepWheelSpinStartedAt = new Map(); // spinKey -> Date.now() — bkz. wheelSpinStartedAt (aynı anlık-sıçrama düzeltmesi)
const prepWheelSpinScheduled = new Set(); // spinKey -> reveal zamanlayıcısı zaten kuruldu mu

function prepWheelSegmentsFor(state) {
  const catalog = state.config?.PREP_WHEEL_SEGMENTS || [];
  const isBlind = state.room?.draftMode === 'blind';
  return catalog.filter((s) => isBlind || s.kind !== 'spy');
}

export function renderPrepWheel({ state, actions }) {
  const { room } = state;
  const pw = room.prepWheel;
  const order = pw ? pw.order : [];
  const cursor = pw ? pw.cursor : 0;
  const activeClientId = pw ? order[cursor] : null;
  const isMyTurn = activeClientId === state.clientId;
  const activePlayer = room.players.find((p) => p.clientId === activeClientId);
  const deadline = pw ? pw.deadline : null;

  const root = el('div', { class: 'view' });
  root.appendChild(el('div', { class: 'panel' }, [
    el('h2', {}, '🎡 Hazırlık Çarkı'),
    el('p', { class: 'muted' }, 'Formasyon kurasından önce, sırayla: çevirirsen iyi ya da kötü bir perk gelebilir. İstemezsen hiç risk almadan devam edebilirsin.'),
  ]));
  root.appendChild(prepWheelCatalog(state));

  clearInterval(timerInterval); // önceki render'dan kalan geri sayım (varsa) burada kesiliyor

  const spin = state.prepWheelSpin;
  const spinElapsed = spin ? Date.now() - spin.startedAt : Infinity;
  const spinActive = isPrepWheelSpinActive(state);
  if (spin && !spinActive) state.prepWheelSpin = null;

  if (spinActive) {
    const spinnerName = (room.players.find((p) => p.clientId === spin.clientId) || {}).name || '?';
    const isMine = spin.clientId === state.clientId;
    const revealReady = spinElapsed >= WHEEL_SPIN_DURATION_MS;
    const spinKey = `prep-${spin.clientId}-${spin.startedAt}`;
    const geo = wheelGeometry(prepWheelSegmentsFor(state));
    const disk = buildWheelDiskEl(geo, spinKey, spin.perk.label, prepWheelSpinAnimated, prepWheelSpinStartedAt);
    const stage = el('div', {
      class: `wheel-stage ${!revealReady ? 'spinning' : ''}`,
    }, [el('div', { class: `wheel-pointer ${revealReady ? 'landed' : ''}` }), disk]);

    if (!prepWheelSpinScheduled.has(spinKey)) {
      prepWheelSpinScheduled.add(spinKey);
      setTimeout(() => actions.route(), PREP_WHEEL_SPIN_HOLD_MS - spinElapsed + 30);
    }


    root.appendChild(el('div', { class: 'panel' }, [
      el('div', { class: `wheel-turn-banner ${isMine ? 'mine' : ''}` },
        !revealReady ? `🎡 ${spinnerName}${isMine ? ' (sen)' : ''} çeviriyor...` : `🎯 ${spin.perk.label} çıktı!`),
      stage,
    ]));
    return root; // animasyon bitene kadar aşağıdaki normal tur/sıra ekranı hiç gösterilmiyor
  }

  const timerLabel = el('div', { class: 'timer-label' }, '—');
  const timerFill = el('div', { class: 'timer-fill', style: 'width:100%' });
  const timerWrap = el('div', { class: 'timer-wrap' }, [el('div', { class: 'timer-bar' }, timerFill), timerLabel]);
  if (deadline) {
    const nominalMs = (state.config?.PREP_WHEEL_PICK_DURATION_SECONDS || 20) * 1000;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      timerLabel.textContent = `${(left / 1000).toFixed(1)} sn — süre dolarsa otomatik "risk almadan devam et" seçilir`;
      timerFill.style.width = `${Math.min(100, (left / nominalMs) * 100)}%`;
      timerWrap.classList.toggle('urgent', left <= 5000 && left > 2000);
      timerWrap.classList.toggle('critical', left <= 2000);
      countdownTick(left);
      if (left <= 0) clearInterval(timerInterval);
    };
    tick();
    timerInterval = setInterval(tick, 150);
  }

  const turnBody = isMyTurn
    ? [
        el('div', { class: 'prep-wheel-turn-label' }, 'Sıra sende!'),
        el('div', { class: 'prep-wheel-actions' }, [
          el('button', { class: 'btn', onclick: () => actions.spinPrepWheel() }, '🎡 Çevir (risk var)'),
          el('button', { class: 'btn secondary', onclick: () => actions.skipPrepWheel() }, '⏭ Risk Almadan Devam Et'),
        ]),
        timerWrap,
      ]
    : [
        el('div', { class: 'prep-wheel-turn-label' }, `Sıra: ${activePlayer ? activePlayer.name : '?'}`),
        el('div', { class: 'muted' }, 'Kendi sıran gelince buradan çevirebilir ya da atlayabilirsin.'),
        timerWrap,
      ];
  root.appendChild(el('div', { class: 'panel' }, turnBody));

  // [KULLANICI İSTEĞİ] Görünürlük herkese açık — sırayla ilerleyen listede kimin çevirdiği/
  // atladığı, kimin sırasının geldiği, kimin hâlâ beklediği tek bakışta görünüyor.
  const rows = room.players.map((p) => {
    const idx = order.indexOf(p.clientId);
    const isDone = idx !== -1 && idx < cursor;
    const isCurrent = p.clientId === activeClientId;
    let text;
    if (isCurrent) text = 'Sırası geldi — karar veriyor...';
    else if (!isDone) text = 'Sırasını bekliyor';
    else if (p.prepPerk) text = `${p.prepPerk.label}${p.prepPerk.detail ? ' ' + p.prepPerk.detail : ''}`;
    else text = 'Risk almadan devam etti';
    return el('div', { class: `prep-wheel-row ${isCurrent ? 'current' : ''}` }, [
      el('span', {}, p.name + (p.clientId === state.clientId ? ' (sen)' : '')),
      el('span', { class: (isDone || isCurrent) ? '' : 'muted' }, text),
    ]);
  });
  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, `Sıra (${cursor}/${room.players.length} tamamlandı)`),
    ...rows,
  ]));

  return root;
}

// ============================== DRAFT ==============================
let timerInterval = null;
// [design.md "Hareket"] Canlı en-yüksek-teklif rakamının bir önceki gösterdiği değeri tur
// bazında hatırlar ki route() DOM'u sıfırdan kursa bile (bkz. app.js) bir sonraki teklif geldiğinde
// eski değerden yeni değere doğru "sayarak" yükselsin, anlık belirmesin (bkz. countUpMoney).
const lastShownBid = new Map();

// ============================== ÇARK MODU v2 ==============================
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Çarka animasyon ekle, döndüğü belli olsun, daha güzel
// bir çark olsun, çıkan sonuç ekrana gelsin." — segment listesi artık global bir config sabiti
// DEĞİL, bu draftın kendi çarkı (bkz. state.draft.wheelSegments, DraftEngine.emitDraft). Dilim
// renkleri artık havuza (iyi/orta/kötü) göre — hem "hangi dilim iyi/kötü" görsel bir ipucu hem
// de aynı havuzdaki komşu dilimler birbirinden ayırt edilsin diye pool başına 3 ton.
const POOL_COLORS = {
  iyi: ['#22c55e', '#16a34a', '#4ade80'],
  orta: ['#ff9500', '#e08000', '#ffb347'],
  kötü: ['#fb4155', '#c81e37', '#ff6b81'],
};

// Çark grafiğindeki dilim etiketlerinin merkezden uzaklığı (bkz. renderWheelRound'daki
// translateY kullanımı) — hem konumlama hem de her etiketin yay genişliğini hesaplamak için.
const LABEL_RADIUS = 78;

function wheelGeometry(segments) {
  const total = segments.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  const poolCounters = { iyi: 0, orta: 0, kötü: 0 };
  return segments.map((seg) => {
    const startPct = (acc / total) * 100;
    acc += seg.weight;
    const endPct = (acc / total) * 100;
    const startDeg = (startPct / 100) * 360;
    const endDeg = (endPct / 100) * 360;
    const shades = POOL_COLORS[seg.pool] || POOL_COLORS.orta;
    const color = shades[(poolCounters[seg.pool] || 0) % shades.length];
    poolCounters[seg.pool] = (poolCounters[seg.pool] || 0) + 1;
    return { ...seg, color, startPct, endPct, startDeg, endDeg, centerDeg: (startDeg + endDeg) / 2 };
  });
}

// [KULLANICI İSTEĞİ] "Döndüğü belli olsun, daha güzel bir çark olsun" — v1'deki 5 tur/2.6sn'den
// biraz uzatıldı (7 tam tur + 3.2sn) — hem daha "gerçek bir çark" hissi hem de aşağıdaki reveal
// gecikmesiyle (WHEEL_REVEAL_DELAY_MS) senkron bir bekleme penceresi sağlıyor.
const WHEEL_SPIN_DURATION_MS = 3200;
const WHEEL_SPIN_SPINS = 7;
// [KULLANICI İSTEĞİ] "Çıkan sonuç ekrana gelsin" — animasyon bitmeden sonucu (band/oyuncu
// listesi) hiç göstermiyoruz, animasyon süresinden biraz sonra (bkz. wheelRevealReady) açığa
// çıkarıyoruz — sonuç gerçekten "ekrana gelen" dramatik bir an oluyor, dönerken zaten belli.
const WHEEL_REVEAL_DELAY_MS = WHEEL_SPIN_DURATION_MS + 150;
// Hazırlık Çarkı'nın kendi hold süresi (reveal + kısa bir "sonucu okuma" payı) — renderPrepWheel'in
// yukarısında (module scope'ta önce çağrılabilse de) tanımlı; JS önce TÜM modülü değerlendirip
// SONRA fonksiyonları çağırdığı için renderPrepWheel bunu kendisinden SONRA tanımlanmış olsa
// bile güvenle kullanabiliyor (WHEEL_SPIN_DURATION_MS için de zaten aynı desen geçerliydi).
const PREP_WHEEL_SPIN_HOLD_MS = WHEEL_SPIN_DURATION_MS + 400;
// [DÜZELTİLDİ — BUG, KULLANICI GERİ BİLDİRİMİ] "Çark bitince oyun hemen başlıyor" — kök neden:
// `app.js route()` SADECE `state.room.status`'a bakarak hangi ekranı çizeceğine karar veriyordu.
// Hazırlık Çarkı'nda SIRADAKİ kişi son kişiyse, sunucu o kişinin spin'ini çözer çözmez (hiçbir
// gecikme olmadan, aynı tick'te) `startDraft`'ı çağırıp `room.status`'u 'draft'a çeviriyordu —
// bu değişiklik `room:state` ile ANINDA yayınlanıyordu, ve `route()` bir SONRAKİ render'ında artık
// `renderPrepWheel` yerine `renderDraft`'ı çiziyordu; oysa o kişinin (ve izleyen herkesin) yerel
// `state.prepWheelSpin` "hold" süresi (bu sabit) HENÜZ dolmamış olabiliyordu — çark az önce
// çevrilmiş, animasyon oynamaya BAŞLAMIŞ ama ekran o anda draft'a sıçrıyordu ("dönmüyor, direkt
// sonuç çıkıyor" hissi tam olarak buydu, özellikle sıradaki son kişi çevirdiğinde/kendi turunda).
// Çözüm: `route()` artık `state.room.status`'tan ÖNCE bu fonksiyonla "hâlâ bir prep-wheel
// animasyonu gösteriliyor mu" diye soruyor — cevap evetse (durum artık 'draft' olsa bile)
// `renderPrepWheel` çizilmeye devam ediyor (o fonksiyon zaten `state.prepWheelSpin`'i `room.
// prepWheel`e hiç ihtiyaç duymadan çizebiliyor), hold süresi dolunca normal `room.status`
// yönlendirmesi devreye giriyor. Bkz. client/public/app.js route().
export function isPrepWheelSpinActive(state) {
  const spin = state.prepWheelSpin;
  if (!spin) return false;
  return (Date.now() - spin.startedAt) < PREP_WHEEL_SPIN_HOLD_MS;
}

// Çarkı görsel olarak istenen dilimde durdurmak için gereken toplam dönüş açısı — birkaç tam
// tur (heyecan için) + dilimin ortasına (küçük bir rastgele sapmayla, hep aynı noktada
// durmasın diye) hizalanacak açı. Pointer sabit üstte (0deg/12 yönü) olduğu için CSS
// conic-gradient'in KENDİ 0deg'i (üst, saat yönü) ile aynı referans kullanılıyor. `label`
// çarkın GEOMETRİSİNDE (geo) yoksa (ör. sunucunun "kimsede yok — havuzdan seç" gibi sentetik bir
// segmente düşürdüğü durum) dilimi bulamayız — bu durumda rastgele bir dilimde durur (hangi
// dilimde durduğunun bir önemi yok, sonuç zaten farklı bir mekanizmayla — pick listesi/reveal
// metniyle — anlatılıyor).
function wheelRotationFor(geo, label, spins = WHEEL_SPIN_SPINS) {
  const seg = geo.find((s) => s.label === label);
  if (!seg) return spins * 360 + Math.random() * 360;
  const width = seg.endDeg - seg.startDeg;
  const jitter = (Math.random() - 0.5) * width * 0.6;
  const target = seg.centerDeg + jitter;
  return spins * 360 + (360 - target);
}

// Bir spin'in animasyonunu SADECE İLK render'ında oynat (route() DOM'u sıfırdan kursa da,
// bkz. lastShownBid ile aynı desen) — sonraki re-render'larda çark zaten vardığı açıda durur.
// [DÜZELTİLDİ — BUG, KULLANICI GERİ BİLDİRİMİ] "Çark dönmüyor, direkt sonuç çıkıyor" — bu
// yorumun varsaydığı "zaten vardığı açıda durur" DOĞRU DEĞİLDİ: route() her seferinde disk'i
// SIFIRDAN yeni bir DOM elemanı olarak kuruyor (bkz. buildWheelDiskEl), önceki elemanın o anki
// GERÇEK (interpolated) açısı hiçbir yerde tutulmuyordu — ikinci bir render (animasyon HENÜZ
// bitmeden, ör. rakibin bir aksiyonu/yeniden bağlanma yüzünden gelen bir room:state/draft:update
// broadcast'i) `transition:none` ile doğrudan FİNAL açıya ATLIYORDU; yani "dönmüyor, direkt
// sonuç çıkıyor" hissi, animasyon sırasında ARADA bir re-render olduğunda gerçekten oluşuyordu
// (kendi testimde art arda tıklama/ekran görüntüsü almadan tek bir oturumda YAKALANMADI ama kod
// okununca kök neden netti — bkz. wheelSpinStartedAt). Artık her spinKey için başlangıç zamanı
// da saklanıyor; ara bir re-render'da animasyon süresi henüz dolmadıysa KALAN süre kadar (0'dan
// değil, o ana kadar geçen süre düşülerek) dönüşe devam ediliyor — asla anlık sıçrama olmuyor.
const wheelSpinAnimated = new Map(); // spinKey -> final rotation (deg)
const wheelSpinStartedAt = new Map(); // spinKey -> Date.now() (ilk render anı) — ara re-render'larda kalan süreyi hesaplamak için
// [KULLANICI İSTEĞİ] Suspense — animasyon bitene kadar sonucu (band/pick listesi) gizler. Bir
// spinKey için reveal zamanlayıcısı SADECE bir kez kurulur (aksi halde her ara re-render'da
// yeniden 3.2sn'lik bir bekleme başlardı).
const wheelRevealReady = new Map(); // spinKey -> true (animasyon bitti, sonuç gösterilebilir)
const wheelRevealScheduled = new Set(); // spinKey -> zamanlayıcı zaten kuruldu mu
const WHEEL_AUTO_KINDS = new Set(['forced_worst', 'give_best', 'respin']); // sunucudaki AUTO_RESOLVE_KINDS ile aynı

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] "🙈 Kör İlk Tur" perk'i — SADECE
// istemci-yerel bir bulanıklaştırma (round.main verisi zaten herkese aynı şekilde geliyor, bu
// rakibe karşı bir güvenlik sınırı değil — kendi kendine seçilmiş bir zorluk). Bu oyuncunun
// katıldığı İLK auction/blind_auction turunda ana oyuncunun reytingi bulanıklaşır; o tur resolve
// olup FARKLI bir tura geçilince (roundKey değişince) hak bir daha geri gelmemek üzere tükenir.
function blindFirstRoundActive(state, round) {
  const me = state.room && state.room.players.find((p) => p.clientId === state.clientId);
  if (!me || !me.prepPerk || me.prepPerk.kind !== 'blind_first_round') return false;
  if (state.blindFirstRoundConsumed) return false;
  if (!round || !round.main || !round.participantIds || !round.participantIds.includes(state.clientId)) return false;
  const roundKey = `${round.main.id}@${round.deadline}`;
  if (state.blindFirstRoundKey && state.blindFirstRoundKey !== roundKey) {
    state.blindFirstRoundConsumed = true; // farklı bir tura geçtik — önceki blur'lanan tur resolve oldu
    return false;
  }
  state.blindFirstRoundKey = roundKey; // bu turu "blur'lanan İLK ve TEK tur" olarak kilitle
  return true;
}

// [KULLANICI İSTEĞİ] "Draft/lobi dışında gerçek bir onboarding yok — draft ekranına ilk kez
// gelen biri kaskad, büyük-fark rozeti, anti-snipe gibi kavramlarda kafası karışabilir."
// Nasıl Oynanır sayfasını tekrarlamayan, SADECE bu ekranda görünen kavramların kısa karşılığı.
// İlk 3 draftta açık gelir, sonra kendiliğinden kapanır; "Anladım"a basılırsa hemen biter —
// kapatıldıktan sonra da başlıktan tekrar açılabilir (kalıcı olarak kaybolmaz).
const COACH_KEY = 'kk_draft_coach_seen';
function coachSeen() { try { return parseInt(localStorage.getItem(COACH_KEY) || '0', 10) || 0; } catch (e) { return 99; } }
function bumpCoachSeen(n) { try { localStorage.setItem(COACH_KEY, String(n)); } catch (e) { /* yok say */ } }

// Draft ekranındaki kavram sözlüğü. Mod'a göre içerik değişir: çark modunda kaskad/teklif
// kavramları hiç yok, kör draftta gizli teklif var.
function draftCoach(mode) {
  const TIPS = mode === 'wheel' ? [
    ['🎡', 'Çark', 'Sıra sana gelince çarkı çevirirsin. Çıkan bant (reyting aralığı, lig, ülke, icon) o turda kimler arasından seçebileceğini belirler.'],
    ['🧊', 'Bant', 'Bant daraldıkça aday listesi kısalır. Beğenmediysen "kararsızım"a basıp seçimi sisteme bırakabilirsin.'],
    ['💸', 'Bütçe yok', 'Bu modda para harcanmaz — herkes 11 tur çevirir, kadro tamamen çarkın getirdiğinden kurulur.'],
  ] : [
    ['🪜', 'Kaskad', 'Bir pozisyon için sırayla birden fazla oyuncu açık arttırmaya çıkar. Ana oyuncuyu kaçırırsan altındaki sıra sana kalabilir — son sıradaki oyuncu rakipsiz kalana bedelsiz gider.'],
    ['📈', 'Büyük fark', 'Bu rozet, ana oyuncu ile bir alttaki arasında ciddi bir reyting uçurumu olduğunu söyler. Yani bu turu kaçırmanın bedeli yüksek.'],
    ['🛡️', 'Anti-snipe', 'Son saniyede gelen teklif süreyi uzatır. Bekleyip bir anda vurmak işe yaramaz; gerçekten en yükseği veren alır.'],
    mode === 'blind'
      ? ['🙈', 'Gizli teklif', 'Kör draftta rakibin teklifini görmezsin. Tek şansın var — ne kadar vereceğine kör karar verirsin.']
      : ['⏸', 'Duraklatma', 'Herkes onaylarsa draft durur. Sırada beklerken kimse mağdur olmaz.'],
  ];

  const seen = coachSeen();
  const open = seen < 3;
  if (open) bumpCoachSeen(seen + 1);

  const body = el('div', { class: 'coach-body' }, TIPS.map(([ico, term, desc]) => el('div', { class: 'coach-tip' }, [
    el('span', { class: 'coach-ico' }, ico),
    el('div', { class: 'coach-text' }, [
      el('b', {}, term),
      el('span', {}, desc),
    ]),
  ])));

  const wrap = el('details', { class: 'coach', ...(open ? { open: 'open' } : {}) }, [
    el('summary', { class: 'coach-summary' }, [
      el('span', { class: 'coach-badge' }, 'İlk kez mi?'),
      el('span', { class: 'coach-summary-text' }, 'Bu ekrandaki kavramlar'),
    ]),
    body,
    el('button', {
      class: 'btn small secondary coach-dismiss',
      onclick: (e) => { e.preventDefault(); bumpCoachSeen(99); wrap.open = false; },
    }, 'Anladım, bir daha gösterme'),
  ]);
  return wrap;
}

export function renderDraft({ state, actions }) {
  const d = state.draft;
  const root = el('div', { class: 'view' });

  if (!d) {
    root.appendChild(el('div', { class: 'panel' }, 'Draft başlıyor...'));
    return root;
  }

  // [KULLANICI İSTEĞİ] "Açık arttırmada durdurma gelsin. İki oyuncuda onayladığında oyun
  // duraklatılsın." — [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod: eşik odadaki
  // TÜM oyuncu sayısı (bkz. DraftEngine.togglePauseVote).
  const pauseVotes = d.pauseVotes || [];
  const iVotedPause = pauseVotes.includes(state.clientId);
  const totalPlayers = state.room.players.length;
  let pauseLabel;
  if (d.paused) pauseLabel = '▶ Devam Et';
  else if (iVotedPause) pauseLabel = '⏳ Diğerlerinin onayı bekleniyor — iptal et';
  else pauseLabel = `⏸ Durdur (${pauseVotes.length}/${totalPlayers})`;

  const isBlindMode = state.room.draftMode === 'blind';
  const isWheelMode = state.room.draftMode === 'wheel';
  const isSuperLigMode = state.room.playerPool === 'super-lig';

  // [DÜZELTİLDİ — BUG] Bu açıklama Çark Modu'nu hiç hesaba katmıyordu — "Kör Draft" değilse hep
  // "Canlı açık arttırma" yazıyordu, Çark Modu'nda oynarken bile.
  let modeDescription;
  if (isBlindMode) modeDescription = '🙈 Kör Draft — sistem rastgele pozisyon getirir, teklifler gizli';
  else if (isWheelMode) modeDescription = '🎡 Çark Modu — bütçe yok, sırayla çark çevirip çıkan banttan ücretsiz seç';
  else modeDescription = 'Canlı açık arttırma — sistem rastgele pozisyon getirir';

  root.appendChild(el('div', { class: 'draft-header' }, [
    el('div', { class: 'formation-badge' }, `Formasyon: ${d.formation}`),
    el('div', { class: 'muted' }, modeDescription),
    isSuperLigMode ? el('div', { class: 'muted' }, '🇹🇷 Tek Lig Modu — havuz Süper Lig + Türk icon\'larla sınırlı') : null,
    el('button', {
      class: `btn small ${d.paused || iVotedPause ? 'danger' : 'secondary'}`,
      onclick: () => actions.togglePause(),
    }, pauseLabel),
    leaveGameButton(actions),
  ]));

  root.appendChild(draftCoach(state.room.draftMode));

  if (d.paused) {
    root.appendChild(el('div', { class: 'warning-banner' }, '⏸ Draft duraklatıldı — devam etmek için taraflardan biri "Devam Et"e basmalı.'));
  }

  // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Çark Modunda kullanıcıların parası gözüküyor, o
  // modda para hiç kullanılmıyor" — Çark Modu'nda bütçe hiç değişmiyor (bkz. claude.md "Çark
  // Modu" — tamamen ücretsiz), bu yüzden gösterilmesi kafa karıştırıcıydı.
  root.appendChild(el('div', { class: 'budget-row' }, d.players.map((p) => el('div', { class: 'budget-card' }, [
    el('div', { class: 'name' }, p.name + (p.clientId === state.clientId ? ' (sen)' : '')),
    isWheelMode ? null : el('div', { class: 'budget' }, fmtMoney(p.budget)),
    el('div', { class: 'slots' }, `${11 - p.remainingSlots}/11 dolduruldu`),
  ]))));

  const roundPanel = el('div', { class: 'panel round-area' });
  const round = d.round;

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Teklif verdiğinde oyuncunun kimin aldığını kaç
  // paraya aldığını diğer kullanıcıların ne kadar teklif verdiğini göster her seferinde. Ara
  // yüz çıksın her oyuncudan sonra belli bir saniye, sonra diğer tura geç." — round çözülünce
  // sunucu bir süre (bkz. ROUND_RESULT_DELAY_MS) yeni tur başlatmadan bekliyor; o pencerede
  // istemci canlı round yerine net bir "Tur Sonucu" panelini gösterir (round tekrar dolana
  // kadar otomatik olarak kalır — ayrı bir zamanlayıcıya gerek yok).
  const RESOLVED_EVENT_TYPES = ['auction_resolved', 'blind_auction_resolved', 'one_sided_assigned', 'wheel_turn_resolved', 'joker_used'];
  const resultEvent = d.event && RESOLVED_EVENT_TYPES.includes(d.event.type) ? d.event : null;

  if (resultEvent) {
    roundPanel.appendChild(renderRoundResultPanel(resultEvent, state));
  } else if (!round) {
    roundPanel.appendChild(el('div', { class: 'muted' }, 'Sıradaki tur hazırlanıyor...'));
  } else if (round.kind === 'one_sided') {
    roundPanel.appendChild(el('h3', {}, `Tek taraflı ihtiyaç — ${round.slotType}`));
    roundPanel.appendChild(playerCard(round.main, { slot: round.slotType, tag: 'Rakipsiz atandı' }));
  } else if (round.kind === 'wheel') {
    roundPanel.appendChild(renderWheelRound({ state, actions, round, paused: d.paused }));
  } else {
    const isBlind = round.kind === 'blind_auction';
    roundPanel.appendChild(el('h3', {}, isBlind
      ? `Kör Teklif — ${round.slotType} pozisyonu`
      : `Açık Arttırma — ${round.slotType} pozisyonu`));
    if (round.bigGap) {
      roundPanel.appendChild(el('div', { class: 'big-gap-badge' }, '⚡ Sürpriz pozisyon — ana ve yedek arasında uçurum var!'));
    }

    const timerLabel = el('div', { class: 'timer-label' }, '—');
    const timerFill = el('div', { class: 'timer-fill', style: 'width:100%' });
    const timerWrap = el('div', { class: 'timer-wrap' }, [
      el('div', { class: 'timer-bar' }, timerFill),
      timerLabel,
    ]);
    roundPanel.appendChild(timerWrap);

    clearInterval(timerInterval);
    const nominalMs = (isBlind
      ? (state.config?.BLIND_BID_DURATION_SECONDS || 20)
      : (state.config?.AUCTION_DURATION_SECONDS || 18)) * 1000;
    if (d.paused) {
      // Duraklatılmışken sunucu deadline'ı ilerletmiyor — canlı geri sayım yerine sunucudan
      // gelen dondurulmuş kalan süreyi statik göster.
      const frozenLeft = round.pausedRemainingMs != null ? round.pausedRemainingMs : 0;
      timerLabel.textContent = `⏸ ${(frozenLeft / 1000).toFixed(1)} sn (duraklatıldı)`;
      timerFill.style.width = `${Math.min(100, (frozenLeft / nominalMs) * 100)}%`;
    } else {
      // [design.md "Hareket"] "Geri sayım son saniyelerde renk/hız değiştirerek gerçek bir
      // aciliyet hissettirsin" — 5sn altı turuncu, 2sn altı kırmızı+nabız (bkz. styles.css
      // .timer-wrap.urgent/.critical).
      const tick = () => {
        const left = Math.max(0, round.deadline - Date.now());
        timerLabel.textContent = `${(left / 1000).toFixed(1)} sn`;
        timerFill.style.width = `${Math.min(100, (left / nominalMs) * 100)}%`;
        timerWrap.classList.toggle('urgent', left <= 5000 && left > 2000);
        timerWrap.classList.toggle('critical', left <= 2000);
        countdownTick(left);
        if (left <= 0) clearInterval(timerInterval);
      };
      tick();
      timerInterval = setInterval(tick, 150);
    }

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "N kullanıcı için bir turda N-1 açık arttırma olsun —
    // x için açık arttırma, x'i alan çıkar, kalanlar y için YENİDEN açık arttırmaya girer..."
    // — ladder artık toplu atanmıyor, KASKAD ilerliyor: round.backups şu an "sırası gelmemiş,
    // ileride kendi açık arttırmasına çıkacak" adaylar. Bu dizinin SON elemanı HER ZAMAN
    // ladder'ın son üyesi — yani nihayetinde rekabet kalmayınca rakipsiz gidecek aday (bkz.
    // DraftEngine.startCascadeStage: backups = candidates.slice(stageIndex+1), ladder'ın kuyruğu
    // stageIndex'ten bağımsız hep aynı son elemanda biter).
    const backups = round.backups || [];
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] "🙈 Kör İlk Tur" perk'i — bu SADECE
    // kendi kendine uygulanan, İSTEMCİ-YEREL bir zorluk (rakip için bir güvenlik sınırı DEĞİL,
    // round.main verisi zaten herkese aynı şekilde geliyor — bkz. claude.md). Bu oyuncunun
    // katıldığı İLK turda ana oyuncunun reytingi bulanıklaştırılır; o tur resolve olup bir
    // sonraki tura geçilince hak tükenir (bkz. blindFirstRoundActive).
    const shouldBlurRating = blindFirstRoundActive(state, round);
    roundPanel.appendChild(el('div', { class: 'reveal-row' }, [
      playerCard(round.main, {
        slot: round.slotType,
        extraClass: `main${shouldBlurRating ? ' blurred-rating' : ''}`,
        tag: isBlind ? 'ANA OYUNCU — gizli teklif' : 'ANA OYUNCU — açık arttırmada',
      }),
      ...backups.map((b, i) => {
        const isFinal = i === backups.length - 1;
        const card = playerCard(b, {
          slot: round.slotType, extraClass: 'backup',
          tag: isFinal ? 'SON SIRA — rakipsiz kalana otomatik gider' : `${i + 2}. SIRA — sırası gelince açık arttırmaya çıkacak`,
        });
        if (backups.length > 1) card.appendChild(el('div', { class: 'ladder-rank-badge' }, String(i + 2)));
        return card;
      }),
    ]));

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — bu turda kimin yarıştığını (o
    // pozisyona ihtiyacı olan katılımcı alt kümesini) göstermek N>2 odada önemli hale geliyor.
    const participants = (round.participantIds || [])
      .map((id) => state.room.players.find((p) => p.clientId === id))
      .filter(Boolean);
    if (participants.length > 2) {
      roundPanel.appendChild(el('div', { class: 'muted', style: 'text-align:center' },
        `Bu turda yarışanlar: ${participants.map((p) => p.name + (p.clientId === state.clientId ? ' (sen)' : '')).join(', ')}`));
    }
    // [KULLANICI İSTEĞİ] Kaskadın kaçıncı aşamasında olduğumuzu göster — SADECE gerçekten
    // birden fazla aşamalı (K>2) turlarda anlamlı; 2 kişilik odalarda (her zaman 1/2) yeni bir
    // bilgi taşımadığı için gösterilmiyor.
    if (round.cascadeTotal > 2) {
      roundPanel.appendChild(el('div', { class: 'muted', style: 'text-align:center' },
        `Bu pozisyon için ${round.cascadeStage}/${round.cascadeTotal}. açık arttırma`));
    }

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI "TAM SÜRÜM"] "👁️ Gözcü" perk'i — kör
    // draftta, bu turun katılımcısıysan ve hakkın hâlâ aktifse, süre dolmadan rakiplerinin o anki
    // tekliflerini BİR KEZ görebilirsin (bkz. app.js peekBids — ACK-only, broadcast EDİLMEZ).
    // `state.room.players` kullanılıyor (`d.players`'ta prepPerk yok — bkz. DraftEngine.emitDraft).
    const myRoomPlayer = state.room.players.find((p) => p.clientId === state.clientId);
    const spyActive = isBlind && myRoomPlayer && myRoomPlayer.prepPerk && myRoomPlayer.prepPerk.kind === 'spy'
      && myRoomPlayer.prepPerk.active && (round.participantIds || []).includes(state.clientId);
    if (spyActive) {
      const peekResult = el('div', { class: 'muted', style: 'margin-top:6px;white-space:pre-line' }, '');
      const peekBtn = el('button', {
        class: 'btn small secondary',
        onclick: async () => {
          const res = await actions.peekBids();
          if (res && res.ok) {
            peekResult.textContent = Object.entries(res.bids).map(([id, amt]) => {
              const name = (state.room.players.find((p) => p.clientId === id) || {}).name || '?';
              return `${name}: ${amt != null ? fmtMoney(amt) : 'henüz teklif yok'}`;
            }).join('\n');
            peekBtn.remove(); // bir kereye mahsus — sunucu zaten NO_SPY_AVAILABLE döner ama UI'dan da kaldıralım
          }
        },
      }, '👁️ Gözcü: Teklifleri Gör (bir kerelik hak)');
      roundPanel.appendChild(el('div', { style: 'text-align:center;margin-top:8px' }, [peekBtn, peekResult]));
    }

    const me = d.players.find((p) => p.clientId === state.clientId);
    const cap = me ? me.budget - (Math.max(1, me.remainingSlots) - 1) * (state.config?.MIN_PLAYER_PRICE || 10) : 0;
    const errorText = el('div', { class: 'error-text' });

    if (isBlind) {
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft — rakibin teklifi hiçbir zaman canlı
      // gösterilmez (sunucu da göndermiyor), sadece "kilitledi mi" bilgisi paylaşılır. Kendi
      // teklifini round bitene kadar istediği kadar değiştirip yeniden gönderebilir.
      const roundKey = `${round.main.id}@${round.deadline}`;
      if (!state.blindBidUi || state.blindBidUi.roundKey !== roundKey) {
        state.blindBidUi = { roundKey, myAmount: null };
      }
      const minAmount = state.config?.MIN_PLAYER_PRICE || 10;
      // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Biri teklif verirken diğerinin yazdığı teklif
      // kayboluyor, tekrar yazması gerekiyor" — bu input kontrolsüzdü (değeri sadece DOM'da
      // yaşıyordu); rakibin bir hamlesi bile (draft:update broadcast) route()'u tetikleyip
      // inputu SIFIRDAN, varsayılan değerle yeniden kuruyordu. `data-focus-key` artık bu turla
      // (roundKey) eşleşiyor — app.js'teki genel yakala/geri-yükle mekanizması artık odaktan
      // BAĞIMSIZ olarak `.value`'yu da koruyor, YENİ bir tur başladığında (key değiştiğinde)
      // ise doğal olarak sıfırlanıyor.
      // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Teklif yazarken imleç sayının başına atıyor" —
      // kök neden: `type="number"` input'larda `setSelectionRange` çoğu tarayıcıda hata fırlatıyor
      // (app.js restoreFocus bunu sessizce yutuyordu) — değer korunsa bile imleç konumu HİÇBİR
      // ZAMAN korunamıyordu. `type="text"` + `inputmode="numeric"` ile setSelectionRange gerçekten
      // çalışıyor; rakam-dışı girişi engellemek için oninput'ta manuel filtreleniyor.
      const bidInput = el('input', {
        type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
        min: String(minAmount), max: String(cap), value: String(Math.min(Math.max(cap, minAmount), minAmount)),
        disabled: d.paused ? 'disabled' : undefined,
        'data-focus-key': `bid-input-${roundKey}`,
        oninput: (e) => {
          const digits = e.target.value.replace(/[^0-9]/g, '');
          if (digits !== e.target.value) e.target.value = digits;
        },
      });

      const submittedIds = round.submittedClientIds || [];
      const iSubmitted = submittedIds.includes(state.clientId);
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — tek bir "rakip" yerine bu
      // turdaki DİĞER tüm katılımcıların kilitleme durumu listelenir (miktar hâlâ hiç sızmıyor).
      const others = participants.filter((p) => p.clientId !== state.clientId);

      // Teklif yazılırken uyarı bloğu canlı güncellenir (tavana yaklaşma/aşma anında görülsün).
      let guardEl = bidGuard({ state, cap, planned: Number(bidInput.value) || 0 });
      if (guardEl) bidInput.addEventListener('input', () => {
        const next = bidGuard({ state, cap, planned: Number(bidInput.value) || 0 });
        if (next && guardEl.parentNode) { guardEl.replaceWith(next); guardEl = next; }
      });
      roundPanel.appendChild(el('div', { class: 'bid-panel sticky-mobile' }, [
        el('div', { class: 'bid-current' }, [
          el('div', {}, state.blindBidUi.myAmount != null
            ? ['Kilitlediğin teklif: ', el('b', {}, fmtMoney(state.blindBidUi.myAmount))]
            : 'Henüz teklif kilitlemedin'),
          el('div', { class: 'bid-leaderboard', style: 'margin-top:8px' }, others.map((o) => {
            const locked = submittedIds.includes(o.clientId);
            return el('div', { class: `bid-leaderboard-row ${locked ? 'leading' : ''}` }, [
              el('span', {}, o.name),
              el('span', {}, locked ? 'Kilitledi ✅' : 'Bekleniyor ⏳'),
            ]);
          })),
        ]),
        el('div', { class: 'bid-form' }, [
          bidInput,
          el('button', {
            class: 'btn',
            disabled: d.paused ? 'disabled' : undefined,
            onclick: async () => {
              const amount = Number(bidInput.value);
              const res = await actions.submitBid(amount);
              if (res && res.error) {
                errorText.textContent = `Reddedildi: ${res.error}`;
              } else {
                errorText.textContent = '';
                state.blindBidUi.myAmount = amount;
                actions.route();
              }
            },
          }, iSubmitted ? 'Teklifi Güncelle' : 'Teklifi Kilitle'),
        ]),
        guardEl,
        errorText,
      ]));
    } else {
      const minNext = round.highestBid > 0 ? round.highestBid + (state.config?.MIN_RAISE || 5) : (state.config?.MIN_PLAYER_PRICE || 10);
      const bidderName = round.highestBidderClientId
        ? (state.room.players.find((p) => p.clientId === round.highestBidderClientId)?.name || '?')
        : null;

      // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Biri teklif verirken diğerinin yazdığı teklif
      // kayboluyor" — canlı moddaki rakip teklifi her geldiğinde (round.highestBid değişince
      // minNext de değişir) bu input SIFIRDAN kuruluyordu; kendi yazdığın özel bir teklif varsa
      // sessizce siliniyordu. Aynı çözüm: data-focus-key round'a (bidRoundKey) bağlı, app.js'teki
      // genel mekanizma değeri odaktan bağımsız koruyor.
      const bidRoundKey = `${round.main.id}@${round.deadline}`;
      // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Teklif yazarken imleç sayının başına atıyor" —
      // bkz. yukarıdaki kör draft teklif input'undaki aynı düzeltme notu.
      const bidInput = el('input', {
        type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
        min: String(minNext), max: String(cap), value: String(Math.min(cap, minNext)),
        disabled: d.paused ? 'disabled' : undefined,
        'data-focus-key': `bid-input-${bidRoundKey}`,
        oninput: (e) => {
          const digits = e.target.value.replace(/[^0-9]/g, '');
          if (digits !== e.target.value) e.target.value = digits;
        },
      });

      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Diğer kullanıcıların ne kadar teklif verdiğini
      // göster her seferinde" — canlı modda miktarlar zaten gizli değil, bu yüzden HERKESİN o
      // anki teklifi (verdiyse) anlık olarak listelenir, sadece en yüksek teklif değil.
      const liveBids = round.bids || {};
      const leaderboard = el('div', { class: 'bid-leaderboard', style: 'margin-top:8px' }, participants.map((p) => {
        const amt = liveBids[p.clientId];
        return el('div', { class: `bid-leaderboard-row ${p.clientId === round.highestBidderClientId ? 'leading' : ''}` }, [
          el('span', {}, p.name + (p.clientId === state.clientId ? ' (sen)' : '')),
          el('span', {}, amt != null ? fmtMoney(amt) : '—'),
        ]);
      }));

      const prevBid = lastShownBid.has(bidRoundKey) ? lastShownBid.get(bidRoundKey) : null;
      lastShownBid.set(bidRoundKey, round.highestBid);
      const bidAmountEl = el('b', {});
      countUpMoney(bidAmountEl, prevBid, round.highestBid);

      // Teklif yazılırken uyarı bloğu canlı güncellenir (tavana yaklaşma/aşma anında görülsün).
      let guardEl = bidGuard({ state, cap, planned: Number(bidInput.value) || 0 });
      if (guardEl) bidInput.addEventListener('input', () => {
        const next = bidGuard({ state, cap, planned: Number(bidInput.value) || 0 });
        if (next && guardEl.parentNode) { guardEl.replaceWith(next); guardEl = next; }
      });
      roundPanel.appendChild(el('div', { class: 'bid-panel sticky-mobile' }, [
        el('div', { class: 'bid-current' }, round.highestBid > 0
          ? ['Güncel en yüksek teklif: ', bidAmountEl, ` (${bidderName})`]
          : 'Henüz teklif yok'),
        leaderboard,
        el('div', { class: 'bid-form' }, [
          bidInput,
          el('button', {
            class: 'btn',
            disabled: d.paused ? 'disabled' : undefined,
            onclick: async () => {
              const amount = Number(bidInput.value);
              const res = await actions.submitBid(amount);
              errorText.textContent = res && res.error ? `Reddedildi: ${res.error}` : '';
            },
          }, 'Teklif Ver'),
        ]),
        guardEl,
        errorText,
      ]));
    }
  }

  root.appendChild(roundPanel);

  // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Kör draftta draft sırasında ekranda çok fazla
  // gösterilen şey oluyor, kalabalık oluyor — isteğe bağlı açılıp kapanabilse güzel olur." —
  // odadaki HERKESİN 11'lik kadrosunu her zaman açık göstermek yerine katlanabilir bir panele
  // alındı (prep çark kataloğundaki `<details>` deseniyle aynı). Açık/kapalı tercihi
  // `state.draftUi`'de tutuluyor ki route() her socket broadcast'inde DOM'u sıfırdan kursa bile
  // (draft sırasında bu çok sık olur) kullanıcının seçimi bir sonraki broadcast'te kaybolmasın.
  if (!state.draftUi) state.draftUi = { squadsOpen: false };
  root.appendChild(el('details', {
    class: 'panel',
    open: state.draftUi.squadsOpen ? '' : undefined,
    ontoggle: (e) => { state.draftUi.squadsOpen = e.target.open; },
  }, [
    el('summary', {}, 'Kadrolar'),
    ...d.players.map((p) => el('div', { style: 'margin-bottom:14px' }, [
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, p.name + (p.clientId === state.clientId ? ' (sen)' : '')),
      el('div', { class: 'squad-grid' }, p.squad.map((s) => squadChip(s))),
    ])),
  ]));

  // [KULLANICI İSTEĞİ] Draft geçmişi — "kim neyi kaça aldı" draft bitince kaybolmasın.
  root.appendChild(draftHistoryPanel(state));

  return root;
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Round artık TEK KİŞİLİK bir tur
// (bkz. DraftEngine.nextWheelTurn) — sırası gelen kişi çarkı çevirir (görsel dilim/döndürme,
// bkz. wheelGeometry/wheelRotationFor), animasyon bitene kadar (bkz. wheelRevealReady) sonuç
// gizli kalır, sonra o segmente uygun bir seçim ekranı (ya da özel aksiyonlarda otomatik sonuç)
// açılır. Diğer katılımcılar da aynı anda AYNI çark animasyonunu/reveal zamanlamasını görür
// (round zaten broadcast edildiği için).
// [KULLANICI İSTEĞİ — HAZIRLIK ÇARKI "GÖRSEL ÇARK"] Bu, çark disk'inin (conic-gradient dilimler +
// yay genişliğine göre ölçeklenen etiketler + döndürme transform'u) ORTAK inşa mantığı — Çark
// Modu'ndaki `renderWheelRound` VE Hazırlık Çarkı'ndaki (`renderPrepWheel`) spin animasyonu
// TARAFINDAN paylaşılır. `animMap` çağıranın kendi spinKey->açı önbelleği (Çark Modu ve Hazırlık
// Çarkı ayrı Map kullanır — spinKey isim uzayları çakışmasın diye), `targetLabel` null ise disk
// hiç dönmeden (0deg) durur. `startedAtMap` (animMap ile AYNI spinKey'i paylaşan ayrı bir Map)
// — [DÜZELTİLDİ — BUG] "çark dönmüyor, direkt sonuç çıkıyor": bkz. wheelSpinStartedAt yorumu.
function buildWheelDiskEl(geo, spinKey, targetLabel, animMap, startedAtMap) {
  const disk = el('div', { class: 'wheel-disk' });
  disk.style.background = `conic-gradient(${geo.map((s) => `${s.color} ${s.startPct}% ${s.endPct}%`).join(', ')})`;
  for (const s of geo) {
    const angleDeg = s.endDeg - s.startDeg;
    const arcWidth = 2 * LABEL_RADIUS * Math.sin((angleDeg / 2) * (Math.PI / 180));
    const labelWidth = Math.max(30, Math.min(70, Math.round(arcWidth * 0.86)));
    const fontSize = labelWidth < 38 ? 9 : labelWidth < 50 ? 10 : 11.5;
    const displayLabel = s.label.replace(/^\p{Extended_Pictographic}️?\s*/u, '');
    disk.appendChild(el('div', {
      class: 'wheel-slice-label',
      style: `transform: rotate(${s.centerDeg}deg) translateY(-${LABEL_RADIUS}px) rotate(${-(s.centerDeg + (animMap.get(spinKey) || 0))}deg); width:${labelWidth}px; margin-left:${-labelWidth / 2}px; font-size:${fontSize}px;`,
    }, displayLabel));
  }

  if (targetLabel) {
    let finalDeg = animMap.get(spinKey);
    if (finalDeg == null) {
      finalDeg = wheelRotationFor(geo, targetLabel);
      animMap.set(spinKey, finalDeg);
      startedAtMap.set(spinKey, Date.now());
      sfx.play('wheel'); // [KULLANICI İSTEĞİ] "Ses efektleri daha iyi olabilir" — spin GERÇEKTEN başlarken (spinKey ilk görüldüğünde) bir kere çalar, her re-render'da değil
      disk.style.transition = 'none';
      disk.style.transform = 'rotate(0deg)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          disk.style.transition = `transform ${WHEEL_SPIN_DURATION_MS}ms cubic-bezier(0.14, 0.68, 0.16, 1)`;
          disk.style.transform = `rotate(${finalDeg}deg)`;
        });
      });
    } else {
      // [DÜZELTİLDİ — BUG, KULLANICI GERİ BİLDİRİMİ] "Çark dönmüyor, direkt sonuç çıkıyor" — bu
      // ARA bir re-render (route() DOM'u sıfırdan kuruyor, bkz. rakibin bir aksiyonundan/yeniden
      // bağlanmadan gelen bir room:state/draft:update broadcast'i). Eskiden burada koşulsuz
      // `transition:none` ile doğrudan finalDeg'e ATLANIYORDU — animasyon süresi (WHEEL_SPIN_
      // DURATION_MS) henüz dolmadıysa bu, dönüşü GÖRÜNMEZ hale getirip sonucu anlık gösteriyordu.
      // Artık ilk render'ın ne zaman başladığı (startedAtMap) hatırlanıyor: süre dolmadıysa yeni
      // disk elemanı 0deg'den başlayıp KALAN süre kadar dönmeye devam ediyor (asla sıçramıyor);
      // süre gerçekten dolduysa (normal reveal-sonrası re-render) eskisi gibi anında finalDeg'de duruyor.
      const startedAt = startedAtMap.get(spinKey);
      const elapsed = startedAt != null ? Date.now() - startedAt : WHEEL_SPIN_DURATION_MS;
      const remaining = WHEEL_SPIN_DURATION_MS - elapsed;
      if (remaining > 50) {
        disk.style.transition = 'none';
        disk.style.transform = 'rotate(0deg)';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            disk.style.transition = `transform ${remaining}ms cubic-bezier(0.14, 0.68, 0.16, 1)`;
            disk.style.transform = `rotate(${finalDeg}deg)`;
          });
        });
      } else {
        disk.style.transition = 'none';
        disk.style.transform = `rotate(${finalDeg}deg)`;
      }
    }
  } else {
    disk.style.transition = 'none';
    disk.style.transform = 'rotate(0deg)';
  }
  return disk;
}

function renderWheelRound({ state, actions, round, paused }) {
  const wrap = el('div', { class: 'wheel-round' });
  const nameOf = (id) => (state.room.players.find((p) => p.clientId === id) || {}).name || '?';
  const segments = (state.draft && state.draft.wheelSegments) || [];
  const geo = wheelGeometry(segments);
  const myTurn = round.clientId === state.clientId;
  const turnName = nameOf(round.clientId) + (myTurn ? ' (sen)' : '');

  wrap.appendChild(el('h3', {}, `Çark Modu — ${round.slotType} pozisyonu`));

  // --- Çark grafiği: conic-gradient dilimler + döndürme animasyonu ---
  const spinKey = round.currentSpin ? `${round.clientId}@${round.deadline}` : null;
  const revealReady = spinKey ? wheelRevealReady.get(spinKey) === true : false;

  if (spinKey && !wheelRevealScheduled.has(spinKey)) {
    wheelRevealScheduled.add(spinKey);
    setTimeout(() => {
      wheelRevealReady.set(spinKey, true);
      actions.route();
    }, WHEEL_REVEAL_DELAY_MS);
  }

  const isAutoKind = round.currentSpin && WHEEL_AUTO_KINDS.has(round.currentSpin.kind);
  let bannerText;
  if (round.phase === 'awaiting_spin') {
    bannerText = myTurn ? '🎡 Sıra sende! Çarkı çevir.' : `⏳ ${turnName} çeviriyor...`;
  } else if (!revealReady) {
    bannerText = '🎡 Çark dönüyor...';
  } else if (isAutoKind) {
    bannerText = `⚡ ${round.currentSpin.label} — sonuç uygulanıyor!`;
  } else {
    bannerText = myTurn ? `🎯 ${round.currentSpin.label} bandı çıktı — bir oyuncu seç!` : `⏳ ${turnName} seçim yapıyor...`;
  }
  wrap.appendChild(el('div', { class: `wheel-turn-banner ${myTurn ? 'mine' : ''}` }, bannerText));

  // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Çarktaki yazılar güzel gözükmüyor" — kök neden:
  // her dilime SABİT 64px'lik bir etiket kutusu veriliyordu, ama ağırlıklı çark yüzünden dilimler
  // eşit genişlikte DEĞİL (bkz. gameConfig.js WHEEL_RATING_BANDS/WHEEL_SPECIAL_SEGMENTS weight
  // farkları) — dar bir dilime uzun bir etiket denk gelince metin komşu dilime taşıyordu; artık
  // her etiketin genişliği/font boyutu KENDİ diliminin gerçek yay genişliğine göre hesaplanıyor
  // (bkz. buildWheelDiskEl).
  const disk = buildWheelDiskEl(geo, spinKey, round.currentSpin ? round.currentSpin.label : null, wheelSpinAnimated, wheelSpinStartedAt);

  const stage = el('div', {
    // [KULLANICI İSTEĞİ] "Döndüğü belli olsun" — dönerken (reveal'a kadar) bir glow/pulse
    // halkası, iniş anında pointer'da kısa bir "bounce" (bkz. styles.css .wheel-stage.spinning /
    // .wheel-pointer.landed).
    class: `wheel-stage ${round.currentSpin && !revealReady ? 'spinning' : ''}`,
  }, [el('div', { class: `wheel-pointer ${revealReady ? 'landed' : ''}` }), disk]);
  wrap.appendChild(stage);

  // --- Geri sayım (spin öncesi/sonrası aynı deadline mekanizması) ---
  const timerLabel = el('div', { class: 'timer-label' }, '—');
  const timerFill = el('div', { class: 'timer-fill', style: 'width:100%' });
  const timerWrap = el('div', { class: 'timer-wrap' }, [el('div', { class: 'timer-bar' }, timerFill), timerLabel]);
  wrap.appendChild(timerWrap);

  clearInterval(timerInterval);
  const nominalMs = (state.config?.WHEEL_PICK_DURATION_SECONDS || 20) * 1000;
  if (paused) {
    const frozenLeft = round.pausedRemainingMs != null ? round.pausedRemainingMs : 0;
    timerLabel.textContent = `⏸ ${(frozenLeft / 1000).toFixed(1)} sn (duraklatıldı)`;
    timerFill.style.width = `${Math.min(100, (frozenLeft / nominalMs) * 100)}%`;
  } else if (round.deadline) {
    const tick = () => {
      const left = Math.max(0, round.deadline - Date.now());
      timerLabel.textContent = `${(left / 1000).toFixed(1)} sn`;
      timerFill.style.width = `${Math.min(100, (left / nominalMs) * 100)}%`;
      timerWrap.classList.toggle('urgent', left <= 5000 && left > 2000);
      timerWrap.classList.toggle('critical', left <= 2000);
      countdownTick(left);
      if (left <= 0) clearInterval(timerInterval);
    };
    tick();
    timerInterval = setInterval(tick, 150);
  }

  // --- Aksiyon alanı ---
  if (myTurn && round.phase === 'awaiting_spin') {
    wrap.appendChild(el('button', {
      class: 'btn block wheel-spin-btn',
      disabled: paused ? 'disabled' : undefined,
      onclick: () => actions.spinWheel(),
    }, [
      el('span', { class: 'wheel-spin-btn-icon' }, '🎡'),
      el('span', { class: 'wheel-spin-btn-label' }, 'ÇARKI ÇEVİR'),
    ]));
  } else if (myTurn && round.phase === 'awaiting_pick' && round.currentSpin) {
    if (!revealReady) {
      wrap.appendChild(el('div', { class: 'muted wheel-reveal-pending', style: 'text-align:center' }, 'Çark yavaşlıyor...'));
    } else if (isAutoKind) {
      wrap.appendChild(el('div', { class: 'muted wheel-reveal-pending', style: 'text-align:center' }, 'Sonuç uygulanıyor, birazdan göreceksin...'));
    } else {
      wrap.appendChild(renderWheelPickList({ state, actions, round }));
    }
  }

  return wrap;
}

// [KULLANICI İSTEĞİ] "Oyuncu seçme ekranı açılacak, oradan 90+ oyuncuları seçecek" — çarktan
// çıkan segmente (reyting bandı, efsane havuzu, lig/milliyet piyangosu ya da "rakipten çal")
// göre uygun (henüz kimse tarafından alınmamış) adaylar, reytinge göre azalan sırada, tıklanabilir
// kompakt bir liste olarak gösterilir (potansiyel olarak onlarca/yüzlerce aday olabileceği için
// tam boy player-card grid'i yerine bilerek kompakt satırlar — bkz. renderPlayerDatabase'deki
// benzer yoğun-liste deseni).
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kullanıcı karar vermek istemezse bilgisayar atasın." —
// seçim ekranının HER varyantına (steal/rating/icon/league/nation/club, aday var/yok) eklenen
// ortak bir "kararsızım" çıkışı — süre dolmasını (WHEEL_PICK_DURATION_SECONDS) beklemeden sunucuya
// AYNI otomatik-seçim mantığını (bkz. DraftEngine.requestAutoPick/autoPickWheel) hemen çalıştırtır.
function autoPickButton(actions) {
  const btn = el('button', {
    type: 'button', class: 'btn secondary block wheel-autopick-btn',
    onclick: async () => { btn.disabled = true; await actions.requestWheelAutoPick(); },
  }, '🤖 Kararsızım, Bilgisayar Seçsin');
  return btn;
}

function renderWheelPickList({ state, actions, round }) {
  const wrap = el('div', { class: 'wheel-pick-wrap' });
  const seg = round.currentSpin;

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Rakipten istediğin oyuncuyu al" — aday
  // listesi state.playerDb DEĞİL, diğer katılımcıların O AN KİDROSU (state.draft.players[].squad,
  // zaten sunucudan geliyor) — bu turun pozisyon tipinde olan tüm rakip-sahipli oyuncular.
  if (seg.kind === 'steal') {
    const rows = [];
    for (const p of state.draft.players) {
      if (p.clientId === state.clientId) continue;
      for (const s of p.squad) if (s.slot === round.slotType) rows.push({ owner: p, entry: s });
    }
    if (rows.length === 0) {
      wrap.appendChild(el('div', { class: 'muted', style: 'text-align:center' },
        'Rakiplerde bu pozisyonda oyuncu kalmadı — süre dolunca sunucu otomatik seçecek.'));
      wrap.appendChild(autoPickButton(actions));
      return wrap;
    }
    rows.sort((a, b) => b.entry.player.rating - a.entry.player.rating);
    wrap.appendChild(el('div', { class: 'muted', style: 'text-align:center;margin-bottom:8px' }, `${rows.length} aday — kimden çalacağını seç`));
    const list = el('div', { class: 'wheel-pick-list' }, rows.map(({ owner, entry }) => {
      const row = el('button', { type: 'button', class: 'wheel-pick-row wheel-steal-row' }, [
        el('span', { class: `pos-badge pos-${slotGroup(entry.player.position)}` }, entry.player.position),
        el('span', { class: 'wheel-pick-rating' }, String(entry.player.rating)),
        el('span', { class: 'wheel-pick-name' }, entry.player.name + (entry.player.isIcon ? ' ⭐' : '')),
        el('span', { class: 'wheel-pick-club muted' }, `🎯 ${owner.name}${owner.clientId === state.clientId ? ' (sen)' : ''}`),
      ]);
      row.addEventListener('click', async () => {
        for (const r of list.querySelectorAll('.wheel-pick-row')) r.disabled = true;
        await actions.submitWheelPick(entry.player.id, owner.clientId);
      });
      return row;
    }));
    wrap.appendChild(el('div', { class: 'wheel-pick-scroll' }, list));
    wrap.appendChild(autoPickButton(actions));
    return wrap;
  }

  if (!state.playerDb || state.playerDb.status !== 'ready') {
    if (!state.playerDb || state.playerDb.status !== 'loading') {
      actions.fetchPlayerDb().then(() => actions.route());
    }
    wrap.appendChild(el('div', { class: 'muted', style: 'text-align:center' }, 'Oyuncular yükleniyor...'));
    return wrap;
  }

  // Havuzdan düşenleri (odadaki HERKESİN o ana kadarki kadrosu — sadece bu round değil, draftın
  // tamamı) dışarıda bırak — state.draft.players[].squad zaten sunucudan bu bilgiyi taşıyor.
  const takenIds = new Set();
  for (const p of state.draft.players) for (const s of p.squad) takenIds.add(s.player.id);

  let candidates = state.playerDb.all.filter((p) => !takenIds.has(p.id) && p.position === round.slotType);
  if (seg.kind === 'icon') candidates = candidates.filter((p) => p.isIcon);
  else if (seg.kind === 'league') candidates = candidates.filter((p) => p.league === round.revealValue);
  else if (seg.kind === 'nation') candidates = candidates.filter((p) => p.nation === round.revealValue);
  else if (seg.kind === 'club') candidates = candidates.filter((p) => p.club === round.revealValue);
  else candidates = candidates.filter((p) => p.rating >= seg.min && p.rating <= seg.max);
  candidates = candidates.sort((a, b) => b.rating - a.rating);

  if (candidates.length === 0) {
    wrap.appendChild(el('div', { class: 'muted', style: 'text-align:center' },
      'Bu segmentte uygun oyuncu kalmadı — süre dolunca sunucu otomatik olarak seni atayacak.'));
    wrap.appendChild(autoPickButton(actions));
    return wrap;
  }

  const headerBits = [];
  if ((seg.kind === 'league' || seg.kind === 'nation' || seg.kind === 'club') && round.revealValue) headerBits.push(`🎯 ${round.revealValue}`);
  headerBits.push(`${candidates.length} aday — birini seç`);
  wrap.appendChild(el('div', { class: 'muted', style: 'text-align:center;margin-bottom:8px' }, headerBits.join(' — ')));

  const list = el('div', { class: 'wheel-pick-list' }, candidates.map((p) => {
    const row = el('button', { type: 'button', class: 'wheel-pick-row' }, [
      el('span', { class: `pos-badge pos-${slotGroup(p.position)}` }, p.position),
      el('span', { class: 'wheel-pick-rating' }, String(p.rating)),
      el('span', { class: 'wheel-pick-name' }, p.name + (p.isIcon ? ' ⭐' : '')),
      el('span', { class: 'wheel-pick-club muted' }, p.isIcon ? p.nation : p.club),
    ]);
    row.addEventListener('click', async () => {
      for (const r of list.querySelectorAll('.wheel-pick-row')) r.disabled = true;
      await actions.submitWheelPick(p.id);
    });
    return row;
  }));
  wrap.appendChild(el('div', { class: 'wheel-pick-scroll' }, list));
  wrap.appendChild(autoPickButton(actions));
  return wrap;
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Teklif verdiğinde oyuncunun kimin aldığını kaç paraya
// aldığını diğer kullanıcıların ne kadar teklif verdiğini göster her seferinde" — bir round
// çözüldüğünde (canlı VEYA kör, ana oyuncu VEYA tek taraflı) gösterilen ortak "Tur Sonucu"
// paneli: kazananı + fiyatı, yedek merdivenini (kim, ne fiyata) ve TÜM katılımcıların teklif
// dökümünü (bkz. DraftEngine `bids` reveal) net bir şekilde listeler.
// [KULLANICI İSTEĞİ] "Oyuncu alan kişi kaça aldığı daha güzel bir ekranda gözükebilir" —
// v2: küçük bir metin etiketi yerine üstte büyük, net bir "makbuz" şeridi (alıcı + fiyat +
// oyuncu tek bakışta), teklif dökümü artık miktara göre SIRALI ve her satırın arkasında en
// yüksek teklife oranla bir çubuk (kimin ne kadar yaklaştığını görsel olarak da anlatıyor).
function receiptStrip({ emoji, headline, sub }) {
  return el('div', { class: 'round-receipt' }, [
    el('div', { class: 'round-receipt-emoji' }, emoji),
    el('div', { class: 'round-receipt-text' }, [
      el('div', { class: 'round-receipt-headline' }, headline),
      sub ? el('div', { class: 'round-receipt-sub' }, sub) : null,
    ]),
  ]);
}

function renderRoundResultPanel(event, state) {
  const nameOf = (id) => (state.room.players.find((p) => p.clientId === id) || {}).name || '?';
  const wrap = el('div', { class: 'round-result' });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Çıkan sonuç ekrana gelsin" — çark
  // modunun her turu (normal seçim, çal/ver, şanssız tur, lig/milliyet piyangosu) burada aynı
  // "Tur Sonucu" makbuz deseniyle gösterilir, tıpkı auction/blind/one_sided gibi.
  if (event.type === 'wheel_turn_resolved') {
    const actor = nameOf(event.clientId) + (event.clientId === state.clientId ? ' (sen)' : '');
    wrap.appendChild(el('h3', {}, '🎡 Çark Sonucu'));
    if (event.segmentKind === 'steal') {
      const victim = nameOf(event.fromClientId) + (event.fromClientId === state.clientId ? ' (sen)' : '');
      wrap.appendChild(receiptStrip({
        emoji: '🎁', headline: `${actor} → ${event.player.name}`,
        sub: `${victim}'nin kadrosundan çalındı — ${victim} bu pozisyon için tekrar çark çevirecek.`,
      }));
    } else if (event.segmentKind === 'give_best') {
      const receiver = nameOf(event.toClientId) + (event.toClientId === state.clientId ? ' (sen)' : '');
      wrap.appendChild(receiptStrip({
        emoji: '😱', headline: `${actor} → ${receiver}`,
        sub: `En iyi oyuncusu ${event.player.name}'i vermek zorunda kaldı.`,
      }));
    } else if (event.segmentKind === 'forced_worst') {
      wrap.appendChild(receiptStrip({
        emoji: '💀', headline: `${actor} → ${event.player.name}`,
        sub: 'Şanssız tur — bu pozisyondaki en düşük reytingli oyuncu otomatik atandı.',
      }));
    } else if ((event.segmentKind === 'league' || event.segmentKind === 'nation' || event.segmentKind === 'club') && event.revealValue) {
      wrap.appendChild(receiptStrip({
        emoji: '🎡', headline: `${actor} → ${event.player.name}`,
        sub: `${event.revealValue} piyangosu (${event.band}) — ücretsiz seçildi.`,
      }));
    } else {
      wrap.appendChild(receiptStrip({
        emoji: '🎡', headline: `${actor} → ${event.player.name}`,
        sub: `${event.band} bandından ücretsiz seçildi.`,
      }));
    }
    wrap.appendChild(el('div', { class: 'reveal-row' }, [
      playerCard(event.player, { slot: event.slotType, extraClass: 'main', tag: `🎡 ${actor}` }),
    ]));
    wrap.appendChild(el('p', { class: 'muted', style: 'text-align:center;margin-top:12px' }, '⏳ Sıradaki tur birazdan başlıyor...'));
    return wrap;
  }

  if (event.type === 'joker_used') {
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI "TAM SÜRÜM"] "🃏 Joker Turu" perk'i —
    // rekabet hiç açılmadan, ücretsiz kazanılan bir pozisyon.
    const buyer = nameOf(event.clientId) + (event.clientId === state.clientId ? ' (sen)' : '');
    wrap.appendChild(el('h3', {}, `🃏 Joker Turu — ${event.slotType} pozisyonu`));
    wrap.appendChild(receiptStrip({
      emoji: '🃏', headline: `${buyer} → ${event.player.name}`,
      sub: 'Hazırlık Çarkı\'ndaki Joker Turu perk\'i kullanıldı — rekabet olmadan, tamamen ücretsiz!',
    }));
    wrap.appendChild(el('div', { class: 'reveal-row' }, [
      playerCard(event.player, { slot: event.slotType, extraClass: 'main', tag: '🃏 Joker — 0₺' }),
    ]));
    return wrap;
  }

  if (event.type === 'one_sided_assigned') {
    const buyer = nameOf(event.clientId) + (event.clientId === state.clientId ? ' (sen)' : '');
    wrap.appendChild(el('h3', {}, `Sonuç — ${event.slotType} pozisyonu`));
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "N kullanıcı için N-1 açık arttırma" — bu event artık
    // iki farklı durumu paylaşıyor: (1) gerçek tek taraflı ihtiyaç (bu pozisyona hiç kimse başka
    // ihtiyaç duymuyordu, cascadeFinal yok), (2) bir kaskadın son aşaması (herkes sırasıyla açık
    // arttırmayla kendi oyuncusunu aldı, en son bu kişi kaldı — bkz. DraftEngine.startCascadeStage).
    const sub = event.cascadeFinal
      ? `Rakipsiz, ${fmtMoney(event.price)} — bu pozisyon için sıradaki herkes kendi açık arttırmasını kazandı, sen son kalan kişiydin.`
      : `Rakipsiz, ${fmtMoney(event.price)} — bu pozisyona sadece bu oyuncunun ihtiyacı vardı.`;
    wrap.appendChild(receiptStrip({ emoji: '🤝', headline: `${buyer} → ${event.player.name}`, sub }));
    wrap.appendChild(el('div', { class: 'reveal-row' }, [
      playerCard(event.player, { slot: event.slotType, extraClass: 'main' }),
    ]));
    return wrap;
  }

  const isBlind = event.type === 'blind_auction_resolved';
  const winner = nameOf(event.winnerClientId) + (event.winnerClientId === state.clientId ? ' (sen)' : '');
  wrap.appendChild(el('h3', {}, isBlind ? '🔓 Kör Teklif Sonucu' : '📢 Açık Arttırma Sonucu'));
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kaskad — bu artık bir "ladder"ın parçası değil, bu
  // aşamanın TEK sonucu; kaybedenler bir sonraki (bir alt reytingli) aday için AYRI, taze bir
  // açık arttırmaya girecek (bkz. o sonraki round-result panelinde ayrı ayrı görünecekler).
  const progressSub = event.cascadeTotal > 2 ? ` — ${event.cascadeStage}/${event.cascadeTotal}. açık arttırma` : '';
  wrap.appendChild(receiptStrip({
    emoji: '🏆', headline: `${winner} → ${event.main.name}`,
    sub: `${fmtMoney(event.price)} karşılığında kadroya kattı${progressSub}`,
  }));
  wrap.appendChild(el('div', { class: 'reveal-row' }, [
    // .sold-wrap: saf CSS'te (bkz. styles.css) dönen bir "SATILDI" damgası basar — bu turun
    // dramatik anını (kim aldı) vurgulamak için.
    el('div', { class: 'sold-wrap' }, [playerCard(event.main, {
      slot: event.slotType, extraClass: 'main',
      tag: `🏆 ${winner} — ${fmtMoney(event.price)}`,
    })]),
  ]));

  // Herkesin teklif dökümü — kör modda bu, round bitene kadar hiç görünmeyen bilginin
  // "reveal" anı; canlı modda zaten bilinen tekliflerin net bir özeti. Artık miktara göre
  // (yüksekten alçağa, teklif vermeyenler en altta) sıralanıyor ve her satırın arkasında en
  // yüksek teklife oranla dolan bir çubuk var — "kim kime ne kadar yaklaştı" tek bakışta okunsun.
  const bids = event.bids || {};
  const bidIds = Object.keys(bids);
  if (bidIds.length) {
    const maxAmt = Math.max(1, ...bidIds.map((id) => bids[id] || 0));
    const sortedIds = [...bidIds].sort((a, b) => (bids[b] ?? -1) - (bids[a] ?? -1));
    wrap.appendChild(el('div', { class: 'muted', style: 'text-align:center;margin-top:16px' }, 'Teklif dökümü'));
    wrap.appendChild(el('div', { class: 'bid-leaderboard', style: 'margin:8px auto 0' }, sortedIds.map((id) => {
      const amt = bids[id];
      const pct = amt != null ? Math.max(6, Math.round((amt / maxAmt) * 100)) : 0;
      return el('div', {
        class: `bid-leaderboard-row ${id === event.winnerClientId ? 'leading' : ''}`,
        style: `--pct:${pct}%`,
      }, [
        el('span', {}, nameOf(id) + (id === state.clientId ? ' (sen)' : '')),
        el('span', {}, amt != null ? fmtMoney(amt) : 'Teklif vermedi'),
      ]);
    })));
  }

  wrap.appendChild(el('p', { class: 'muted', style: 'text-align:center;margin-top:12px' }, '⏳ Sıradaki tur birazdan başlıyor...'));
  return wrap;
}


// ============================== TAKAS TURU ==============================
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKAS TURU] Kurallar ve sunucu tarafı: bkz.
// server/src/trade/TradeEngine.js. Bu ekran sadece o kuralları GÖSTERİR ve teklif kurar:
//   · 1↔1, para yok, kaleci takas edilemez, mevki serbest.
//   · Teklif kurulurken "takastan sonra kurabileceğin formasyonlar" CANLI hesaplanır (aşağıdaki
//     canBuildFormation — sunucudaki lineup.js ile aynı bipartite eşleştirme mantığı, sadece
//     önizleme için; asıl doğrulama her zaman sunucuda).
//   · Aynı kişiyle en fazla maxPerPair (2) takas; bekleyen teklifteki oyuncular kilitli.
//   · 5 dk geri sayım, herkes "bitti" derse erken kapanır.

// Sunucudaki maxBipartiteMatching'in kompakt istemci karşılığı (sadece önizleme).
function canBuildFormation(entries, slotInstances) {
  if (!slotInstances || entries.length !== slotInstances.length) return false;
  const elig = entries.map((e) => new Set((e.eligibleSlots || []).map((x) => x.slot)));
  const slotToPlayer = new Array(slotInstances.length).fill(-1);
  const tryAssign = (pIdx, visited) => {
    for (let s = 0; s < slotInstances.length; s++) {
      if (visited[s] || !elig[pIdx].has(slotInstances[s])) continue;
      visited[s] = true;
      if (slotToPlayer[s] === -1 || tryAssign(slotToPlayer[s], visited)) { slotToPlayer[s] = pIdx; return true; }
    }
    return false;
  };
  let matched = 0;
  for (let p = 0; p < entries.length; p++) {
    if (tryAssign(p, new Array(slotInstances.length).fill(false))) matched++;
  }
  return matched === slotInstances.length;
}

function buildableKeys(state, entries) {
  const F = state.config?.FORMATIONS || {};
  return Object.keys(F).filter((key) => canBuildFormation(entries, F[key]));
}

function tradeSquadRow({ entry, selected, locked, disabled, onPick }) {
  const isGK = entry.position === 'GK';
  const tag = isGK ? 'Takas edilemez' : locked ? 'Teklifte' : '';
  return el('button', {
    type: 'button',
    class: `trade-row ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`,
    disabled: disabled ? 'disabled' : undefined,
    onclick: disabled ? null : onPick,
  }, [
    el('span', { class: `pos-badge pos-${slotGroup(entry.position)}` }, entry.position),
    el('span', { class: 'trade-row-name' }, entry.name + (entry.isIcon ? ' ⭐' : '')),
    tag ? el('span', { class: `trade-row-tag ${isGK ? 'gk' : 'locked'}` }, tag) : el('span', {}),
    el('span', { class: `trade-row-rating ${entry.rating >= 90 ? 'hot' : ''}` }, String(entry.rating)),
  ]);
}

export function renderTradeRound({ state, actions }) {
  const root = el('div', { class: 'view trade' });
  const room = state.room;
  const t = state.trade;

  if (!t || !t.squads) {
    root.appendChild(el('div', { class: 'panel' }, 'Takas turu yükleniyor...'));
    actions.syncTrade();
    return root;
  }

  if (!state.tradeUi) state.tradeUi = { rival: null, give: null, get: null };
  const ui = state.tradeUi;
  const rivals = room.players.filter((p) => p.clientId !== state.clientId);
  if (!ui.rival || !rivals.find((p) => p.clientId === ui.rival)) ui.rival = rivals[0]?.clientId || null;

  const mySquad = t.squads[state.clientId] || [];
  const rivalSquad = ui.rival ? (t.squads[ui.rival] || []) : [];
  const nameOf = (id) => (room.players.find((p) => p.clientId === id) || {}).name || '?';
  const lockedIds = new Set(t.lockedPlayerIds || []);
  const maxPerPair = t.maxPerPair || state.config?.TRADE_MAX_PER_PAIR || 2;
  const pairUsed = (t.pairCounts || {})[ui.rival] || 0;
  const pairFull = pairUsed >= maxPerPair;
  const iAmDone = (t.doneVotes || []).includes(state.clientId);

  // ---------- üst bar: geri sayım + "bitti" oyu ----------
  const clockLabel = el('div', { class: 'trade-clock' }, '—');
  const clockFill = el('div', { class: 'timer-fill', style: 'width:100%' });
  const clockWrap = el('div', { class: 'timer-wrap trade-timer' }, [el('div', { class: 'timer-bar' }, clockFill), clockLabel]);
  clearInterval(timerInterval);
  const totalMs = (state.config?.TRADE_ROUND_DURATION_SECONDS || 300) * 1000;
  const tick = () => {
    const left = Math.max(0, (t.deadline || 0) - Date.now());
    const mm = Math.floor(left / 60000);
    const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
    clockLabel.textContent = `${mm}:${ss}`;
    clockFill.style.width = `${Math.min(100, (left / totalMs) * 100)}%`;
    clockWrap.classList.toggle('critical', left <= 30000);
    if (left <= 0) clearInterval(timerInterval);
  };
  tick();
  timerInterval = setInterval(tick, 500);

  root.appendChild(el('div', { class: 'trade-head' }, [
    el('div', { class: 'trade-head-left' }, [
      el('span', { class: 'trade-live' }, 'Takas turu açık'),
      el('span', { class: 'trade-badge' }, `Para yok · 1↔1 · kaleci hariç · aynı kişiyle en fazla ${maxPerPair}`),
    ]),
    el('div', { class: 'trade-head-right' }, [
      clockWrap,
      el('button', {
        type: 'button', class: `btn small ${iAmDone ? '' : 'secondary'} trade-done-btn`,
        onclick: () => actions.toggleTradeDone(),
      }, iAmDone
        ? `✓ Bitti dedin (${(t.doneVotes || []).length}/${room.players.length})`
        : 'Takas turunu bitir'),
    ]),
  ]));

  root.appendChild(el('div', { class: 'trade-intro' }, [
    el('h1', { class: 'trade-title' }, 'Takas Turu'),
    el('p', { class: 'trade-sub' }, 'Kadrondan bir oyuncu verip rakipten bir oyuncu al. Mevki serbest — verdiğin orta saha yerine forvet alıp formasyonunu değiştirebilirsin. Tek şart: takastan sonra iki kadro da en az bir formasyon kurabilmeli. Herkes "bitti" derse tur süre dolmadan kapanır.'),
  ]));

  // ---------- gelen teklifler ----------
  const incoming = t.incoming || [];
  if (incoming.length) {
    root.appendChild(el('div', { class: 'panel trade-incoming' }, [
      el('h3', {}, `Gelen Teklifler (${incoming.length})`),
      el('div', { class: 'trade-offer-list' }, incoming.map((o) => {
        const after = mySquad.filter((e) => e.playerId !== o.get.playerId).concat([o.give]);
        const keys = buildableKeys(state, after);
        return el('div', { class: 'trade-offer' }, [
          el('div', { class: 'trade-offer-body' }, [
            el('div', { class: 'trade-offer-from' }, `${nameOf(o.fromClientId)} teklif etti`),
            el('div', { class: 'trade-offer-pair' }, [
              el('span', { class: 'trade-offer-side' }, [
                el('span', { class: `pos-badge pos-${slotGroup(o.give.position)}` }, o.give.position),
                el('b', {}, o.give.name), el('span', { class: 'trade-offer-rating' }, String(o.give.rating)),
              ]),
              el('span', { class: 'trade-swap-icon' }, '⇄'),
              el('span', { class: 'trade-offer-side' }, [
                el('span', { class: `pos-badge pos-${slotGroup(o.get.position)}` }, o.get.position),
                el('b', {}, o.get.name), el('span', { class: 'trade-offer-rating' }, String(o.get.rating)),
              ]),
            ]),
            el('div', { class: `trade-offer-note ${keys.length ? '' : 'bad'}` }, keys.length
              ? `Kabul edersen kurabileceğin formasyonlar: ${keys.join(', ')}`
              : 'Kabul edilemez — kadron geçerli bir formasyon kuramaz.'),
          ]),
          el('div', { class: 'trade-offer-actions' }, [
            el('button', { type: 'button', class: 'btn small trade-accept', onclick: () => actions.acceptTrade(o.id) }, 'Kabul et'),
            el('button', { type: 'button', class: 'btn small secondary', onclick: () => actions.cancelTrade(o.id) }, 'Reddet'),
          ]),
        ]);
      })),
    ]));
  }

  // ---------- kadrolar ----------
  const giveEntry = mySquad.find((e) => e.playerId === ui.give) || null;
  const getEntry = rivalSquad.find((e) => e.playerId === ui.get) || null;

  root.appendChild(el('div', { class: 'trade-grid' }, [
    el('div', { class: 'panel trade-squad' }, [
      el('h3', {}, 'Kadron'),
      el('div', { class: 'trade-squad-hint' }, 'Vereceğin oyuncuyu seç'),
      el('div', { class: 'trade-list' }, mySquad.map((entry) => tradeSquadRow({
        entry,
        selected: ui.give === entry.playerId,
        locked: lockedIds.has(entry.playerId),
        disabled: entry.position === 'GK' || lockedIds.has(entry.playerId),
        onPick: () => { ui.give = entry.playerId; actions.route(); },
      }))),
    ]),
    el('div', { class: 'panel trade-squad' }, [
      el('h3', {}, 'Rakip Kadrosu'),
      el('div', { class: 'trade-squad-hint' }, [
        el('span', {}, 'Almak istediğin oyuncuyu seç'),
        el('span', { class: `trade-pair-limit ${pairFull ? 'full' : ''}` }, `${nameOf(ui.rival)} ile ${pairUsed}/${maxPerPair} takas`),
      ]),
      el('div', { class: 'trade-tabs' }, rivals.map((p) => el('button', {
        type: 'button', class: `trade-tab ${ui.rival === p.clientId ? 'active' : ''}`,
        onclick: () => { ui.rival = p.clientId; ui.get = null; actions.route(); },
      }, p.name + (p.connected ? '' : ' (kopuk)')))),
      el('div', { class: 'trade-list' }, rivalSquad.map((entry) => tradeSquadRow({
        entry,
        selected: ui.get === entry.playerId,
        locked: lockedIds.has(entry.playerId),
        disabled: entry.position === 'GK' || lockedIds.has(entry.playerId) || pairFull,
        onPick: () => { ui.get = entry.playerId; actions.route(); },
      }))),
    ]),
  ]));

  // ---------- teklif kurucu + formasyon önizlemesi ----------
  const complete = !!(giveEntry && getEntry);
  const before = buildableKeys(state, mySquad);
  const afterMine = complete
    ? buildableKeys(state, mySquad.filter((e) => e.playerId !== giveEntry.playerId).concat([getEntry]))
    : before;
  const afterRival = complete
    ? buildableKeys(state, rivalSquad.filter((e) => e.playerId !== getEntry.playerId).concat([giveEntry]))
    : [];
  const bothValid = complete && afterMine.length > 0 && afterRival.length > 0;
  const canSend = bothValid && !pairFull;

  const F = state.config?.FORMATIONS || {};
  root.appendChild(el('div', { class: `panel trade-builder ${complete ? (bothValid ? 'ok' : 'bad') : ''}` }, [
    el('h3', {}, 'Teklif'),
    el('div', { class: 'trade-builder-row' }, [
      el('div', { class: `trade-slot ${giveEntry ? 'filled' : ''}` }, [
        el('div', { class: 'trade-slot-k' }, 'Verdiğin'),
        el('div', { class: 'trade-slot-name' }, giveEntry ? giveEntry.name : 'Seçilmedi'),
        el('div', { class: 'trade-slot-meta' }, giveEntry
          ? `${giveEntry.position} · reyting ${giveEntry.rating}`
          : 'Kadrondan bir oyuncu seç'),
      ]),
      el('div', { class: 'trade-swap-big' }, '⇄'),
      el('div', { class: `trade-slot ${getEntry ? 'filled' : ''}` }, [
        el('div', { class: 'trade-slot-k' }, 'Aldığın'),
        el('div', { class: 'trade-slot-name' }, getEntry ? getEntry.name : 'Seçilmedi'),
        el('div', { class: 'trade-slot-meta' }, getEntry
          ? `${getEntry.position} · reyting ${getEntry.rating} · ${nameOf(ui.rival)}`
          : `${nameOf(ui.rival)} kadrosundan bir oyuncu seç`),
      ]),
    ]),
    el('div', { class: 'trade-formations' }, [
      el('div', { class: 'trade-formations-head' }, [
        el('span', { class: 'trade-formations-k' }, 'Takastan sonra kurabileceğin formasyonlar'),
        el('span', { class: `trade-valid ${!complete ? '' : bothValid ? 'ok' : 'bad'}` }, !complete
          ? 'Teklif tamamlanmadı'
          : bothValid ? 'İki kadro da geçerli ✓' : 'Geçersiz — bir taraf dizilim kuramıyor'),
      ]),
      el('div', { class: 'trade-formation-pills' }, Object.keys(F).map((key) => {
        const on = afterMine.includes(key);
        const isNew = complete && on && !before.includes(key);
        const lost = complete && !on && before.includes(key);
        return el('span', { class: `trade-formation ${on ? 'on' : 'off'} ${isNew ? 'new' : ''} ${lost ? 'lost' : ''}` }, [
          el('b', {}, key),
          isNew ? el('i', {}, 'yeni') : lost ? el('i', {}, 'kapandı') : null,
        ]);
      })),
      el('div', { class: 'trade-formation-note' }, !complete
        ? 'Mevki serbest: orta saha verip forvet alabilirsin. Kaleciler takas edilemez.'
        : bothValid
          ? `Bu takas ${nameOf(ui.rival)} için de geçerli — onun kurabileceği formasyonlar: ${afterRival.join(', ')}.`
          : 'Sunucu bu takası reddeder: takastan sonra taraflardan biri hiçbir formasyon kuramıyor.'),
    ]),
    el('div', { class: 'trade-send-row' }, [
      el('button', {
        type: 'button', class: 'btn trade-send',
        disabled: canSend ? undefined : 'disabled',
        onclick: async () => {
          const res = await actions.sendTradeOffer(ui.rival, ui.give, ui.get);
          if (res && res.ok) { ui.give = null; ui.get = null; actions.route(); }
        },
      }, pairFull ? `${nameOf(ui.rival)} ile limit doldu` : 'Teklifi Gönder'),
      el('button', {
        type: 'button', class: 'btn small secondary',
        onclick: () => { ui.give = null; ui.get = null; actions.route(); },
      }, 'Temizle'),
      el('div', { class: 'trade-send-hint' }, pairFull
        ? `Aynı kişiyle en fazla ${maxPerPair} takas yapılabilir. Başka rakip seç.`
        : 'Teklif açıkken iki oyuncu da kilitlenir. Karşı taraf onaylarsa takas anında işlenir.'),
    ]),
  ]));

  // ---------- gönderilen teklifler + tamamlananlar + tur durumu ----------
  const outgoing = t.outgoing || [];
  const completed = t.completed || [];
  root.appendChild(el('div', { class: 'trade-grid' }, [
    el('div', { class: 'panel' }, [
      el('h3', {}, 'Gönderdiğin Teklifler'),
      outgoing.length
        ? el('div', { class: 'trade-mini-list' }, outgoing.map((o) => el('div', { class: 'trade-mini-row' }, [
            el('div', {}, [
              el('div', { class: 'trade-mini-text' }, `${o.give.name} ⇄ ${o.get.name}`),
              el('div', { class: 'trade-mini-sub' }, `${nameOf(o.toClientId)} · onay bekliyor`),
            ]),
            el('button', { type: 'button', class: 'btn small secondary', onclick: () => actions.cancelTrade(o.id) }, 'Geri çek'),
          ])))
        : el('div', { class: 'muted trade-empty' }, 'Henüz teklif göndermedin.'),
    ]),
    el('div', { class: 'panel' }, [
      el('h3', {}, 'Tamamlanan Takaslar'),
      completed.length
        ? el('div', { class: 'trade-mini-list' }, completed.map((c) => el('div', { class: 'trade-done-row' }, [
            el('span', { class: 'trade-done-tag' }, 'Tamam'),
            el('span', {}, `${c.aName} → ${c.aGave.name} (${c.aGave.rating}) · ${c.bName} → ${c.bGave.name} (${c.bGave.rating})`),
          ])))
        : el('div', { class: 'muted trade-empty' }, 'Bu turda henüz takas tamamlanmadı.'),
    ]),
  ]));

  root.appendChild(el('div', { class: 'panel trade-status' }, [
    el('h3', {}, 'Tur Durumu'),
    el('div', { class: 'trade-status-grid' }, room.players.map((p) => {
      const done = (t.doneVotes || []).includes(p.clientId);
      return el('div', { class: `trade-status-card ${done ? 'done' : ''}` }, [
        el('span', { class: 'trade-status-name' }, p.name + (p.clientId === state.clientId ? ' (sen)' : '')),
        el('span', { class: 'trade-status-tag' }, !p.connected ? 'bağlantı kopuk' : done ? 'bitti' : 'pazarlıkta'),
      ]);
    })),
  ]));

  root.appendChild(draftHistoryPanel(state));
  return root;
}

// ============================== LINEUP ==============================
// v2 — bkz. handoff/lineup-v2.css (.lu-*)

const STYLE_CHOICES = [
  ['calm', 'Sakin', 1, 'Sert girme yok. Kart riski en düşük, ikili mücadelede biraz geride kalırsın.'],
  ['normal', 'Normal', 2, 'Standart risk. Kart oranı ve mücadele gücü dengede.'],
  ['aggressive', 'Agresif', 3, 'Baskı yüksek, ikili mücadele güçlü. Sarı ve kırmızı kart riski en yüksek.'],
];
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kontra": kendi hücumundan biraz feragat edip RAKİBİN
// hücum gücünü doğrudan kısan dördüncü taktik (bkz. server simulate.js applyCounterDefense).
const TACTIC_CHOICES = [
  ['defensive', 'Defansif', [['Defans', 1], ['Hücum', -1]], 'Blok geride kurulur. Gol yeme olasılığın düşer, üretimin azalır.'],
  ['balanced', 'Dengeli', [['Defans', 0], ['Hücum', 0]], 'Kadronun ham gücüyle oynarsın. Hiçbir eksende değişiklik yok.'],
  ['attack', 'Atak', [['Hücum', 1], ['Defans', -1]], 'Hat yukarı çıkar. Daha çok pozisyon üretirsin, arkan açık kalır.'],
  ['counter', 'Kontra', [['Hücum', -0.5], ['Rakip hücum', -1]], 'Kendi hücumundan biraz feragat edip rakibin hücum gücünü doğrudan kısarsın.'],
];

const GROUP_Y = { GK: 91, DF: 70, MF: 44, FW: 16 };
const SLOT_RANK = { GK: 50, LB: 8, CB: 50, RB: 92, DM: 50, CM: 50, AM: 50, LM: 15, RM: 85, LW: 15, ST: 50, RW: 85 };
// Kenar çipleri sahanın (overflow:hidden) dışına taşmasın diye yayılım dar tutuluyor ve çip
// genişliği yüzdesel: kalabalık hatta çip incelir, çakışma/kırpılma olmaz.
function spreadFor(n) { return n >= 5 ? 72 : n === 4 ? 76 : 70; }

function layout(slots) {
  const rows = {};
  slots.forEach((slot, idx) => { const g = slotGroup(slot); (rows[g] = rows[g] || []).push({ slot, idx }); });
  const out = new Array(slots.length);
  Object.keys(rows).forEach((g) => {
    const items = rows[g].slice().sort((a, b) => (SLOT_RANK[a.slot] ?? 50) - (SLOT_RANK[b.slot] ?? 50) || a.idx - b.idx);
    const n = items.length;
    const spread = spreadFor(n);
    const step = n > 1 ? spread / (n - 1) : 24;
    items.forEach((item, i) => {
      out[item.idx] = {
        x: n === 1 ? 50 : (100 - spread) / 2 + i * step,
        y: GROUP_Y[g] ?? 50,
        w: Math.min(21, step * 0.92),
        dense: n >= 5,
        siblings: items.map((it) => it.idx),
      };
    });
  });
  return out;
}

export function renderLineup({ state, actions }) {
  const root = el('div', { class: 'view lu' });
  const room = state.room;

  if (!state.lineupOptions) {
    root.appendChild(el('div', { class: 'panel' }, 'Dizilim seçenekleri yükleniyor...'));
    actions.fetchLineupOptions().then(() => actions.route());
    return root;
  }
  if (!state.lineupUi) {
    state.lineupUi = {
      activeTab: 'home',
      selections: {
        home: initSelection(state.lineupOptions.options, room.formation),
        away: initSelection(state.lineupOptions.options, room.formation),
      },
    };
  }

  const side = state.lineupUi.activeTab;
  const sel = state.lineupUi.selections[side];
  const squad = state.lineupOptions.squad;
  const submitted = state.lineupSubmitted[state.clientId] || {};
  const sideName = side === 'home' ? 'Ev Sahibi' : 'Deplasman';

  // ---------- üst bar ----------
  root.appendChild(el('div', { class: 'lu-top' }, [
    el('div', { class: 'lu-top-left' }, [
      el('span', { class: 'lu-live' }, 'Draft tamamlandı'),
      el('span', { class: 'lu-code' }, room.code),
    ]),
    el('button', { type: 'button', class: 'btn small secondary', onclick: () => actions.leaveRoom() }, '🚪 Oyundan Çık'),
  ]));

  root.appendChild(el('div', { class: 'lu-head' }, [
    el('div', {}, [
      el('h1', { class: 'lu-title' }, 'Dizilim & Taktik'),
      el('p', { class: 'lu-sub' }, 'Her iki maç için kadronu kur, oyun tarzını ve taktiğini seç. İkisi de kaydedilmeden maç başlamaz.'),
    ]),
    el('div', { class: 'lu-stats' }, [
      el('div', { class: `lu-stat ${submitted.home ? 'done' : ''}` }, [
        el('div', { class: 'lu-stat-k' }, 'Ev sahibi'),
        el('div', { class: 'lu-stat-v' }, submitted.home ? 'Kaydedildi' : 'Bekliyor'),
      ]),
      el('div', { class: `lu-stat ${submitted.away ? 'done' : ''}` }, [
        el('div', { class: 'lu-stat-k' }, 'Deplasman'),
        el('div', { class: 'lu-stat-v' }, submitted.away ? 'Kaydedildi' : 'Bekliyor'),
      ]),
    ]),
  ]));

  // ---------- rakip/oda durumu ----------
  const matchVotes = room.readyVotes || [];
  const matchIAmReady = matchVotes.includes(state.clientId);
  root.appendChild(el('div', { class: 'lu-peers' }, room.players.map((p) => {
    const s = state.lineupSubmitted[p.clientId] || {};
    return el('div', { class: 'lu-peer' }, [
      el('div', { class: 'lu-peer-name' }, p.name + (p.clientId === state.clientId ? ' (sen)' : '')),
      el('div', { class: 'lu-peer-tags' }, [
        el('span', { class: `lu-pill ${s.home ? 'done' : ''}` }, s.home ? 'Ev ✓' : 'Ev —'),
        el('span', { class: `lu-pill ${s.away ? 'done' : ''}` }, s.away ? 'Dep ✓' : 'Dep —'),
      ]),
    ]);
  })));

  // ---------- sekmeler ----------
  root.appendChild(el('div', { class: 'lu-tabs' }, ['home', 'away'].map((s) => el('button', {
    type: 'button',
    class: `lu-tab ${side === s ? 'active' : ''}`,
    onclick: () => { state.lineupUi.activeTab = s; actions.route(); },
  }, s === 'home' ? 'Ev Sahibi Maçı' : 'Deplasman Maçı'))));

  if (!sel.formation) {
    root.appendChild(el('div', { class: 'lu-card' }, el('p', { class: 'muted' }, 'Kadroyla kurulabilecek bir formasyon bulunamadı.')));
    return root;
  }

  // ---------- saha + kontroller ----------
  root.appendChild(el('div', { class: 'lu-grid' }, [
    pitchCard({ state, actions, side, squad }),
    el('div', { class: 'lu-col' }, [
      formationCard({ state, actions, side }),
      styleCard({ state, actions, side }),
      tacticCard({ state, actions, side }),
      (!submitted.home || !submitted.away)
        ? el('div', { class: 'lu-warn' }, [
            el('span', { class: 'lu-warn-k' }, 'Eksik'),
            el('span', {}, `Maç başlamadan önce iki dizilim de kaydedilmeli. Eksik: ${[!submitted.home ? 'Ev Sahibi' : null, !submitted.away ? 'Deplasman' : null].filter(Boolean).join(' ve ')}.`),
          ])
        : null,
      el('div', { class: 'lu-save-row' }, [
        el('button', {
          type: 'button',
          class: `lu-save ${submitted[side] ? 'saved' : ''}`,
          onclick: async () => {
            const res = await actions.submitLineup(side, sel.formation, sel.assignment, sel.style, sel.tactic);
            if (res && res.ok) toast(`${sideName} dizilimi kaydedildi.`);
          },
        }, submitted[side] ? `${sideName} Kaydedildi` : `${sideName} Dizilimini Kaydet`),
        el('div', { class: 'lu-save-hint' }, submitted[side]
          ? 'Değişiklik yaparsan tekrar kaydet.'
          : 'Formasyon, tarz ve taktik birlikte kaydedilir.'),
      ]),
      draftHistoryPanel(state),
      room.status === 'match'
        ? el('button', {
            type: 'button',
            class: `btn block ${matchIAmReady ? 'secondary' : ''}`,
            onclick: () => actions.toggleMatchReady(),
          }, matchIAmReady
            ? `⏳ Hazırsın — diğerleri bekleniyor (${matchVotes.length}/${room.players.length})`
            : '✅ Hazırım — Maçı Başlat')
        : null,
    ]),
  ]));

  return root;
}

function initSelection(options, preferredFormation) {
  const preferred = options.find((o) => o.formation === preferredFormation && o.feasible) || options.find((o) => o.feasible);
  return preferred ? initSelectionForFormation(preferred) : { formation: null, assignment: [], style: 'normal', tactic: 'balanced' };
}
function initSelectionForFormation(option) {
  return {
    formation: option.formation,
    assignment: option.suggestedLineup.map((l) => l.squadIndex),
    style: 'normal',
    tactic: 'balanced',
  };
}

// ============================== SAHA ==============================
function pitchCard({ state, actions, side, squad }) {
  const sel = state.lineupUi.selections[side];
  const slots = state.config.FORMATIONS[sel.formation];
  const pos = layout(slots);
  const rated = sel.assignment.map((i) => (i != null && squad[i] ? squad[i].player.rating : 0));
  const avg = rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length) : 0;

  function swap(i, j) {
    const a = sel.assignment.slice();
    const t = a[i]; a[i] = a[j]; a[j] = t;
    sel.assignment = a;
    actions.route();
  }

  const chips = slots.map((slotType, slotIdx) => {
    const p = pos[slotIdx];
    const usedElsewhere = new Set(sel.assignment.filter((_, i) => i !== slotIdx));
    const eligible = squad
      .map((entry, idx) => ({ idx, entry }))
      .filter(({ entry }) => entry.player.eligibleSlots.some((e) => e.slot === slotType));
    const currentIdx = sel.assignment[slotIdx];
    const current = currentIdx != null ? squad[currentIdx] : null;

    // Görünür kart bizim; tıklama/klavye/ekran okuyucu işini üstte şeffaf bir gerçek <select>
    // yapıyor. Select SADECE rating+isim sarmalayıcısını kaplar — swap okları onun dışında
    // (aksi halde okların tıklamasını yutuyordu).
    const select = el('select', {
      class: 'lu-select-native',
      onchange: (e) => { sel.assignment[slotIdx] = Number(e.target.value); actions.route(); },
    }, eligible.map(({ idx, entry }) => el('option', {
      value: String(idx),
      selected: currentIdx === idx ? 'selected' : undefined,
      disabled: usedElsewhere.has(idx) && currentIdx !== idx ? 'disabled' : undefined,
    }, `${entry.player.name} (${entry.player.rating})${usedElsewhere.has(idx) && currentIdx !== idx ? ' — kullanımda' : ''}`)));

    const sibs = (p.siblings || []).filter((i) => slots[i] === slotType);
    const k = sibs.indexOf(slotIdx);
    const left = k > 0 ? sibs[k - 1] : null;
    const right = k >= 0 && k < sibs.length - 1 ? sibs[k + 1] : null;
    const swapRow = sibs.length > 1 ? el('div', { class: 'lu-swap-row' }, [
      el('button', {
        type: 'button', class: `lu-swap ${left == null ? 'off' : ''}`, title: 'Soldakiyle yer değiştir',
        onclick: left == null ? null : () => swap(slotIdx, left),
      }, '◀'),
      el('button', {
        type: 'button', class: `lu-swap ${right == null ? 'off' : ''}`, title: 'Sağdakiyle yer değiştir',
        onclick: right == null ? null : () => swap(slotIdx, right),
      }, '▶'),
    ]) : null;

    return el('div', {
      class: `lu-slot ${p.dense ? 'dense' : ''}`,
      style: `left:${p.x}%; top:${p.y}%; width:${p.w}%`,
    }, [
      el('div', { class: `lu-pos pos-${slotGroup(slotType)}` }, slotType),
      el('div', { class: `lu-chip ${current && current.player.rating >= 90 ? 'hot' : ''} ${current && current.player.isIcon ? 'icon' : ''}` }, [
        el('div', { class: 'lu-select-wrap' }, [
          el('div', { class: 'lu-rating' }, current ? String(current.player.rating) : '–'),
          el('div', { class: 'lu-name' }, current ? current.player.name : 'Seç...'),
          select,
        ]),
        swapRow,
      ]),
    ]);
  });

  return el('div', { class: 'lu-card lu-pitch-card' }, [
    el('div', { class: 'lu-card-head' }, [
      el('span', { class: 'lu-card-title' }, 'Saha'),
      el('span', { class: 'lu-card-meta' }, `${sel.formation} · ort. ${avg}`),
    ]),
    el('div', { class: 'lu-pitch' }, [
      el('div', { class: 'lu-pitch-half' }),
      el('div', { class: 'lu-pitch-circle' }),
      el('div', { class: 'lu-pitch-box top' }),
      el('div', { class: 'lu-pitch-box bottom' }),
      ...chips,
    ]),
  ]);
}

// ============================== FORMASYON ==============================
function formationCard({ state, actions, side }) {
  const sel = state.lineupUi.selections[side];
  const feasible = state.lineupOptions.options.filter((o) => o.feasible);

  return el('div', { class: 'lu-card' }, [
    el('div', { class: 'lu-card-head' }, [
      el('span', { class: 'lu-card-title' }, 'Formasyon'),
      el('span', { class: 'lu-card-meta' }, 'Kadroyla kurulabilenler'),
    ]),
    el('div', { class: 'lu-formations' }, feasible.map((o) => {
      const on = sel.formation === o.formation;
      const slots = state.config.FORMATIONS[o.formation] || [];
      const counts = { DF: 0, MF: 0, FW: 0 };
      slots.forEach((s) => { const g = slotGroup(s); if (counts[g] != null) counts[g] += 1; });
      const rows = [counts.FW, counts.MF, counts.DF, 1].filter((n) => n > 0);
      return el('button', {
        type: 'button', class: `lu-formation ${on ? 'on' : ''}`,
        onclick: () => {
          // Formasyon değişse de seçilmiş oyun tarzı/taktik korunsun.
          const next = initSelectionForFormation(o);
          next.style = sel.style;
          next.tactic = sel.tactic;
          state.lineupUi.selections[side] = next;
          actions.route();
        },
      }, [
        el('div', { class: 'lu-mini' }, rows.map((n) =>
          el('div', { class: 'lu-mini-row' }, new Array(n).fill(0).map(() => el('span', { class: 'lu-dot' }))))),
        el('span', { class: 'lu-formation-label' }, o.formation),
      ]);
    })),
  ]);
}

// ============================== OYUN TARZI ==============================
function styleCard({ state, actions, side }) {
  const sel = state.lineupUi.selections[side];
  return el('div', { class: 'lu-card' }, [
    el('div', { class: 'lu-card-head' }, [
      el('span', { class: 'lu-card-title' }, 'Oyun Tarzı'),
      el('span', { class: 'lu-card-meta' }, 'Kart riski'),
    ]),
    el('div', { class: 'lu-styles' }, STYLE_CHOICES.map(([key, label, risk, desc]) => {
      const on = sel.style === key;
      return el('button', {
        type: 'button', class: `lu-opt ${on ? 'on' : ''}`,
        onclick: () => { sel.style = key; actions.route(); },
      }, [
        el('div', { class: 'lu-opt-label' }, label),
        el('div', { class: 'lu-meter' }, [0, 1, 2].map((i) =>
          el('span', { class: `lu-meter-bar ${i < risk ? 'fill' : ''}` }))),
        el('div', { class: 'lu-opt-desc' }, desc),
      ]);
    })),
  ]);
}

// ============================== TAKTİK ==============================
function tacticCard({ state, actions, side }) {
  const sel = state.lineupUi.selections[side];
  return el('div', { class: 'lu-card' }, [
    el('div', { class: 'lu-card-head' }, [
      el('span', { class: 'lu-card-title' }, 'Taktik'),
      el('span', { class: 'lu-card-meta' }, 'Hücum / defans dengesi'),
    ]),
    el('div', { class: 'lu-tactics' }, TACTIC_CHOICES.map(([key, label, effects, desc]) => {
      const on = sel.tactic === key;
      return el('button', {
        type: 'button', class: `lu-opt lu-tactic ${on ? 'on' : ''}`,
        onclick: () => { sel.tactic = key; actions.route(); },
      }, [
        el('div', { class: 'lu-tactic-head' }, [
          el('span', { class: 'lu-opt-label' }, label),
          el('span', { class: 'lu-radio' }),
        ]),
        el('div', { class: 'lu-effects' }, effects.map(([axis, v]) => el('div', { class: 'lu-effect' }, [
          el('span', { class: 'lu-effect-k' }, axis),
          el('span', { class: 'lu-effect-track' }, el('span', {
            class: `lu-effect-fill ${v > 0 ? 'up' : v < 0 ? 'down' : ''}`,
            style: `left:${v >= 0 ? 50 : 50 - Math.abs(v) * 50}%; width:${Math.abs(v) * 50}%`,
          })),
          el('span', { class: `lu-effect-v ${v > 0 ? 'up' : v < 0 ? 'down' : 'zero'}` },
            v === 0 ? '0' : (v > 0 ? '+' : '−') + String(Math.abs(v)).replace('0.5', '½')),
        ]))),
        el('div', { class: 'lu-opt-desc' }, desc),
      ]);
    })),
  ]);
}

// ============================== MAÇ ANLATIMI ==============================
// [KULLANICI İSTEĞİ] "Maçta direkt sonucu gösterme, maç anlatımı olsun, bir hızlı bir yavaş
// modu, birde direkt maç sonucuna geç kısmı olsun." Skor sunucuda zaten belirlendi (bkz.
// simulate.js) — burada sadece o skora denk gelen dakika bazlı event akışı (server/src/
// match/narration.js) dakika dakika oynatılıyor. Saf DOM mutasyonu ile (draft turundaki
// timer deseniyle aynı mantık) — her dakika tick'inde tüm görünümü yeniden çizmek yerine
// sadece saat/skor/log DOM düğümleri doğrudan güncelleniyor.
let playbackTimer = null;
const SPEED_MS_PER_MIN = { slow: 380, fast: 90 };

// [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Simülasyon sırasında maçlar eş zamanlı gitmiyor,
// bazı kullanıcılar geriden geliyor." — kök neden: dakika sayacı (pb.clock) her istemcide SAF
// SAYAÇ olarak ilerliyordu (`setInterval` her ateşlendiğinde +1 dakika) — gerçek geçen süreye
// hiç bakmıyordu. Tarayıcı arka plandaki (odaklanmamış) bir sekmede timer'ları büyük ölçüde
// yavaşlatır/atlar; bu istemcinin sayacı geride kalınca bir daha KENDİLİĞİNDEN yakalayamıyordu
// (her ateşleme sadece +1 dakika ekliyordu, kaç dakikanın GERÇEKTE geçmiş olması gerektiğine
// bakmadan). Çözüm: bir "çıpa" (pb.tickAnchorAt/tickAnchorClock/tickAnchorSpeed) tutuluyor —
// scheduleNextTick her çağrıldığında gerçek geçen süreye göre "şu an hangi dakikada olmamız
// gerekiyor"u hesaplıyor; geride kalınmışsa (throttle edilmiş bir setTimeout geç ateşlendiyse)
// aynı JS turunda hemen bir dakika daha işleyip TEKRAR kendini çağırıyor — birkaç ardışık
// çağrıda gerçek zamana yakınsıyor. Çıpa SADECE kasıtlı bir duraklamadan (gol/şans gerilimi,
// hız değişikliği, ilk başlangıç) sonra `resumeTicking()` ile SIFIRLANIYOR — aksi halde
// gerilim penceresi de "geride kalınmış" sayılıp hemen telafi edilmeye çalışılırdı, bu da
// istenmeyen bir sonuç olurdu (anlatım gerilimi kaybolur).
function resumeTicking(pb, scheduleFn) {
  pb.tickAnchorAt = Date.now();
  pb.tickAnchorClock = pb.clock;
  pb.tickAnchorSpeed = pb.speed;
  scheduleFn();
}

const GOAL_TEMPLATES = [
  (s) => `GOL! ${s} topu ağlarla buluşturdu!`,
  (s) => `GOOOL! ${s} harika bir vuruşla ağları sarstı!`,
  (s) => `${s} soğukkanlılıkla golü buldu!`,
  (s) => `${s} plasmanla köşeyi buldu, top filelerde!`,
];
// [KULLANICI İSTEĞİ] "Önemli pozisyonlarda hemen gol oldu değil de X futbolcu vuruyo, sonra
// goool diye çıkabilir" — SONUCU açık etmeyen "vuruyor!" satırı; hem gol hem kaçan pozisyon
// aynı belirsiz cümleyle başlıyor ki hangisi olacağı önceden belli olmasın (bkz.
// formatBuildupEvent + renderMatchPlayback tick() içindeki gerilim akışı).
const BUILDUP_TEMPLATES = [
  (p) => `${p} topu kontrol ediyor, ceza sahasına giriyor...`,
  (p) => `${p} boşluk buldu, şutu çekiyor!`,
  (p) => `${p} çalımdan sıyrıldı, vuruyor!`,
  (p) => `${p} arkadan gelip plase şutu deniyor!`,
  (p) => `${p} kafayı topa uzattı!`,
];
// Kaçan pozisyonlar için SONUÇ cümlesi — buildup zaten "şutu çekiyor" dediği için burada
// sadece netice (kurtarış/aut/blok) anlatılıyor, aksiyon tekrar edilmiyor.
const CHANCE_TEMPLATES = [
  (p, gk) => `${gk} müthiş bir refleksle kurtardı!`,
  (p) => `Top az farkla yandan auta gitti!`,
  (p) => `Savunmaya çarpıp kornere gitti.`,
  (p, gk) => `${gk} parmak ucuyla kornere çeldi!`,
  (p) => `Kaleyi az farkla geçti, üstten auta gitti!`,
];

function scoreContextPhrase(team, homeScore, awayScore) {
  if (homeScore === awayScore) return 'skoru eşitledi';
  const teamScore = team === 'home' ? homeScore : awayScore;
  const oppScore = team === 'home' ? awayScore : homeScore;
  const diff = teamScore - oppScore;
  if (diff <= 0) return 'farkı azalttı';
  if (diff === 1) return 'öne geçti';
  return `farkı ${diff} yaptı`;
}

// [KULLANICI İSTEĞİ] "Kadro diziliminde agresif/sakin oyna seçenekleri gelsin, buna bağlı
// olarak kırmızı/sarı kart gelsin." — sunucudan gelen 'yellow'/'red' event'leri için anlatım.
const YELLOW_TEMPLATES = [
  (p) => `${p} sert bir müdahale yaptı, hakem sarı kartı gösterdi.`,
  (p) => `${p} itiraz etti, hakemden sarı kart gördü.`,
];
const RED_TEMPLATES = [
  (p) => `${p} çok kötü bir hareket yaptı — DOĞRUDAN KIRMIZI KART!`,
  (p) => `${p} ikinci sarıdan kırmızı kart gördü, takımı 10 kişi kaldı!`,
];

// [KULLANICI İSTEĞİ] Gol/şans event'lerinin İLK (sonuç belirsiz) satırı — bkz. yukarıdaki
// BUILDUP_TEMPLATES notu. Sadece 'goal'/'chance' için çağrılır (kart event'lerinde gerilime
// gerek yok, onlar zaten anlık gösteriliyor).
function formatBuildupEvent(ev) {
  const tpl = BUILDUP_TEMPLATES[Math.floor(Math.random() * BUILDUP_TEMPLATES.length)];
  return `${ev.minute}' ${tpl(ev.playerName || ev.scorerName)}`;
}

// Bir event'in SONUÇ satırını, ANLIK skor bağlamıyla birlikte üretir. Metin üretildiği anda
// (reveal sırasında) sabitlenip pb.shown'a yazılır — bu yüzden bir sonraki tam yeniden çizimde
// (hız değişimi gibi) aynı metin tekrar üretilmeye çalışılmaz.
function formatEvent(ev, { homeName, awayName, homeScore, awayScore }) {
  const teamName = ev.team === 'home' ? homeName : awayName;
  if (ev.type === 'goal') {
    const tpl = GOAL_TEMPLATES[Math.floor(Math.random() * GOAL_TEMPLATES.length)];
    const context = scoreContextPhrase(ev.team, homeScore, awayScore);
    return `${ev.minute}' ⚽ ${tpl(ev.scorerName)} ${teamName} ${context}. (${homeScore}-${awayScore})`;
  }
  if (ev.type === 'yellow') {
    const tpl = YELLOW_TEMPLATES[Math.floor(Math.random() * YELLOW_TEMPLATES.length)];
    return `${ev.minute}' 🟨 ${tpl(ev.playerName)}`;
  }
  if (ev.type === 'red') {
    const tpl = RED_TEMPLATES[Math.floor(Math.random() * RED_TEMPLATES.length)];
    return `${ev.minute}' 🟥 ${tpl(ev.playerName)} ${teamName} sayısal üstünlüğü kaybetti.`;
  }
  const tpl = CHANCE_TEMPLATES[Math.floor(Math.random() * CHANCE_TEMPLATES.length)];
  return `${ev.minute}' ${tpl(ev.playerName, ev.gkName || 'kaleci')}`;
}

function rowClassFor(type) {
  if (type === 'goal') return 'goal';
  if (type === 'red') return 'red-card';
  if (type === 'yellow') return 'yellow-card';
  if (type === 'buildup') return 'buildup';
  return '';
}

// Gerilim penceresi süresi — gol/şans event'inin BUILDUP satırından SONUÇ satırına geçene
// kadar beklenen süre. Minyatür sahadaki topun yol alma süresiyle (bkz. createMiniPitch
// runPath: 260+250+280=790ms + 300ms şut) kabaca örtüşecek şekilde seçildi ki metin sahadaki
// golle/kurtarışla neredeyse aynı anda ortaya çıksın.
const SUSPENSE_DELAY_MS = 1150;
let suspenseTimer = null;

function clearPlaybackTimer() {
  clearInterval(playbackTimer);
  playbackTimer = null;
  clearTimeout(suspenseTimer);
  suspenseTimer = null;
}

// [KULLANICI İSTEĞİ] "Kenarda minyatür bir saha gibi bir şey olsun, önemli pozisyonlarda
// animasyon çıksın — gol pozisyonu, kaçan önemli goller." Saf CSS geçişleriyle (top/left)
// hareket eden bir "top" ve gol ağzında yanıp sönen bir parlama efekti. Sunucudan gelen
// gerçek sonucu DEĞİŞTİRMEZ — sadece event'i görsel olarak canlandırır.
// Kural: home takım her zaman sağ kaleye, away takım her zaman sol kaleye hücum eder
// (o maçın süresi boyunca sabit bir görsel kural — gerçek ev sahibi avantajıyla ilgisi yok).
// Gol anında minyatür sahanın yan panelinde konfeti patlatır (saf CSS animasyonlu, [KULLANICI
// İSTEĞİ] "enerjik/oyun gibi"). `container`'ın position:relative olması gerekir.
const CONFETTI_COLORS = ['#33e39a', '#f6c65a', '#5fa8ff', '#ff8a5b', '#d199ff', '#ff6161'];
function spawnConfetti(container, count = 24) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI - Math.PI / 2 - Math.PI / 2; // yukarı yarım daire
    const dist = 60 + Math.random() * 90;
    const dx = `${Math.cos(angle) * dist}px`;
    const dy = `${Math.sin(angle) * dist - 30}px`;
    const piece = el('div', {
      class: 'pitch-confetti',
      style: `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}; top:6%; --dx:${dx}; --dy:${dy}; --rot:${Math.round(Math.random() * 540 - 270)}deg;`,
    });
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 950);
  }
}

// [KULLANICI İSTEĞİ] Minyatür saha v2 — "sadece top" yerine SAHA: iki takımın 11+11 oyuncusu
// gerçek dizilimden (lineupHome/lineupAway slot'ları) noktalar halinde çizilir, atak sırasında
// atak yapan takımın hatları hafifçe öne kayar, altta pozisyonun hangi aşamada olduğunu söyleyen
// bir durum satırı akar. Arayüz DEĞİŞMEDİ: { el, playEvent, reset, cardFlash } — anlatım akışı,
// gol konfetisi, kart titremesi ve top yolu (waypoint + kale ağzı hedefleme) birebir korundu.
// opts: { homeSlots: ['GK','LB',...], awaySlots: [...], homeName, awayName }
const PITCH_LANE_X = { GK: 6, DF: 20, MF: 38, FW: 49 };
const PITCH_SLOT_RANK = { GK: 50, LB: 10, CB: 50, RB: 90, DM: 50, CM: 50, AM: 50, LM: 14, RM: 86, LW: 14, ST: 50, RW: 86 };

function pitchDotPositions(slots) {
  const lanes = {};
  (slots || []).forEach((slot, idx) => {
    const g = slotGroup(slot);
    (lanes[g] = lanes[g] || []).push({ slot, idx });
  });
  const out = [];
  Object.keys(lanes).forEach((g) => {
    const items = lanes[g].slice().sort((a, b) =>
      (PITCH_SLOT_RANK[a.slot] ?? 50) - (PITCH_SLOT_RANK[b.slot] ?? 50) || a.idx - b.idx);
    const n = items.length;
    const spread = n >= 5 ? 74 : n >= 4 ? 68 : 56;
    items.forEach((item, i) => {
      out.push({
        slot: item.slot,
        group: g,
        x: PITCH_LANE_X[g] ?? 38,
        y: n === 1 ? 50 : (100 - spread) / 2 + i * (spread / (n - 1)),
      });
    });
  });
  return out;
}

function createMiniPitch(onGoalImpact, opts = {}) {
  const ball = el('div', { class: 'pitch-ball' });
  const caption = el('div', { class: 'pitch-caption' });
  const phase = el('div', { class: 'pitch-phase' });
  const flashLeft = el('div', { class: 'pitch-flash left' });
  const flashRight = el('div', { class: 'pitch-flash right' });

  // --- oyuncu noktaları (ev sahibi solda/sağa oynar, deplasman aynalanır) ---
  const homeDots = [];
  const awayDots = [];
  function buildTeam(slots, side, bag) {
    return pitchDotPositions(slots.length ? slots : ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'LW', 'ST', 'RW'])
      .map((p) => {
        const x = side === 'home' ? p.x : 100 - p.x;
        const node = el('span', {
          class: `pitch-dot ${side} group-${p.group}`,
          title: p.slot,
          style: `left:${x}%; top:${p.y}%`,
        });
        bag.push({ node, baseX: x, side });
        return node;
      });
  }
  const homeNodes = buildTeam(opts.homeSlots || [], 'home', homeDots);
  const awayNodes = buildTeam(opts.awaySlots || [], 'away', awayDots);

  const field = el('div', { class: 'pitch-field' }, [
    el('div', { class: 'pitch-halfline' }),
    el('div', { class: 'pitch-circle' }),
    el('div', { class: 'pitch-box left' }),
    el('div', { class: 'pitch-box right' }),
    el('div', { class: 'pitch-goal left' }),
    el('div', { class: 'pitch-goal right' }),
    el('div', { class: 'pitch-team-tag left' }, opts.homeName || 'Ev sahibi'),
    el('div', { class: 'pitch-team-tag right' }, opts.awayName || 'Deplasman'),
    ...homeNodes,
    ...awayNodes,
    flashLeft,
    flashRight,
    ball,
    caption,
    phase,
  ]);
  const root = el('div', { class: 'mini-pitch' }, [field]);

  // Kale ağzı CSS'te top:50% height:22% olarak çizili — yani dikeyde ~%39-%61 aralığı.
  // Golün / kurtarışın "içeri" gitmiş gibi görünmesi için hedef bu aralıkta olmalı; auta
  // giden şutlar ise bilerek bu aralığın DIŞINA hedeflenir (bkz. playEvent).
  const GOAL_MOUTH_MIN = 39;
  const GOAL_MOUTH_MAX = 61;

  let seq = 0; // her playEvent kendi işaretini taşır — eski/yarım kalan animasyonlar bu sayede iptal olur

  function setBall(xPct, yPct, durationMs) {
    if (!durationMs) {
      ball.style.transitionDuration = '0s';
      ball.style.left = `${xPct}%`;
      ball.style.top = `${yPct}%`;
      void ball.offsetWidth; // süresiz geçişi hemen uygula (reflow zorla)
      return;
    }
    ball.style.transitionDuration = `${durationMs}ms`;
    ball.style.left = `${xPct}%`;
    ball.style.top = `${yPct}%`;
  }

  // Atak yapan takımın hatları öne, rakip hatları geriye kayar; pozisyon bitince nötre döner.
  function shiftTeams(attackingSide) {
    const apply = (bag, delta) => bag.forEach((d) => {
      d.node.style.left = `${Math.max(3, Math.min(97, d.baseX + delta))}%`;
    });
    if (!attackingSide) { apply(homeDots, 0); apply(awayDots, 0); return; }
    const push = attackingSide === 'home' ? 9 : -9;
    apply(homeDots, attackingSide === 'home' ? push : push * 0.45);
    apply(awayDots, attackingSide === 'away' ? push : push * 0.45);
  }

  function flashGoal(side, kind = '') {
    const node = side === 'right' ? flashRight : flashLeft;
    node.classList.remove('flash', 'post');
    void node.offsetWidth;
    if (kind) node.classList.add(kind);
    node.classList.add('flash');
  }

  // [KULLANICI İSTEĞİ] Kart event'lerinde topu hareket ettirmenin bir anlamı yok (yönlü bir
  // pozisyon değil) — bunun yerine tüm sahada kısa bir renkli titreşim (sarı/kırmızı) verilir.
  function cardFlash(kind) {
    field.classList.remove('card-flash-yellow', 'card-flash-red');
    void field.offsetWidth;
    field.classList.add(kind === 'red' ? 'card-flash-red' : 'card-flash-yellow');
    showPhase(kind === 'red' ? 'Kırmızı kart — oyun durdu' : 'Faul — sarı kart', kind === 'red' ? 'red' : 'yellow');
  }

  function showCaption(text, kind) {
    caption.textContent = text;
    caption.className = `pitch-caption show ${kind}`;
    setTimeout(() => { caption.className = 'pitch-caption'; }, 1300);
  }

  function showPhase(text, kind = '') {
    phase.textContent = text;
    phase.className = `pitch-phase show ${kind}`;
  }

  function reset() {
    seq += 1;
    setBall(50, 50, 0);
    caption.className = 'pitch-caption';
    shiftTeams(null);
    showPhase('Orta sahada mücadele');
  }
  reset();

  // Bir dizi ara noktadan (paslaşma / atağın gelişimi) sırayla geçer; her adımda güncel
  // seq kontrol edilir — araya yeni bir event girerse eski animasyon sessizce durur.
  function runPath(mySeq, waypoints, i, done) {
    if (mySeq !== seq) return;
    if (i >= waypoints.length) { if (done) done(); return; }
    const [x, y, dur, note] = waypoints[i];
    setBall(x, y, dur);
    if (note) showPhase(note);
    setTimeout(() => runPath(mySeq, waypoints, i + 1, done), dur);
  }

  // [KULLANICI İSTEĞİ] "Pozisyon öncesi paslaşmaları, atağın nasıl oluştuğunu da göster" —
  // topu tek hamlede kaleye fırlatmak yerine kendi yarı sahadan çıkış → orta saha paslaşması
  // → ceza sahasına giriş → şut olmak üzere 4 adımlık bir "atak" canlandırılıyor.
  // ev: {type: 'goal'|'chance', team: 'home'|'away', ...}
  function playEvent(ev) {
    const mySeq = ++seq;
    const attackRight = ev.team === 'home';
    const targetSide = attackRight ? 'right' : 'left';
    const isGoal = ev.type === 'goal';
    const attackerName = (attackRight ? opts.homeName : opts.awayName) || (attackRight ? 'Ev sahibi' : 'Deplasman');
    const defenderName = (attackRight ? opts.awayName : opts.homeName) || (attackRight ? 'Deplasman' : 'Ev sahibi');

    // [KULLANICI İSTEĞİ] "Top dışarı çıkıyor gibi görünüyor ama gol diyor" bug'ının düzeltmesi:
    // artık şutun hedef Y'si sonucu YANSITIYOR — gol/kurtarış kale ağzı aralığına, auta giden
    // şut ise bilerek o aralığın dışına hedefleniyor.
    // [KULLANICI İSTEĞİ] "Direkten dönünce direkten dönme sesi" — gol olmayan şutların üç ayrı
    // sonucu var: kaleci kurtardı / DİREĞE çarptı / auta gitti. Direk vuruşu kale ağzının tam
    // kenarına hedeflenir (görsel olarak da direğe çarpmış gibi durur).
    let outcome = 'save';
    let shotY;
    if (isGoal) {
      shotY = GOAL_MOUTH_MIN + 4 + Math.random() * (GOAL_MOUTH_MAX - GOAL_MOUTH_MIN - 8);
    } else {
      const roll = Math.random();
      outcome = roll < 0.5 ? 'save' : roll < 0.68 ? 'post' : 'miss';
      shotY = outcome === 'save'
        ? GOAL_MOUTH_MIN + 2 + Math.random() * (GOAL_MOUTH_MAX - GOAL_MOUTH_MIN - 4)
        : outcome === 'post'
          ? (Math.random() < 0.5 ? GOAL_MOUTH_MIN - 1 : GOAL_MOUTH_MAX + 1) // direğin dibi
          : (Math.random() < 0.5 ? 12 + Math.random() * 18 : 70 + Math.random() * 18);
    }
    const saved = outcome === 'save';
    const hitPost = outcome === 'post';
    const shotX = isGoal ? (attackRight ? 97 : 3)
      : saved ? (attackRight ? 90 : 10)
      : hitPost ? (attackRight ? 95 : 5)
      : (attackRight ? 94 : 6);
    const boxY = Math.max(8, Math.min(92, shotY + (Math.random() * 16 - 8)));
    const buildY1 = 16 + Math.random() * 68;
    const buildY2 = 16 + Math.random() * 68;
    const x1 = attackRight ? 30 : 70; // kendi yarı sahadan çıkış
    const x2 = attackRight ? 56 : 44; // orta sahayı geçen pas
    const x3 = attackRight ? 79 : 21; // ceza sahasına giriş

    setBall(50, 50, 0); // orta sahaya sıfırla
    shiftTeams(ev.team);

    requestAnimationFrame(() => {
      runPath(mySeq, [
        [x1, buildY1, 260, `${attackerName} arkadan çıkıyor`],
        [x2, buildY2, 250, 'Orta sahada paslaşma'],
        [x3, boxY, 280, `${defenderName} ceza sahasında`],
      ], 0, () => {
        setBall(shotX, shotY, 300); // şut
        showPhase('Vuruyor!');
        sfx.play('shot');
        setTimeout(() => {
          if (mySeq !== seq) return;
          flashGoal(targetSide, hitPost ? 'post' : '');
          if (isGoal) {
            showCaption('GOOOL! ⚽', 'goal');
            showPhase(`Gol — ${defenderName} kalesi`, 'goal');
            if (onGoalImpact) onGoalImpact(); // gol sesi + konfeti + ekran sallanması
          } else if (hitPost) {
            // [KULLANICI İSTEĞİ] direkten dönme: kendi sesi, kendi yazısı, kendi rengi.
            showCaption('DİREK! 🥁', 'post');
            showPhase(`Direkten döndü — ${defenderName} kurtuldu`, 'post');
            sfx.play('post');
          } else {
            showCaption(saved ? 'KURTARDI! 🧤' : 'AUT! 📛', saved ? 'save' : 'miss');
            showPhase(saved ? `Kaleci kurtardı — ${defenderName}` : 'Top auta gitti', saved ? 'save' : 'miss');
            sfx.play(saved ? 'save' : 'miss');
          }
          setTimeout(() => {
            if (mySeq !== seq) return;
            setBall(50, 50, 500);
            shiftTeams(null);
            showPhase('Orta sahada mücadele');
          }, 800);
        }, 300);
      });
    });
  }

  return { el: root, playEvent, reset, cardFlash };
}

export function renderMatchPlayback({ state, actions }) {
  clearPlaybackTimer();
  const pb = state.matchPlayback;
  const r = state.matchResult;
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "İlk maç x-y, sonra y-x, sonra diğer eşleşmelere geçme —
  // karışık oynat, sırayı hep değiştir." — N>2 odada anlatım artık fixture'ları sırayla DEĞİL,
  // pb.order'daki (bkz. app.js buildMatchOrder) rastgele karıştırılmış düz maç listesini tek tek
  // izler. 2 kişilik odada order iki elemanlıdır (fixture 0'ın 2 maçı) — davranış eskisiyle
  // birebir aynı kalır (sıra %50 ihtimalle ters de gelebilir, sonucu etkilemez).
  const step = pb.order[pb.pos];
  const fixture = r.fixtures[step.fixtureIndex];
  const isFirst = step.matchIndex === 0;
  const m = isFirst ? fixture.match1 : fixture.match2;
  const events = m.events || [];
  const nameOf = (id) => (state.room.players.find((p) => p.clientId === id) || {}).name || '?';
  const homeName = nameOf(m.homeClientId);
  const awayName = nameOf(m.awayClientId);
  const fixtureTag = r.fixtures.length > 1 ? `Eşleşme ${step.fixtureIndex + 1}/${r.fixtures.length} — ` : '';
  const progressTag = pb.order.length > 2 ? ` (Maç ${pb.pos + 1}/${pb.order.length})` : '';

  const root = el('div', { class: 'view' });

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Sonuca geç için bütün oyuncuların onayı gereksin — ya
  // herkes sonuca geçecek ya da herkes aynı şekilde izleyecek, hızlı da dahil." — hız/skip artık
  // sunucuda oy birliği ile karar veriliyor (bkz. app.js votePlaybackSpeed/votePlaybackSkip,
  // matchSockets.js). `pb.speed`/`pb.done` sadece HERKES anlaşınca değişir; butonlar kendi oyunu
  // gönderir, o ana kadarki oy durumu (`pb.sync`) burada gösterilir.
  const totalPlayers = (state.room && state.room.players.length) || 1;
  const sync = pb.sync || { speed: pb.speed, skip: false, speedVotes: {}, skipVotes: [] };
  const speedVotesMap = sync.speedVotes || {};
  const skipVotesList = sync.skipVotes || [];
  const mySpeedVote = speedVotesMap[state.clientId];
  const mySkipVote = skipVotesList.includes(state.clientId);
  const slowVoteCount = Object.values(speedVotesMap).filter((v) => v === 'slow').length;
  const fastVoteCount = Object.values(speedVotesMap).filter((v) => v === 'fast').length;
  const speedHint = totalPlayers > 1
    ? `Hız oyu — 🐢 ${slowVoteCount}/${totalPlayers} · ⚡ ${fastVoteCount}/${totalPlayers}` : null;
  const skipHint = totalPlayers > 1 && skipVotesList.length > 0
    ? `⏭ Sonuca geçmek isteyen: ${skipVotesList.length}/${totalPlayers}` : null;

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'draft-header' }, [
      el('h3', {}, `${fixtureTag}${isFirst ? '1. Maç' : '2. Maç'}${progressTag} — ${homeName} vs ${awayName}`),
      el('div', { class: 'playback-controls' }, [
        el('button', {
          class: `btn small ${pb.speed === 'slow' ? '' : 'secondary'} ${mySpeedVote === 'slow' ? 'voted' : ''}`,
          title: totalPlayers > 1 ? 'Tüm oyuncular Yavaş\'ı oylarsa herkes için geçerli olur' : undefined,
          onclick: () => actions.votePlaybackSpeed('slow'),
        }, '🐢 Yavaş'),
        el('button', {
          class: `btn small ${pb.speed === 'fast' ? '' : 'secondary'} ${mySpeedVote === 'fast' ? 'voted' : ''}`,
          title: totalPlayers > 1 ? 'Tüm oyuncular Hızlı\'yı oylarsa herkes için geçerli olur' : undefined,
          onclick: () => actions.votePlaybackSpeed('fast'),
        }, '⚡ Hızlı'),
        el('button', {
          class: `btn small danger ${mySkipVote ? 'voted' : ''}`,
          title: totalPlayers > 1 ? 'Tüm oyuncular oylarsa herkes birlikte sonuç ekranına geçer' : undefined,
          onclick: () => actions.votePlaybackSkip(),
        }, mySkipVote ? '✓ Sonuca Geç (oy verildi)' : '⏭ Sonuca Geç'),
      ]),
      (speedHint || skipHint) ? el('div', { class: 'playback-vote-hint', style: 'width:100%' }, [speedHint, skipHint].filter(Boolean).join(' · ')) : null,
    ]),
  ]));

  const clockLabel = el('div', { class: 'match-clock' }, `${pb.clock}'`);
  const scoreNum = el('span', {}, `${pb.score.home} - ${pb.score.away}`);
  const scoreEl = el('div', { class: 'scoreline' }, [
    el('div', { class: 'team' }, homeName),
    el('div', { class: 'score' }, scoreNum),
    el('div', { class: 'team' }, awayName),
  ]);
  const logEl = el('div', { class: 'event-log commentary-log' });

  const liveSide = el('div', { class: 'panel match-live-side' });
  const layoutEl = el('div', { class: 'match-live-layout' });

  // Gol anında hem konfeti (liveSide'a bindirilir) hem de tüm anlatım kutusunda kısa bir
  // ekran sallanması tetikler — [KULLANICI İSTEĞİ] "enerjik/oyun gibi" hissi.
  const pitch = createMiniPitch(() => {
    sfx.play('goal');
    spawnConfetti(liveSide);
    layoutEl.classList.remove('shake');
    void layoutEl.offsetWidth;
    layoutEl.classList.add('shake');
  }, {
    // Saha noktaları gerçek dizilimden çizilir (bkz. createMiniPitch v2).
    homeSlots: (m.lineupHome || []).map((e) => e.slot),
    awaySlots: (m.lineupAway || []).map((e) => e.slot),
    homeName, awayName,
  });

  if (pb.shown.length === 0) {
    const kickoffText = `⚽ Maç başladı — ${homeName} - ${awayName}`;
    pb.shown.push({ type: 'kickoff', text: kickoffText });
  }
  for (const s of pb.shown) {
    logEl.appendChild(el('div', { class: `row ${rowClassFor(s.type)}` }, s.text));
  }
  logEl.scrollTop = logEl.scrollHeight;

  liveSide.appendChild(clockLabel);
  liveSide.appendChild(scoreEl);
  liveSide.appendChild(pitch.el);
  liveSide.appendChild(el('p', { class: 'muted', style: 'text-align:center;margin:0' }, `xG ${m.xgHome.toFixed(2)} - ${m.xgAway.toFixed(2)}`));

  const logSide = el('div', { class: 'panel match-live-log' }, [
    el('h3', {}, 'Maç Anlatımı'),
    logEl,
  ]);
  layoutEl.appendChild(liveSide);
  layoutEl.appendChild(logSide);
  root.appendChild(layoutEl);

  // [KULLANICI İSTEĞİ] Gol/şans event'lerinde önce sonucu açık etmeyen bir "vuruyor!" satırı,
  // kısa bir gerilim penceresinden sonra gerçek sonuç (gol/kurtarış/aut) — bkz. yukarıdaki
  // BUILDUP_TEMPLATES/SUSPENSE_DELAY_MS notları. Bekleyen sonuç `pb.pendingReveal`'da (state'te,
  // sadece bu render'ın kapadığı bir yerel değişkende değil) tutuluyor ki hız değiştirme gibi
  // bir yeniden çizim arada olsa bile bekleyen sonuç kaybolmasın (altta `armSuspense` ile
  // kaldığı yerden — gerilim penceresi baştan sayılarak — devam ettiriliyor).

  function finishMinuteUpdate() {
    scoreNum.textContent = `${pb.score.home} - ${pb.score.away}`;
    if (pb.clock >= 90) {
      clearPlaybackTimer();
      // [KULLANICI İSTEĞİ] "Maç bitince düdük sesi."
      sfx.play('whistleEnd');
      const ftText = '🏁 Maç sona erdi.';
      pb.shown.push({ type: 'fulltime', text: ftText });
      logEl.appendChild(el('div', { class: 'row' }, ftText));
      logEl.scrollTop = logEl.scrollHeight;
      setTimeout(() => {
        if (pb.done) return; // bu arada kullanıcı "Sonuca Geç" ile atladıysa tekrar route etme
        // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Karışık sıra — bir sonraki maç artık aynı
        // eşleşmenin 2. maçı olmak ZORUNDA değil, pb.order'daki bir sonraki (karışık) adım.
        if (pb.pos + 1 < pb.order.length) {
          pb.pos += 1; pb.clock = 0; pb.shown = []; pb.score = { home: 0, away: 0 };
          pb.tickAnchorAt = null; // yeni maç — çıpa sıfırdan kurulsun (bkz. resumeTicking)
        } else {
          pb.done = true;
        }
        actions.route();
      }, 1600);
      return true; // maç bitti — tick döngüsü yeniden başlatılmayacak
    }
    return false;
  }

  function revealOutcome(ev) {
    if (ev.type === 'goal') {
      if (ev.team === 'home') pb.score.home += 1; else pb.score.away += 1;
    }
    const text = formatEvent(ev, { homeName, awayName, homeScore: pb.score.home, awayScore: pb.score.away });
    pb.shown.push({ type: ev.type, text });
    logEl.appendChild(el('div', { class: `row ${rowClassFor(ev.type)}` }, text));
    logEl.scrollTop = logEl.scrollHeight;
    if (ev.type === 'goal') {
      scoreNum.classList.remove('flash');
      void scoreNum.offsetWidth;
      scoreNum.classList.add('flash');
    }
    pb.pendingReveal = null;
    // [DÜZELTİLDİ — SENKRON] Gerilim penceresi kasıtlı bir duraklama — bunu "geride kalınmış"
    // sayıp telafi etmeye çalışmamak için çıpa burada SIFIRLANIYOR (resumeTicking), ham
    // scheduleNextTick çağrılmıyor.
    if (!finishMinuteUpdate()) resumeTicking(pb, scheduleNextTick);
  }

  function armSuspense(ev) {
    pb.pendingReveal = ev;
    clearTimeout(suspenseTimer);
    suspenseTimer = setTimeout(() => { if (!pb.done) revealOutcome(ev); }, SUSPENSE_DELAY_MS);
  }

  function tick() {
    if (pb.done) { clearPlaybackTimer(); return; }
    // [KULLANICI İSTEĞİ] Maç başlama düdüğü — her maç için yalnızca bir kez (pb.kickedOff,
    // state'te tutuluyor ki hız değişimi/yeniden çizim düdüğü tekrar çaldırmasın).
    if (pb.clock === 0 && pb.kickedOff !== pb.pos) { pb.kickedOff = pb.pos; sfx.play('whistleKick'); }
    pb.clock += 1;
    clockLabel.textContent = `${pb.clock}'`; // dakika sayacı gerilim sırasında da akmaya devam eder
    const due = events.filter((ev) => ev.minute === pb.clock);
    const ev = due[0]; // dakika başına en fazla 1 event garanti (bkz. narration.js uniqueMinute)

    if (ev && (ev.type === 'goal' || ev.type === 'chance')) {
      const buildupText = formatBuildupEvent(ev);
      pb.shown.push({ type: 'buildup', text: buildupText });
      logEl.appendChild(el('div', { class: 'row buildup' }, buildupText));
      logEl.scrollTop = logEl.scrollHeight;
      pitch.playEvent(ev);
      clearTimeout(playbackTimer); // sonuç açıklanana kadar dakika akışı duraklar
      armSuspense(ev);
      return;
    }

    if (ev) {
      // Kart event'i — gerilime gerek yok (yönlü bir pozisyon değil), anında göster.
      const text = formatEvent(ev, { homeName, awayName, homeScore: pb.score.home, awayScore: pb.score.away });
      pb.shown.push({ type: ev.type, text });
      logEl.appendChild(el('div', { class: `row ${rowClassFor(ev.type)}` }, text));
      logEl.scrollTop = logEl.scrollHeight;
      pitch.cardFlash(ev.type);
      sfx.play(ev.type === 'red' ? 'red' : 'yellow');
    }
    if (!finishMinuteUpdate()) scheduleNextTick();
  }

  // [DÜZELTİLDİ — SENKRON] setInterval yerine kendi kendini düzelten bir setTimeout zinciri:
  // her çağrıda gerçek geçen süreye göre "şu an kaçıncı dakikada olunması gerektiği" hesaplanır
  // (bkz. yukarıdaki resumeTicking notu). Throttle edilmiş bir sekme geç uyanınca birden fazla
  // dakikayı aynı JS turunda ardışık `tick()` çağrılarıyla hızla telafi eder.
  function scheduleNextTick() {
    const msPerMin = SPEED_MS_PER_MIN[pb.speed];
    if (pb.tickAnchorSpeed !== pb.speed || !pb.tickAnchorAt) { resumeTicking(pb, scheduleNextTick); return; }
    const elapsed = Date.now() - pb.tickAnchorAt;
    const dueClock = pb.tickAnchorClock + Math.floor(elapsed / msPerMin);
    if (dueClock > pb.clock) { tick(); return; }
    const remaining = msPerMin - (elapsed % msPerMin);
    clearTimeout(playbackTimer);
    playbackTimer = setTimeout(scheduleNextTick, Math.max(16, remaining));
  }

  if (pb.pendingReveal) {
    // Bekleyen bir sonuç varken araya bir yeniden çizim girdi (ör. hız değiştirme düğmesi) —
    // akışı kaldığı yerden devam ettir.
    armSuspense(pb.pendingReveal);
  } else if (!pb.tickAnchorAt) {
    resumeTicking(pb, scheduleNextTick);
  } else {
    scheduleNextTick();
  }

  // [KULLANICI İSTEĞİ] "Simülasyon sırasında altta bir yerlerde canlı puan durumu gözükmesini
  // istiyorum." — sadece pb.order'da ŞU ANA KADAR TAMAMEN oynatılmış maçlar (pb.pos'tan ÖNCEKİ
  // adımlar — şu an izlenen maç henüz bitmediği için dahil edilmiyor, aksi halde onun sonucunu
  // anlatım bitmeden açık ederdi) hesaba katılıyor. pb.pos her ilerlediğinde (bir maç bitip
  // sıradakine geçildiğinde) zaten actions.route() çağrılıyor (bkz. yukarıdaki setTimeout), bu
  // yüzden tablo otomatik olarak canlı güncelleniyor — ayrı bir yeniden çizim mekanizması
  // gerekmedi. N=2 odada (tek eşleşme) ilk maç bitene kadar tablo boş bir bekleme mesajı
  // gösteriyor, ikinci maç bitince renderMatch'teki NİHAİ tabloyla birebir örtüşüyor.
  const completedSteps = pb.order.slice(0, pb.pos);
  root.appendChild(el('div', { class: 'panel' }, completedSteps.length === 0
    ? [
        el('h3', {}, 'Canlı Puan Durumu'),
        el('p', { class: 'muted', style: 'text-align:center;margin:0' }, 'İlk maç bitince tablo burada güncellenecek.'),
      ]
    : [
        el('h3', {}, 'Canlı Puan Durumu'),
        el('div', { style: 'overflow-x:auto' }, standingsTable(computeLiveStandings(state.room.players, r.fixtures, completedSteps), state)),
      ]));

  return root;
}

// [KULLANICI İSTEĞİ] "Simülasyon sırasında canlı puan durumu" — henüz oynanmamış maçlar hariç,
// SADECE tamamlanmış adımlardan (bkz. renderMatchPlayback completedSteps) bir puan tablosu
// üretir. orchestrate.js'teki sunucu mantığının basitleştirilmiş bir istemci-tarafı kopyası —
// nihai/kesin tablo HER ZAMAN sunucudan gelir (r.standings), bu sadece oynanış SIRASINDA
// gösterilen geçici/canlı bir özet; bu yüzden sunucudaki nadir son-çare eşitlik bozucuları
// (deplasman golü/fair-play/kura) burada tekrarlanmıyor — puan/averaj/atılan gol yeterli.
function computeLiveStandings(players, fixtures, completedSteps) {
  const points = {}, wins = {}, draws = {}, losses = {}, goalsFor = {}, goalsAgainst = {};
  for (const p of players) {
    points[p.clientId] = 0; wins[p.clientId] = 0; draws[p.clientId] = 0; losses[p.clientId] = 0;
    goalsFor[p.clientId] = 0; goalsAgainst[p.clientId] = 0;
  }
  for (const step of completedSteps) {
    const fixture = fixtures[step.fixtureIndex];
    const m = step.matchIndex === 0 ? fixture.match1 : fixture.match2;
    points[m.homeClientId] += m.pointsHome; points[m.awayClientId] += m.pointsAway;
    goalsFor[m.homeClientId] += m.goalsHome; goalsAgainst[m.homeClientId] += m.goalsAway;
    goalsFor[m.awayClientId] += m.goalsAway; goalsAgainst[m.awayClientId] += m.goalsHome;
    if (m.pointsHome === 3) { wins[m.homeClientId] += 1; losses[m.awayClientId] += 1; }
    else if (m.pointsAway === 3) { wins[m.awayClientId] += 1; losses[m.homeClientId] += 1; }
    else { draws[m.homeClientId] += 1; draws[m.awayClientId] += 1; }
  }
  return players.map((p) => ({
    clientId: p.clientId,
    name: p.name,
    played: wins[p.clientId] + draws[p.clientId] + losses[p.clientId],
    wins: wins[p.clientId],
    draws: draws[p.clientId],
    losses: losses[p.clientId],
    points: points[p.clientId],
    goalsFor: goalsFor[p.clientId],
    goalsAgainst: goalsAgainst[p.clientId],
    goalDiff: goalsFor[p.clientId] - goalsAgainst[p.clientId],
  })).sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);
}

// Puan tablosu <table>'ı — hem nihai sonuç ekranındaki (renderMatch) gerçek/kesin tablo hem de
// anlatım sırasındaki (renderMatchPlayback) canlı/geçici tablo AYNI görünümü paylaşıyor.
function standingsTable(standings, state) {
  return el('table', { class: 'standings-table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, '#'), el('th', {}, 'Oyuncu'), el('th', {}, 'O'), el('th', {}, 'G'), el('th', {}, 'B'), el('th', {}, 'M'),
      el('th', {}, 'A'), el('th', {}, 'Y'), el('th', {}, 'AV'), el('th', {}, 'P'),
    ])),
    el('tbody', {}, standings.map((s, i) => el('tr', {
      class: [s.clientId === state.clientId ? 'me' : '', i === 0 ? 'winner' : ''].filter(Boolean).join(' ') || undefined,
    }, [
      el('td', { class: 'rank-cell' }, String(i + 1)),
      el('td', {}, s.name + (s.clientId === state.clientId ? ' (sen)' : '')),
      el('td', {}, String(s.played)),
      el('td', {}, String(s.wins)),
      el('td', {}, String(s.draws)),
      el('td', {}, String(s.losses)),
      el('td', {}, String(s.goalsFor)),
      el('td', {}, String(s.goalsAgainst)),
      el('td', {}, (s.goalDiff > 0 ? '+' : '') + s.goalDiff),
      el('td', { style: 'font-weight:800' }, String(s.points)),
    ]))),
  ]);
}

// ============================== MATCH ==============================
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — "Maç fazı": sonuç artık
// {fixtures, standings, winnerClientId} şeklinde (round-robin — herkes herkesle ev+deplasman).
// N=2 odada fixtures tek elemanlıdır, puan tablosu 2 satıra iner — eski "Toplam Skor" ekranının
// doğal genellemesi.
export function renderMatch({ state, actions }) {
  const r = state.matchResult;
  const root = el('div', { class: 'view' });
  if (!r) {
    root.appendChild(el('div', { class: 'panel' }, 'Maç sonucu bekleniyor...'));
    return root;
  }

  const nameOf = (clientId) => (state.room.players.find((p) => p.clientId === clientId) || {}).name || '?';
  const winnerName = nameOf(r.winnerClientId);

  const winnerBanner = el('div', { class: 'winner-banner' }, [
    el('span', { class: 'trophy-icon' }, '🏆'),
    ` Şampiyon: ${winnerName}`,
  ]);
  root.appendChild(winnerBanner);
  // Ekran ilk açıldığında bir kerelik kutlama konfetisi (bkz. spawnConfetti — maç anlatımındaki
  // gol kutlamasıyla aynı efekt, [KULLANICI İSTEĞİ] "enerjik/oyun gibi" temasını sürdürür).
  setTimeout(() => spawnConfetti(winnerBanner, 30), 0);

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — "LİG USÜLÜ"] "Her maç 3 puan, beraberlik 1 puan, n
  // kişilik lig gibi olsun, 1. olan şampiyon olsun." — gerçek bir lig tablosu formatı: O(ynanan)/
  // G(alibiyet)/B(eraberlik)/M(ağlubiyet) sayaçları da gösteriliyor (bkz. orchestrate.js
  // standings.wins/draws/losses/played), sadece Puan/Averaj değil.
  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Puan Tablosu'),
    el('div', { style: 'overflow-x:auto' }, standingsTable(r.standings, state)),
    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Puan/averaj/atılan gol de eşitse ek bir istatistik
    // kriteri kullanılsın" — sıralama mantığı şeffaf olsun diye (bkz. claude.md "Puan Tablosu
    // 3-0 sorusu") kısa bir açıklama satırı.
    el('p', { class: 'muted', style: 'margin-top:8px;font-size:12.5px' },
      'Sıralama: Puan → Averaj → Atılan Gol → Deplasman Golü → Fair-Play (az kart). Bunlar da tam eşitse kura ile belirlenir.'),
  ]));

  // N>2 odada birden fazla eşleşme oynanır — sekmelerle aralarında gezinilir (2 kişilik odada
  // tek eşleşme olduğu için sekmeler hiç gösterilmez, ekran eskisiyle birebir aynı görünür).
  if (!state.matchResultUi || state.matchResultUi.fixtureIndex >= r.fixtures.length) {
    state.matchResultUi = { fixtureIndex: 0 };
  }
  const ui = state.matchResultUi;

  if (r.fixtures.length > 1) {
    root.appendChild(el('div', { class: 'fixture-tabs' }, r.fixtures.map((fx, i) => el('button', {
      class: `tab ${ui.fixtureIndex === i ? 'active' : ''}`,
      onclick: () => { ui.fixtureIndex = i; actions.route(); },
    }, `${nameOf(fx.aClientId)} vs ${nameOf(fx.bClientId)}`))));
  }

  const fx = r.fixtures[ui.fixtureIndex];
  root.appendChild(renderMatchResultCard('1. Maç', nameOf(fx.match1.homeClientId), nameOf(fx.match1.awayClientId), fx.match1));
  root.appendChild(renderMatchResultCard('2. Maç', nameOf(fx.match2.homeClientId), nameOf(fx.match2.awayClientId), fx.match2));

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — "LİG USÜLÜ"] "Ev ve deplasmanı kazanana 3 puan verme,
  // her maç kendi başına 3 puan." — bu ikili artık kendi başına bir "galip" üretmiyor (penaltı
  // YOK), her iki maç bağımsız puanlanıp doğrudan yukarıdaki lig tablosuna işleniyor. Burada
  // sadece bilgi amaçlı bir özet: bu ikiliden toplamda kaç puan çıktı + toplam gol.
  const pointsA = fx.match1.pointsHome + fx.match2.pointsAway;
  const pointsB = fx.match1.pointsAway + fx.match2.pointsHome;
  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Bu İkilinin Toplamı'),
    el('div', { class: 'scoreline' }, [
      el('div', { class: 'team' }, [nameOf(fx.aClientId), el('div', { class: 'xg' }, `${pointsA} puan`)]),
      el('div', { class: 'score' }, `${fx.aggregate[fx.aClientId]} - ${fx.aggregate[fx.bClientId]}`),
      el('div', { class: 'team' }, [nameOf(fx.bClientId), el('div', { class: 'xg' }, `${pointsB} puan`)]),
    ]),
    el('p', { class: 'muted', style: 'text-align:center;margin-top:6px' }, 'Her maç kendi başına puanlanır (galibiyet 3, beraberlik 1) — lig usülü, yukarıdaki puan tablosuna öyle işlendi.'),
  ]));

  // [KULLANICI İSTEĞİ] "Maç bittikten sonra tekrar oyna butonu gelsin." — aynı rakiple, oda
  // kodunu yeniden paylaşmadan sıfırdan bir draft başlatır (bkz. actions.rematch).
  root.appendChild(el('div', { style: 'display:flex; gap:10px; flex-wrap:wrap' }, [
    el('button', { class: 'btn', onclick: () => actions.rematch() }, '🔁 Tekrar Oyna'),
    el('button', { class: 'btn secondary', onclick: () => actions.leaveRoom() }, 'Yeni Oda Kur'),
  ]));
  return root;
}

// [KULLANICI İSTEĞİ] "Maçların altına gol atan oyuncular, gol atılan dakika yazsın."
function scorerColumn(events, team, teamName) {
  const goals = (events || []).filter((e) => e.type === 'goal' && e.team === team).sort((a, b) => a.minute - b.minute);
  return el('div', { class: 'scorer-list' }, [
    el('div', { class: 'scorer-list-team' }, teamName),
    goals.length
      ? el('div', {}, goals.map((g) => el('div', { class: 'scorer-row' }, `⚽ ${g.minute}' ${g.scorerName}`)))
      : el('div', { class: 'scorer-empty' }, 'Gol yok'),
  ]);
}

function ratingTier(rating) {
  if (rating >= 8) return 'great';
  if (rating >= 6.5) return 'good';
  return 'poor';
}

// [KULLANICI İSTEĞİ] "Sonra alta yine dizilişteki gibi saha formatında oyuncuların
// performansını gösteren performans puanı gözüksün — X oyuncusu iyi oynadı, maç puanı 9 gibi."
// lineup: [{slot, player, matchRating}] (bkz. server/src/match/ratings.js).
function renderMatchLineupPitch(lineup, title) {
  const slots = lineup.map((entry) => entry.slot);
  // [DÜZELTİLDİ — BUG, KULLANICI GERİ BİLDİRİMİ] "Simülasyon bittikten sonraki detay ekranı
  // açılmıyor" — kök neden: "Dizilim & Taktik ekranını v2 tasarımla yeniden kur" turunda (bkz.
  // git eced3d3) dizilim SEÇİM ekranındaki eski `computeLineupPositions` fonksiyonu silinip
  // yerine `layout` konmuştu, ama bu fonksiyon MAÇ SONUCU ekranındaki (bambaşka bir yer —
  // renderMatchLineupPitch, "Maç Performansı" mini sahası) bir çağrısı gözden kaçmış, silinen
  // isme bakmaya devam ediyordu. Sonuç: maç bitip renderMatch çizilmeye çalışınca `computeLineup
  // Positions is not defined` ReferenceError'ı fırlatıyordu — route() DOM'u önceden temizlediği
  // için ekran TAMAMEN BOŞ kalıyordu (konsolda sessiz bir hata, kullanıcıya hiçbir şey
  // gösterilmiyordu). `layout(slots)` aynı `{x,y,...}` şeklini (fazlasıyla) döndürüyor — doğrudan
  // yerine kullanılabiliyor, görsel bir fark yaratmıyor (GROUP_Y değerleri neredeyse özdeş).
  const positions = layout(slots);

  const chips = lineup.map((entry, i) => {
    const pos = positions[i];
    const tier = ratingTier(entry.matchRating);
    return el('div', { class: 'pitch-lineup-slot', style: `left:${pos.x}%; top:${pos.y}%` }, [
      el('div', { class: `pitch-lineup-badge pos-${slotGroup(entry.slot)}` }, entry.slot),
      el('div', { class: `pitch-lineup-chip rating-${tier}` }, [
        el('div', { class: 'pitch-lineup-matchrating' }, entry.matchRating.toFixed(1)),
        el('div', { class: 'pitch-lineup-name' }, entry.player.name),
      ]),
    ]);
  });

  const field = el('div', { class: 'lineup-pitch-field' }, [
    el('div', { class: 'lineup-pitch-halfline' }),
    el('div', { class: 'lineup-pitch-circle' }),
    el('div', { class: 'lineup-pitch-box top' }),
    el('div', { class: 'lineup-pitch-box bottom' }),
    ...chips,
  ]);

  return el('div', { class: 'lineup-pitch small' }, [
    el('div', { class: 'lineup-pitch-title' }, title),
    field,
  ]);
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — "LİG USÜLÜ"] "Her maç kendi başına 3 puan" — bu maçın
// KENDİ sonucuna göre hangi tarafın kaç puan kazandığını kısa bir etiketle gösterir.
function matchPointsSummary(m) {
  if (m.pointsHome === m.pointsAway) return 'Berabere — ikisi de 1 puan aldı';
  const winnerSide = m.pointsHome === 3 ? 'Ev sahibi' : 'Deplasman';
  return `${winnerSide} kazandı — 3 puan aldı, diğeri 0 puan`;
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Salt skor yeterli değil, motoru gerçekten yansıtan kısa
// bir anlatı/flavor-text üretilebilir — 'rakibin kalecisi seni 3 kez kurtardı' ya da 'zayıf
// defansın seni yedi' gibi." — sunucu (bkz. story.js) sadece yapısal olgular ({key, team,
// magnitude}) üretir, gerçek cümleyi burada takım isimleriyle kuruyoruz — narration.js'in
// event->metin ayrımıyla AYNI mimari.
const STORY_TEMPLATES = {
  attack_star: (team, homeName, awayName) => `⚔️ ${team === 'home' ? homeName : awayName} hücum hattı maça damga vurdu.`,
  defense_leak: (team, homeName, awayName) => `🕳️ ${team === 'home' ? homeName : awayName} defansı bu maçta rakibe kapıları açtı.`,
  defense_wall: (team, homeName, awayName) => `🛡️ ${team === 'home' ? homeName : awayName} defansı bu maçta neredeyse geçilmedi.`,
  keeper_wall: (team, homeName, awayName) => `🧤 ${team === 'home' ? homeName : awayName} kalecisi kritik anlarda seriyi kurtardı.`,
  keeper_soft: (team, homeName, awayName) => `🥅 ${team === 'home' ? homeName : awayName} kalecisinin zayıflığı bu maçta rakibin işine yaradı.`,
  unlucky: (team, homeName, awayName) => `📉 ${team === 'home' ? homeName : awayName}, beklenenin oldukça altında bir sonuçla ayrıldı — şanssızdı.`,
  lucky: (team, homeName, awayName) => `📈 ${team === 'home' ? homeName : awayName}, beklenenin oldukça üzerinde bir sonuçla ayrıldı — şanslıydı.`,
};

function matchStoryLine(fact, homeName, awayName) {
  const fn = STORY_TEMPLATES[fact.key];
  return fn ? fn(fact.team, homeName, awayName) : null;
}

function renderMatchResultCard(title, homeName, awayName, m) {
  const storyLines = (m.story || []).map((f) => matchStoryLine(f, homeName, awayName)).filter(Boolean);
  return el('div', { class: 'panel match-result-card' }, [
    el('div', { class: 'match-result-header' }, [
      el('div', { class: 'match-result-title' }, title),
      el('div', { class: 'match-result-tag' }, 'Ev sahibi solda, deplasman sağda'),
    ]),
    el('div', { class: 'scoreline' }, [
      el('div', { class: 'team' }, [homeName, el('div', { class: 'xg' }, `xG ${m.xgHome.toFixed(2)}`)]),
      el('div', { class: 'score' }, `${m.goalsHome} - ${m.goalsAway}`),
      el('div', { class: 'team' }, [awayName, el('div', { class: 'xg' }, `xG ${m.xgAway.toFixed(2)}`)]),
    ]),
    el('p', { class: 'muted', style: 'text-align:center;margin-top:2px' }, matchPointsSummary(m)),
    storyLines.length ? el('div', { class: 'match-story' }, storyLines.map((line) => el('p', { class: 'match-story-line' }, line))) : null,
    el('div', { class: 'scorer-columns' }, [
      scorerColumn(m.events, 'home', homeName),
      scorerColumn(m.events, 'away', awayName),
    ]),
    m.lineupHome && m.lineupAway ? el('div', { class: 'match-rating-pitches' }, [
      renderMatchLineupPitch(m.lineupHome, `${homeName} — Maç Performansı`),
      renderMatchLineupPitch(m.lineupAway, `${awayName} — Maç Performansı`),
    ]) : null,
  ]);
}

// ============================== OYUNCU VERİTABANI ==============================
// [KULLANICI İSTEĞİ] "Bir sayfaya oyundaki bütün oyuncuların ratingleri yazabilir. Buraya
// filtreleme de koyup insanların oyuncuları öğrenmesi için iyi olur. Filtreleme ve sıralama
// seçenekleri koy." — oda/draft durumundan bağımsız, üst bardaki #playersNavBtn'den her an
// açılıp kapatılabilen ayrı bir sayfa (bkz. app.js `state.page`). Veri `/api/players/all`'dan
// bir kez çekilip `actions.fetchPlayerDb` ile state'e alınıyor (bkz. app.js).
const POSITION_ORDER = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'RW', 'ST'];

function fmtEUR(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M €`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K €`;
  return `${n} €`;
}

// [KULLANICI İSTEĞİ] Reytingin performans ayağının kaynağını gösterir (bkz. server ETL
// `seasonStats`) — gol/asist yoksa (kaleci, veri eksik, icon vb.) sadece maç sayısı gösterilir.
function fmtSeasonStats(s, tournament, clubAchievement) {
  if (!s && !tournament && !clubAchievement) return '—';
  const bits = [];
  if (s) {
    bits.push(`${s.appearances} maç`);
    if (s.goals) bits.push(`${s.goals}G`);
    if (s.assists) bits.push(`${s.assists}A`);
    // [KULLANICI İSTEĞİ] "gol atamamış olabilir ama iyi oynamıştır" — DF/GK için sahadayken
    // yenen gol de (varsa) görünsün, reytingin bu kısmının nereden geldiği belli olsun.
    if (s.concededApps) bits.push(`${(s.concededWhileOnPitch / s.concededApps).toFixed(1)} yenen gol/maç`);
  }
  // [KULLANICI İSTEĞİ] "Trossard Dünya Kupası'nda çeyrek final oynadı" — büyük turnuva
  // katılımı da (varsa) burada görünsün, reytinge neden küçük bir bonus kattığı belli olsun.
  if (tournament && tournament.appearances > 0) bits.push(`🌍 turnuva +${tournament.bonus}`);
  // [KULLANICI İSTEĞİ] "lig şampiyonu oldu, Şampiyonlar Ligi'nde final oynadı" — kulüp başarısı
  // (tek bir toplam bonus — şampiyonluk + Avrupa turu birlikte, çift saymayı önlemek için).
  if (clubAchievement) {
    const label = [clubAchievement.isLeagueChampion ? '🏆 şampiyon' : null, clubAchievement.cupRoundDepth > 0 ? '⚽ Avrupa' : null]
      .filter(Boolean).join(' + ');
    if (label) bits.push(`${label} (+${clubAchievement.bonus})`);
  }
  return bits.length ? bits.join(' · ') : '—';
}

const PDB_SORTERS = {
  rating_desc: (a, b) => b.rating - a.rating,
  rating_asc: (a, b) => a.rating - b.rating,
  name_asc: (a, b) => a.name.localeCompare(b.name, 'tr'),
  value_desc: (a, b) => (b.marketValueEUR || 0) - (a.marketValueEUR || 0),
};
const PDB_RESULT_LIMIT = 200;

export function renderPlayerDatabase({ state, actions }) {
  if (!state.playerDbUi) {
    state.playerDbUi = { search: '', position: 'ALL', league: 'ALL', sort: 'rating_desc' };
  }
  const ui = state.playerDbUi;
  const root = el('div', { class: 'view' });

  root.appendChild(el('button', {
    class: 'btn small secondary', style: 'align-self:flex-start',
    onclick: () => actions.navigateToPage(null),
  }, '← Geri dön'));

  if (!state.playerDb || state.playerDb.status === 'idle') {
    actions.fetchPlayerDb().then(() => actions.route());
    root.appendChild(el('div', { class: 'panel' }, 'Oyuncular yükleniyor...'));
    return root;
  }
  if (state.playerDb.status === 'loading') {
    root.appendChild(el('div', { class: 'panel' }, 'Oyuncular yükleniyor...'));
    return root;
  }
  if (state.playerDb.status === 'error') {
    root.appendChild(el('div', { class: 'panel' }, 'Oyuncu listesi yüklenemedi — sunucu çalışıyor mu?'));
    return root;
  }

  const all = state.playerDb.all;
  const leagues = [...new Set(all.map((p) => p.league))].sort((a, b) => a.localeCompare(b, 'tr'));

  const q = ui.search.trim().toLowerCase();
  let filtered = all.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (ui.position !== 'ALL' && p.position !== ui.position) return false;
    if (ui.league !== 'ALL' && p.league !== ui.league) return false;
    return true;
  });
  filtered = filtered.slice().sort(PDB_SORTERS[ui.sort] || PDB_SORTERS.rating_desc);
  const shown = filtered.slice(0, PDB_RESULT_LIMIT);

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, `Oyuncu Veritabanı (${all.length})`),
    el('div', { class: 'player-db-toolbar' }, [
      el('input', {
        type: 'text', placeholder: '🔍 İsim ara...', value: ui.search,
        // [KULLANICI İSTEĞİ] "Harfler teker teker giriliyor, tekrar tıklamak gerekiyor" —
        // route() DOM'u yeniden kurduğunda bu işaret sayesinde odak/imleç geri yükleniyor
        // (bkz. app.js captureFocus/restoreFocus).
        'data-focus-key': 'pdb-search',
        oninput: (e) => { ui.search = e.target.value; actions.route(); },
      }),
      el('select', { onchange: (e) => { ui.position = e.target.value; actions.route(); } }, [
        el('option', { value: 'ALL', selected: ui.position === 'ALL' ? 'selected' : undefined }, 'Tüm pozisyonlar'),
        ...POSITION_ORDER.map((p) => el('option', { value: p, selected: ui.position === p ? 'selected' : undefined }, p)),
      ]),
      el('select', { onchange: (e) => { ui.league = e.target.value; actions.route(); } }, [
        el('option', { value: 'ALL', selected: ui.league === 'ALL' ? 'selected' : undefined }, 'Tüm ligler'),
        ...leagues.map((l) => el('option', { value: l, selected: ui.league === l ? 'selected' : undefined }, l)),
      ]),
      el('select', { onchange: (e) => { ui.sort = e.target.value; actions.route(); } }, [
        el('option', { value: 'rating_desc', selected: ui.sort === 'rating_desc' ? 'selected' : undefined }, 'Reyting ↓'),
        el('option', { value: 'rating_asc', selected: ui.sort === 'rating_asc' ? 'selected' : undefined }, 'Reyting ↑'),
        el('option', { value: 'name_asc', selected: ui.sort === 'name_asc' ? 'selected' : undefined }, 'İsim A-Z'),
        el('option', { value: 'value_desc', selected: ui.sort === 'value_desc' ? 'selected' : undefined }, 'Piyasa değeri ↓'),
      ]),
    ]),
    el('div', { class: 'muted', style: 'margin:10px 0' },
      `${filtered.length} oyuncu bulundu` + (filtered.length > PDB_RESULT_LIMIT ? ` — ilk ${PDB_RESULT_LIMIT} tanesi gösteriliyor, daraltmak için filtre kullan` : '')),
    el('div', { class: 'player-db-table-wrap' }, [
      el('table', { class: 'pdb-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Reyting'), el('th', {}, 'İsim'), el('th', {}, 'Poz'), el('th', {}, 'Kulüp'), el('th', {}, 'Lig'), el('th', {}, 'Bu Sezon'), el('th', {}, 'Değer'),
        ])),
        el('tbody', {}, shown.map((p) => el('tr', {}, [
          el('td', { class: 'pdb-rating' }, [
            String(p.rating),
            // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — REYTİNG KAYNAĞI ŞEFFAFLIĞI] bkz. helpers.js
            // fmtRatingSource/ratingSourceTitle — FC26 (doğrudan EA verisi) vs ≈EA (EA ölçeğine
            // kalibre edilmiş tahmin) ayrımı burada da görünsün diye.
            fmtRatingSource(p.ratingOverrideSource)
              ? el('span', {
                class: `pdb-source-tag ${p.ratingOverrideSource === 'fc26-2026-27-kalibre' ? 'calibrated' : ''}`,
                title: ratingSourceTitle(p.ratingOverrideSource) || '',
              }, fmtRatingSource(p.ratingOverrideSource))
              : null,
          ]),
          el('td', { class: 'pdb-name' }, [p.name, p.isIcon ? el('span', { class: 'pdb-icon-tag' }, ' ⭐') : null]),
          el('td', {}, el('span', { class: `pdb-pos pos-${slotGroup(p.position)}` }, p.position)),
          el('td', { class: 'muted' }, p.club || '—'),
          el('td', { class: 'muted' }, p.league),
          // [KULLANICI İSTEĞİ] "10 gol 10 asist yapmış... rating buna göre de belirlenmeli" —
          // reytingin performans ayağının NEDEN olduğunu gösteren şeffaflık satırı.
          el('td', { class: 'muted pdb-season' }, fmtSeasonStats(p.seasonStats, p.majorTournament, p.clubAchievement)),
          el('td', { class: 'pdb-value' }, p.isIcon ? '—' : fmtEUR(p.marketValueEUR)),
        ]))),
      ]),
    ]),
  ]));

  return root;
}
