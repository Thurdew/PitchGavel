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

export function toast(msg, kind = '') {
  const host = document.getElementById('toastHost');
  const node = el('div', { class: 'toast' }, msg);
  host.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

const GROUP_BY_SLOT = {
  GK: 'GK',
  CB: 'DF', LB: 'DF', RB: 'DF',
  DM: 'MF', CM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF',
  LW: 'FW', RW: 'FW', ST: 'FW',
};
export function slotGroup(slot) { return GROUP_BY_SLOT[slot] || 'MF'; }

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — REYTİNG KAYNAĞI ŞEFFAFLIĞI] `ratingOverrideSource` zaten
// server/src/etl/run.js'te hesaplanıyordu ama hiçbir yerde gösterilmiyordu — "draft'ta yan yana
// çıkan iki oyuncudan biri EA verisiyle, diğeri bizim formülümüzle hesaplanmış olabilir, şeffaf
// olsun" isteğiyle küçük bir rozete çevrildi. Bilinmeyen/gelecekteki bir kaynak değeri de (ham
// haliyle) gösterilsin diye jenerik bırakıldı — sadece bilinen 'fc26-2026-27' kısaltılıyor.
// [KULLANICI İSTEĞİ — TEK ÖLÇEK] Artık üç değil iki durum var: reyting ya doğrudan EA FC26
// verisi ('FC26'), ya da EA dosyasında bulunmayan bir oyuncu için o ligin EA dağılımına
// oturtulmuş değer ('≈EA' — bkz. server/src/etl/eaCalibration.js). Kendi formülümüzün ham
// sayısı artık hiçbir oyuncuda görünmüyor, bu yüzden ayrı bir etiketi de yok.
export function fmtRatingSource(source) {
  if (!source) return null;
  if (source === 'fc26-2026-27') return 'FC26';
  if (source === 'fc26-2026-27-kalibre') return '≈EA';
  return source;
}

export function ratingSourceTitle(source) {
  if (source === 'fc26-2026-27') return 'Bu reyting doğrudan EA Sports FC 26 verisinden alınmıştır.';
  if (source === 'fc26-2026-27-kalibre') return 'Bu oyuncu EA FC 26 kadro listesinde yok. Reytingi, kendi değer+performans sıralamamız kullanılarak ligin EA dağılımına oturtuldu — yani EA ölçeğinde bir tahmin.';
  return null;
}

export function playerCard(player, { slot, extraClass = '', tag = '' } = {}) {
  const group = slotGroup(slot || player.position);
  const sourceLabel = fmtRatingSource(player.ratingOverrideSource);
  // [KULLANICI İSTEĞİ] "Icon (efsane) oyuncu kartları normal karttan çok az ayrışıyor — 38
  // kişilik özel bir kategori olduğu için kartın kendisine foil/özel çerçeve eklensin."
  // Rozet kaldı, ama ayrım artık kartın TAMAMINDA: mor-altın foil kenar, taranan parıltı,
  // koyu mor zemin (bkz. styles.css .player-card.icon).
  return el('div', { class: `player-card ${player.isIcon ? 'icon' : ''} ${extraClass}` }, [
    el('div', { class: `pos-badge pos-${group}` }, slot || player.position),
    el('div', { class: 'rating' }, String(player.rating)),
    sourceLabel ? el('div', {
      class: `rating-source-badge ${player.ratingOverrideSource === 'fc26-2026-27-kalibre' ? 'calibrated' : ''}`,
      title: ratingSourceTitle(player.ratingOverrideSource) || '',
    }, sourceLabel) : null,
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
