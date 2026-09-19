// [KULLANICI İSTEĞİ] "Ses/haptik: teklif, son 3 saniye, gol — oyunun temposunu artırır."
// Hiç ses DOSYASI yok (indirme/telif/gecikme yükü olmasın): tüm efektler WebAudio ile anlık
// üretiliyor (kısa zarf + 1-2 osilatör). Mobilde titreşim (navigator.vibrate) eşlik ediyor.
//
// Kurallar:
//  · AudioContext KULLANICI etkileşiminden önce açılmaz (tarayıcı autoplay politikası) —
//    ilk play() çağrısında (bir tık/tuş sonrası) kurulur, ondan sonra tekrar kullanılır.
//  · Tercih localStorage'da ('kk_sfx') tutulur; kapalıysa hiçbir şey çalmaz ve titreşmez.
//  · play() ASLA throw etmez — ses desteklenmeyen/engellenen ortamda oyun sessizce devam eder.
const LS_KEY = 'kk_sfx';
let ctx = null;
let enabled = (() => {
  try { return localStorage.getItem(LS_KEY) !== 'off'; } catch (e) { return true; }
})();

function ac() {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch (e) { return null; }
}

// Tek bir "bip": frekans rampası + kısa exponential zarf. type: 'sine'|'square'|'triangle'|'sawtooth'
function tone({ freq = 440, to = null, dur = 0.12, type = 'sine', gain = 0.16, delay = 0 }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function buzz(ms) {
  if (!enabled) return;
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* desteklenmiyor */ }
}

// Oyun olaylarının ses kimliği — hepsi kısa, üst üste binse bile karışmayacak aralıklarda.
const SOUNDS = {
  bid: () => { tone({ freq: 620, to: 880, dur: 0.1, type: 'triangle', gain: 0.14 }); buzz(12); },
  outbid: () => { tone({ freq: 380, to: 240, dur: 0.18, type: 'sawtooth', gain: 0.13 }); buzz([18, 40, 18]); },
  tick: () => { tone({ freq: 1180, dur: 0.05, type: 'square', gain: 0.07 }); },
  tickLast: () => { tone({ freq: 1480, dur: 0.07, type: 'square', gain: 0.12 }); buzz(14); },
  win: () => {
    tone({ freq: 523, dur: 0.12, type: 'triangle', gain: 0.16 });
    tone({ freq: 784, dur: 0.16, type: 'triangle', gain: 0.16, delay: 0.1 });
    tone({ freq: 1046, dur: 0.22, type: 'triangle', gain: 0.14, delay: 0.22 });
    buzz([20, 50, 30]);
  },
  sold: () => { tone({ freq: 300, to: 190, dur: 0.16, type: 'sine', gain: 0.1 }); },
  goal: () => {
    tone({ freq: 392, dur: 0.16, type: 'sawtooth', gain: 0.15 });
    tone({ freq: 587, dur: 0.2, type: 'sawtooth', gain: 0.15, delay: 0.12 });
    tone({ freq: 784, dur: 0.34, type: 'triangle', gain: 0.17, delay: 0.26 });
    buzz([30, 60, 90]);
  },
  save: () => { tone({ freq: 520, to: 700, dur: 0.1, type: 'sine', gain: 0.1 }); },
  card: () => { tone({ freq: 220, dur: 0.22, type: 'square', gain: 0.1 }); buzz(60); },
  start: () => {
    tone({ freq: 440, dur: 0.14, type: 'triangle', gain: 0.14 });
    tone({ freq: 660, dur: 0.22, type: 'triangle', gain: 0.14, delay: 0.14 });
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
    if (enabled) this.play('tick');
  },
  toggle() { this.setEnabled(!enabled); return enabled; },
};
