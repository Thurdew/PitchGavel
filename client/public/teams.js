// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — TAKIM TEMASI] Kayıtta seçilen "tuttuğun takım" (ücretsiz,
// bilgi amaçlı). Şimdilik SADECE Trendyol Süper Lig 2026-27 takımları (Amedspor hariç tutuldu).
// `id` listesi server/src/shared/teams.js ile AYNI kalmalı. Ücretli ürün isimleri (`kit`) kulüp
// adı taşımaz — sadece renk/desen adı.
//   colors: [ana, ikincil] · pattern: stripes | halves | hoops | sleeves | sash | solid
//   accent/ink: koyu zeminde okunur vurgu + vurgu üstündeki metin · card: lisans kartı zemini
export const TEAMS = [
  {
    "id": "besiktas",
    "name": "Beşiktaş",
    "short": "BJK",
    "colors": [
      "#111111",
      "#ffffff"
    ],
    "pattern": "stripes",
    "accent": "#ffffff",
    "ink": "#0a0a0a",
    "card": "#0a0a0a",
    "theme": "Siyah-Beyaz",
    "kit": "Siyah-Beyaz Çubuklu"
  },
  {
    "id": "galatasaray",
    "name": "Galatasaray",
    "short": "GS",
    "colors": [
      "#fdb912",
      "#a90d1c"
    ],
    "pattern": "halves",
    "accent": "#fdb912",
    "ink": "#3a0508",
    "card": "#5e0d16",
    "theme": "Sarı-Kırmızı",
    "kit": "Sarı-Kırmızı Yarım"
  },
  {
    "id": "fenerbahce",
    "name": "Fenerbahçe",
    "short": "FB",
    "colors": [
      "#ffed00",
      "#0b1a3d"
    ],
    "pattern": "stripes",
    "accent": "#ffed00",
    "ink": "#0b1a3d",
    "card": "#0b1a3d",
    "theme": "Sarı-Lacivert",
    "kit": "Sarı-Lacivert Çubuklu"
  },
  {
    "id": "trabzonspor",
    "name": "Trabzonspor",
    "short": "TS",
    "colors": [
      "#6e1a33",
      "#6cabdd"
    ],
    "pattern": "sleeves",
    "accent": "#6cabdd",
    "ink": "#2e0b17",
    "card": "#5a1a2e",
    "theme": "Bordo-Mavi",
    "kit": "Bordo-Mavi Kollu"
  },
  {
    "id": "basaksehir",
    "name": "Başakşehir",
    "short": "İBFK",
    "colors": [
      "#f26a21",
      "#1b2a4a"
    ],
    "pattern": "solid",
    "accent": "#f26a21",
    "ink": "#1b0a00",
    "card": "#1b2a4a",
    "theme": "Turuncu-Lacivert",
    "kit": "Turuncu-Lacivert Düz"
  },
  {
    "id": "kasimpasa",
    "name": "Kasımpaşa",
    "short": "KSP",
    "colors": [
      "#1c3f94",
      "#ffffff"
    ],
    "pattern": "solid",
    "accent": "#8fb0ff",
    "ink": "#0a1633",
    "card": "#0f1f4d",
    "theme": "Lacivert-Beyaz",
    "kit": "Lacivert-Beyaz Düz"
  },
  {
    "id": "eyupspor",
    "name": "Eyüpspor",
    "short": "EYP",
    "colors": [
      "#5b2a86",
      "#f5d000"
    ],
    "pattern": "stripes",
    "accent": "#f5d000",
    "ink": "#2a1040",
    "card": "#2e1447",
    "theme": "Mor-Sarı",
    "kit": "Mor-Sarı Çubuklu"
  },
  {
    "id": "goztepe",
    "name": "Göztepe",
    "short": "GÖZ",
    "colors": [
      "#ffd400",
      "#d11f26"
    ],
    "pattern": "stripes",
    "accent": "#ffd400",
    "ink": "#3a0508",
    "card": "#5c0a10",
    "theme": "Sarı-Kırmızı",
    "kit": "Sarı-Kırmızı Çubuklu"
  },
  {
    "id": "samsunspor",
    "name": "Samsunspor",
    "short": "SAM",
    "colors": [
      "#d2232a",
      "#ffffff"
    ],
    "pattern": "solid",
    "accent": "#ff6a6f",
    "ink": "#2a0000",
    "card": "#5a0c10",
    "theme": "Kırmızı-Beyaz",
    "kit": "Kırmızı-Beyaz Düz"
  },
  {
    "id": "rizespor",
    "name": "Çaykur Rizespor",
    "short": "RİZ",
    "colors": [
      "#00843d",
      "#0072bc"
    ],
    "pattern": "stripes",
    "accent": "#3ccf82",
    "ink": "#00210f",
    "card": "#003d20",
    "theme": "Yeşil-Mavi",
    "kit": "Yeşil-Mavi Çubuklu"
  },
  {
    "id": "konyaspor",
    "name": "Konyaspor",
    "short": "KON",
    "colors": [
      "#00893f",
      "#ffffff"
    ],
    "pattern": "hoops",
    "accent": "#3ddc84",
    "ink": "#002611",
    "card": "#00361a",
    "theme": "Yeşil-Beyaz",
    "kit": "Yeşil-Beyaz Yatay"
  },
  {
    "id": "kocaelispor",
    "name": "Kocaelispor",
    "short": "KOC",
    "colors": [
      "#0a8a3a",
      "#111111"
    ],
    "pattern": "stripes",
    "accent": "#2fd06b",
    "ink": "#001a0a",
    "card": "#06200f",
    "theme": "Yeşil-Siyah",
    "kit": "Yeşil-Siyah Çubuklu"
  },
  {
    "id": "genclerbirligi",
    "name": "Gençlerbirliği",
    "short": "GB",
    "colors": [
      "#c8102e",
      "#111111"
    ],
    "pattern": "halves",
    "accent": "#ff5566",
    "ink": "#1a0004",
    "card": "#3a0710",
    "theme": "Kırmızı-Siyah",
    "kit": "Kırmızı-Siyah Yarım"
  },
  {
    "id": "gaziantep",
    "name": "Gaziantep FK",
    "short": "GFK",
    "colors": [
      "#d71920",
      "#111111"
    ],
    "pattern": "stripes",
    "accent": "#ff5a4f",
    "ink": "#1a0000",
    "card": "#3a0808",
    "theme": "Kırmızı-Siyah",
    "kit": "Kırmızı-Siyah Çubuklu"
  },
  {
    "id": "alanyaspor",
    "name": "Alanyaspor",
    "short": "ALA",
    "colors": [
      "#f58220",
      "#00853e"
    ],
    "pattern": "halves",
    "accent": "#f58220",
    "ink": "#1f0d00",
    "card": "#3a1c05",
    "theme": "Turuncu-Yeşil",
    "kit": "Turuncu-Yeşil Yarım"
  },
  {
    "id": "erzurumspor",
    "name": "Erzurumspor",
    "short": "ERZ",
    "colors": [
      "#0a4ea2",
      "#ffffff"
    ],
    "pattern": "sash",
    "accent": "#6aa8ff",
    "ink": "#001533",
    "card": "#0a2550",
    "theme": "Mavi-Beyaz",
    "kit": "Mavi-Beyaz Kuşaklı"
  },
  {
    "id": "corum",
    "name": "Çorum FK",
    "short": "ÇOR",
    "colors": [
      "#c8102e",
      "#111111"
    ],
    "pattern": "hoops",
    "accent": "#ff5566",
    "ink": "#1a0004",
    "card": "#2a0a0e",
    "theme": "Kırmızı-Siyah",
    "kit": "Kırmızı-Siyah Yatay"
  }
];

