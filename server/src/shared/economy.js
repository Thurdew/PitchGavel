// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — OYUN İÇİ PARA (COIN)] Maç ödülleri + mağaza fiyatları.
// Coin'ler SADECE kozmetik (forma vb.) almak için — perk'lere/oyun dengesine etkisi yok (ileride
// gerçek parayla satılınca "parayla kazanılıyor" algısı olmasın diye). Rakamlar kullanıcıyla
// kararlaştırıldı; ayarlamak için tek yer burası.
const COIN_REWARDS = {
  win: 100,
  draw: 40,
  loss: 20,
  firstWinBonus: 100, // günün ilk ödüllü galibiyetine ek
  dailyCap: 500, // hesap başına günlük maç kazancı tavanı (bonus dahil)
  pairDailyLimit: 3, // aynı iki hesap arasında günde en fazla bu kadar ödüllü maç
};

// Mağaza kataloğu. `kitId` = client/public/teams.js KIT_VARIANTS id'si; premium formalar
// (bkz. shared/teams.js PREMIUM_KIT_IDS) sahiplik gerektirir. Forma takıma bağlı değil — bir kez
// alınan "Retro Çizgili" tuttuğun takım değişse de o takımın renklerinde giyilir.
const KIT_ITEMS = [
  { id: 'kit:plain', type: 'kit', kitId: 'plain', price: 500 },
  { id: 'kit:retro', type: 'kit', kitId: 'retro', price: 750 },
  { id: 'kit:sash', type: 'kit', kitId: 'sash', price: 750 },
  { id: 'kit:night', type: 'kit', kitId: 'night', price: 1000 },
  // [MAĞAZA v3]
  { id: 'kit:band', type: 'kit', kitId: 'band', price: 600 },
  { id: 'kit:fade', type: 'kit', kitId: 'fade', price: 650 },
  { id: 'kit:quarters', type: 'kit', kitId: 'quarters', price: 800 },
  { id: 'kit:checker', type: 'kit', kitId: 'checker', price: 850 },
  { id: 'kit:chevron', type: 'kit', kitId: 'chevron', price: 800 },
  { id: 'kit:retro70', type: 'kit', kitId: 'retro70', price: 900 },
  { id: 'kit:retro90', type: 'kit', kitId: 'retro90', price: 900 },
  { id: 'kit:vintage', type: 'kit', kitId: 'vintage', price: 1000 },
  { id: 'kit:laceup', type: 'kit', kitId: 'laceup', price: 1200 },
  { id: 'kit:gold', type: 'kit', kitId: 'gold', price: 1500 },
];

