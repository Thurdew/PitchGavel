// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Mağaza kozmetiklerinin istemci tarafı: görünen
// adlar/açıklamalar, önizlemeler, gol efektleri ve tepkiler. Fiyat + sahiplik SUNUCUDAN gelir
// (bkz. server/src/shared/economy.js); burada sadece "nasıl görünür" var. Takım adı/logosu yok.
import { el } from './helpers.js';
import { sfx } from './sfx.js';

// Mağaza sekmeleri (sıra = ekrandaki sıra). `slot: true` → takılıp çıkarılabilir.
export const STORE_CATS = [
  { id: 'kit', label: 'Formalar' },
  { id: 'frame', label: 'Kart Çerçeveleri', slot: true, who: 'Herkes görür · bekleme odası ve hesap kartı' },
  { id: 'title', label: 'Unvanlar', slot: true, who: 'Herkes görür · isminin altında' },
  { id: 'pitch', label: 'Saha Zemini', slot: true, who: 'Ev sahibiyken maçın sahası bu olur, iki taraf da görür' },
  { id: 'goalfx', label: 'Gol Efekti', slot: true, who: 'Senin golünde oynar, herkes görür' },
  { id: 'crowd', label: 'Tribün Sesi', slot: true, who: 'Senin golünde çalar · sesi kapalı olan duymaz' },
  { id: 'stamp', label: 'Satıldı Damgası', slot: true, who: 'Açık arttırmayı sen kazanınca basılır' },
  { id: 'wheel', label: 'Çark Kaplaması', slot: true, who: 'Sen çevirirken herkes görür · dilimler aynı kalır' },
  { id: 'reactions', label: 'Tepkiler', who: 'Draft ve takas sırasında rakibe' },
];

// Slotun ücretsiz varsayılanı (mağazada ilk kart).
export const SLOT_DEFAULTS = {
  frame: { name: 'Çerçevesiz', desc: 'Kartın takım renklerinde, kenarlıksız.' },
  title: { name: 'Unvansız', desc: 'İsminin altında etiket görünmez.' },
  pitch: { name: 'Klasik', desc: 'Şeritli yeşil çim.' },
  goalfx: { name: 'Standart Konfeti', desc: 'Altı renkli klasik konfeti.' },
  crowd: { name: 'Standart', desc: 'Sadece oyunun gol sesi.' },
  stamp: { name: 'Klasik Damga', desc: 'Kırmızı "SATILDI" damgası, tek tokmak.' },
  wheel: { name: 'Standart', desc: 'Oyunun kendi çark görünümü.' },
};