const BY_ID = new Map(TEAMS.map((t) => [t.id, t]));
export function teamById(id) { return (id && BY_ID.get(id)) || null; }

// Forma deseninin CSS arka planı. `w` = çubuk/şerit genişliği (px) — küçük saha noktası için 2,
// lisans kartı için ~18.
export function kitBackground(t, w = 3) {
  const [a, b] = t.colors;
  switch (t.pattern) {
    case 'stripes': { const s = t.wide ? w * 2 : w; return `repeating-linear-gradient(90deg, ${a} 0 ${s}px, ${b} ${s}px ${s * 2}px)`; }
    case 'hoops': { const s = t.wide ? w * 2 : w; return `repeating-linear-gradient(0deg, ${a} 0 ${s}px, ${b} ${s}px ${s * 2}px)`; }
    case 'pinstripes': { const line = Math.max(1, w / 3); return `repeating-linear-gradient(90deg, ${a} 0 ${w * 2}px, ${b} ${w * 2}px ${w * 2 + line}px)`; }
    case 'halves': return `linear-gradient(90deg, ${a} 50%, ${b} 50%)`;
    case 'sleeves': return `linear-gradient(90deg, ${b} 0 24%, ${a} 24% 76%, ${b} 76%)`;
    case 'sash': return `linear-gradient(135deg, ${a} 0 38%, ${b} 38% 62%, ${a} 62%)`;
    // [MAĞAZA v3] yeni desenler — hepsi `background:` kısayoluyla kullanılır (boyut/tekrar içerir).
    case 'quarters': return `conic-gradient(${a} 0 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0)`;
    case 'checker': return `repeating-conic-gradient(${a} 0 25%, ${b} 0 50%) 0 0 / ${w * 2}px ${w * 2}px`;
    case 'band': return `linear-gradient(180deg, ${a} 0 32%, ${b} 32% 50%, ${a} 50%)`;
    case 'chevron': return `linear-gradient(to top right, ${a} 0 42%, ${b} 42% 58%, ${a} 58%) 0 0 / 50.5% 100% no-repeat, linear-gradient(to top left, ${a} 0 42%, ${b} 42% 58%, ${a} 58%) 100% 0 / 50.5% 100% no-repeat, ${a}`;
    case 'fade': return `linear-gradient(180deg, ${a} 10%, ${b} 100%)`;
    case 'zigzag': { const s = w * 2; return `linear-gradient(135deg, ${b} 25%, transparent 25%) -${w}px 0 / ${s}px ${s}px, linear-gradient(225deg, ${b} 25%, transparent 25%) -${w}px 0 / ${s}px ${s}px, linear-gradient(315deg, ${b} 25%, transparent 25%) 0 0 / ${s}px ${s}px, linear-gradient(45deg, ${b} 25%, ${a} 25%) 0 0 / ${s}px ${s}px`; }
    // [MAĞAZA v3] Bağcıklı yaka retro: gövde a, kollar + yaka b, ortada bağcıklı yaka açıklığı.
    // Koordinatlar .kit-shirt clip-path'ine göre (yaka x 38-62%, kollar <28% ve >72%).
    case 'laceup': return [
      `repeating-linear-gradient(0deg, ${b} 0 1px, ${a} 1px 3px) 50% 10% / 6% 15% no-repeat`,
      `linear-gradient(${b}, ${b}) 50% 0 / 28% 15% no-repeat`,
      `linear-gradient(90deg, ${b} 0 28%, ${a} 28% 72%, ${b} 72%)`,
    ].join(', ');
    default: return a;
  }
}

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — FORMA ÇEŞİTLERİ] Her takım için aynı 6 varyant, takımın
// renklerinden türetilir (id'ler server/src/shared/teams.js KIT_IDS ile AYNI). `tier: 'premium'`
// olanlar ileride ücretli olacak — şimdilik herkes seçebiliyor (kilit mantığı yok).
// [MAĞAZA v3] `series` mağazadaki gruplamadır (bkz. views.js KIT_SERIES).
export const KIT_VARIANTS = [
  { id: 'home', label: 'İç Saha', tier: 'free' },
  { id: 'away', label: 'Deplasman', tier: 'free' },
  { id: 'plain', label: 'Düz', tier: 'premium', series: 'classic' },
  { id: 'band', label: 'Göğüs Bantlı', tier: 'premium', series: 'classic' },
  { id: 'fade', label: 'Degrade', tier: 'premium', series: 'classic' },
  { id: 'sash', label: 'Kuşaklı Özel', tier: 'premium', series: 'classic' },
  { id: 'quarters', label: 'Çeyrek Bölmeli', tier: 'premium', series: 'pattern' },
  { id: 'checker', label: 'Damalı', tier: 'premium', series: 'pattern' },
  { id: 'chevron', label: 'V Bantlı', tier: 'premium', series: 'pattern' },
  { id: 'retro', label: 'Retro Çizgili', tier: 'premium', series: 'retro' },
  { id: 'retro70', label: "Retro 70'ler Kollu", tier: 'premium', series: 'retro' },
  { id: 'retro90', label: "Retro 90'lar Zikzak", tier: 'premium', series: 'retro' },
  { id: 'vintage', label: 'Vintage Krem', tier: 'premium', series: 'retro' },
  { id: 'laceup', label: 'Bağcıklı Yaka Retro', tier: 'premium', series: 'retro' },
  { id: 'night', label: 'Gece Serisi', tier: 'premium', series: 'special' },
  { id: 'gold', label: 'Altın Seri', tier: 'premium', series: 'special' },
];
const KIT_BY_ID = new Map(KIT_VARIANTS.map((v) => [v.id, v]));