// [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — MAĞAZA v2] Kozmetikler. Her `type` bir "slot"tur; kullanıcı
// her slota sahip olduğu tek bir ürünü takar (users.cosmetics JSON: { frame: 'gold', ... }).
// Slot boşsa (null) varsayılan, ücretsiz görünüm kullanılır. Takım adı/logosu HİÇBİR üründe yok.
// Kim görür:
//   frame, title  → herkes (bekleme odası, hesap kartı)
//   pitch         → maçta EV SAHİBİNİN seçimi, iki tarafa da
//   goalfx, crowd → golü atan tarafın seçimi, herkese
//   stamp         → açık arttırmayı kazananın seçimi, herkese
//   wheel         → çarkı çeviren kişinin seçimi, herkese (dilim renkleri/yazıları değişmez)
// `reactions` bir slot değil — paket sahipliği o paketteki tepkileri açar.
const COSMETIC_SLOTS = ['frame', 'title', 'pitch', 'goalfx', 'crowd', 'stamp', 'wheel'];
const COSMETIC_ITEMS = [
  { id: 'frame:claw', type: 'frame', key: 'claw', price: 900 },
  { id: 'frame:gold', type: 'frame', key: 'gold', price: 1200 },
  { id: 'frame:neon', type: 'frame', key: 'neon', price: 800 },
  { id: 'frame:chalk', type: 'frame', key: 'chalk', price: 600 },
  { id: 'frame:lights', type: 'frame', key: 'lights', price: 700 },
  { id: 'frame:carbon', type: 'frame', key: 'carbon', price: 500 },

  { id: 'title:king', type: 'title', key: 'king', price: 500 },
  { id: 'title:haggler', type: 'title', key: 'haggler', price: 500 },
  { id: 'title:lastsec', type: 'title', key: 'lastsec', price: 400 },
  { id: 'title:wheelmaster', type: 'title', key: 'wheelmaster', price: 400 },
  { id: 'title:vault', type: 'title', key: 'vault', price: 300 },

  { id: 'pitch:night', type: 'pitch', key: 'night', price: 900 },
  { id: 'pitch:snow', type: 'pitch', key: 'snow', price: 800 },
  { id: 'pitch:retro', type: 'pitch', key: 'retro', price: 800 },
  // [MAĞAZA v3]
  { id: 'pitch:mowed', type: 'pitch', key: 'mowed', price: 600 },
  { id: 'pitch:sunset', type: 'pitch', key: 'sunset', price: 850 },
  { id: 'pitch:rain', type: 'pitch', key: 'rain', price: 850 },
  { id: 'pitch:beach', type: 'pitch', key: 'beach', price: 900 },
  { id: 'pitch:film70', type: 'pitch', key: 'film70', price: 900 },
  { id: 'pitch:arcade', type: 'pitch', key: 'arcade', price: 1000 },
  { id: 'pitch:neon', type: 'pitch', key: 'neon', price: 1100 },

  { id: 'goalfx:teamconfetti', type: 'goalfx', key: 'teamconfetti', price: 750 },
  { id: 'goalfx:flash', type: 'goalfx', key: 'flash', price: 1000 },
  { id: 'goalfx:stars', type: 'goalfx', key: 'stars', price: 1500 },

  { id: 'crowd:drum', type: 'crowd', key: 'drum', price: 750 },
  { id: 'crowd:roar', type: 'crowd', key: 'roar', price: 750 },
  { id: 'crowd:horn', type: 'crowd', key: 'horn', price: 750 },

  { id: 'stamp:gold', type: 'stamp', key: 'gold', price: 600 },
  { id: 'stamp:seal', type: 'stamp', key: 'seal', price: 700 },

  { id: 'wheel:casino', type: 'wheel', key: 'casino', price: 700 },
  { id: 'wheel:neon', type: 'wheel', key: 'neon', price: 800 },

  { id: 'reactions:market', type: 'reactions', key: 'market', price: 400 },
];

// Draft/takas sırasında gönderilebilen tepkiler. `pack: null` = herkese ücretsiz.
const REACTIONS = {
  fire: { pack: null }, laugh: { pack: null }, clap: { pack: null }, grimace: { pack: null },
  robbery: { pack: 'reactions:market' }, goodbuy: { pack: 'reactions:market' },
  waste: { pack: 'reactions:market' }, comeon: { pack: 'reactions:market' },
};
// Spam koruması: en fazla 3 tepki birikebilir, her 5 saniyede 1 yenilenir.
const REACTION_LIMIT = { burst: 3, refillMs: 5000 };

const STORE_ITEMS = [...KIT_ITEMS, ...COSMETIC_ITEMS];
const STORE_ITEM_BY_ID = new Map(STORE_ITEMS.map((i) => [i.id, i]));

function isValidCosmetic(slot, key) {
  if (!COSMETIC_SLOTS.includes(slot)) return false;
  if (key == null) return true;
  return STORE_ITEM_BY_ID.has(`${slot}:${key}`);
}

module.exports = { COIN_REWARDS, STORE_ITEMS, STORE_ITEM_BY_ID, COSMETIC_SLOTS, COSMETIC_ITEMS, REACTIONS, REACTION_LIMIT, isValidCosmetic };