export const COSMETIC_META = {
  'frame:claw': { name: 'Kartal Pençesi', desc: 'Köşede üç pençe izi, beyaz kenar.' },
  'frame:gold': { name: 'Altın Varak', desc: 'Işıltılı altın kenarlık.' },
  'frame:neon': { name: 'Gece Neonu', desc: 'Parlayan camgöbeği kenar.' },
  'frame:chalk': { name: 'Taktik Tahtası', desc: 'Kara tahta zemin, tebeşir kesik çizgi.' },
  'frame:lights': { name: 'Stadyum Işıkları', desc: 'Üstten vuran iki projektör.' },
  'frame:carbon': { name: 'Karbon', desc: 'Koyu karbon fiber örgü.' },

  'title:king': { name: 'Transfer Kralı', desc: 'İsminin altında turuncu etiket.' },
  'title:haggler': { name: 'Pazarlık Ustası', desc: 'İsminin altında turuncu etiket.' },
  'title:lastsec': { name: 'Son Saniye Teklifçisi', desc: 'İsminin altında turuncu etiket.' },
  'title:wheelmaster': { name: 'Çark Efendisi', desc: 'İsminin altında turuncu etiket.' },
  'title:vault': { name: 'Kasa Sahibi', desc: 'İsminin altında turuncu etiket.' },

  'pitch:night': { name: 'Gece Işıklı', desc: 'Koyu çim, dört köşede projektör.' },
  'pitch:snow': { name: 'Karlı Saha', desc: 'Karla kaplı zemin, mavi çizgiler, turuncu top.' },
  'pitch:retro': { name: 'Retro Yayın', desc: 'Eski tüplü TV: tarama çizgileri, soluk renkler.' },
  'pitch:mowed': { name: 'Dama Biçimli Çim', desc: 'Çim kareler halinde biçilmiş, açık-koyu desen.' },
  'pitch:sunset': { name: 'Gün Batımı', desc: 'Turuncu akşam ışığı, uzun gölgeler.' },
  'pitch:rain': { name: 'Yağmurlu Maç', desc: 'Islak koyu çim, eğik yağmur çizgileri, su birikintileri.' },
  'pitch:beach': { name: 'Kumsal', desc: 'Kum zemin, mavi ip çizgiler.' },
  'pitch:film70': { name: "70'ler Filmi", desc: 'Grenli, sepya tonlu eski film karesi.' },
  'pitch:arcade': { name: '8-Bit Arcade', desc: 'Piksel ızgara, köşeli orta yuvarlak, kare top.' },
  'pitch:neon': { name: 'Neon Hatlar', desc: 'Karanlık zemin, parlayan camgöbeği ve pembe çizgiler.' },

  'goalfx:teamconfetti': { name: 'Takım Konfetisi', desc: 'Konfeti formanın iki renginde.' },
  'goalfx:flash': { name: 'Ekran Flaşı', desc: 'Kale ağzından sahaya yayılan beyaz patlama.' },
  'goalfx:stars': { name: 'Yıldız Yağmuru', desc: 'Saha kararır, altın yıldızlar düşer.' },

  'crowd:drum': { name: 'Davul', desc: 'Tribün davulunun ritmi.' },
  'crowd:roar': { name: 'Kalabalık Uğultusu', desc: 'Uzun, dolgun bir tribün patlaması.' },
  'crowd:horn': { name: 'Korna', desc: 'Üç kez çalan stadyum kornası.' },

  'stamp:gold': { name: 'Altın Tokmak', desc: '"Tokmak vuruldu" altın şeridi, üç vuruş.' },
  'stamp:seal': { name: 'Mühür', desc: 'Kırmızı balmumu mühür, yumuşak basış sesi.' },

  'wheel:casino': { name: 'Kumarhane', desc: 'Altın kenar, siyah iç halka.' },
  'wheel:neon': { name: 'Neon', desc: 'Parlayan camgöbeği kenar ve gösterge.' },

  'reactions:market': { name: 'Pazar Yeri Paketi', desc: 'Dört yazılı tepki: Soygun!, İyi alış, Boşa para, Hadi be.' },
};
export const cosmeticName = (type, key) => (key ? (COSMETIC_META[`${type}:${key}`] || {}).name : (SLOT_DEFAULTS[type] || {}).name) || key || '';

// Tepkiler — id'ler sunucudaki REACTIONS ile aynı.
export const REACTIONS = [
  { id: 'fire', text: '🔥', emoji: true },
  { id: 'laugh', text: '😂', emoji: true },
  { id: 'clap', text: '👏', emoji: true },
  { id: 'grimace', text: '😬', emoji: true },
  { id: 'robbery', text: 'Soygun!', tone: 'danger', pack: 'reactions:market' },
  { id: 'goodbuy', text: 'İyi alış', tone: 'good', pack: 'reactions:market' },
  { id: 'waste', text: 'Boşa para', tone: 'accent', pack: 'reactions:market' },
  { id: 'comeon', text: 'Hadi be', tone: 'light', pack: 'reactions:market' },
];
export const reactionById = (id) => REACTIONS.find((r) => r.id === id) || null;

// Odadaki oyuncunun (toPublicState) takılı kozmetiği.
export const cosmeticOf = (player, slot) => (player && player.cosmetics && player.cosmetics[slot]) || null;

