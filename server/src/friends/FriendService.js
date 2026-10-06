// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ARKADAŞLAR] Kayıtlı kullanıcılar arası karşılıklı onaylı
// arkadaşlık. Kimlik: e-posta ya da (benzersiz olmayan) görünen ad DEĞİL, paylaşılabilir rastgele
// bir arkadaş kodu — e-postayla arama "bu adres kayıtlı mı" bilgisini sızdırırdı.
// Tablolar: friendships (çift başına tek satır, user_a < user_b) ve user_blocks (bkz. db/db.js).
// Kim şu an hangi odada sorusu burada değil, bellekteki Presence'ta (bkz. friends/Presence.js).
const crypto = require('crypto');

// 0/O, 1/I/L gibi karışan karakterler yok. 8 karakter, 32^8 ≈ 1 trilyon — tahminle bulunamaz.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const FRIEND_LIMITS = {
  maxFriends: 200,
  maxOutgoingPending: 50,
  maxIncomingPending: 100,
};

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// "abcd-efgh", "ABCD EFGH", "abcdefgh" → "ABCDEFGH"; geçersizse null.
function normalizeCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

function formatCode(code) {
  return code ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
}

function pairOf(x, y) {
  return x < y ? [x, y] : [y, x];
}

class FriendService {
  constructor(db) {
    this.db = db;
  }

