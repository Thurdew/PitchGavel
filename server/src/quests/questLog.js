// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — GÖREVLER, NİŞ] Draft/takas sırasında olan görev olayları
// ("kör draftta 10₺'ye oyuncu kap", "son saniyede kap", "çarkla çal"...) oda içinde, bellekte
// sayılır: room.questLog[clientId][stat]. DB'ye HEMEN yazılmaz — maç sonunda, o oyuncunun en az
// bir geçerli maçı varsa (coin kuralları: bot/misafir/ikinci hesap değil) görev ilerlemesine
// eklenir (bkz. sockets/matchSockets.js awardCoins). Böylece bu olaylar da kasılamaz.
function resetQuestLog(room) {
  room.questLog = {};
}

function bumpQuest(room, clientId, stat, n = 1) {
  if (!room || !clientId) return;
  if (!room.questLog) room.questLog = {};
  const log = room.questLog[clientId] || (room.questLog[clientId] = {});
  log[stat] = (log[stat] || 0) + n;
}

module.exports = { resetQuestLog, bumpQuest };
