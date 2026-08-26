import { el, toast, playerCard, squadChip, slotGroup, fmtMoney, countUpMoney } from './helpers.js';

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
export function renderLobby({ state, actions }) {
  if (!state.lobbyUi) state.lobbyUi = { mode: null, name: '', code: '', draftMode: 'live', playerPool: 'all', wheelSegments: [] };
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
      actions.createRoom(nameInput.value.trim(), ui.draftMode, ui.playerPool, picked);
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

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kullanıcı oynayacağını lobide sorma" — oda
  // kurulurken bir hedef oyuncu sayısı SORULMUYOR; oda kaç kişi gelirse gelsin (2-8) katılım
  // kabul eder, host odadaki herkes hazır olunca kendisi başlatır (bkz. renderWaitingRoom).

  const formSection = ui.mode ? el('div', { class: 'lobby-form' }, [
    el('div', { class: 'field' }, [el('label', {}, 'Adın'), nameInput]),
    ui.mode === 'join' ? el('div', { class: 'field' }, [el('label', {}, 'Oda Kodu'), codeInput]) : null,
    draftModePicker,
    playerPoolPicker,
    wheelSegmentPickerEl,
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
const wheelSpinAnimated = new Map(); // spinKey -> final rotation (deg)
// [KULLANICI İSTEĞİ] Suspense — animasyon bitene kadar sonucu (band/pick listesi) gizler. Bir
// spinKey için reveal zamanlayıcısı SADECE bir kez kurulur (aksi halde her ara re-render'da
// yeniden 3.2sn'lik bir bekleme başlardı).
const wheelRevealReady = new Map(); // spinKey -> true (animasyon bitti, sonuç gösterilebilir)
const wheelRevealScheduled = new Set(); // spinKey -> zamanlayıcı zaten kuruldu mu
const WHEEL_AUTO_KINDS = new Set(['forced_worst', 'give_best', 'respin']); // sunucudaki AUTO_RESOLVE_KINDS ile aynı

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
  const RESOLVED_EVENT_TYPES = ['auction_resolved', 'blind_auction_resolved', 'one_sided_assigned', 'wheel_turn_resolved'];
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
    roundPanel.appendChild(el('div', { class: 'reveal-row' }, [
      playerCard(round.main, { slot: round.slotType, extraClass: 'main', tag: isBlind ? 'ANA OYUNCU — gizli teklif' : 'ANA OYUNCU — açık arttırmada' }),
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
      const bidInput = el('input', {
        type: 'number', min: String(minAmount), max: String(cap), value: String(Math.min(Math.max(cap, minAmount), minAmount)),
        disabled: d.paused ? 'disabled' : undefined,
        'data-focus-key': `bid-input-${roundKey}`,
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

      // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Biri teklif verirken diğerinin yazdığı teklif
      // kayboluyor" — canlı moddaki rakip teklifi her geldiğinde (round.highestBid değişince
      // minNext de değişir) bu input SIFIRDAN kuruluyordu; kendi yazdığın özel bir teklif varsa
      // sessizce siliniyordu. Aynı çözüm: data-focus-key round'a (bidRoundKey) bağlı, app.js'teki
      // genel mekanizma değeri odaktan bağımsız koruyor.
      const bidRoundKey = `${round.main.id}@${round.deadline}`;
      const bidInput = el('input', {
        type: 'number', min: String(minNext), max: String(cap), value: String(Math.min(cap, minNext)),
        disabled: d.paused ? 'disabled' : undefined,
        'data-focus-key': `bid-input-${bidRoundKey}`,
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

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] Round artık TEK KİŞİLİK bir tur
// (bkz. DraftEngine.nextWheelTurn) — sırası gelen kişi çarkı çevirir (görsel dilim/döndürme,
// bkz. wheelGeometry/wheelRotationFor), animasyon bitene kadar (bkz. wheelRevealReady) sonuç
// gizli kalır, sonra o segmente uygun bir seçim ekranı (ya da özel aksiyonlarda otomatik sonuç)
// açılır. Diğer katılımcılar da aynı anda AYNI çark animasyonunu/reveal zamanlamasını görür
// (round zaten broadcast edildiği için).
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

  const disk = el('div', { class: 'wheel-disk' });
  disk.style.background = `conic-gradient(${geo.map((s) => `${s.color} ${s.startPct}% ${s.endPct}%`).join(', ')})`;
  // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Çarktaki yazılar güzel gözükmüyor" — kök neden:
  // her dilime SABİT 64px'lik bir etiket kutusu veriliyordu, ama ağırlıklı çark yüzünden dilimler
  // eşit genişlikte DEĞİL (bkz. gameConfig.js WHEEL_RATING_BANDS/WHEEL_SPECIAL_SEGMENTS weight
  // farkları) — dar bir dilime uzun bir etiket ("💀 Şanssız Tur", "🏳️ Milliyet Piyangosu") denk
  // gelince metin komşu dilime taşıyordu. Artık her etiketin genişliği/font boyutu KENDİ diliminin
  // gerçek yay genişliğine göre hesaplanıyor; ayrıca emoji önekini (banner/toast'ta zaten var, bkz.
  // renderWheelRound bannerText) çarkın ÜZERİNDE göstermiyoruz — dar dilimlerde en kıymetli alanı
  // asıl kelimeye ayırmak için.
  for (const s of geo) {
    const angleDeg = s.endDeg - s.startDeg;
    const arcWidth = 2 * LABEL_RADIUS * Math.sin((angleDeg / 2) * (Math.PI / 180));
    const labelWidth = Math.max(30, Math.min(70, Math.round(arcWidth * 0.86)));
    const fontSize = labelWidth < 38 ? 9 : labelWidth < 50 ? 10 : 11.5;
    const displayLabel = s.label.replace(/^\p{Extended_Pictographic}️?\s*/u, '');
    disk.appendChild(el('div', {
      class: 'wheel-slice-label',
      style: `transform: rotate(${s.centerDeg}deg) translateY(-${LABEL_RADIUS}px) rotate(${-(s.centerDeg + (wheelSpinAnimated.get(spinKey) || 0))}deg); width:${labelWidth}px; margin-left:${-labelWidth / 2}px; font-size:${fontSize}px;`,
    }, displayLabel));
  }

  if (round.currentSpin) {
    let finalDeg = wheelSpinAnimated.get(spinKey);
    if (finalDeg == null) {
      // Bu spin için İLK render — animasyonu şimdi başlat (0'dan hedef açıya, bkz. yorum
      // yukarıda). İki iç içe rAF: tarayıcının "transition:none + rotate(0)" durumunu gerçekten
      // boyaması için (aksi halde 0'dan başlamadan direkt hedefe atlayabiliyor).
      finalDeg = wheelRotationFor(geo, round.currentSpin.label);
      wheelSpinAnimated.set(spinKey, finalDeg);
      disk.style.transition = 'none';
      disk.style.transform = 'rotate(0deg)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          disk.style.transition = `transform ${WHEEL_SPIN_DURATION_MS}ms cubic-bezier(0.14, 0.68, 0.16, 1)`;
          disk.style.transform = `rotate(${finalDeg}deg)`;
        });
      });
    } else {
      disk.style.transition = 'none';
      disk.style.transform = `rotate(${finalDeg}deg)`;
    }
  } else {
    disk.style.transition = 'none';
    disk.style.transform = 'rotate(0deg)';
  }

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
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap' }, [
      el('h3', { style: 'margin:0' }, 'Durum'),
      leaveGameButton(actions),
    ]),
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
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kontra" — kendi hücum/orta saha gücünden biraz feragat
// edip karşılığında RAKİBİN hücum gücünü doğrudan kısan dördüncü taktik (bkz. simulate.js
// applyCounterDefense) — zayıf bir savunması olan kadıya bile gerçek bir strateji şansı veriyor.
const TACTIC_CHOICES = [
  ['defensive', '🛡️ Defansif', 'Defans +, hücum −'],
  ['balanced', '⚖️ Dengeli', 'Değişiklik yok'],
  ['attack', '⚔️ Atak', 'Hücum +, defans −'],
  ['counter', '🔀 Kontra', 'Kendi hücumun biraz azalır, rakibin hücum gücünü doğrudan kısarsın'],
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

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'draft-header' }, [
      el('h3', {}, `${fixtureTag}${isFirst ? '1. Maç' : '2. Maç'}${progressTag} — ${homeName} vs ${awayName}`),
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
        // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Karışık sıra — bir sonraki maç artık aynı
        // eşleşmenin 2. maçı olmak ZORUNDA değil, pb.order'daki bir sonraki (karışık) adım.
        if (pb.pos + 1 < pb.order.length) {
          pb.pos += 1; pb.clock = 0; pb.shown = []; pb.score = { home: 0, away: 0 };
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