// Tepkileri gizle tercihi (cihaza özel).
const LS_HIDE = 'pg_hide_reactions';
export function reactionsHidden() { try { return localStorage.getItem(LS_HIDE) === '1'; } catch (e) { return false; } }
export function setReactionsHidden(v) { try { localStorage.setItem(LS_HIDE, v ? '1' : '0'); } catch (e) { /* yok say */ } }

// ---------------- gol efektleri ----------------
const DEFAULT_CONFETTI = ['#33e39a', '#f6c65a', '#5fa8ff', '#ff8a5b', '#d199ff', '#ff6161'];
function confettiBurst(container, colors, count = 24) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI - Math.PI;
    const dist = 60 + Math.random() * 90;
    const piece = el('div', {
      class: 'pitch-confetti',
      style: `background:${colors[i % colors.length]}; top:6%; --dx:${Math.cos(angle) * dist}px; --dy:${Math.sin(angle) * dist - 30}px; --rot:${Math.round(Math.random() * 540 - 270)}deg;`,
    });
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 950);
  }
}

// `container`: konfetinin bindiği panel (position:relative). `field`: .pitch-field (flaş/yıldız
// sahanın üstüne çizilir). `side`: 'home' (sağ kaleye) | 'away' (sol kaleye). `kit`: golü atan
// tarafın forması ({ colors: [a, b] }) — takım konfetisi bunu kullanır.
export function playGoalFx(key, { container, field, side = 'home', kit = null } = {}) {
  if (key === 'teamconfetti' && kit && kit.colors) {
    confettiBurst(container, [kit.colors[0], kit.colors[1] || '#ffffff', kit.colors[0], '#ffffff'], 30);
    return;
  }
  if (key === 'flash' && field) {
    const fx = el('div', { class: `fx-flash ${side === 'away' ? 'left' : 'right'}` });
    field.appendChild(fx);
    setTimeout(() => fx.remove(), 1100);
    return;
  }
  if (key === 'stars' && field) {
    const dim = el('div', { class: 'fx-dim' });
    field.appendChild(dim);
    for (let i = 0; i < 16; i++) {
      const s = el('span', {
        class: 'fx-star',
        style: `left:${4 + Math.random() * 92}%; font-size:${12 + Math.round(Math.random() * 16)}px; animation-delay:${Math.round(Math.random() * 500)}ms; --fall:${60 + Math.random() * 40}%;`,
      }, '★');
      field.appendChild(s);
    }
    setTimeout(() => { dim.remove(); field.querySelectorAll('.fx-star').forEach((n) => n.remove()); }, 1900);
    return;
  }
  if (container) confettiBurst(container, DEFAULT_CONFETTI, 24);
}

export function playCrowd(key, delay = 350) {
  if (!key) return;
  setTimeout(() => sfx.play(`crowd_${key}`), delay);
}

export function playStampSound(key) {
  if (key === 'gold') sfx.play('stamp_gold');
  else if (key === 'seal') sfx.play('stamp_seal');
}

// ---------------- mağaza önizlemeleri ----------------
function miniLic({ frame, title, name }) {
  return el('div', { class: `mini-lic ${frame ? `frame-${frame}` : ''}` }, [
    el('span', { class: 'lic-frame' }),
    el('div', { class: 'mini-lic-inner' }, [
      el('div', { class: 'mini-lic-strip' }, 'Menajer Lisansı'),
      el('div', { class: 'mini-lic-name' }, name || 'Menajer'),
      title ? el('span', { class: 'lic-title' }, cosmeticName('title', title)) : null,
    ]),
  ]);
}

function miniPitch(skin) {
  const dots = [[22, 30], [22, 64], [40, 47]].map(([x, y]) => el('span', { class: 'cos-dot home', style: `left:${x}%;top:${y}%` }))
    .concat([[74, 34], [74, 60], [58, 47]].map(([x, y]) => el('span', { class: 'cos-dot away', style: `left:${x}%;top:${y}%` })));
  return el('div', { class: `pitch-field cos-pitch ${skin ? `skin-${skin}` : ''}` }, [
    el('div', { class: 'pitch-halfline' }), el('div', { class: 'pitch-circle' }),
    el('div', { class: 'pitch-box left' }), el('div', { class: 'pitch-box right' }),
    el('div', { class: 'pitch-goal left' }), el('div', { class: 'pitch-goal right' }),
    ...dots,
    el('span', { class: 'cos-ball' }),
  ]);
}

