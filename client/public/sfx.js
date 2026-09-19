// [KULLANICI İSTEĞİ] "Ses efektleri daha iyi olabilir: gol olunca goool sesi, direkten dönünce
// direkten dönme sesi, maç bitince düdük sesi falan."
//
// v2 ses motoru. Hâlâ HİÇ ses dosyası yok (telif/indirme/gecikme yükü olmasın) — her efekt
// WebAudio ile anlık sentezleniyor. v1'de her şey tek bir osilatör bipiydi; artık üç yapı taşı var:
//   · tone()  — osilatör + zarf (melodik: düdük, ıslık, korna, bip)
//   · noise() — beyaz gürültü + filtre (kalabalık uğultusu, tribün, şut/vuruş)
//   · hit()   — kısa rezonanslı çarpma (DİREK — bant geçiren filtre yüksek Q ile "tak" sesi)
// Her efekt bunların zamanlanmış bir bileşimi; kulakta ayırt edilebilir kimlikler:
//   goal        → kalabalık patlaması + ağ + yükselen korna (en uzun, en dolgun ses)
//   post        → tahta/direk çarpması ("tak") + hayal kırıklığı iç çekişi (kalabalık düşüşü)
//   save        → eldiven tokatı + kısa kalabalık "oh"
//   miss        → auta giden şutun sönük ıslığı
//   whistleKick → maç başlangıcı: tek kısa düdük
//   whistleEnd  → maç sonu: üç kademeli uzun düdük (klasik bitiş düdüğü)
//   yellow/red  → kart: red daha alçak ve uzun, tribün homurtusu eşlik eder
//
// Kurallar (v1'den korundu):
//  · AudioContext KULLANICI etkileşiminden önce açılmaz (autoplay politikası).
//  · Tercih localStorage'da ('kk_sfx'); kapalıysa hiçbir şey çalmaz, titreşim de olmaz.
//  · play() ASLA throw etmez — ses desteklenmeyen ortamda oyun sessizce devam eder.
//  · Tüm efektler master gain üzerinden çıkar; UI sesleri (click) kısık, maç sesleri dolgun.
const LS_KEY = 'kk_sfx';
let ctx = null;
let master = null;
let noiseBuffer = null;
let enabled = (() => {
  try { return localStorage.getItem(LS_KEY) !== 'off'; } catch (e) { return true; }
})();

function ac() {
  if (!enabled) return null;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (e) { return null; }
}

// 2 saniyelik beyaz gürültü bir kez üretilip tekrar kullanılıyor (her efektte yeniden
// doldurmak mobilde gözle görülür bir donmaya yol açıyordu).
function getNoise(c) {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(c.sampleRate * 2);
  noiseBuffer = c.createBuffer(1, len, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function env(c, node, t0, dur, peak, attack = 0.012) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g);
  return g;
}

