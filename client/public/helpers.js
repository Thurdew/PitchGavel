// Küçük yardımcılar: toast, DOM oluşturma kısayolları, oyuncu kartı/çip render'ı.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// [KULLANICI İSTEĞİ] Toast v3: ikon kutusu + mesaj + kalan süre çizgisi; tıklayınca kapanır.
// kind: 'success' | 'danger' | '' (bilgi). Verilmezse mesajdan tahmin edilir (hata/ret kelimeleri).
const TOAST_MS = 4200;
const TOAST_ICONS = {
  info: '<path d="M12 16v-4"/><path d="M12 8h.01"/><circle cx="12" cy="12" r="9"/>',
  success: '<path d="M20 6 9 17l-5-5"/>',
  danger: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
};
export function toast(msg, kind = '') {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const k = kind || (/hata|reddedildi|başarısız|yok|kullandın|dolu|geçersiz/i.test(String(msg)) ? 'danger' : /kopyalandı|kaydedildi|gönderildi|kazandın|tamam/i.test(String(msg)) ? 'success' : 'info');
  const node = el('div', { class: `toast v3 ${k}`, role: 'status' }, [
    el('span', { class: 'toast-ico', html: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${TOAST_ICONS[k] || TOAST_ICONS.info}</svg>` }),
    el('span', { class: 'toast-msg' }, msg),
    el('span', { class: 'toast-life', style: `animation-duration:${TOAST_MS}ms` }),
  ]);
  const close = () => { node.classList.add('out'); setTimeout(() => node.remove(), 200); };
  node.addEventListener('click', close);
  host.appendChild(node);
  setTimeout(close, TOAST_MS);
}

const GROUP_BY_SLOT = {
  GK: 'GK',
  CB: 'DF', LB: 'DF', RB: 'DF',
  DM: 'MF', CM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF',
  LW: 'FW', RW: 'FW', ST: 'FW',
};
export function slotGroup(slot) { return GROUP_BY_SLOT[slot] || 'MF'; }

export function playerCard(player, { slot, extraClass = '', tag = '' } = {}) {
  const group = slotGroup(slot || player.position);
  // [KULLANICI İSTEĞİ] "Icon (efsane) oyuncu kartları normal karttan çok az ayrışıyor — 38
  // kişilik özel bir kategori olduğu için kartın kendisine foil/özel çerçeve eklensin."
  // Rozet kaldı, ama ayrım artık kartın TAMAMINDA: mor-altın foil kenar, taranan parıltı,
  // koyu mor zemin (bkz. styles.css .player-card.icon).
  return el('div', { class: `player-card ${player.isIcon ? 'icon' : ''} ${extraClass}` }, [
    el('div', { class: `pos-badge pos-${group}` }, slot || player.position),
    el('div', { class: 'rating' }, String(player.rating)),
    player.isIcon ? el('div', { class: 'icon-flag' }, '⭐ ICON') : null,
    el('div', { class: 'name' }, player.name),
    el('div', { class: 'club' }, player.isIcon ? `Icon · ${player.nation}` : `${player.club} · ${player.league}`),
    tag ? el('div', { class: 'tag' }, tag) : null,
  ]);
}

export function squadChip(entry) {
  const group = slotGroup(entry.slot);
  return el('div', { class: `squad-chip ${entry.player.isIcon ? 'icon' : ''}` }, [
    el('div', { class: `badge pos-${group}` }, entry.slot),
    el('div', { class: 'info' }, [
      el('div', { class: 'n' }, entry.player.name + (entry.player.isIcon ? ' ⭐' : '')),
      el('div', { class: 'r' }, `${entry.player.rating} reyting · ${entry.price}₺`),
    ]),
  ]);
}

export function fmtMoney(n) { return `${n}₺`; }

// [design.md "Hareket"] "Teklif miktarları anlık belirmesin, gerçek bir arttırma gibi sayarak
// yükselsin" — bir <b>/<span> içindeki para rakamını `from`'dan `to`'ya doğru sayarak
// animasyonlu günceller (requestAnimationFrame). Azaltılmış hareket tercih edilmişse (ya da
// fark yoksa) direkt hedef değere atlar, ayrı bir kod yolu gerekmez.
export function countUpMoney(node, from, to, duration = 420) {
  if (node.__countUpRaf) cancelAnimationFrame(node.__countUpRaf);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (from == null || reduceMotion || from === to) {
    node.textContent = fmtMoney(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic
    const value = Math.round(from + (to - from) * eased);
    node.textContent = fmtMoney(value);
    if (t < 1) node.__countUpRaf = requestAnimationFrame(step);
  };
  node.__countUpRaf = requestAnimationFrame(step);
}

// [KULLANICI İSTEĞİ] Tarayıcının gri confirm() kutusu yerine oyunun kendi onay penceresi.
// Promise<boolean> döner: onay → true; vazgeç, Esc ya da arka plana tıklama → false.
export function confirmDialog({ title, body, confirmLabel = 'Onayla', cancelLabel = 'Vazgeç', danger = false }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const done = (v) => {
      overlay.classList.add('out');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => overlay.remove(), 160);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    const cancelBtn = el('button', { type: 'button', class: 'btn secondary', onclick: () => done(false) }, cancelLabel);
    const okBtn = el('button', { type: 'button', class: `btn ${danger ? 'danger' : ''}`, onclick: () => done(true) }, confirmLabel);
    const card = el('div', { class: `cd-card ${danger ? 'danger' : ''}`, role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'cdTitle', onclick: (e) => e.stopPropagation() }, [
      el('span', { class: 'cd-ico', html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' }),
      el('h3', { id: 'cdTitle', class: 'cd-title' }, title),
      body ? el('p', { class: 'cd-body' }, body) : null,
      el('div', { class: 'cd-actions' }, [cancelBtn, okBtn]),
    ]);
    const overlay = el('div', { class: 'cd-overlay', onclick: () => done(false) }, card);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    cancelBtn.focus();
  });
}
