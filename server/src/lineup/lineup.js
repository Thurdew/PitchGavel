// Draft sonrası dizilim seçimi: kadronun HANGİ formasyonlarda gerçekten kurulabildiğini
// (oyuncuların birincil+ikincil pozisyon uygunluğuna göre) hesaplar ve slot->oyuncu
// ataması üretir/doğrular. Bkz. AUCTION-GAME-CLAUDE.md "Kadro / Draft Kuralları":
// "Sistem, kadroyla gerçekten kurulamayacak formasyonları seçenek olarak GÖSTERMEMELİ."
const { FORMATIONS } = require('../shared/football');

/**
 * Kuhn'un augmenting-path algoritmasıyla maksimum bipartite eşleştirme.
 * playerEligibility: her oyuncu için uygun slot tiplerinin Set'i (index = squad sırası).
 * slotInstances: formasyonun gerektirdiği slot tipleri dizisi (ör. 4-4-2 için 11 eleman,
 *                CB iki kez geçer -> iki ayrı "slot örneği" olarak ele alınır).
 * Döner: { matched: boolean, assignment: (playerIndex|null)[] } (assignment.length === slotInstances.length)
 */
function maxBipartiteMatching(playerEligibility, slotInstances) {
  const nSlots = slotInstances.length;
  const nPlayers = playerEligibility.length;
  const slotToPlayer = new Array(nSlots).fill(-1); // slotIndex -> playerIndex

  function tryAssign(playerIdx, visitedSlots) {
    for (let s = 0; s < nSlots; s++) {
      if (visitedSlots[s]) continue;
      if (!playerEligibility[playerIdx].has(slotInstances[s])) continue;
      visitedSlots[s] = true;
      if (slotToPlayer[s] === -1 || tryAssign(slotToPlayer[s], visitedSlots)) {
        slotToPlayer[s] = playerIdx;
        return true;
      }
    }
    return false;
  }

  let matchedCount = 0;
  for (let p = 0; p < nPlayers; p++) {
    const visited = new Array(nSlots).fill(false);
    if (tryAssign(p, visited)) matchedCount++;
  }

  return {
    matched: matchedCount === nSlots,
    matchedCount,
    assignment: slotToPlayer, // slotIndex -> playerIndex (-1 doldurulamadıysa)
  };
}

function eligibilitySets(squad) {
  return squad.map((entry) => new Set(entry.player.eligibleSlots.map((e) => e.slot)));
}

/** Verilen kadronun bir formasyonda kurulup kurulamayacağını (ve mümkünse bir dizilimi) döner. */
function tryBuildFormation(squad, formationKey) {
  const slotInstances = FORMATIONS[formationKey];
  if (!slotInstances) return { feasible: false, error: 'UNKNOWN_FORMATION' };
  if (squad.length !== slotInstances.length) return { feasible: false, error: 'SQUAD_SIZE_MISMATCH' };

  const elig = eligibilitySets(squad);
  const { matched, assignment } = maxBipartiteMatching(elig, slotInstances);
  if (!matched) return { feasible: false };

  const lineup = assignment.map((playerIdx, slotIdx) => ({
    slot: slotInstances[slotIdx],
    squadIndex: playerIdx,
    player: squad[playerIdx].player,
  }));
  return { feasible: true, lineup };
}

/** Kadronun kurulabildiği TÜM formasyonları (havuzdan) döner — UI sadece bunları göstermeli. */
function buildableFormations(squad) {
  return Object.keys(FORMATIONS).map((key) => {
    const result = tryBuildFormation(squad, key);
    return { formation: key, feasible: result.feasible, suggestedLineup: result.feasible ? result.lineup : null };
  });
}

/** Kullanıcının elle seçtiği slot->oyuncu atamasının geçerliliğini doğrular. */
function validateAssignment(squad, formationKey, assignment) {
  const slotInstances = FORMATIONS[formationKey];
  if (!slotInstances) return { valid: false, error: 'UNKNOWN_FORMATION' };
  if (!Array.isArray(assignment) || assignment.length !== slotInstances.length) {
    return { valid: false, error: 'ASSIGNMENT_LENGTH_MISMATCH' };
  }

  const usedPlayers = new Set();
  for (let i = 0; i < assignment.length; i++) {
    const squadIndex = assignment[i];
    if (squadIndex == null || squadIndex < 0 || squadIndex >= squad.length) {
      return { valid: false, error: 'INVALID_SQUAD_INDEX', slotIndex: i };
    }
    if (usedPlayers.has(squadIndex)) return { valid: false, error: 'DUPLICATE_PLAYER', slotIndex: i };
    usedPlayers.add(squadIndex);

    const requiredSlot = slotInstances[i];
    const player = squad[squadIndex].player;
    const ok = player.eligibleSlots.some((e) => e.slot === requiredSlot);
    if (!ok) return { valid: false, error: 'PLAYER_NOT_ELIGIBLE', slotIndex: i, requiredSlot, playerId: player.id };
  }

  return { valid: true };
}

module.exports = { buildableFormations, tryBuildFormation, validateAssignment, maxBipartiteMatching };
