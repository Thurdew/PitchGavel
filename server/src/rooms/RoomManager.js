const { generateRoomCode } = require('../utils/ids');
const {
  STARTING_BUDGET, ROOM_TTL_MS, MAX_ROOM_PLAYERS,
  WHEEL_SEGMENT_CATALOG, WHEEL_CUSTOM_PICK_COUNT,
} = require('../shared/gameConfig');

// Oda durum makinesi: lobby -> [prep_wheel ->] draft -> squad_select -> match -> finished
// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] `prep_wheel` isteğe bağlı bir ara faz —
// sadece room.prepWheelEnabled ise (host oda kurarken seçti) lobby ile draft arasına girer.
const STATUS = {
  LOBBY: 'lobby',
  PREP_WHEEL: 'prep_wheel',
  DRAFT: 'draft',
  SQUAD_SELECT: 'squad_select',
  MATCH: 'match',
  FINISHED: 'finished',
};

class RoomManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.rooms = new Map();
    // clientId -> roomCode, hızlı reconnect lookup'ı için
    this.clientRoomIndex = new Map();

    // periyodik olarak uzun süredir dokunulmamış odaları temizle
    this._sweepInterval = setInterval(() => this.sweepStaleRooms(), 30 * 60 * 1000);
    this._sweepInterval.unref?.();
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kullanıcı oynayacağını lobide sorma, kaç kişi
  // gelirse gelsin" — host'a hedef bir sayı SORULMUYOR. Oda sadece dokümandaki N ≤ 8 sınırına
  // kadar (MAX_ROOM_PLAYERS) katılım kabul eder; draftı ne zaman/kaç kişiyle başlatacağına
  // (herkes hazır olduktan sonra) oda sahibi (hostClientId) kendisi karar verir.
  createRoom(hostClientId, hostName, draftMode, playerPool, wheelSegmentLabels, prepWheelEnabled) {
    let code;
    do { code = generateRoomCode(); } while (this.rooms.has(code));

    const resolvedDraftMode = draftMode === 'blind' ? 'blind' : draftMode === 'wheel' ? 'wheel' : 'live';
    const room = {
      code,
      status: STATUS.LOBBY,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      formation: null, // draft başlarken kura ile atanır (Faz 3)
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft / Çark Modu — oda kurulurken host
      // tarafından seçilir, oda ömrü boyunca sabit kalır (katılan taraf modu değiştiremez,
      // sadece görür).
      draftMode: resolvedDraftMode,
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Tek Lig Modu — draftMode'dan bağımsız ikinci bir
      // anahtar: havuzu sadece Süper Lig + Türk icon'lara daraltır (bkz. draft/pool.js).
      playerPool: playerPool === 'super-lig' ? 'super-lig' : 'all',
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] "Kör draft ve açık arttırma için
      // geçerli" — host oda kurarken açar/kapatır (varsayılan kapalı), draftMode==='wheel' iken
      // ANLAMSIZ olduğu için (o modun zaten kendi çarkı var) BİLEREK zorla kapalı tutuluyor,
      // istemci zaten bu seçeneği Çark Modu'nda hiç göstermiyor ama sunucu da asıl otorite
      // olduğu için burada garanti ediyor. Oda ömrü boyunca sabit.
      prepWheelEnabled: !!prepWheelEnabled && resolvedDraftMode !== 'wheel',
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] Host'un elle işaretlediği çark
      // segmentleri (bkz. gameConfig.js WHEEL_SEGMENT_CATALOG/WHEEL_CUSTOM_PICK_COUNT) — TAM 10
      // geçerli/benzersiz `label` verilmediyse (istemci bunu zaten önden engelliyor, ama sunucu
      // asıl otorite olduğu için burada da doğrulanıyor) sessizce null'a düşülür; null ise
      // pool.js buildWheelSegments eski dengeli-rastgele davranışına döner — draft asla
      // hatayla durmaz, sadece host'un seçimi yoksayılmış olur.
      wheelSegmentLabels: this._sanitizeWheelSegmentLabels(wheelSegmentLabels),
      // Katılım tavanı — hedef DEĞİL, sadece bir üst sınır (bkz. yukarıdaki not).
      maxPlayers: MAX_ROOM_PLAYERS,
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Odayı kuran kişi — draftı fiilen BAŞLATMA yetkisi
      // sadece bu kişide (bkz. draftSockets.js `draft:start`). Oda ömrü boyunca değişmez.
      hostClientId,
      players: [
        this._makePlayer(hostClientId, hostName),
      ],
      draft: null, // Faz 3
      squads: {}, // Faz 4: { [clientId]: { home: {...}, away: {...} } }
      matchState: null, // Faz 5
      // [KULLANICI İSTEĞİ] "Açık artırma/maç başlarken iki oyuncudan da onay al" — draftın
      // ve maçın başlaması için gereken "hazırım" oyları. Her faz geçişinde (draft başlayınca,
      // maç başlayınca) tüketilip sıfırlanır — bkz. draftSockets.js, matchSockets.js.
      readyVotes: new Set(),
    };

    this.rooms.set(code, room);
    this.clientRoomIndex.set(hostClientId, code);
    return room;
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] Host'un gönderdiği etiket listesini
  // WHEEL_SEGMENT_CATALOG'a göre doğrular: TAM WHEEL_CUSTOM_PICK_COUNT tane, katalogda gerçekten
  // var olan, benzersiz `label` değilse geçersiz sayılır ve null döner (auto-balance'a düşer).
  _sanitizeWheelSegmentLabels(labels) {
    if (!Array.isArray(labels) || labels.length === 0) return null;
    const validLabels = new Set(WHEEL_SEGMENT_CATALOG.map((s) => s.label));
    const unique = [...new Set(labels)].filter((l) => validLabels.has(l));
    if (unique.length !== WHEEL_CUSTOM_PICK_COUNT) return null;
    return unique;
  }

  _makePlayer(clientId, name) {
    return {
      clientId,
      name: (name || 'Oyuncu').slice(0, 24),
      socketId: null,
      connected: false,
      budget: STARTING_BUDGET,
      squad: [], // draft sırasında/sonrasında kazanılan oyuncular
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] Bu draftta çevirdiği (varsa) perk —
      // görünürlük "herkese açık" olarak kararlaştırıldı, bkz. toPublicState. `active` bazı
      // perk türlerinde (anti_snipe_shield/ceiling_reduction: draft boyunca sürekli; free_backup:
      // bir kereye mahsus tüketilene kadar) DraftEngine tarafından kontrol edilir; budget_bonus/
      // budget_penalty/gambler anında uygulanıp active:false olarak işaretlenir (bkz.
      // DraftEngine.applyPrepPerk). blind_first_round SADECE client-side tüketilir (self-imposed,
      // rakip için bir güvenlik sınırı değil — bkz. claude.md).
      prepPerk: null,
    };
  }

  joinRoom(code, clientId, name) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'ROOM_NOT_FOUND' };

    const existing = room.players.find((p) => p.clientId === clientId);
    if (existing) {
      this.clientRoomIndex.set(clientId, code);
      return { room, player: existing };
    }

    // [BUG DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Oyun ortasında yabancı biri odaya
    // katılabiliyor" — daha önce burada SADECE kapasiteye bakılıyordu, `room.status`'a hiç
    // bakılmıyordu. Draft başladıktan sonra (hatta maç sırasında/bittikten sonra bile) yeni bir
    // clientId odaya eklenebiliyordu; bu kişi draft motorunun aldığı snapshot'ta olmadığı için
    // hiçbir sıraya giremiyor, kadrosu hep 0 kalıyor — ama match:simulate'teki "herkes hazır mı"
    // eşiği `room.players.length`'a baktığı için gerçek oyuncular maçı SONSUZA KADAR
    // başlatamaz hale gelebiliyordu (kolayca istismar edilebilir bir kilitlenme). Var olan bir
    // oyuncunun geri katılması (yukarıdaki `existing` dalı — reconnect ile aynı davranış) bundan
    // ETKİLENMİYOR, sadece TAMAMEN YENİ bir clientId'nin katılması artık sadece LOBBY'de mümkün.
    if (room.status !== STATUS.LOBBY) return { error: 'ROOM_IN_PROGRESS' };

    if (room.players.length >= (room.maxPlayers || 2)) {
      return { error: 'ROOM_FULL' };
    }

    const player = this._makePlayer(clientId, name);
    room.players.push(player);
    room.updatedAt = Date.now();
    this.clientRoomIndex.set(clientId, code);
    return { room, player };
  }

  bindSocket(code, clientId, socketId) {
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = room.players.find((p) => p.clientId === clientId);
    if (!player) return null;
    player.socketId = socketId;
    player.connected = true;
    room.updatedAt = Date.now();
    return room;
  }

  handleDisconnect(socketId) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (player) {
        player.connected = false;
        player.socketId = null;
        // Bağlantısı kopan oyuncunun "hazırım" oyu geçersiz olsun — aksi halde diğer taraf
        // tek başına draftı/maçı başlatmış gibi görünen (aslında asla tetiklenmeyecek) bir
        // oy kalır ortada.
        room.readyVotes?.delete(player.clientId);
        // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Maç anlatımı hız/skip oy birliği (bkz.
        // matchSockets.js) — bağlantısı kopan oyuncunun eski oyu diğerlerini YANLIŞLIKLA
        // "herkes anlaştı" sandırmasın diye (ör. az önce 'fast' oyladı, koptu, kalanlar hâlâ onu
        // sayıp konsensüse ulaşmış gibi görünmesin) siliniyor — readyVotes ile aynı mantık.
        if (room.playbackSync) {
          delete room.playbackSync.speedVotes[player.clientId];
          room.playbackSync.skipVotes?.delete(player.clientId);
        }
        // [BUG DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Host bağlantısını kaybedip hiç geri
        // gelmezse oda sonsuza kadar kilitli kalıyor" — draftı SADECE host başlatabildiği için
        // (bkz. draftSockets.js draft:start ONLY_HOST_CAN_START) host'suz kalan bir oda,
        // 6 saatlik TTL temizliğine kadar diğer oyuncular için kullanılamaz hale geliyordu.
        // Host rolü, bağlantısı kopan kişi host'sa VE odada hâlâ bağlı başka bir oyuncu varsa,
        // katılım sırasındaki bir sonraki bağlı oyuncuya devredilir. Kasıtlı olarak GERİ
        // DÖNMÜYOR — eski host tekrar bağlansa bile host rolünü otomatik geri almaz (basit/
        // öngörülebilir kalsın, "host topu" ileri geri sıçramasın diye).
        if (room.hostClientId === player.clientId) {
          const nextHost = room.players.find((p) => p.clientId !== player.clientId && p.connected);
          if (nextHost) room.hostClientId = nextHost.clientId;
        }
        room.updatedAt = Date.now();
        return room;
      }
    }
    return null;
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  getRoomByClientId(clientId) {
    const code = this.clientRoomIndex.get(clientId);
    return code ? this.rooms.get(code) : null;
  }

  isRoomFull(room) {
    return room.players.length >= (room.maxPlayers || 2);
  }

  // [KULLANICI İSTEĞİ] "Maç bittikten sonra tekrar oyna butonu gelsin." — aynı oda kodu ve
  // aynı iki oyuncuyla, oda kodunu yeniden paylaşmaya gerek kalmadan sıfırdan bir draft
  // başlatılabilsin diye odayı LOBBY durumuna resetler (bütçe/kadro/draft/maç geçmişi silinir).
  resetForRematch(room) {
    room.status = STATUS.LOBBY;
    room.formation = null;
    room.draft = null;
    room.squads = {};
    room.matchState = null;
    room.playbackSync = null; // bkz. matchSockets.js — bir sonraki maçta sıfırdan oy birliği
    room.prepWheel = null; // bkz. DraftEngine — bir sonraki draftta hazırlık çarkı sıfırdan başlar
    room.readyVotes = new Set();
    room.updatedAt = Date.now();
    for (const p of room.players) {
      p.budget = STARTING_BUDGET;
      p.squad = [];
      p.prepPerk = null;
    }
    return room;
  }

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Kaç kişi gelirse gelsin" — sabit bir hedefe ulaşma
  // ŞARTI yok, sadece en az 2 kişi olması ve hepsinin o an bağlı olması yeterli (host ne zaman
  // başlatacağına kendisi karar verir, bkz. draftSockets.js `draft:start`).
  allConnected(room) {
    return room.players.length >= 2 && room.players.every((p) => p.connected);
  }

  isHost(room, clientId) {
    return room.hostClientId === clientId;
  }

  sweepStaleRooms() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      if (now - room.updatedAt > ROOM_TTL_MS) {
        for (const p of room.players) this.clientRoomIndex.delete(p.clientId);
        this.rooms.delete(code);
      }
    }
  }

  // Client'a görünecek güvenli/özet oda görünümü (Faz 3+ genişletilecek).
  toPublicState(room) {
    return {
      code: room.code,
      status: room.status,
      formation: room.formation,
      draftMode: room.draftMode || 'live',
      playerPool: room.playerPool || 'all',
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] Bekleme odasında/draft
      // başlığında "bu odanın çarkı host tarafından özelleştirildi" rozeti gösterebilmek için —
      // asıl segment listesi (bkz. yukarıdaki not) draft başlayınca zaten draft:update ile geliyor.
      wheelCustomized: !!room.wheelSegmentLabels,
      maxPlayers: room.maxPlayers || MAX_ROOM_PLAYERS,
      hostClientId: room.hostClientId,
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI]
      prepWheelEnabled: !!room.prepWheelEnabled,
      // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI, "TAM SÜRÜM"] Turn-based: `order`
      // (sabit sıra) + `cursor` (şu an kimin turu olduğu, order[cursor]) — bkz.
      // DraftEngine.openPrepWheelTurn. `order[0..cursor-1]` zaten karar vermiş (sonuçları
      // players[].prepPerk'te — skip edenlerde null, ama "index < cursor" ile "henüz sırası
      // gelmedi"den ayırt edilir).
      prepWheel: room.prepWheel
        ? { order: room.prepWheel.order, cursor: room.prepWheel.cursor, deadline: room.prepWheel.deadline }
        : null,
      // [KULLANICI İSTEĞİ] "Açık artırma/maç başlarken iki oyuncudan da onay al" — o anki
      // fazın "hazırım" oyları (draft başlangıcı ya da maç başlangıcı, faza göre değişir).
      readyVotes: [...(room.readyVotes || [])],
      players: room.players.map((p) => ({
        clientId: p.clientId,
        name: p.name,
        connected: p.connected,
        budget: p.budget,
        squadCount: p.squad.length,
        // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — HAZIRLIK ÇARKI] Görünürlük "herkese açık" —
        // kimin ne perk aldığı odadaki herkese gösterilir (bkz. üstteki not).
        prepPerk: p.prepPerk || null,
      })),
    };
  }
}

module.exports = { RoomManager, STATUS };
