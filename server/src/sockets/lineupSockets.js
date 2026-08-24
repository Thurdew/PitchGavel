const { STATUS } = require('../rooms/RoomManager');
const { buildableFormations, validateAssignment } = require('../lineup/lineup');
const { FORMATIONS } = require('../shared/football');
const { normalizeStyle } = require('../match/cards');

// [KULLANICI İSTEĞİ] "Atak/dengeli/defansif oyna seçenekleri gelsin maçtan önce." — [KULLANICI
// İSTEĞİ, KARARLAŞTIRILDI] "Kontra" eklendi (bkz. simulate.js applyCounterDefense) — zayıf bir
// kadıya da gerçek bir taktik şansı versin diye.
const VALID_TACTICS = ['defensive', 'balanced', 'attack', 'counter'];
function normalizeTactic(tactic) {
  return VALID_TACTICS.includes(tactic) ? tactic : 'balanced';
}

function findRoomPlayer(room, clientId) {
  return room.players.find((p) => p.clientId === clientId);
}

function registerLineupSockets(io, socket, ctx) {
  const { roomManager } = ctx;

  function getRoom(code) {
    return roomManager.getRoom((code || socket.data.roomCode || '').toUpperCase());
  }

  socket.on('lineup:options', ({ code } = {}, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    if (room.status !== STATUS.SQUAD_SELECT && room.status !== STATUS.MATCH) {
      return cb?.({ error: 'DRAFT_NOT_FINISHED' });
    }
    const player = findRoomPlayer(room, socket.data.clientId);
    if (!player) return cb?.({ error: 'NOT_IN_ROOM' });

    const options = buildableFormations(player.squad);
    cb?.({ options, squad: player.squad });
  });

  socket.on('lineup:submit', ({ code, matchSide, formation, assignment, style, tactic } = {}, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    if (room.status !== STATUS.SQUAD_SELECT && room.status !== STATUS.MATCH) {
      return cb?.({ error: 'DRAFT_NOT_FINISHED' });
    }
    if (matchSide !== 'home' && matchSide !== 'away') return cb?.({ error: 'INVALID_MATCH_SIDE' });

    const player = findRoomPlayer(room, socket.data.clientId);
    if (!player) return cb?.({ error: 'NOT_IN_ROOM' });

    const check = validateAssignment(player.squad, formation, assignment);
    if (!check.valid) return cb?.({ error: 'INVALID_LINEUP', detail: check });

    const lineup = assignment.map((squadIndex, slotIndex) => ({
      slot: FORMATIONS[formation][slotIndex],
      squadIndex,
      player: player.squad[squadIndex].player,
    }));

    // [KULLANICI İSTEĞİ] "Kadro diziliminde agresif/sakin oyna, atak/dengeli/defansif oyna
    // seçenekleri gelsin" — beyaz listeye karşı doğrulanır, eksik/geçersizse nötr varsayılana
    // düşülür (davranışı değiştirmeyen 'normal'/'balanced' — bkz. match/cards.js, simulate.js).
    if (!room.squads[player.clientId]) room.squads[player.clientId] = {};
    room.squads[player.clientId][matchSide] = {
      formation, lineup, style: normalizeStyle(style), tactic: normalizeTactic(tactic),
    };
    room.updatedAt = Date.now();

    cb?.({ ok: true });
    io.to(room.code).emit('lineup:update', {
      clientId: player.clientId,
      matchSide,
      formation,
      submitted: summarizeSubmissions(room),
    });

    maybeStartMatchPhase(io, roomManager, room);
  });

  socket.on('lineup:clear', ({ code, matchSide } = {}, cb) => {
    const room = getRoom(code);
    if (!room) return cb?.({ error: 'ROOM_NOT_FOUND' });
    const player = findRoomPlayer(room, socket.data.clientId);
    if (!player) return cb?.({ error: 'NOT_IN_ROOM' });
    if (room.squads[player.clientId]) delete room.squads[player.clientId][matchSide];
    cb?.({ ok: true });
    io.to(room.code).emit('lineup:update', { clientId: player.clientId, matchSide, cleared: true, submitted: summarizeSubmissions(room) });
  });
}

function summarizeSubmissions(room) {
  const out = {};
  for (const p of room.players) {
    const s = room.squads[p.clientId] || {};
    out[p.clientId] = { home: !!s.home, away: !!s.away };
  }
  return out;
}

function bothFullyReady(room) {
  return room.players.every((p) => {
    const s = room.squads[p.clientId];
    return s && s.home && s.away;
  });
}

function maybeStartMatchPhase(io, roomManager, room) {
  if (room.status === STATUS.SQUAD_SELECT && bothFullyReady(room)) {
    room.status = STATUS.MATCH;
    // room.status değişikliğini istemcilere yay — aksi halde istemcideki eski
    // 'squad_select' durumu hiç güncellenmez ve "Maçı Simüle Et" butonu görünmez
    // (renderLineup, room.status === 'match' kontrolüne bakıyor).
    io.to(room.code).emit('room:state', roomManager.toPublicState(room));
    io.to(room.code).emit('match:ready', { code: room.code });
  }
}

module.exports = { registerLineupSockets, bothFullyReady, summarizeSubmissions };