// Melodik ton. vibrato: düdük/ıslık için hafif frekans titremesi.
function tone({ freq = 440, to = null, dur = 0.12, type = 'sine', gain = 0.16, delay = 0, vibrato = 0, detune = 0 }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  if (vibrato) {
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 26; // düdük içindeki bilyenin titremesi
    lfoGain.gain.value = vibrato;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(t0); lfo.stop(t0 + dur + 0.02);
  }
  env(c, osc, t0, dur, gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Filtrelenmiş gürültü. filter: 'lowpass'|'bandpass'|'highpass'
function noise({ dur = 0.3, gain = 0.12, delay = 0, filter = 'bandpass', freq = 1200, to = null, q = 1 }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  src.loop = true;
  const bq = c.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(freq, t0);
  if (to) bq.frequency.exponentialRampToValueAtTime(Math.max(60, to), t0 + dur);
  src.connect(bq);
  env(c, bq, t0, dur, gain, 0.02).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// Kısa, rezonanslı çarpma — direk/kaleci eldiveni/vuruş. Yüksek Q = tahta "tak" karakteri.
function hit({ freq = 320, dur = 0.22, gain = 0.3, delay = 0, q = 14, drop = 0.55 }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  const bq = c.createBiquadFilter();
  bq.type = 'bandpass';
  bq.Q.value = q;
  bq.frequency.setValueAtTime(freq, t0);
  bq.frequency.exponentialRampToValueAtTime(Math.max(50, freq * drop), t0 + dur);
  src.connect(bq);
  env(c, bq, t0, dur, gain, 0.004).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// Tribün uğultusu: alçak, geniş bantlı gürültünün yavaş yükselip düşmesi.
function crowd({ dur = 1.1, gain = 0.16, delay = 0, up = true }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  src.loop = true;
  const bq = c.createBiquadFilter();
  bq.type = 'lowpass';
  bq.Q.value = 0.7;
  bq.frequency.setValueAtTime(up ? 400 : 1400, t0);
  bq.frequency.linearRampToValueAtTime(up ? 1800 : 380, t0 + dur * 0.7);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  // Patlama: hızlı yüksel, yavaş sön. İç çekiş (up:false): yavaş yüksel, hızlı sön.
  g.gain.exponentialRampToValueAtTime(gain, t0 + (up ? 0.09 : dur * 0.45));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bq).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function buzz(ms) {
  if (!enabled) return;
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* desteklenmiyor */ }
}

// Hakem düdüğü — iki hafif detune edilmiş kare dalga + vibrato + üstünde hava gürültüsü.
function whistle({ delay = 0, dur = 0.3, gain = 0.15 }) {
  tone({ freq: 2100, dur, type: 'square', gain, delay, vibrato: 90 });
  tone({ freq: 2760, dur, type: 'square', gain: gain * 0.55, delay, vibrato: 70, detune: 12 });
  noise({ dur: dur * 0.9, gain: gain * 0.28, delay, filter: 'highpass', freq: 2600 });
}

const SOUNDS = {
  // ---------------- maç ----------------
  // [KULLANICI İSTEĞİ] "Gol olunca goool sesi" — kalabalık patlaması + ağın hışırtısı +
  // yükselen üç nota korna. Oyunun en uzun ve en yüksek sesi; gol anını kaçırmak imkânsız.
  goal: () => {
    hit({ freq: 180, dur: 0.1, gain: 0.26, q: 3 });                       // topun vuruşu
    noise({ dur: 0.26, gain: 0.1, delay: 0.04, filter: 'highpass', freq: 3200 }); // ağ
    crowd({ dur: 1.5, gain: 0.2, delay: 0.03, up: true });                // tribün
    tone({ freq: 392, dur: 0.18, type: 'sawtooth', gain: 0.13, delay: 0.1 });
    tone({ freq: 587, dur: 0.2, type: 'sawtooth', gain: 0.13, delay: 0.24 });
    tone({ freq: 784, dur: 0.42, type: 'triangle', gain: 0.16, delay: 0.4 });
    tone({ freq: 1175, dur: 0.5, type: 'triangle', gain: 0.1, delay: 0.52 });
    buzz([40, 50, 120]);
  },
  // [KULLANICI İSTEĞİ] "Direkten dönünce direkten dönme sesi" — yüksek Q'lu bant geçiren
  // gürültü tahta/alüminyum "TAK"ı verir; ardından tribünün hayal kırıklığı iç çekişi.
  post: () => {
    hit({ freq: 620, dur: 0.3, gain: 0.34, q: 22, drop: 0.35 });
    hit({ freq: 1560, dur: 0.16, gain: 0.16, q: 26, drop: 0.5, delay: 0.005 });
    crowd({ dur: 0.9, gain: 0.13, delay: 0.1, up: false });
    buzz([25, 30, 25]);
  },
  save: () => {
    hit({ freq: 240, dur: 0.14, gain: 0.24, q: 4 });   // eldiven tokatı
    noise({ dur: 0.18, gain: 0.08, delay: 0.02, filter: 'bandpass', freq: 900, q: 1.2 });
    crowd({ dur: 0.7, gain: 0.1, delay: 0.06, up: false });
    buzz(25);
  },
  miss: () => {
    noise({ dur: 0.34, gain: 0.09, filter: 'bandpass', freq: 1600, to: 420, q: 2 });
    crowd({ dur: 0.6, gain: 0.08, delay: 0.05, up: false });
  },
  shot: () => { hit({ freq: 150, dur: 0.09, gain: 0.2, q: 2.5 }); },
  // [KULLANICI İSTEĞİ] "Maç bitince düdük sesi" — klasik üç kademeli uzun bitiş düdüğü.
  whistleEnd: () => {
    whistle({ dur: 0.22, gain: 0.16 });
    whistle({ dur: 0.22, gain: 0.16, delay: 0.3 });
    whistle({ dur: 0.72, gain: 0.17, delay: 0.6 });
    crowd({ dur: 1.4, gain: 0.12, delay: 0.7, up: true });
    buzz([60, 60, 60, 60, 160]);
  },
  whistleKick: () => { whistle({ dur: 0.26, gain: 0.15 }); crowd({ dur: 0.9, gain: 0.1, delay: 0.1, up: true }); buzz(40); },
  yellow: () => {
    whistle({ dur: 0.16, gain: 0.12 });
    tone({ freq: 300, dur: 0.2, type: 'square', gain: 0.09, delay: 0.14 });
    buzz(50);
  },
  red: () => {
    whistle({ dur: 0.2, gain: 0.14 });
    tone({ freq: 190, to: 120, dur: 0.5, type: 'square', gain: 0.12, delay: 0.16 });
    crowd({ dur: 1.1, gain: 0.14, delay: 0.2, up: true }); // tribün homurtusu
    buzz([70, 50, 120]);
  },
  card: () => SOUNDS.yellow(), // geriye uyumluluk (eski sfx.play('card') çağrıları)

  // ---------------- draft / takas ----------------
  bid: () => { tone({ freq: 620, to: 880, dur: 0.1, type: 'triangle', gain: 0.13 }); buzz(12); },
  outbid: () => { tone({ freq: 380, to: 240, dur: 0.18, type: 'sawtooth', gain: 0.12 }); buzz([18, 40, 18]); },
  tick: () => { tone({ freq: 1180, dur: 0.05, type: 'square', gain: 0.07 }); },
  tickLast: () => { tone({ freq: 1480, dur: 0.07, type: 'square', gain: 0.12 }); buzz(14); },
  // Tur kapanışı: tokmak (açık arttırma) — kısa, sert, alçak bir vuruş.
  gavel: () => { hit({ freq: 420, dur: 0.16, gain: 0.3, q: 7, drop: 0.3 }); hit({ freq: 160, dur: 0.24, gain: 0.2, q: 3, delay: 0.02 }); buzz(35); },
  win: () => {
    tone({ freq: 523, dur: 0.12, type: 'triangle', gain: 0.15 });
    tone({ freq: 784, dur: 0.16, type: 'triangle', gain: 0.15, delay: 0.1 });
    tone({ freq: 1046, dur: 0.26, type: 'triangle', gain: 0.14, delay: 0.22 });
    buzz([20, 50, 30]);
  },
  sold: () => { hit({ freq: 400, dur: 0.14, gain: 0.22, q: 6, drop: 0.35 }); },
  trade: () => {
    tone({ freq: 660, dur: 0.1, type: 'triangle', gain: 0.12 });
    tone({ freq: 880, dur: 0.14, type: 'triangle', gain: 0.12, delay: 0.09 });
    buzz([20, 30, 20]);
  },
  wheel: () => { noise({ dur: 0.9, gain: 0.07, filter: 'bandpass', freq: 1800, to: 500, q: 3 }); },

  // ---------------- arayüz ----------------
  // [KULLANICI İSTEĞİ] "Butonları dahil hallet" — her butona kısık, nötr bir dokunma sesi
  // (app.js'te global delegasyonla bağlanıyor; kendi sesi olan butonlar hariç).
  click: () => { tone({ freq: 880, dur: 0.035, type: 'triangle', gain: 0.05 }); },
  toggle: () => { tone({ freq: 520, to: 760, dur: 0.06, type: 'triangle', gain: 0.07 }); },
  start: () => {
    tone({ freq: 440, dur: 0.14, type: 'triangle', gain: 0.13 });
    tone({ freq: 660, dur: 0.22, type: 'triangle', gain: 0.13, delay: 0.14 });
  },
  error: () => { tone({ freq: 200, to: 140, dur: 0.2, type: 'square', gain: 0.12 }); buzz([30, 30, 30]); },
  offline: () => { tone({ freq: 300, to: 150, dur: 0.3, type: 'sine', gain: 0.12 }); },
  online: () => { tone({ freq: 500, to: 880, dur: 0.2, type: 'sine', gain: 0.12 }); },
};

export const sfx = {
  play(kind) {
    if (!enabled) return;
    const fn = SOUNDS[kind];
    if (!fn) return;
    try { fn(); } catch (e) { /* ses yok — oyun devam */ }
  },
  isEnabled() { return enabled; },
  setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(LS_KEY, enabled ? 'on' : 'off'); } catch (e) { /* yok say */ }
    if (enabled) this.play('toggle');
  },
  toggle() { this.setEnabled(!enabled); return enabled; },
};
