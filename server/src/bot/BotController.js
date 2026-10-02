// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — BİLGİSAYARA KARŞI] Bot odalarını süren denetleyici. Bot bir
// socket değil: tek bir zamanlayıcı her BOT_TICK_MS'de bot odalarını gezip duruma bakar ve
// gerekiyorsa motor fonksiyonlarını (DraftEngine, dizilim, oylar) doğrudan çağırır. Kararlar
// BotBrain.js'te; burası sadece "ne zaman" kısmı (insan gibi kısa düşünme payları).
const { STATUS } = require('../rooms/RoomManager');
const { FORMATIONS } = require('../shared/football');
const { summarizeSubmissions, maybeStartMatchPhase } = require('../sockets/lineupSockets');
const brain = require('./BotBrain');

const TICK_MS = Number(process.env.BOT_TICK_MS) || 300;
// Bota karşı odada hiç bağlı insan kalmazsa bu süre sonra oda kapatılır.
const ABANDON_MS = Number(process.env.BOT_ABANDON_MS) || 10 * 60 * 1000;
const WHEEL_PICK_DELAY_MS = Number(process.env.BOT_WHEEL_PICK_DELAY_MS) || 4200; // çark animasyonu bitsin

function rand(min, max) { return min + Math.random() * (max - min); }

class BotController {
  constructor(io, roomManager, draftEngine) {
    this.io = io;
    this.roomManager = roomManager;
    this.draftEngine = draftEngine;
    this.rooms = new Map(); // code -> bellek
    this.timer = null;
  }