// Ürün adı kulüp adı taşımaz: "Siyah-Beyaz Retro Çizgili" gibi.
export function kitFor(team, kitId) {
  if (!team) return null;
  const v = KIT_BY_ID.get(kitId) || KIT_VARIANTS[0];
  const [a, b] = team.colors;
  const base = { id: v.id, team: team.id, accent: team.accent, ink: team.ink, tier: v.tier, name: `${team.theme} ${v.label}` };
  switch (v.id) {
    case 'away': return { ...base, pattern: 'solid', colors: [b, a] };
    case 'plain': return { ...base, pattern: 'solid', colors: [a, b] };
    case 'retro': return { ...base, pattern: team.pattern === 'hoops' ? 'stripes' : 'hoops', colors: [a, b], wide: true };
    case 'sash': return { ...base, pattern: 'sash', colors: team.pattern === 'sash' ? [b, a] : [a, b] };
    case 'night': return { ...base, pattern: 'pinstripes', colors: ['#0b0d12', team.accent] };
    case 'band': return { ...base, pattern: 'band', colors: [a, b] };
    case 'fade': return { ...base, pattern: 'fade', colors: [a, b] };
    case 'quarters': return { ...base, pattern: 'quarters', colors: [a, b] };
    case 'checker': return { ...base, pattern: 'checker', colors: [a, b] };
    case 'chevron': return { ...base, pattern: 'chevron', colors: [a, b] };
    case 'retro70': return { ...base, pattern: 'sleeves', colors: team.pattern === 'sleeves' ? [b, a] : [a, b] };
    case 'retro90': return { ...base, pattern: 'zigzag', colors: [a, b] };
    case 'vintage': return { ...base, pattern: 'hoops', colors: ['#efe4c8', a] };
    case 'laceup': return { ...base, pattern: 'laceup', colors: [a, b] };
    case 'gold': return { ...base, pattern: 'band', colors: ['#141210', '#d4af37'] };
    default: return { ...base, pattern: team.pattern, colors: [a, b] };
  }
}