const WAVES = {
  drum: 'polygon(0 50%,6% 10%,9% 90%,12% 50%,24% 50%,30% 5%,33% 95%,36% 50%,48% 50%,54% 10%,57% 90%,60% 50%,66% 20%,69% 80%,72% 50%,84% 50%,90% 0,93% 100%,96% 50%,100% 50%)',
  roar: 'polygon(0 50%,8% 40%,18% 30%,30% 22%,42% 10%,55% 0,68% 8%,80% 20%,92% 32%,100% 45%,100% 55%,92% 68%,80% 80%,68% 92%,55% 100%,42% 90%,30% 78%,18% 70%,8% 60%)',
  horn: 'polygon(0 50%,4% 50%,5% 15%,28% 15%,29% 50%,36% 50%,37% 15%,60% 15%,61% 50%,68% 50%,69% 5%,98% 5%,99% 50%,98% 95%,69% 95%,68% 50%,61% 50%,60% 85%,37% 85%,36% 50%,29% 50%,28% 85%,5% 85%,4% 50%)',
  none: 'polygon(0 45%,100% 45%,100% 55%,0 55%)',
};

// Mağaza kartındaki önizleme. `ctx`: { name, kit } — kullanıcının adı ve forması (takım konfetisi için).
export function cosmeticPreview(type, key, ctx = {}) {
  switch (type) {
    case 'frame': return miniLic({ frame: key, name: ctx.name });
    case 'title': return miniLic({ title: key, name: ctx.name });
    case 'pitch': return miniPitch(key);
    case 'goalfx': {
      const field = miniPitch(null);
      const wrap = el('button', { type: 'button', class: 'cos-play-wrap', title: 'Önizle' }, [field, el('span', { class: 'cos-play-hint' }, '▶ Önizle')]);
      wrap.onclick = () => { sfx.play('goal'); playGoalFx(key || null, { container: wrap, field, side: 'home', kit: ctx.kit }); };
      return wrap;
    }
    case 'crowd': {
      const btn = el('button', { type: 'button', class: 'cos-sound' }, [
        el('span', { class: 'cos-sound-play' }),
        el('span', { class: 'cos-wave', style: `clip-path:${WAVES[key || 'none']}` }),
      ]);
      btn.onclick = () => { sfx.play('goal'); playCrowd(key, 250); };
      return btn;
    }
    case 'stamp': {
      const card = () => el('div', { class: `cos-stamp sold-wrap ${key ? `stamp-${key}` : ''}` }, [
        el('div', { class: 'cos-stamp-card' }, [
          el('span', { class: 'cos-stamp-pos' }, 'FW'),
          el('span', { class: 'cos-stamp-name' }, 'E. Kaya'),
          el('span', { class: 'cos-stamp-meta' }, '84 · 42M'),
        ]),
      ]);
      const holder = el('button', { type: 'button', class: 'cos-play-wrap', title: 'Önizle' }, [card()]);
      holder.onclick = () => { holder.replaceChildren(card()); sfx.play('gavel'); playStampSound(key); };
      return holder;
    }
    case 'wheel': return el('div', { class: `cos-wheel wheel-stage ${key ? `wheel-skin-${key}` : ''}` }, [
      el('div', { class: 'wheel-pointer' }),
      el('div', { class: 'wheel-disk', style: 'background:conic-gradient(#22c55e 0 25%,#f59e0b 25% 50%,#fb4155 50% 70%,#22c55e 70% 85%,#f59e0b 85% 100%)' }),
    ]);
    case 'reactions': return el('div', { class: 'cos-reacts' }, REACTIONS.filter((r) => r.pack === `reactions:${key}`)
      .map((r) => el('span', { class: `react-chip tone-${r.tone || 'light'}` }, r.text)));
    default: return el('div');
  }
}
