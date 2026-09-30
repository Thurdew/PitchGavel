// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Maç sonu coin ödülü + mağaza.
// AuthService/RewardsService'in `{ error: 'CODE' }` konvansiyonuyla birebir.
//
// Kasma (farming) önlemleri (kullanıcıyla kararlaştırıldı — IP'ye göre OYUNU engellemek yerine
// ÖDÜLÜ sınırlama; aynı evde/yurtta oynayan arkadaşlar ve operatörlerin ortak IP'si yüzünden):
//   1. İki taraf da giriş yapmış, FARKLI ve e-postası doğrulanmış hesap olmalı (misafirle oynanan
//      maç kimseye coin vermez). Gmail'in nokta/+etiket varyantları aynı adres sayılır.
//   2. Günlük tavan (COIN_REWARDS.dailyCap).
//   3. Aynı iki hesap arasında günde en fazla COIN_REWARDS.pairDailyLimit ödüllü maç.
//   4. Aynı IP'den bağlanan iki hesap arasındaki maçta SADECE galibiyet ödüllendirilir (kendi
//      kendine oynayan biri iki hesabı birden besleyemesin).
// Her maç (ev + deplasman ayrı ayrı) kendi başına ödüllendirilir — lig puanlamasıyla aynı mantık.
const { COIN_REWARDS, STORE_ITEMS, STORE_ITEM_BY_ID, COSMETIC_SLOTS } = require('../shared/economy');
const { PREMIUM_KIT_IDS } = require('../shared/teams');

function todayUTC() { return new Date().toISOString().slice(0, 10); }