// Renk çakışması: iki formanın ana renkleri sahada ayırt edilemeyecek kadar yakınsa (desen farklı
// olsa bile — ör. Göztepe çubuklu / Galatasaray yarım, ya da herhangi bir "Gece Serisi" / Beşiktaş
// iç saha) deplasman takımı sırayla deplasman / iç saha / gece formasına geçer (ilk çakışmayan);
// hiçbiri olmazsa nötr beyaz formaya düşer.
const KIT_CLASH_DISTANCE = 90;
function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorDistance(a, b) {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}
const clashes = (x, y) => colorDistance(x.colors[0], y.colors[0]) < KIT_CLASH_DISTANCE;

export function resolveClash(home, away, awayTeam) {
  if (!home || !away || !awayTeam) return away;
  if (!clashes(home, away)) return away;
  for (const id of ['away', 'home', 'night']) {
    const k = kitFor(awayTeam, id);
    if (!clashes(home, k)) return k;
  }
  return { ...away, pattern: 'solid', colors: ['#f2f2f2', home.colors[0]] };
}

// Uygulama geneli vurgu rengi (--accent ailesi). Takım yoksa varsayılan turuncuya döner.
const ACCENT_VARS = ['--accent', '--accent-strong', '--gold', '--gold-strong', '--accent-soft', '--gold-soft', '--accent-glow', '--gold-glow', '--accent-ink'];
let appliedTheme;
export function applyTeamTheme(id) {
  const t = teamById(id);
  const key = t ? t.id : '';
  if (key === appliedTheme) return;
  appliedTheme = key;
  const root = document.documentElement;
  if (!t) { ACCENT_VARS.forEach((v) => root.style.removeProperty(v)); delete root.dataset.team; return; }
  root.dataset.team = t.id;
  const soft = `color-mix(in srgb, ${t.accent} 15%, transparent)`;
  const glow = `color-mix(in srgb, ${t.accent} 45%, transparent)`;
  const strong = `color-mix(in srgb, ${t.accent} 85%, #000)`;
  root.style.setProperty('--accent', t.accent); root.style.setProperty('--gold', t.accent);
  root.style.setProperty('--accent-strong', strong); root.style.setProperty('--gold-strong', strong);
  root.style.setProperty('--accent-soft', soft); root.style.setProperty('--gold-soft', soft);
  root.style.setProperty('--accent-glow', glow); root.style.setProperty('--gold-glow', glow);
  root.style.setProperty('--accent-ink', t.ink);
}

// Lisans kartı için CSS değişkenleri (inline style).
export function teamCardVars(t) {
  return `--t-bg:${t.card};--t-accent:${t.accent};--t-ink:${t.ink};--t-kit:${kitBackground({ ...t, colors: [t.accent, 'transparent'] }, 18)}`;
}