  attach(room) {
    this.rooms.set(room.code, { pendingAt: null, pendingKey: null, blindHistory: [], lastBlind: null, lastHumanAt: Date.now() });
    if (!this.timer) {
      this.timer = setInterval(() => this.tickAll(), TICK_MS);
      this.timer.unref?.();
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.rooms.clear();
  }

  tickAll() {
    for (const [code, mem] of this.rooms) {
      const room = this.roomManager.getRoom(code);
      if (!room) { this.rooms.delete(code); continue; }
      try { this.tick(room, mem); } catch (e) { console.error('[bot] hata:', e && e.stack ? e.stack : e); }
    }
    if (this.rooms.size === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  tick(room, mem) {
    const now = Date.now();
    const humans = this.roomManager.humanPlayers(room);
    if (humans.some((p) => p.connected)) mem.lastHumanAt = now;
    else if (now - mem.lastHumanAt > ABANDON_MS) {
      this.roomManager.removeRoom(room.code);
      this.rooms.delete(room.code);
      return;
    }
    for (const bot of room.players.filter((p) => p.isBot)) {
      if (room.status === STATUS.LOBBY || room.status === STATUS.MATCH) this.voteReady(room, bot);
      else if (room.status === STATUS.DRAFT && room.draft) this.draftTurn(room, bot, mem, now);
      else if (room.status === STATUS.SQUAD_SELECT) this.submitLineups(room, bot);
    }
  }

  // Bekleme odasında ve maç öncesinde "hazırım" (eşikler zaten sadece insanları sayıyor — bu
  // yalnızca arayüzde botun da hazır görünmesi için).
  voteReady(room, bot) {
    if (room.readyVotes.has(bot.clientId)) return;
    room.readyVotes.add(bot.clientId);
    this.io.to(room.code).emit('room:state', this.roomManager.toPublicState(room));
  }

  // Bir hamleyi kısa bir "düşünme" süresinden sonra yapar; süre dolunca durum yeniden okunur
  // (bu arada değiştiyse eski karar uygulanmaz).
  schedule(mem, key, delayMs, now) {
    if (mem.pendingKey === key) return now >= mem.pendingAt;
    mem.pendingKey = key;
    mem.pendingAt = now + delayMs;
    return false;
  }

  draftTurn(room, bot, mem, now) {
    const d = room.draft;
    this.recordBlindOutcome(room, bot, mem);
    this.mirrorPause(room, bot);
    if (d.paused) return;
    const round = d.round;
    if (!round) return;

    if (round.kind === 'auction' && round.participantIds.includes(bot.clientId)) {
      const amount = brain.liveBidDecision(room, bot, round);
      if (amount == null) return;
      const msLeft = round.deadline - now;
      const key = `live:${round.deadline}:${round.highestBid}:${round.cascadeStage}`;
      const delay = Math.min(rand(900, 2400), Math.max(150, msLeft * 0.35));
      if (!this.schedule(mem, key, delay, now)) return;
      mem.pendingKey = null;
      const fresh = brain.liveBidDecision(room, bot, room.draft.round || round);
      if (fresh != null && room.draft.round === round) this.draftEngine.submitBid(room, bot.clientId, fresh);
      return;
    }

    if (round.kind === 'blind_auction' && round.participantIds.includes(bot.clientId)) {
      if (round.bids.has(bot.clientId)) return;
      const msLeft = round.deadline - now;
      const key = `blind:${round.deadline}`;
      if (!this.schedule(mem, key, Math.min(rand(1500, 4000), Math.max(150, msLeft * 0.4)), now)) return;
      mem.pendingKey = null;
      const amount = brain.blindBidDecision(room, bot, round, mem.blindHistory);
      mem.lastBlind = { round, ceiling: brain.auctionCeiling(room, bot, round) };
      this.draftEngine.submitBid(room, bot.clientId, amount);
      return;
    }

    if (round.kind === 'wheel' && round.clientId === bot.clientId) this.wheelTurn(room, bot, round, mem, now);
  }

  // Kör turda rakibin açıklanan teklifini, o turdaki kendi tavanıma oranla saklar (tahmin için).
  recordBlindOutcome(room, bot, mem) {
    const last = mem.lastBlind;
    if (!last || room.draft.round === last.round) return;
    mem.lastBlind = null;
    for (const id of last.round.participantIds) {
      if (id === bot.clientId) continue;
      const b = last.round.bids.get(id);
      if (last.ceiling > 0) mem.blindHistory.push({ ratio: (b ? b.amount : 0) / last.ceiling });
    }
  }

  // Duraklatma tüm insanlar isterse bot da katılır; biri vazgeçerse bot da çekilir.
  mirrorPause(room, bot) {
    const d = room.draft;
    const humansWant = this.roomManager.allHumansIn(room, d.pauseVotes);
    const botVoted = d.pauseVotes.has(bot.clientId);
    if (humansWant !== botVoted) {
      if (botVoted) d.pauseVotes.delete(bot.clientId); else d.pauseVotes.add(bot.clientId);
      this.draftEngine.emitDraft(room);
    }
  }

  wheelTurn(room, bot, round, mem, now) {
    if (round.phase === 'awaiting_spin' && !round.currentSpin) {
      if (!this.schedule(mem, `spin:${round.deadline}`, Math.min(rand(1000, 2000), Math.max(150, (round.deadline - now) * 0.3)), now)) return;
      mem.pendingKey = null;
      this.draftEngine.spinWheel(room, bot.clientId);
      return;
    }
    if (round.phase !== 'awaiting_pick' || !round.currentSpin) return;
    const kind = round.currentSpin.kind;
    if (kind === 'forced_worst' || kind === 'give_best' || kind === 'respin') return; // sunucu kendisi uygular
    const delay = Math.min(WHEEL_PICK_DELAY_MS + rand(300, 1200), Math.max(150, (round.deadline - now) * 0.5));
    if (!this.schedule(mem, `pick:${round.deadline}`, delay, now)) return;
    mem.pendingKey = null;
    if (kind === 'steal') {
      const target = brain.bestStealTarget(room, bot, round.slotType);
      if (target) this.draftEngine.submitWheelPick(room, bot.clientId, { playerId: target.player.id, ownerClientId: target.ownerClientId });
      else this.draftEngine.requestAutoPick(room, bot.clientId);
      return;
    }
    const best = brain.bestCandidate(this.draftEngine.candidatesForSegment(room, round));
    if (best) this.draftEngine.submitWheelPick(room, bot.clientId, { playerId: best.id });
    else this.draftEngine.requestAutoPick(room, bot.clientId);
  }

  // Draft biter bitmez ev ve deplasman dizilimini gönderir (insanın kadrosunu bilerek ama
  // onun gönderdiği dizilime bakmadan).
  submitLineups(room, bot) {
    const mine = room.squads[bot.clientId] || {};
    if (mine.home && mine.away) return;
    if (bot.squad.length !== 11) return;
    const opp = room.players.find((p) => p.clientId !== bot.clientId);
    for (const side of ['home', 'away']) {
      if (mine[side]) continue;
      const choice = brain.chooseLineup(bot.squad, opp ? opp.squad : null, side === 'home');
      if (!choice) continue;
      const lineup = choice.assignment.map((squadIndex, slotIndex) => ({
        slot: FORMATIONS[choice.formation][slotIndex],
        squadIndex,
        player: bot.squad[squadIndex].player,
      }));
      if (!room.squads[bot.clientId]) room.squads[bot.clientId] = {};
      room.squads[bot.clientId][side] = { formation: choice.formation, lineup, style: choice.style, tactic: choice.tactic };
      this.io.to(room.code).emit('lineup:update', {
        clientId: bot.clientId, matchSide: side, formation: choice.formation, submitted: summarizeSubmissions(room),
      });
    }
    room.updatedAt = Date.now();
    maybeStartMatchPhase(this.io, this.roomManager, room);
  }
}

module.exports = { BotController };