// Gmail'de "a.hmet@gmail.com" ve "ahmet+pg@gmail.com" aynı gelen kutusuna düşer — aynı kişi
// sayılsın. `+etiket` birçok sağlayıcıda (Outlook, iCloud, Proton...) aynı şekilde çalıştığı için
// her alan adında kırpılıyor; noktalar sadece Gmail'de anlamsız.
function canonicalEmail(email) {
  const [localRaw, domainRaw] = String(email || '').trim().toLowerCase().split('@');
  if (!domainRaw) return String(email || '').trim().toLowerCase();
  let local = localRaw.split('+')[0];
  const domain = domainRaw === 'googlemail.com' ? 'gmail.com' : domainRaw;
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

// Bir maçtaki bir tarafın (ev ya da deplasman) ödül durumu.
const NOTE = {
  GUEST: 'GUEST', // bu oyuncu giriş yapmamış
  OPPONENT_GUEST: 'OPPONENT_GUEST', // rakip giriş yapmamış
  UNVERIFIED: 'UNVERIFIED', // taraflardan birinin e-postası doğrulanmamış
  PAIR_LIMIT: 'PAIR_LIMIT', // aynı rakiple bugünkü ödüllü maç sınırı doldu
  SAME_NETWORK: 'SAME_NETWORK', // aynı ağ — sadece galibiyet ödüllü
  DAILY_CAP: 'DAILY_CAP', // günlük tavan doldu
};

class CoinService {
  constructor(db) {
    this.db = db;
  }

  async balance(userId) {
    const row = await this.db.get('SELECT coins FROM users WHERE id = ?', userId);
    return row ? Number(row.coins || 0) : 0;
  }

  async _credit(userId, amount, reason, meta) {
    if (amount <= 0) return;
    await this.db.run('UPDATE users SET coins = coins + ? WHERE id = ?', amount, userId);
    await this.db.run(
      'INSERT INTO coin_ledger (user_id, amount, reason, meta, created_at) VALUES (?, ?, ?, ?, ?)',
      userId, amount, reason, meta ? JSON.stringify(meta) : null, Date.now()
    );
  }

  async _dailyRow(userId, day) {
    await this.db.run('INSERT OR IGNORE INTO coin_daily (user_id, day, earned, first_win) VALUES (?, ?, 0, 0)', userId, day);
    return this.db.get('SELECT * FROM coin_daily WHERE user_id = ? AND day = ?', userId, day);
  }

  // Günlük tavana göre verilebilecek kadarını ayırır. [TURSO] İyimser kilit: `earned = <okunan>`
  // koşullu UPDATE — aynı hesap aynı anda iki odada maç bitirse bile tavan aşılmaz.
  async _reserveDaily(userId, day, amount) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await this._dailyRow(userId, day);
      const earned = Number(row.earned || 0);
      const grant = Math.min(amount, COIN_REWARDS.dailyCap - earned);
      if (grant <= 0) return 0;
      const upd = await this.db.run(
        'UPDATE coin_daily SET earned = earned + ? WHERE user_id = ? AND day = ? AND earned = ?',
        grant, userId, day, earned
      );
      if (upd.changes === 1) return grant;
    }
    return 0;
  }

  // Günün ilk galibiyet bonusu — bir kez (koşullu UPDATE ile atomik).
  async _claimFirstWin(userId, day) {
    await this._dailyRow(userId, day);
    const upd = await this.db.run('UPDATE coin_daily SET first_win = 1 WHERE user_id = ? AND day = ? AND first_win = 0', userId, day);
    return upd.changes === 1;
  }

  // Aynı iki hesap arasındaki ödüllü maç sayacı — limit dolmadıysa bir artırır (atomik).
  async _takePairSlot(userA, userB, day) {
    const key = [userA, userB].sort((a, b) => a - b).join(':');
    await this.db.run('INSERT OR IGNORE INTO coin_pair_daily (day, pair_key, count) VALUES (?, ?, 0)', day, key);
    const upd = await this.db.run(
      'UPDATE coin_pair_daily SET count = count + 1 WHERE day = ? AND pair_key = ? AND count < ?',
      day, key, COIN_REWARDS.pairDailyLimit
    );
    return upd.changes === 1;
  }

  // Bir odanın maç sonucunu ödüllendirir. `accounts`: clientId → { userId, canonicalEmail,
  // verified, ip } (sadece hesabını odaya bağlamış oyuncular). Dönen: clientId → { earned,
  // balance, notes[], lines[] } — misafir oyuncular için de (notes: GUEST) bir kayıt döner ki
  // istemci neden coin almadığını açıklayabilsin.
  async awardRoomResult(fixtures, accounts, allClientIds) {
    const day = todayUTC();
    const out = {};
    for (const id of allClientIds) out[id] = { earned: 0, notes: new Set(), lines: [] };

    for (const fx of fixtures || []) {
      for (const m of [fx.match1, fx.match2]) {
        if (!m) continue;
        const h = accounts[m.homeClientId];
        const a = accounts[m.awayClientId];
        const sides = [
          { clientId: m.homeClientId, acc: h, opp: a, gf: m.goalsHome, ga: m.goalsAway },
          { clientId: m.awayClientId, acc: a, opp: h, gf: m.goalsAway, ga: m.goalsHome },
        ];

        let blocked = null;
        if (!h || !a) blocked = 'guest';
        else if (!h.verified || !a.verified) blocked = NOTE.UNVERIFIED;
        else if (h.userId === a.userId || h.canonicalEmail === a.canonicalEmail) blocked = 'same';
        if (blocked) {
          for (const s of sides) {
            if (!out[s.clientId]) continue;
            if (blocked === 'guest') out[s.clientId].notes.add(s.acc ? NOTE.OPPONENT_GUEST : NOTE.GUEST);
            else if (blocked === NOTE.UNVERIFIED) out[s.clientId].notes.add(NOTE.UNVERIFIED);
          }
          continue;
        }

        if (!(await this._takePairSlot(h.userId, a.userId, day))) {
          for (const s of sides) out[s.clientId]?.notes.add(NOTE.PAIR_LIMIT);
          continue;
        }

        const sameNetwork = !!(h.ip && a.ip && h.ip === a.ip);
        for (const s of sides) {
          const o = out[s.clientId];
          if (!o) continue;
          const outcome = s.gf > s.ga ? 'win' : s.gf < s.ga ? 'loss' : 'draw';
          if (sameNetwork && outcome !== 'win') { o.notes.add(NOTE.SAME_NETWORK); continue; }

          let amount = COIN_REWARDS[outcome];
          let bonus = 0;
          if (outcome === 'win' && (await this._claimFirstWin(s.acc.userId, day))) bonus = COIN_REWARDS.firstWinBonus;
          const granted = await this._reserveDaily(s.acc.userId, day, amount + bonus);
          if (granted < amount + bonus) o.notes.add(NOTE.DAILY_CAP);
          if (granted <= 0) continue;
          // Tavan kırptıysa önce bonus düşer — satırlar gerçekte verileni göstersin.
          const baseGranted = Math.min(amount, granted);
          const bonusGranted = granted - baseGranted;
          await this._credit(s.acc.userId, granted, `match_${outcome}`, { day, opponent: s.opp.userId, bonus: bonusGranted });
          o.earned += granted;
          o.lines.push({ outcome, amount: baseGranted, score: `${s.gf}-${s.ga}` });
          if (bonusGranted > 0) o.lines.push({ outcome: 'first_win', amount: bonusGranted });
          if (sameNetwork) o.notes.add(NOTE.SAME_NETWORK);
        }
      }
    }

    for (const [clientId, o] of Object.entries(out)) {
      const acc = accounts[clientId];
      o.notes = [...o.notes];
      o.balance = acc ? await this.balance(acc.userId) : null;
      o.rules = COIN_REWARDS;
    }
    return out;
  }

  // ---- Mağaza ----------------------------------------------------------------------------

  async ownedItemIds(userId) {
    const rows = await this.db.all('SELECT item_id FROM user_items WHERE user_id = ?', userId);
    return rows.map((r) => r.item_id);
  }

  async ownsKit(userId, kitId) {
    if (!PREMIUM_KIT_IDS.includes(kitId)) return true;
    const row = await this.db.get('SELECT 1 AS ok FROM user_items WHERE user_id = ? AND item_id = ?', userId, `kit:${kitId}`);
    return !!row;
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Kozmetik sahipliği.
  async ownsItem(userId, itemId) {
    const row = await this.db.get('SELECT 1 AS ok FROM user_items WHERE user_id = ? AND item_id = ?', userId, itemId);
    return !!row;
  }

  // Kullanıcının taktığı kozmetiklerden SADECE sahip olduklarını döner (ürün kataloğdan
  // kaldırılmış ya da kayıt elle bozulmuşsa o slot varsayılana düşer). Odaya bu yayınlanır.
  async equippedCosmetics(userId, cosmetics) {
    const owned = new Set(await this.ownedItemIds(userId));
    const out = {};
    for (const slot of COSMETIC_SLOTS) {
      const key = cosmetics && cosmetics[slot];
      if (key && owned.has(`${slot}:${key}`)) out[slot] = key;
    }
    return out;
  }

  async ownedReactionPacks(userId) {
    return (await this.ownedItemIds(userId)).filter((id) => id.startsWith('reactions:'));
  }

  async todayEarned(userId) {
    const row = await this.db.get('SELECT earned FROM coin_daily WHERE user_id = ? AND day = ?', userId, todayUTC());
    return row ? Number(row.earned || 0) : 0;
  }

  async storeFor(userId) {
    const owned = userId ? new Set(await this.ownedItemIds(userId)) : new Set();
    return {
      items: STORE_ITEMS.map((i) => ({ ...i, owned: owned.has(i.id) })),
      balance: userId ? await this.balance(userId) : null,
      todayEarned: userId ? await this.todayEarned(userId) : 0,
      rewards: COIN_REWARDS,
    };
  }

  // [TURSO] Bakiye koşullu UPDATE ile düşülür (`coins >= fiyat`) — eşzamanlı iki satın alma
  // bakiyeyi eksiye düşüremez. Ürün aynı anda iki kez alınırsa (INSERT OR IGNORE changes=0)
  // ikinci ödeme iade edilir.
  async buy(userId, itemId) {
    const item = STORE_ITEM_BY_ID.get(itemId);
    if (!item) return { error: 'UNKNOWN_ITEM' };
    const has = await this.db.get('SELECT 1 AS ok FROM user_items WHERE user_id = ? AND item_id = ?', userId, itemId);
    if (has) return { error: 'ALREADY_OWNED' };
    const pay = await this.db.run('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', item.price, userId, item.price);
    if (pay.changes !== 1) return { error: 'INSUFFICIENT_COINS' };
    const ins = await this.db.run('INSERT OR IGNORE INTO user_items (user_id, item_id, acquired_at) VALUES (?, ?, ?)', userId, itemId, Date.now());
    if (ins.changes !== 1) {
      await this.db.run('UPDATE users SET coins = coins + ? WHERE id = ?', item.price, userId);
      return { error: 'ALREADY_OWNED' };
    }
    await this.db.run(
      'INSERT INTO coin_ledger (user_id, amount, reason, meta, created_at) VALUES (?, ?, ?, ?, ?)',
      userId, -item.price, 'purchase', JSON.stringify({ itemId }), Date.now()
    );
    return { ok: true, item, balance: await this.balance(userId) };
  }
}

module.exports = { CoinService, canonicalEmail, NOTE };
