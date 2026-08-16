import { el, toast, playerCard, squadChip, slotGroup, fmtMoney, countUpMoney } from './helpers.js';

// ============================== LOBBY ==============================
// [KULLANICI İSTEĞİ] "İki farklı kutu değilde tek kutuda göster. Oda kur veya odaya katıl
// seçeneği koy. Değer seçildikten sonra ad ve kod yazma yeri gelsin." — önce tek bir kartta
// mod seçimi (Oda Kur / Odaya Katıl), seçim yapılınca altında ilgili alanlar açılıyor.
export function renderLobby({ state, actions }) {
  if (!state.lobbyUi) state.lobbyUi = { mode: null, name: '', code: '', draftMode: 'live', playerPool: 'all' };
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
      actions.createRoom(nameInput.value.trim(), ui.draftMode, ui.playerPool);
    } else {
      if (!codeInput.value.trim()) return toast('Oda kodunu gir.');
      actions.joinRoom(nameInput.value.trim(), codeInput.value.trim());
    }
  }
  const submitOnEnter = (e) => { if (e.key === 'Enter') submit(); };
  nameInput.addEventListener('keydown', submitOnEnter);
  codeInput.addEventListener('keydown', submitOnEnter);

  function selectMode(mode) { ui.mode = mode; actions.route(); }
  function selectDraftMode(draftMode) { ui.draftMode = draftMode; actions.route(); }
  function selectPlayerPool(playerPool) { ui.playerPool = playerPool; actions.route(); }

  // [KULLANICI İSTEĞİ] "Oda kur/katıl ekranları güzel gözükmüyor, çok kalabalık duruyor" —
  // önceden bir mod seçilince (Oda Kur/Odaya Katıl) ÜSTTEKİ büyük kart çifti tam boyutta
  // kalmaya devam ediyor, ALTINDA da Draft Modu ve Oyuncu Havuzu için AYNI büyük kart deseni
  // (ikon+başlık+açıklama) tekrarlanıyordu — 3 büyük kart grubu üst üste. Artık: (1) üstteki
  // mod kartları SADECE seçim yapılmadan önce görünüyor (seçilince kompakt başlık zaten
  // "➕ Oda Kur" diyor, tekrar göstermeye gerek yok). (2) Draft Modu/Oyuncu Havuzu artık büyük
  // kart değil, dizilim ekranındaki formasyon seçiciyle AYNI kompakt "hap" (pill) düğmeler —
  // açıklama metni native tooltip'e (title) taşındı, ekranda ayrı bir satır kaplamıyor.
  // [KULLANICI İSTEĞİ] "Kartlar boş duruyor, ilgi çekici değil" — küçük bir ok (hover'da beliren)
  // ile birlikte tek bir yardımcı fonksiyondan üretiliyor (bkz. .lobby-mode-arrow CSS'i).
  function lobbyModeCard(icon, label, desc, onClick) {
    return el('button', { class: 'lobby-mode-btn', onclick: onClick }, [
      el('div', { class: 'lobby-mode-icon' }, icon),
      el('div', { class: 'lobby-mode-label-row' }, [
        el('div', { class: 'lobby-mode-label' }, label),
        el('div', { class: 'lobby-mode-arrow' }, '→'),
      ]),
      el('div', { class: 'lobby-mode-desc' }, desc),
    ]);
  }

  const modePicker = ui.mode ? null : el('div', { class: 'lobby-mode-picker' }, [
    lobbyModeCard('➕', 'Oda Kur', 'Yeni bir oda aç, kodu rakibine gönder', () => selectMode('create')),
    lobbyModeCard('🔑', 'Odaya Katıl', 'Rakibinden aldığın kodla gir', () => selectMode('join')),
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

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft modu — sadece host, oda kurarken seçer;
  // oda ömrü boyunca sabit kalır (bkz. claude.md "Ek Mod Fikirleri" / RoomManager.createRoom).
  const draftModePicker = ui.mode === 'create' ? pillToggle('Draft Modu', [
    ['live', '⏱️ Canlı Açık Arttırma', 'Teklifler anlık görünür, süre bitene kadar yükselir'],
    ['blind', '🙈 Kör Draft', 'Tek seferlik gizli teklif — rakibinkini göremezsin'],
  ], ui.draftMode, selectDraftMode) : null;

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Tek Lig Modu — draftMode'dan bağımsız ikinci bir
  // anahtar: havuzu Süper Lig + Türk icon'lara daraltır (bkz. claude.md "Ek Mod Fikirleri" /
  // RoomManager.createRoom / draft/pool.js).
  const playerPoolPicker = ui.mode === 'create' ? pillToggle('Oyuncu Havuzu', [
    ['all', '🌍 Tüm Ligler', 'Süper Lig + büyük 5 Avrupa ligi + tüm icon\'lar'],
    ['super-lig', '🇹🇷 Süper Lig', 'Sadece Süper Lig kadroları + Türk icon\'lar'],
  ], ui.playerPool, selectPlayerPool) : null;

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kullanıcı oynayacağını lobide sorma" — oda
  // kurulurken bir hedef oyuncu sayısı SORULMUYOR; oda kaç kişi gelirse gelsin (2-8) katılım
  // kabul eder, host odadaki herkes hazır olunca kendisi başlatır (bkz. renderWaitingRoom).

  const formSection = ui.mode ? el('div', { class: 'lobby-form' }, [
    el('div', { class: 'field' }, [el('label', {}, 'Adın'), nameInput]),
    ui.mode === 'join' ? el('div', { class: 'field' }, [el('label', {}, 'Oda Kodu'), codeInput]) : null,
    draftModePicker,
    playerPoolPicker,
    el('button', { class: 'btn block', onclick: submit }, ui.mode === 'create' ? 'Oda Kur' : 'Katıl'),
    el('button', { class: 'lobby-back', onclick: () => { ui.mode = null; actions.route(); } }, '← Geri'),
  ]) : null;

  // [KULLANICI İSTEĞİ] Bir mod seçilince (form açılınca) eski dar/kompakt düzen aynen kalıyor —
  // odaklanmış, sade bir form ekranı olması için split/dekoratif düzeni SADECE ilk açılış
  // ekranında (mod seçilmeden önceki hâlde) kullanıyoruz.
  if (ui.mode) {
    const hero = el('div', { class: 'lobby-hero' }, [
      el('h1', { class: 'lobby-title compact' }, ui.mode === 'create' ? '➕ Oda Kur' : '🔑 Odaya Katıl'),
    ]);
    return el('div', { class: 'lobby-shell' }, [
      hero,
      el('div', { class: 'center-col' }, [
        el('div', { class: 'panel lobby-card' }, [formSection]),
      ]),
    ]);
  }

  // [KULLANICI İSTEĞİ] "Ekranın yarısından fazlası boş duruyor, daha güzel olsun, yazı
  // ekleyebiliriz, bir tasarım olabilir" — geniş ekranda dar bir sütun ortada kalıp yanları boş
  // bırakıyordu. Artık: (1) geniş ekranda hero metni SOLDA, Oda Kur/Katıl kartları SAĞDA yan
  // yana (bkz. .lobby-hero-split) — dikey yerine yatay alan kullanılıyor. (2) Hero'nun altına
  // oyunun ne sunduğunu özetleyen kısa bir özellik şeridi eklendi (bkz. .lobby-features) — hem
  // bilgilendirici hem alan dolduruyor. (3) Arka planda gerçek player-card bileşeniyle (aynı
  // helpers.js fonksiyonu, sadece dekoratif/etkileşimsiz) döndürülmüş, soluk iki kart — sayfanın
  // geri kalanındaki "trading card" diliyle atmosfer kuruyor. Dar ekranda hepsi tek sütuna
  // katlanıyor, dekoratif kartlar gizleniyor (bkz. CSS media query).
  const FEATURES = [
    ['⚡', 'Canlı Açık Arttırma', 'Teklifler anlık, heyecan bitmiyor'],
    ['🌍', '3500+ Oyuncu', '6 lig, gerçek piyasa verisiyle'],
    ['⚽', 'Maç Simülasyonu', 'Ev sahibi + deplasman, dakika dakika'],
    ['🏆', '38 Efsane', 'Icon oyuncularla kadronu güçlendir'],
  ];
  const featureStrip = el('div', { class: 'lobby-features' }, FEATURES.map(([icon, title, desc]) => el('div', { class: 'lobby-feature' }, [
    el('div', { class: 'lobby-feature-icon' }, icon),
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

  // [KULLANICI İSTEĞİ] "Logo ve iconu proje dosyasının içine attım, kullanmak istiyorum" —
  // gerçek marka logosu (bkz. client/public/assets/logo-dark.png) SADECE mod seçilmeden
  // önceki ilk hero ekranında (kompakt "➕ Oda Kur" başlığında değil — orada zaten kalabalık
  // olmasın diye sade tutulmuştu, bkz. yukarıdaki "lobi kalabalığı" notları).
  const logoImg = el('img', { class: 'lobby-logo', src: '/assets/logo-dark.png', alt: 'PitchGavel — Kadro Açık Arttırması' });

  const heroCol = el('div', { class: 'lobby-hero-col' }, [
    logoImg,
    el('div', { class: 'lobby-hero-badge' }, '⚽ CANLI AÇIK ARTTIRMA'),
    el('h1', { class: 'lobby-title' }, ['Kendi ', el('span', {}, '11'), '\'ini kur.']),
    el('p', { class: 'lobby-sub' }, 'Rakibinle canlı açık arttırmada kadro topla, formasyonunu seç, ev sahibi + deplasman iki maçlık seride üstünlüğü kanıtla.'),
    featureStrip,
  ]);
  const cardsCol = el('div', { class: 'lobby-cards-col' }, [modePicker]);

  return el('div', { class: 'lobby-shell' }, [
    el('div', { class: 'lobby-hero-split' }, [decor, heroCol, cardsCol]),
  ]);
}

// ============================== WAITING ROOM ==============================
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kişi gelirse gelsin, herkes hazır verdikten sonra
// oda sahibi başlatsın" — sabit bir hedefe göre boş slot göstermek yerine, o an odada kim varsa
// (2-8 kişi) sadece onlar listelenir. Herkes kendi "hazırım" oyunu verir; draftı fiilen
// başlatan ayrı ve host'a özel bir buton (bkz. draftSockets.js `draft:start`).
export function renderWaitingRoom({ state, actions }) {
  const { room } = state;
  const votes = room.readyVotes || [];
  const iAmReady = votes.includes(state.clientId);
  const amIHost = room.hostClientId === state.clientId;
  const allReady = room.players.length >= 2 && room.players.every((p) => p.connected)
    && votes.length === room.players.length;

  return el('div', { class: 'view' }, [
    el('div', { class: 'panel' }, [
      el('h3', {}, 'Oda Kodu — rakibine/gruba gönder'),
      el('div', { class: 'room-code' }, room.code),
      el('div', { class: 'muted', style: 'margin-top:8px' },
        room.draftMode === 'blind' ? '🙈 Kör Draft modu — teklifler gizli' : '⏱️ Canlı Açık Arttırma modu'),
      el('div', { class: 'muted', style: 'margin-top:4px' },
        room.playerPool === 'super-lig' ? '🇹🇷 Tek Lig Modu — sadece Süper Lig + Türk icon\'lar' : '🌍 Tüm ligler'),
      el('div', { class: 'muted', style: 'margin-top:4px' }, `👥 En fazla ${room.maxPlayers || 8} kişi katılabilir`),
    ]),
    el('div', { class: 'panel' }, [
      el('h3', {}, `Oyuncular (${room.players.length})`),
      el('div', { class: 'player-slots' }, room.players.map((p) => el('div', { class: 'player-slot' }, [
        el('span', { class: `dot ${p.connected ? 'on' : 'off'}` }),
        el('span', {}, p.name + (p.clientId === state.clientId ? ' (sen)' : '') + (p.clientId === room.hostClientId ? ' 👑' : '')),
        votes.includes(p.clientId) ? el('span', { class: 'status-pill done' }, 'Hazır') : null,
      ]))),
      el('button', {
        class: `btn block ${iAmReady ? 'secondary' : ''}`,
        style: 'margin-top:16px',
        onclick: () => actions.toggleDraftReady(),
      }, iAmReady ? '⏳ Hazırsın — oyunu geri çekmek için tıkla' : '✅ Hazırım'),
      amIHost
        ? el('button', {
            class: 'btn block',
            style: 'margin-top:10px',
            disabled: allReady ? undefined : 'disabled',
            onclick: () => actions.startDraft(),
          }, allReady ? '🚀 Draftı Başlat' : `Başlatmak için herkes hazır olmalı (${votes.length}/${room.players.length})`)
        : el('p', { class: 'muted', style: 'margin-top:12px;text-align:center' },
            allReady ? 'Herkes hazır — oda sahibinin başlatması bekleniyor...' : `Hazır: ${votes.length}/${room.players.length}`),
    ]),
  ]);
}

// ============================== DRAFT ==============================
let timerInterval = null;
// [design.md "Hareket"] Canlı en-yüksek-teklif rakamının bir önceki gösterdiği değeri tur
// bazında hatırlar ki route() DOM'u sıfırdan kursa bile (bkz. app.js) bir sonraki teklif geldiğinde
// eski değerden yeni değere doğru "sayarak" yükselsin, anlık belirmesin (bkz. countUpMoney).
const lastShownBid = new Map();

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
  const isSuperLigMode = state.room.playerPool === 'super-lig';

  root.appendChild(el('div', { class: 'draft-header' }, [
    el('div', { class: 'formation-badge' }, `Formasyon: ${d.formation}`),
    el('div', { class: 'muted' }, isBlindMode
      ? '🙈 Kör Draft — sistem rastgele pozisyon getirir, teklifler gizli'
      : 'Canlı açık arttırma — sistem rastgele pozisyon getirir'),
    isSuperLigMode ? el('div', { class: 'muted' }, '🇹🇷 Tek Lig Modu — havuz Süper Lig + Türk icon\'larla sınırlı') : null,
    el('button', {
      class: `btn small ${d.paused || iVotedPause ? 'danger' : 'secondary'}`,
      onclick: () => actions.togglePause(),
    }, pauseLabel),
  ]));

  if (d.paused) {
    root.appendChild(el('div', { class: 'warning-banner' }, '⏸ Draft duraklatıldı — devam etmek için taraflardan biri "Devam Et"e basmalı.'));
  }

  root.appendChild(el('div', { class: 'budget-row' }, d.players.map((p) => el('div', { class: 'budget-card' }, [
    el('div', { class: 'name' }, p.name + (p.clientId === state.clientId ? ' (sen)' : '')),
    el('div', { class: 'budget' }, fmtMoney(p.budget)),
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
  const RESOLVED_EVENT_TYPES = ['auction_resolved', 'blind_auction_resolved', 'one_sided_assigned'];
  const resultEvent = d.event && RESOLVED_EVENT_TYPES.includes(d.event.type) ? d.event : null;

  if (resultEvent) {
    roundPanel.appendChild(renderRoundResultPanel(resultEvent, state));
  } else if (!round) {
    roundPanel.appendChild(el('div', { class: 'muted' }, 'Sıradaki tur hazırlanıyor...'));
  } else if (round.kind === 'one_sided') {
    roundPanel.appendChild(el('h3', {}, `Tek taraflı ihtiyaç — ${round.slotType}`));
    roundPanel.appendChild(playerCard(round.main, { slot: round.slotType, tag: 'Rakipsiz atandı' }));
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
        if (left <= 0) clearInterval(timerInterval);
      };
      tick();
      timerInterval = setInterval(tick, 150);
    }

    // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — "yedek merdiveni": tek bir yedek
    // yerine azalan reytingte K-1 yedek gösterilir (K = bu turdaki katılımcı sayısı). 2 kişilik
    // odada backups tam olarak 1 eleman taşır — görünüm eskisiyle birebir aynı kalır.
    const backups = round.backups || [];
    roundPanel.appendChild(el('div', { class: 'reveal-row' }, [
      playerCard(round.main, { slot: round.slotType, extraClass: 'main', tag: isBlind ? 'ANA OYUNCU — gizli teklif' : 'ANA OYUNCU — açık arttırmada' }),
      ...backups.map((b, i) => {
        const card = playerCard(b, {
          slot: round.slotType, extraClass: 'backup',
          tag: backups.length > 1 ? `${i + 2}. SIRA YEDEK` : 'YEDEK — kaybeden otomatik alır',
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
      const bidInput = el('input', {
        type: 'number', min: String(minAmount), max: String(cap), value: String(Math.min(Math.max(cap, minAmount), minAmount)),
        disabled: d.paused ? 'disabled' : undefined,
      });

      const submittedIds = round.submittedClientIds || [];
      const iSubmitted = submittedIds.includes(state.clientId);
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — tek bir "rakip" yerine bu
      // turdaki DİĞER tüm katılımcıların kilitleme durumu listelenir (miktar hâlâ hiç sızmıyor).
      const others = participants.filter((p) => p.clientId !== state.clientId);

      roundPanel.appendChild(el('div', { class: 'bid-panel' }, [
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
        el('div', { class: 'bid-cap' }, `Kişisel güvenli teklif tavanın: ${fmtMoney(Math.max(0, cap))} (bütçen diğer boş slotların için korunuyor)`),
        errorText,
      ]));
    } else {
      const minNext = round.highestBid > 0 ? round.highestBid + (state.config?.MIN_RAISE || 5) : (state.config?.MIN_PLAYER_PRICE || 10);
      const bidderName = round.highestBidderClientId
        ? (state.room.players.find((p) => p.clientId === round.highestBidderClientId)?.name || '?')
        : null;

      const bidInput = el('input', {
        type: 'number', min: String(minNext), max: String(cap), value: String(Math.min(cap, minNext)),
        disabled: d.paused ? 'disabled' : undefined,
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

      const bidRoundKey = `${round.main.id}@${round.deadline}`;
      const prevBid = lastShownBid.has(bidRoundKey) ? lastShownBid.get(bidRoundKey) : null;
      lastShownBid.set(bidRoundKey, round.highestBid);
      const bidAmountEl = el('b', {});
      countUpMoney(bidAmountEl, prevBid, round.highestBid);

      roundPanel.appendChild(el('div', { class: 'bid-panel' }, [
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
        el('div', { class: 'bid-cap' }, `Kişisel güvenli teklif tavanın: ${fmtMoney(Math.max(0, cap))} (bütçen diğer boş slotların için korunuyor)`),
        errorText,
      ]));
    }
  }

  root.appendChild(roundPanel);

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Kadrolar'),
    ...d.players.map((p) => el('div', { style: 'margin-bottom:14px' }, [
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, p.name + (p.clientId === state.clientId ? ' (sen)' : '')),
      el('div', { class: 'squad-grid' }, p.squad.map((s) => squadChip(s))),
    ])),
  ]));

  return root;
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

  if (event.type === 'one_sided_assigned') {
    const buyer = nameOf(event.clientId) + (event.clientId === state.clientId ? ' (sen)' : '');
    wrap.appendChild(el('h3', {}, `Sonuç — ${event.slotType} pozisyonu`));
    wrap.appendChild(receiptStrip({
      emoji: '🤝', headline: `${buyer} → ${event.player.name}`,
      sub: `Rakipsiz, ${fmtMoney(event.price)} — bu pozisyona sadece bu oyuncunun ihtiyacı vardı.`,
    }));
    wrap.appendChild(el('div', { class: 'reveal-row' }, [
      playerCard(event.player, { slot: event.slotType, extraClass: 'main' }),
    ]));
    return wrap;
  }

  const isBlind = event.type === 'blind_auction_resolved';
  const winner = nameOf(event.winnerClientId) + (event.winnerClientId === state.clientId ? ' (sen)' : '');
  wrap.appendChild(el('h3', {}, isBlind ? '🔓 Kör Teklif Sonucu' : '📢 Açık Arttırma Sonucu'));
  wrap.appendChild(receiptStrip({
    emoji: '🏆', headline: `${winner} → ${event.main.name}`,
    sub: `${fmtMoney(event.price)} karşılığında kadroya kattı`,
  }));
  wrap.appendChild(el('div', { class: 'reveal-row' }, [
    // .sold-wrap: saf CSS'te (bkz. styles.css) dönen bir "SATILDI" damgası basar — bu turun
    // dramatik anını (kim aldı) vurgulamak için.
    el('div', { class: 'sold-wrap' }, [playerCard(event.main, {
      slot: event.slotType, extraClass: 'main',
      tag: `🏆 ${winner} — ${fmtMoney(event.price)}`,
    })]),
    ...(event.backups || []).map((b, i) => {
      const card = playerCard(b.player, {
        slot: event.slotType, extraClass: 'backup',
        tag: `${nameOf(b.clientId)}${b.clientId === state.clientId ? ' (sen)' : ''} — ${fmtMoney(b.price)}`,
      });
      if ((event.backups || []).length > 1) card.appendChild(el('div', { class: 'ladder-rank-badge' }, String(i + 2)));
      return card;
    }),
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

// ============================== LINEUP ==============================
export function renderLineup({ state, actions }) {
  const root = el('div', { class: 'view' });
  const room = state.room;

  if (!state.lineupOptions) {
    root.appendChild(el('div', { class: 'panel' }, 'Dizilim seçenekleri yükleniyor...'));
    actions.fetchLineupOptions().then(() => actions.route());
    return root;
  }

  if (!state.lineupUi) {
    const draftFormation = room.formation;
    state.lineupUi = {
      activeTab: 'home',
      selections: {
        home: initSelection(state.lineupOptions.options, draftFormation),
        away: initSelection(state.lineupOptions.options, draftFormation),
      },
    };
  }

  const submitted = state.lineupSubmitted[state.clientId] || {};

  // [KULLANICI İSTEĞİ] "Maç başlarken de iki oyuncuda hazır versin." — [KULLANICI İSTEĞİ,
  // KARARLAŞTIRILDI] Çok Oyunculu Mod: eşik odadaki TÜM oyuncu sayısı, durum kartları da tek
  // bir "rakip" yerine odadaki HERKESİ listeler.
  const matchVotes = room.readyVotes || [];
  const matchIAmReady = matchVotes.includes(state.clientId);

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Durum'),
    el('div', { class: 'budget-row' }, room.players.map((p) =>
      statusCard(p.name + (p.clientId === state.clientId ? ' (sen)' : ''), state.lineupSubmitted[p.clientId] || {}))),
    room.status === 'match'
      ? el('button', {
          class: `btn block ${matchIAmReady ? 'secondary' : ''}`,
          style: 'margin-top:14px',
          onclick: () => actions.toggleMatchReady(),
        }, matchIAmReady ? `⏳ Hazırsın — diğerleri bekleniyor (${matchVotes.length}/${room.players.length})` : '✅ Hazırım — Maçı Başlat')
      : null,
  ]));

  // [KULLANICI İSTEĞİ] "Kadroları kaydederken uyarı göster, hem ev sahibi hem deplasman
  // kadrosunu kaydedin diye" — ikisi de kaydedilmeden maç başlayamayacağı açıkça hatırlatılıyor.
  if (!submitted.home || !submitted.away) {
    const missing = [!submitted.home ? 'Ev Sahibi' : null, !submitted.away ? 'Deplasman' : null].filter(Boolean).join(' ve ');
    root.appendChild(el('div', { class: 'warning-banner' }, `⚠️ Unutma: hem Ev Sahibi hem Deplasman dizilimini kaydetmelisin — eksik: ${missing}.`));
  }

  root.appendChild(el('div', { class: 'tabs' }, ['home', 'away'].map((side) => el('button', {
    class: `tab ${state.lineupUi.activeTab === side ? 'active' : ''}`,
    onclick: () => { state.lineupUi.activeTab = side; actions.route(); },
  }, side === 'home' ? 'Ev Sahibi Maçı' : 'Deplasman Maçı'))));

  const side = state.lineupUi.activeTab;
  const sel = state.lineupUi.selections[side];
  const squad = state.lineupOptions.squad;

  // Doküman: "Sistem, kadroyla gerçekten kurulamayacak formasyonları seçenek olarak
  // GÖSTERMEMELİ" — bu yüzden kurulamayan formasyonlar listeden tamamen çıkarılıyor
  // (devre dışı/üstü çizili göstermek yerine).
  const feasibleOptions = state.lineupOptions.options.filter((o) => o.feasible);

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, `${side === 'home' ? 'Ev Sahibi' : 'Deplasman'} — Formasyon Seç`),
    el('div', { class: 'formation-pick' }, feasibleOptions.map((o) => el('button', {
      class: `formation-option ${sel.formation === o.formation ? 'selected' : ''}`,
      onclick: () => {
        // Formasyon değişse de daha önce seçilmiş oyun tarzı/taktik korunsun.
        const next = initSelectionForFormation(o);
        next.style = sel.style;
        next.tactic = sel.tactic;
        state.lineupUi.selections[side] = next;
        actions.route();
      },
    }, o.formation))),

    sel.formation ? renderTacticPanel({ state, actions, side }) : null,
    sel.formation ? renderSlotAssignment({ state, actions, side, squad }) : el('p', { class: 'muted' }, 'Bir formasyon seç.'),

    sel.formation ? el('button', {
      class: 'btn block',
      style: 'margin-top:14px',
      onclick: async () => {
        const res = await actions.submitLineup(side, sel.formation, sel.assignment, sel.style, sel.tactic);
        if (res && res.ok) toast(`${side === 'home' ? 'Ev sahibi' : 'Deplasman'} dizilimi kaydedildi.`);
      },
    }, `${side === 'home' ? 'Ev Sahibi' : 'Deplasman'} Dizilimini Kaydet`) : null,
  ]));

  return root;
}

// [KULLANICI İSTEĞİ] "Kadro diziliminde agresif oyna/sakin oyna seçenekleri gelsin, buna bağlı
// olarak kırmızı/sarı kart gelsin. Atak/dengeli/defansif oyna seçenekleri de gelsin maçtan
// önce." — iki bağımsız eksen: oyun tarzı (kart riski) ve taktik (hücum/defans dengesi).
const STYLE_CHOICES = [
  ['calm', '😌 Sakin', 'Kart riski düşük'],
  ['normal', '🙂 Normal', 'Standart risk'],
  ['aggressive', '🔥 Agresif', 'Kart riski yüksek'],
];
const TACTIC_CHOICES = [
  ['defensive', '🛡️ Defansif', 'Defans +, hücum −'],
  ['balanced', '⚖️ Dengeli', 'Değişiklik yok'],
  ['attack', '⚔️ Atak', 'Hücum +, defans −'],
];

function renderTacticPanel({ state, actions, side }) {
  const sel = state.lineupUi.selections[side];

  function choiceRow(label, choices, current, onPick) {
    return el('div', { class: 'tactic-row' }, [
      el('div', { class: 'tactic-label' }, label),
      el('div', { class: 'formation-pick' }, choices.map(([key, text, desc]) => el('button', {
        class: `formation-option ${current === key ? 'selected' : ''}`,
        title: desc,
        onclick: () => { onPick(key); actions.route(); },
      }, text))),
    ]);
  }

  return el('div', { class: 'tactic-panel' }, [
    choiceRow('Oyun Tarzı', STYLE_CHOICES, sel.style, (key) => { sel.style = key; }),
    choiceRow('Taktik', TACTIC_CHOICES, sel.tactic, (key) => { sel.tactic = key; }),
  ]);
}

function statusCard(label, submitted) {
  return el('div', { class: 'budget-card' }, [
    el('div', { class: 'name' }, label),
    el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [
      el('span', { class: `status-pill ${submitted.home ? 'done' : 'pending'}` }, `Ev: ${submitted.home ? 'Hazır' : 'Bekliyor'}`),
      el('span', { class: `status-pill ${submitted.away ? 'done' : 'pending'}` }, `Dep: ${submitted.away ? 'Hazır' : 'Bekliyor'}`),
    ]),
  ]);
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

// [KULLANICI İSTEĞİ] "İlk 11'lerin gösterildiği ekran kötü... saha formatında pozisyon
// pozisyon gözüksün." — her slotun sahadaki yaklaşık (x%, y%) konumunu hesaplar. GK en altta
// (kendi kalesi), FW en üstte (hücum) olacak şekilde dikey bir saha varsayılır. Aynı satırdaki
// (aynı güç grubundaki) slotlar, saha genişliğine, sol/orta/sağ eğilimlerine göre dağıtılır.
const LINEUP_SLOT_RANK = { GK: 50, LB: 8, CB: 50, RB: 92, DM: 50, CM: 50, AM: 50, LM: 15, RM: 85, LW: 15, ST: 50, RW: 85 };
const LINEUP_GROUP_Y = { GK: 92, DF: 68, MF: 42, FW: 15 };

function computeLineupPositions(slots) {
  const rows = {};
  slots.forEach((slot, idx) => {
    const group = slotGroup(slot);
    (rows[group] = rows[group] || []).push({ slot, idx });
  });
  const positions = new Array(slots.length);
  for (const group of Object.keys(rows)) {
    const items = rows[group].slice().sort((a, b) => (LINEUP_SLOT_RANK[a.slot] ?? 50) - (LINEUP_SLOT_RANK[b.slot] ?? 50) || a.idx - b.idx);
    const n = items.length;
    items.forEach((item, i) => {
      const x = n === 1 ? 50 : 10 + i * (80 / (n - 1));
      positions[item.idx] = { x, y: LINEUP_GROUP_Y[group] ?? 50 };
    });
  }
  return positions;
}

function renderSlotAssignment({ state, actions, side, squad }) {
  const sel = state.lineupUi.selections[side];
  const slots = state.config.FORMATIONS[sel.formation];
  const positions = computeLineupPositions(slots);

  // [KULLANICI İSTEĞİ] "3 orta saha oyuncum var, x y z... z'nin ortada durmasını istiyorum,
  // x z y yapabilmeliyim, diğer mevkiler için de geçerli" — aynı slot TİPİNDEN (örn. üç CM)
  // iki slotun ATANMIŞ OYUNCUSUNU birbiriyle takas eder. computeLineupPositions aynı tipteki
  // slotları zaten artan idx sırasına göre soldan sağa dizdiği için "komşu index" = "komşu
  // görsel konum" — ayrı bir sıralama/konum state'i tutmaya gerek yok.
  function swapAssignment(i, j) {
    const tmp = sel.assignment[i];
    sel.assignment[i] = sel.assignment[j];
    sel.assignment[j] = tmp;
    actions.route();
  }

  const chips = slots.map((slotType, slotIdx) => {
    const usedElsewhere = new Set(sel.assignment.filter((_, i) => i !== slotIdx));
    const eligible = squad
      .map((entry, idx) => ({ idx, entry }))
      .filter(({ entry }) => entry.player.eligibleSlots.some((e) => e.slot === slotType));

    // Seçili oyuncunun reytingi/ismi büyük görünsün diye <select> yerine kendi görünümümüzü
    // çiziyoruz; native <select> altta görünmez şekilde bindirilip tıklamayı/erişilebilirliği
    // yönetiyor (klavye/ekran okuyucu için de gerçek bir <select> kalmış olur).
    const currentIdx = sel.assignment[slotIdx];
    const current = currentIdx != null ? squad[currentIdx] : null;

    const select = el('select', {
      class: 'pitch-lineup-select-native',
      onchange: (e) => {
        sel.assignment[slotIdx] = Number(e.target.value);
        actions.route();
      },
    }, eligible.map(({ idx, entry }) => el('option', {
      value: String(idx),
      selected: sel.assignment[slotIdx] === idx ? 'selected' : undefined,
      disabled: usedElsewhere.has(idx) && sel.assignment[slotIdx] !== idx ? 'disabled' : undefined,
    }, `${entry.player.name} (${entry.player.rating})${usedElsewhere.has(idx) && sel.assignment[slotIdx] !== idx ? ' — kullanımda' : ''}`)));

    // Aynı tip (örn. hepsi 'CM') kardeş slotlar, artan idx sırasıyla = soldan sağa görünüm
    // sırasıyla aynı. Sol/sağ ok sadece bir komşu VARSA gösterilir (uçtaki slotta o yön yok).
    const siblings = slots.map((s, i) => (s === slotType ? i : -1)).filter((i) => i >= 0);
    const posInGroup = siblings.indexOf(slotIdx);
    const leftSibling = posInGroup > 0 ? siblings[posInGroup - 1] : null;
    const rightSibling = posInGroup < siblings.length - 1 ? siblings[posInGroup + 1] : null;
    const swapRow = siblings.length > 1 ? el('div', { class: 'pitch-lineup-swap-row' }, [
      leftSibling != null
        ? el('button', { type: 'button', class: 'pitch-lineup-swap', title: 'Soldakiyle yer değiştir', onclick: () => swapAssignment(slotIdx, leftSibling) }, '◀')
        : el('span', { class: 'pitch-lineup-swap placeholder' }, '◀'),
      rightSibling != null
        ? el('button', { type: 'button', class: 'pitch-lineup-swap', title: 'Sağdakiyle yer değiştir', onclick: () => swapAssignment(slotIdx, rightSibling) }, '▶')
        : el('span', { class: 'pitch-lineup-swap placeholder' }, '▶'),
    ]) : null;

    const pos = positions[slotIdx];
    return el('div', {
      class: `pitch-lineup-slot ${current && current.player.isIcon ? 'icon' : ''}`,
      style: `left:${pos.x}%; top:${pos.y}%`,
    }, [
      el('div', { class: `pitch-lineup-badge pos-${slotGroup(slotType)}` }, slotType),
      el('div', { class: 'pitch-lineup-chip' }, [
        // [DÜZELTİLDİ — BUG] Görünmez <select> daha önce TÜM slotu (swap okları dahil) kapladığı
        // için z-index'e rağmen bazı tarayıcılarda ok tıklamalarını yutuyordu ("oyuncu pozisyon
        // değiş işe yaramıyor"). Artık select SADECE rating+isim alanını saran ayrı bir wrapper'a
        // (.pitch-lineup-select-wrap) bindirilip swap okları bu wrapper'ın TAMAMEN DIŞINDA —
        // örtüşme fiziksel olarak imkansız, z-index/stacking-context varsayımına gerek kalmıyor.
        el('div', { class: 'pitch-lineup-select-wrap' }, [
          current ? el('div', { class: 'pitch-lineup-rating' }, String(current.player.rating)) : null,
          el('div', { class: 'pitch-lineup-name' }, current ? current.player.name : 'Seç...'),
          select,
        ]),
        swapRow,
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

  return el('div', { class: 'lineup-pitch' }, [field]);
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

function createMiniPitch(onGoalImpact) {
  const ball = el('div', { class: 'pitch-ball' });
  const caption = el('div', { class: 'pitch-caption' });
  const flashLeft = el('div', { class: 'pitch-flash left' });
  const flashRight = el('div', { class: 'pitch-flash right' });
  const field = el('div', { class: 'pitch-field' }, [
    el('div', { class: 'pitch-halfline' }),
    el('div', { class: 'pitch-circle' }),
    el('div', { class: 'pitch-box left' }),
    el('div', { class: 'pitch-box right' }),
    el('div', { class: 'pitch-goal left' }),
    el('div', { class: 'pitch-goal right' }),
    flashLeft,
    flashRight,
    ball,
    caption,
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

  function flashGoal(side) {
    const node = side === 'right' ? flashRight : flashLeft;
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }

  // [KULLANICI İSTEĞİ] Kart event'lerinde topu hareket ettirmenin bir anlamı yok (yönlü bir
  // pozisyon değil) — bunun yerine tüm sahada kısa bir renkli titreşim (sarı/kırmızı) verilir.
  function cardFlash(kind) {
    field.classList.remove('card-flash-yellow', 'card-flash-red');
    void field.offsetWidth;
    field.classList.add(kind === 'red' ? 'card-flash-red' : 'card-flash-yellow');
  }

  function showCaption(text, kind) {
    caption.textContent = text;
    caption.className = `pitch-caption show ${kind}`;
    setTimeout(() => { caption.className = 'pitch-caption'; }, 1300);
  }

  function reset() {
    seq += 1;
    setBall(50, 50, 0);
    caption.className = 'pitch-caption';
  }
  reset();

  // Bir dizi ara noktadan (paslaşma / atağın gelişimi) sırayla geçer; her adımda güncel
  // seq kontrol edilir — araya yeni bir event girerse eski animasyon sessizce durur.
  function runPath(mySeq, waypoints, i, done) {
    if (mySeq !== seq) return;
    if (i >= waypoints.length) { if (done) done(); return; }
    const [x, y, dur] = waypoints[i];
    setBall(x, y, dur);
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

    // [KULLANICI İSTEĞİ] "Top dışarı çıkıyor gibi görünüyor ama gol diyor" bug'ının düzeltmesi:
    // artık şutun hedef Y'si sonucu YANSITIYOR — gol/kurtarış kale ağzı aralığına, auta giden
    // şut ise bilerek o aralığın dışına hedefleniyor.
    let saved = false;
    let shotY;
    if (isGoal) {
      shotY = GOAL_MOUTH_MIN + 4 + Math.random() * (GOAL_MOUTH_MAX - GOAL_MOUTH_MIN - 8);
    } else {
      saved = Math.random() < 0.55;
      shotY = saved
        ? GOAL_MOUTH_MIN + 2 + Math.random() * (GOAL_MOUTH_MAX - GOAL_MOUTH_MIN - 4)
        : (Math.random() < 0.5 ? 12 + Math.random() * 18 : 70 + Math.random() * 18);
    }
    const shotX = isGoal ? (attackRight ? 97 : 3) : (saved ? (attackRight ? 90 : 10) : (attackRight ? 94 : 6));
    const boxY = Math.max(8, Math.min(92, shotY + (Math.random() * 16 - 8)));
    const buildY1 = 16 + Math.random() * 68;
    const buildY2 = 16 + Math.random() * 68;
    const x1 = attackRight ? 30 : 70; // kendi yarı sahadan çıkış
    const x2 = attackRight ? 56 : 44; // orta sahayı geçen pas
    const x3 = attackRight ? 79 : 21; // ceza sahasına giriş

    setBall(50, 50, 0); // orta sahaya sıfırla

    requestAnimationFrame(() => {
      runPath(mySeq, [
        [x1, buildY1, 260],
        [x2, buildY2, 250],
        [x3, boxY, 280],
      ], 0, () => {
        setBall(shotX, shotY, 300); // şut
        setTimeout(() => {
          if (mySeq !== seq) return;
          flashGoal(targetSide);
          if (isGoal) {
            showCaption('GOOOL! ⚽', 'goal');
            if (onGoalImpact) onGoalImpact();
          } else {
            showCaption(saved ? 'KURTARDI! 🧤' : 'AUT! 📛', saved ? 'save' : 'miss');
          }
          setTimeout(() => { if (mySeq === seq) setBall(50, 50, 500); }, 800);
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
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — sonuç artık {fixtures, standings}
  // (N>2 odada birden fazla eşleşme oynanır); anlatım tüm fixtures[] listesini sırayla, her
  // biri kendi match1 -> match2 sırasıyla oynatır. 2 kişilik odada fixtures tek elemanlıdır —
  // davranış eskisiyle birebir aynı kalır.
  const fixture = r.fixtures[pb.fixtureIndex];
  const isFirst = pb.matchIndex === 0;
  const m = isFirst ? fixture.match1 : fixture.match2;
  const events = m.events || [];
  const nameOf = (id) => (state.room.players.find((p) => p.clientId === id) || {}).name || '?';
  const homeName = nameOf(m.homeClientId);
  const awayName = nameOf(m.awayClientId);
  const fixtureTag = r.fixtures.length > 1 ? `Eşleşme ${pb.fixtureIndex + 1}/${r.fixtures.length} — ` : '';

  const root = el('div', { class: 'view' });

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'draft-header' }, [
      el('h3', {}, `${fixtureTag}${isFirst ? '1. Maç' : '2. Maç'} — ${homeName} vs ${awayName}`),
      el('div', { class: 'playback-controls' }, [
        el('button', {
          class: `btn small ${pb.speed === 'slow' ? '' : 'secondary'}`,
          onclick: () => { pb.speed = 'slow'; actions.route(); },
        }, '🐢 Yavaş'),
        el('button', {
          class: `btn small ${pb.speed === 'fast' ? '' : 'secondary'}`,
          onclick: () => { pb.speed = 'fast'; actions.route(); },
        }, '⚡ Hızlı'),
        el('button', {
          class: 'btn small danger',
          onclick: () => { clearPlaybackTimer(); pb.done = true; actions.route(); },
        }, '⏭ Sonuca Geç'),
      ]),
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
    spawnConfetti(liveSide);
    layoutEl.classList.remove('shake');
    void layoutEl.offsetWidth;
    layoutEl.classList.add('shake');
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
      const ftText = '🏁 Maç sona erdi.';
      pb.shown.push({ type: 'fulltime', text: ftText });
      logEl.appendChild(el('div', { class: 'row' }, ftText));
      logEl.scrollTop = logEl.scrollHeight;
      setTimeout(() => {
        if (pb.done) return; // bu arada kullanıcı "Sonuca Geç" ile atladıysa tekrar route etme
        if (isFirst) {
          pb.matchIndex = 1; pb.clock = 0; pb.shown = []; pb.score = { home: 0, away: 0 };
        } else if (pb.fixtureIndex + 1 < r.fixtures.length) {
          // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — bu eşleşmenin 2. maçı da
          // bitti, sırada bir sonraki eşleşme varsa ona geç.
          pb.fixtureIndex += 1; pb.matchIndex = 0; pb.clock = 0; pb.shown = []; pb.score = { home: 0, away: 0 };
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
    if (!finishMinuteUpdate()) playbackTimer = setInterval(tick, SPEED_MS_PER_MIN[pb.speed]);
  }

  function armSuspense(ev) {
    pb.pendingReveal = ev;
    clearTimeout(suspenseTimer);
    suspenseTimer = setTimeout(() => { if (!pb.done) revealOutcome(ev); }, SUSPENSE_DELAY_MS);
  }

  function tick() {
    if (pb.done) { clearPlaybackTimer(); return; }
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
      clearInterval(playbackTimer); // sonuç açıklanana kadar dakika akışı duraklar
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
    }
    finishMinuteUpdate();
  }

  if (pb.pendingReveal) {
    // Bekleyen bir sonuç varken araya bir yeniden çizim girdi (ör. hız değiştirme düğmesi) —
    // akışı kaldığı yerden devam ettir.
    armSuspense(pb.pendingReveal);
  } else {
    playbackTimer = setInterval(tick, SPEED_MS_PER_MIN[pb.speed]);
  }

  return root;
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

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Puan Tablosu'),
    el('div', { style: 'overflow-x:auto' }, [
      el('table', { class: 'standings-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, '#'), el('th', {}, 'Oyuncu'), el('th', {}, 'P'), el('th', {}, 'A'), el('th', {}, 'Y'), el('th', {}, 'AV'),
        ])),
        el('tbody', {}, r.standings.map((s, i) => el('tr', {
          class: [s.clientId === state.clientId ? 'me' : '', i === 0 ? 'winner' : ''].filter(Boolean).join(' ') || undefined,
        }, [
          el('td', { class: 'rank-cell' }, String(i + 1)),
          el('td', {}, s.name + (s.clientId === state.clientId ? ' (sen)' : '')),
          el('td', {}, String(s.points)),
          el('td', {}, String(s.goalsFor)),
          el('td', {}, String(s.goalsAgainst)),
          el('td', {}, (s.goalDiff > 0 ? '+' : '') + s.goalDiff),
        ]))),
      ]),
    ]),
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

  root.appendChild(el('div', { class: 'panel' }, [
    el('h3', {}, 'Toplam Skor (Averaj)'),
    el('div', { class: 'scoreline' }, [
      el('div', { class: 'team' }, nameOf(fx.aClientId)),
      el('div', { class: 'score' }, `${fx.aggregate[fx.aClientId]} - ${fx.aggregate[fx.bClientId]}`),
      el('div', { class: 'team' }, nameOf(fx.bClientId)),
    ]),
    fx.wentToPenalties ? el('p', { class: 'muted', style: 'text-align:center' }, `Penaltılar: ${fx.penalties.scoreA} - ${fx.penalties.scoreB}`) : null,
    el('p', { class: 'muted', style: 'text-align:center;margin-top:6px' }, `Bu eşleşmenin galibi: ${nameOf(fx.winnerClientId)}`),
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
  const positions = computeLineupPositions(slots);

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

function renderMatchResultCard(title, homeName, awayName, m) {
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
    onclick: () => { state.page = null; actions.route(); },
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
          el('td', { class: 'pdb-rating' }, String(p.rating)),
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
