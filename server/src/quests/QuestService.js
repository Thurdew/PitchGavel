// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÖREVLER] Görev ilerlemesi + "Topla". Katalog:
// shared/quests.js. İlerleme maç sonunda CoinService'in GEÇERLİ saydığı maçlardan yazılır
// (aynı kasma önlemleri: misafir/doğrulanmamış/aynı hesap/bot/çift sınırı sayılmaz, aynı ağda
// sadece galibiyet) — böylece görev, ikinci hesapla ya da bota karşı kasılamaz.
//
// Tablo quest_progress (user_id, quest_id, period): period günlükte 'D2026-10-06', haftalıkta
// pazartesinin tarihi 'W2026-10-05', tek seferlikte 'O'. Dönem değişince yeni satır = sıfırdan
// başlar; toplanmamış eski dönem ödülleri kaybolur (istemci sıfırlanma süresini gösterir).
const { QUESTS, QUEST_BY_ID, DRAFT_QUEST_STATS } = require('../shared/quests');

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(ts) { return new Date(ts).toISOString().slice(0, 10); }
function utcMidnight(ts) { const d = new Date(ts); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function weekStart(ts) {
  const midnight = utcMidnight(ts);
  const dow = (new Date(midnight).getUTCDay() + 6) % 7; // pazartesi = 0
  return midnight - dow * DAY_MS;
}

function periodOf(scope, now = Date.now()) {
  if (scope === 'daily') return `D${utcDay(now)}`;
  if (scope === 'weekly') return `W${utcDay(weekStart(now))}`;
  return 'O';
}
function resetsAtOf(scope, now = Date.now()) {
  if (scope === 'daily') return utcMidnight(now) + DAY_MS;
  if (scope === 'weekly') return weekStart(now) + 7 * DAY_MS;
  return null;
}

// Maç olaylarından görev istatistikleri. event: { gf, ga, draftMode?, playerPool? } (bu
// oyuncunun gözünden; mod/havuz bilgisini matchSockets odadan ekler).
function statsOf(events) {
  const s = { play: 0, win: 0, goals: 0, cleanSheet: 0, bigWin: 0, oneNil: 0, goalRain: 0, superLigWin: 0, blindWin: 0, wheelWin: 0 };
  for (const e of events || []) {
    const gf = Number(e.gf) || 0;
    const ga = Number(e.ga) || 0;
    const win = gf > ga;
    s.play += 1;
    s.goals += gf;
    if (win) s.win += 1;
    if (ga === 0) s.cleanSheet += 1;
    if (gf - ga >= 3) s.bigWin += 1;
    if (gf === 1 && ga === 0) s.oneNil += 1;
    if (gf >= 5) s.goalRain += 1;
    if (win && e.playerPool === 'super-lig') s.superLigWin += 1;
    if (win && e.draftMode === 'blind') s.blindWin += 1;
    if (win && e.draftMode === 'wheel') s.wheelWin += 1;
  }
  return s;
}

class QuestService {
  constructor(db, coinService) {
    this.db = db;
    this.coinService = coinService;
  }

  // Maç sonunda bir kullanıcının geçerli maçlarını (+ varsa o odadaki draft/takas olaylarını,
  // bkz. quests/questLog.js) işler. Draft olayları sadece en az bir geçerli maç varsa sayılır.
  async recordMatches(userId, events, now = Date.now(), draftLog = null) {
    if (!events || !events.length) return;
    const stats = statsOf(events);
    for (const k of DRAFT_QUEST_STATS) stats[k] = Math.max(0, Math.floor(Number(draftLog && draftLog[k]) || 0));
    for (const q of QUESTS) {
      const n = stats[q.stat] || 0;
      if (n <= 0) continue;
      await this.db.run(
        `INSERT INTO quest_progress (user_id, quest_id, period, progress, claimed_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?)
         ON CONFLICT (user_id, quest_id, period) DO UPDATE SET progress = progress + excluded.progress, updated_at = excluded.updated_at`,
        userId, q.id, periodOf(q.scope, now), n, now
      );
    }
  }

  async list(userId, now = Date.now()) {
    const rows = await this.db.all('SELECT quest_id, period, progress, claimed_at FROM quest_progress WHERE user_id = ?', userId);
    const byKey = new Map(rows.map((r) => [`${r.quest_id}|${r.period}`, r]));
    const quests = QUESTS.map((q) => {
      const row = byKey.get(`${q.id}|${periodOf(q.scope, now)}`);
      const progress = row ? Number(row.progress) || 0 : 0;
      const claimed = !!(row && row.claimed_at);
      return {
        id: q.id, scope: q.scope, group: q.group, title: q.title, desc: q.desc || null, target: q.target, reward: q.reward,
        progress: Math.min(progress, q.target), claimed, claimable: !claimed && progress >= q.target,
        resetsAt: resetsAtOf(q.scope, now),
      };
    });
    return { quests, claimableCount: quests.filter((q) => q.claimable).length };
  }

  // Tek kullanımlık: koşullu UPDATE'i başaran (changes=1) ödülü alır — çift tıklama/iki sekme
  // aynı ödülü iki kez veremez.
  async claim(userId, questId, now = Date.now()) {
    const q = QUEST_BY_ID[questId];
    if (!q) return { error: 'UNKNOWN_QUEST' };
    const period = periodOf(q.scope, now);
    const upd = await this.db.run(
      'UPDATE quest_progress SET claimed_at = ? WHERE user_id = ? AND quest_id = ? AND period = ? AND claimed_at IS NULL AND progress >= ?',
      now, userId, q.id, period, q.target
    );
    if (upd.changes !== 1) {
      const row = await this.db.get('SELECT claimed_at FROM quest_progress WHERE user_id = ? AND quest_id = ? AND period = ?', userId, q.id, period);
      return { error: row && row.claimed_at ? 'ALREADY_CLAIMED' : 'NOT_COMPLETED' };
    }
    await this.coinService._credit(userId, q.reward, 'quest', { questId: q.id, period });
    return { ok: true, reward: q.reward, balance: await this.coinService.balance(userId) };
  }

  // Eski günlük/haftalık satırlar (2 haftadan eski) — tablo sonsuza dek büyümesin.
  async sweep(now = Date.now()) {
    await this.db.run("DELETE FROM quest_progress WHERE period <> 'O' AND updated_at < ?", now - 14 * DAY_MS);
  }
}

module.exports = { QuestService, periodOf, resetsAtOf, statsOf };