  // Kodu yoksa üretir. Çakışma (UNIQUE index) ya da eşzamanlı iki çağrı: koşullu UPDATE + yeniden oku.
  async ensureCode(userId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const row = await this.db.get('SELECT friend_code FROM users WHERE id = ?', userId);
      if (!row) return null;
      if (row.friend_code) return row.friend_code;
      try {
        await this.db.run('UPDATE users SET friend_code = ? WHERE id = ? AND friend_code IS NULL', generateCode(), userId);
      } catch (e) {
        if (!/UNIQUE/i.test(String(e && e.message))) throw e;
      }
    }
    throw new Error('friend_code üretilemedi');
  }

  async _relation(userId, otherId) {
    const [a, b] = pairOf(userId, otherId);
    return this.db.get('SELECT * FROM friendships WHERE user_a = ? AND user_b = ?', a, b);
  }

  async _isBlocked(blockerId, blockedId) {
    return !!(await this.db.get('SELECT 1 AS x FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', blockerId, blockedId));
  }

  async _count(sql, ...args) {
    const row = await this.db.get(sql, ...args);
    return Number(row && row.n) || 0;
  }

  async _friendCount(userId) {
    return this._count("SELECT COUNT(*) AS n FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'", userId, userId);
  }

  async areFriends(userId, otherId) {
    const rel = await this._relation(userId, otherId);
    return !!(rel && rel.status === 'accepted');
  }

  async friendIds(userId) {
    const rows = await this.db.all(
      "SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'accepted'",
      userId, userId, userId
    );
    return rows.map((r) => Number(r.id));
  }

  // Dönüş: { status: 'pending'|'accepted', user: {id, displayName} } ya da { error }.
  // Hedef seni engellediyse NOT_FOUND — engellendiğin öğrenilemesin.
  async request(userId, rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) return { error: 'INVALID_CODE' };
    const target = await this.db.get('SELECT id, display_name FROM users WHERE friend_code = ?', code);
    if (!target) return { error: 'NOT_FOUND' };
    const targetId = Number(target.id);
    if (targetId === userId) return { error: 'SELF' };
    if (await this._isBlocked(targetId, userId)) return { error: 'NOT_FOUND' };
    if (await this._isBlocked(userId, targetId)) return { error: 'YOU_BLOCKED' };
    const user = { id: targetId, displayName: target.display_name };

    const rel = await this._relation(userId, targetId);
    if (rel) {
      if (rel.status === 'accepted') return { error: 'ALREADY_FRIENDS' };
      if (Number(rel.requested_by) === userId) return { error: 'ALREADY_REQUESTED' };
      // Karşı taraf zaten bana istek atmış — bu, kabul demektir.
      const res = await this.respond(userId, targetId, true);
      return res.error ? res : { status: 'accepted', user };
    }

    if (await this._friendCount(userId) >= FRIEND_LIMITS.maxFriends) return { error: 'FRIEND_LIMIT' };
    const outgoing = await this._count("SELECT COUNT(*) AS n FROM friendships WHERE requested_by = ? AND status = 'pending'", userId);
    if (outgoing >= FRIEND_LIMITS.maxOutgoingPending) return { error: 'PENDING_LIMIT' };
    const incoming = await this._count(
      "SELECT COUNT(*) AS n FROM friendships WHERE (user_a = ? OR user_b = ?) AND status = 'pending' AND requested_by <> ?",
      targetId, targetId, targetId
    );
    if (incoming >= FRIEND_LIMITS.maxIncomingPending) return { error: 'TARGET_PENDING_LIMIT' };

    const [a, b] = pairOf(userId, targetId);
    const now = Date.now();
    const info = await this.db.run(
      `INSERT INTO friendships (user_a, user_b, status, requested_by, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?) ON CONFLICT (user_a, user_b) DO NOTHING`,
      a, b, userId, now, now
    );
    // Eşzamanlı karşılıklı istek: diğer satır önce yazıldı — durumu yeniden değerlendir.
    if (info.changes !== 1) return this.request(userId, rawCode);
    return { status: 'pending', user };
  }

  // userId, otherId'nin kendisine attığı bekleyen isteği kabul eder ya da reddeder.
  async respond(userId, otherId, accept) {
    const rel = await this._relation(userId, otherId);
    if (!rel || rel.status !== 'pending' || Number(rel.requested_by) !== otherId) return { error: 'NO_REQUEST' };
    const [a, b] = pairOf(userId, otherId);
    if (!accept) {
      await this.db.run("DELETE FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'pending'", a, b);
      return { ok: true, status: 'rejected' };
    }
    if (await this._friendCount(userId) >= FRIEND_LIMITS.maxFriends) return { error: 'FRIEND_LIMIT' };
    if (await this._friendCount(otherId) >= FRIEND_LIMITS.maxFriends) return { error: 'TARGET_FRIEND_LIMIT' };
    const info = await this.db.run(
      "UPDATE friendships SET status = 'accepted', updated_at = ? WHERE user_a = ? AND user_b = ? AND status = 'pending'",
      Date.now(), a, b
    );
    if (info.changes !== 1) return { error: 'NO_REQUEST' };
    return { ok: true, status: 'accepted' };
  }

  // Arkadaşlıktan çıkarma, gönderilen isteği geri çekme ve gelen isteği reddetme — hepsi aynı satırı siler.
  async remove(userId, otherId) {
    const [a, b] = pairOf(userId, otherId);
    const info = await this.db.run('DELETE FROM friendships WHERE user_a = ? AND user_b = ?', a, b);
    return info.changes === 1 ? { ok: true } : { error: 'NOT_FOUND' };
  }

  async block(userId, otherId) {
    if (otherId === userId) return { error: 'SELF' };
    const exists = await this.db.get('SELECT 1 AS x FROM users WHERE id = ?', otherId);
    if (!exists) return { error: 'NOT_FOUND' };
    await this.db.run(
      'INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT (blocker_id, blocked_id) DO NOTHING',
      userId, otherId, Date.now()
    );
    const [a, b] = pairOf(userId, otherId);
    await this.db.run('DELETE FROM friendships WHERE user_a = ? AND user_b = ?', a, b);
    return { ok: true };
  }

  async unblock(userId, otherId) {
    await this.db.run('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', userId, otherId);
    return { ok: true };
  }

  async setPresenceHidden(userId, hidden) {
    await this.db.run('UPDATE users SET presence_hidden = ? WHERE id = ?', hidden ? 1 : 0, userId);
  }

  // Ham liste — presence bilgisi çağıranda (index.js) eklenir.
  async overview(userId) {
    const code = await this.ensureCode(userId);
    const me = await this.db.get('SELECT presence_hidden FROM users WHERE id = ?', userId);
    const rows = await this.db.all(
      `SELECT f.status, f.requested_by, f.created_at, f.updated_at, u.id AS uid, u.display_name, u.presence_hidden
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       WHERE f.user_a = ? OR f.user_b = ?`,
      userId, userId, userId
    );
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const r of rows) {
      const entry = { id: Number(r.uid), displayName: r.display_name };
      if (r.status === 'accepted') friends.push({ ...entry, since: Number(r.updated_at), presenceHidden: !!r.presence_hidden });
      else if (Number(r.requested_by) === userId) outgoing.push({ ...entry, at: Number(r.created_at) });
      else incoming.push({ ...entry, at: Number(r.created_at) });
    }
    const blocked = (await this.db.all(
      'SELECT u.id AS uid, u.display_name FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC',
      userId
    )).map((r) => ({ id: Number(r.uid), displayName: r.display_name }));
    friends.sort((x, y) => x.displayName.localeCompare(y.displayName, 'tr'));
    incoming.sort((x, y) => y.at - x.at);
    outgoing.sort((x, y) => y.at - x.at);
    return { code: formatCode(code), presenceHidden: !!(me && me.presence_hidden), friends, incoming, outgoing, blocked };
  }
}

module.exports = { FriendService, FRIEND_LIMITS, normalizeCode, formatCode, CODE_LENGTH };
