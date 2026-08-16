// Oyunun pozisyon/formasyon domain modeli — ETL, draft motoru ve maç simülasyonu
// tarafından ortak kullanılır (tek doğruluk kaynağı).

// Formasyon slotlarında kullanılan kısa pozisyon kodları.
const SLOTS = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'RW', 'ST'];

// Bir slotun ait olduğu güç grubu (maç simülasyonunda Hücum/Orta Saha/Defans/Kaleci).
const SLOT_GROUP = {
  GK: 'GK',
  CB: 'DF', LB: 'DF', RB: 'DF',
  DM: 'MF', CM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF',
  LW: 'FW', RW: 'FW', ST: 'FW',
};

// Transfermarkt sub_position alanı -> bizim slot kodumuz.
const SUB_POSITION_TO_SLOT = {
  'Goalkeeper': 'GK',
  'Centre-Back': 'CB',
  'Left-Back': 'LB',
  'Right-Back': 'RB',
  'Defensive Midfield': 'DM',
  'Central Midfield': 'CM',
  'Attacking Midfield': 'AM',
  'Left Midfield': 'LM',
  'Right Midfield': 'RM',
  'Left Winger': 'LW',
  'Right Winger': 'RW',
  'Centre-Forward': 'ST',
  'Second Striker': 'ST',
};

// sub_position eksikse geniş position alanından kaba bir slot türet.
const POSITION_TO_SLOT_FALLBACK = {
  Goalkeeper: 'GK',
  Defender: 'CB',
  Midfield: 'CM',
  Attack: 'ST',
};

// Pozisyon uygunluk matrisi (ikincil pozisyon verisi Transfermarkt/Wikipedia'da tutarsız
// olduğundan gerçek futbol taktik mantığına dayalı bir heuristikle türetildi — bkz.
// AUCTION-GAME-CLAUDE.md "Çoklu pozisyon verisi" notu: "Bazı oyuncularda bu veri eksik/
// tutarsız olabilir". Her slot için birincil (kendi sub_position'ı) + makul ikincil
// slotlar tanımlanır. Ünlü oyuncular için gerçek çoklu-pozisyon bilgisi
// MANUAL_POSITION_OVERRIDES ile üzerine yazılabilir (bkz. manualPositionOverrides.js).
const SECONDARY_SLOTS = {
  GK: [],
  CB: ['DM'],
  LB: ['LM', 'LW'],
  RB: ['RM', 'RW'],
  DM: ['CM', 'CB'],
  CM: ['DM', 'AM'],
  AM: ['CM', 'LW', 'RW', 'ST'],
  LM: ['LB', 'LW'],
  RM: ['RB', 'RW'],
  LW: ['LM', 'RW', 'ST', 'AM'],
  RW: ['RM', 'LW', 'ST', 'AM'],
  ST: ['AM'],
};

// Formasyon havuzu (bkz. AUCTION-GAME-CLAUDE.md "Kadro / Draft Kuralları" ve "Genişleme Yol
// Haritası" — [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] 4-2-3-1 ve 5-3-2 eklendi). Draft kurası ve
// dizilim (lineup) motoru tamamen bu objenin ANAHTARLARINA göre çalışıyor (bkz. DraftEngine.
// startDraft, lineup.js buildableFormations) — yeni bir formasyon eklemek/çıkarmak için tek
// dokunulacak yer burası, başka hiçbir dosyada formasyon adı hardcode edilmiyor.
const FORMATIONS = {
  '4-4-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'],
  '4-3-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'LW', 'ST', 'RW'],
  '3-5-2': ['GK', 'CB', 'CB', 'CB', 'LM', 'CM', 'CM', 'CM', 'RM', 'ST', 'ST'],
  // Çift altılık (DM, DM) + tek santrafor önünde üçlü bant (LW-AM-RW) — modern taktik futbolun
  // en yaygın kalıplarından biri, mevcut 4-3-3'ten farklı bir orta saha/hücum dengesi sunuyor.
  '4-2-3-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'DM', 'LW', 'AM', 'RW', 'ST'],
  // Beşli defans (LB-CB-CB-CB-RB, bek'ler kanat kadar yüksek oynar) + saf üçlü orta saha +
  // ikili forvet — 3-5-2'nin "geniş kanat yok, defansta bir fazla adam var" versiyonu.
  '5-3-2': ['GK', 'LB', 'CB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CM', 'ST', 'ST'],
};

function slotToGroup(slot) {
  return SLOT_GROUP[slot] || 'MF';
}

// Bir oyuncunun (primarySlot bazlı) hangi slotlarda oynayabileceğini döndürür.
// fit: 'primary' (kendi pozisyonu) veya 'secondary' (uygunluk matrisinden).
function eligibleSlotsFor(primarySlot, manualSecondary) {
  const primary = { slot: primarySlot, fit: 'primary' };
  const secondarySet = new Set(manualSecondary && manualSecondary.length ? manualSecondary : (SECONDARY_SLOTS[primarySlot] || []));
  secondarySet.delete(primarySlot);
  const secondary = [...secondarySet].map((slot) => ({ slot, fit: 'secondary' }));
  return [primary, ...secondary];
}

module.exports = {
  SLOTS,
  SLOT_GROUP,
  SUB_POSITION_TO_SLOT,
  POSITION_TO_SLOT_FALLBACK,
  SECONDARY_SLOTS,
  FORMATIONS,
  slotToGroup,
  eligibleSlotsFor,
};
