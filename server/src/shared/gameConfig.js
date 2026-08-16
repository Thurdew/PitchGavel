// Oyun dengesi sabitleri. AUCTION-GAME-CLAUDE.md'de rakam olarak netleşmemiş noktalar
// ([AÇIK KARAR]) burada, dokümandaki önerilen varsayımlarla çözülüp tek yerde toplandı.

module.exports = {
  SQUAD_SIZE: 11,

  // Sanal bütçe birimi ("bütçe puanı") — gerçek para değildir, sadece oyun içi bir
  // dengeleme birimidir. 11 oyuncu alınacağı için ortalama harcama ~90-100 civarı olacak
  // şekilde ayarlandı.
  STARTING_BUDGET: 1000,

  // Bütçe güvenlik formülündeki "minimum oyuncu fiyatı" (bkz. doküman "Açık Arttırma
  // Sistemi"). Aynı zamanda [AÇIK KARAR, ÖNERİLEN VARSAYIM]: yedek oyuncu fiyatı da bu
  // değere eşit sabit ücret (dokümanın kendi örneği: "örn. minimum oyuncu fiyatı").
  MIN_PLAYER_PRICE: 10,
  BACKUP_PLAYER_PRICE: 10,

  // Bir teklifin bir önceki teklifi en az bu kadar geçmesi gerekir.
  MIN_RAISE: 5,

  // [AÇIK KARAR] Açık arttırma teklif süresi: dokümanda "15-20 saniye" öneriliyor, 18 sn seçildi.
  // Test ortamında turları hızlandırmak için DRAFT_AUCTION_SECONDS env değişkeniyle ezilebilir.
  AUCTION_DURATION_SECONDS: Number(process.env.DRAFT_AUCTION_SECONDS) || 18,

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Kör Draft modu: canlı açık arttırma yerine her iki
  // taraf da gizli/tek seferlik teklif verir (bkz. DraftEngine submitBlindBid/resolveBlindRound).
  // Rakibin tekliflerini canlı görmediği için canlı moddaki "anti-snipe" baskısı yok — bu yüzden
  // biraz daha uzun bir düşünme süresi verildi. Test ortamında DRAFT_BLIND_SECONDS ile ezilebilir.
  BLIND_BID_DURATION_SECONDS: Number(process.env.DRAFT_BLIND_SECONDS) || 20,

  // Ana oyuncudan sonra gösterilecek yedek oyuncunun reyting farkı (dokümanda "~5 reyting altı").
  BACKUP_RATING_GAP: 5,

  // [KULLANICI İSTEĞİ] Açık arttırmaya çıkan ANA oyuncu en az bu reytingde olsun — havuzda
  // bu eşiğin üzerinde aday kalmadığı (ör. LM/RM gibi sığ pozisyonlar, ya da draftın sonlarına
  // doğru üst segment tükenmişse) en yüksek reytingli adayla devam edilir (bkz. pool.js).
  MAIN_MIN_RATING: 80,

  // [KULLANICI İSTEĞİ] "Sadece 2 pozisyonda iki oyuncu arasındaki fark çok olsun, rastgele
  // bir şekilde" — draft başında formasyondaki benzersiz slot tiplerinden rastgele bu kadarı
  // "büyük fark" pozisyonu olarak işaretlenir (bkz. DraftEngine.startDraft).
  BIG_GAP_POSITIONS_COUNT: 2,

  // [KULLANICI İSTEĞİ, AYARLANDI] "Sürpriz oyuncu farkında da o kadar fark koyma" — ilk
  // sürümde 25'ti, kullanıcı geri bildirimiyle düşürüldü. MIN_BACKUP_RATING tabanıyla birlikte
  // çalışır (bkz. pool.js): gerçek fark bu değerden daha da küçük çıkabilir, taban asla ihlal
  // edilmez.
  BIG_GAP_RATING_GAP: 18,

  // [KULLANICI İSTEĞİ] "Icon oyuncu verdiğinde diğeri ortalama 10 rating altında olsun, çünkü
  // icon alamayan kişiye de iyi oyuncu gidiyor" — ana oyuncu icon ise yedek için hedeflenen gap
  // en az bu kadar olur (normal BACKUP_RATING_GAP=5'ten büyük — icon'un kaybedene neredeyse eş
  // değerde bir teselli ödülü olmasını önlemek için).
  ICON_BACKUP_RATING_GAP: 10,

  // [KULLANICI İSTEĞİ] "Kötü oyuncu en az 70 olsun" — yedek oyuncu, büyük fark / icon
  // pozisyonlarında bile mümkün olduğunca bu reytingin altına düşürülmez (bkz. pool.js).
  MIN_BACKUP_RATING: 70,

  // [KULLANICI İSTEĞİ, BUG FIX] "Sürekli aynı oyuncuları veriyor" — havuzda MAIN_MIN_RATING
  // üzerinde aday kalmadığında (sığ pozisyonlar), tek bir deterministik en-iyiyi vermek yerine
  // en yüksek reytingli bu kadar aday arasından rastgele seçilir (bkz. pool.js).
  TOP_FALLBACK_POOL_SIZE: 5,

  // [AÇIK KARAR] Ev sahibi avantajı: dokümanda "%5-10" öneriliyor, %8 seçildi.
  HOME_ADVANTAGE_BONUS: 0.08,

  // Poisson tabanlı xG hesabında kullanılan taban gol katsayısı (kalibrasyon sabiti).
  // "Ortalama" (~55 reyting) iki takım karşılaşınca maç başı ~1.3 gol beklentisi olacak
  // şekilde ayarlandı (gerçekçi bir futbol maçı ortalamasına yakın).
  BASE_GOAL_RATE: 1.8,

  // Orta sahanın hücum gücüne katkı ağırlığı (doküman: "ağırlıklı Orta Saha").
  MIDFIELD_ATTACK_WEIGHT: 0.5,

  // xG formülündeki normalizasyon çapası: "ortalama" bir reyting (~55-60) civarı, hücum
  // gücü / defans gücü oranının 1'e yakın çıkması için kalibrasyon sabiti.
  REFERENCE_RATING: 55,

  // Kaleci kurtarış faktörü (açık oyun xG'sini düşüren çarpan) — reyting 1-99 aralığında
  // lineer enterpole edilir. En zayıf kaleci bile biraz etkili olsun, en iyi kaleci rakip
  // xG'sini belirgin şekilde düşürsün diye alt/üst sınır konuldu.
  GK_SAVE_FACTOR_MIN: 0.10,
  GK_SAVE_FACTOR_MAX: 0.45,

  // Penaltı atışları simülasyonu (bkz. "Maç Simülasyonu": eşitlik bozma). Aynı kaleci-reyting
  // mantığı, açık oyundan farklı (daha gerçekçi) bir kurtarış oranı aralığıyla yeniden kullanılır.
  PENALTY_SAVE_MIN: 0.08,
  PENALTY_SAVE_MAX: 0.30,

  // [KULLANICI İSTEĞİ] Maç anlatımı: skoru etkilemeyen, sadece atmosfer için üretilen
  // "gole gitmeyen pozisyon" (şut/kurtarış) event sayısı aralığı — bkz. match/narration.js.
  CHANCE_EVENT_COUNT_MIN: 3,
  CHANCE_EVENT_COUNT_MAX: 6,

  // [KULLANICI İSTEĞİ] "Kadro diziliminde agresif oyna/sakin oyna seçenekleri gelsin, buna
  // bağlı olarak kırmızı/sarı kart gelsin." — seçilen "oyun tarzı"na göre kırmızı kart
  // olasılığı ve sarı kart sayısı aralığı (bkz. match/cards.js).
  RED_CARD_RISK: { calm: 0.04, normal: 0.10, aggressive: 0.22 },
  YELLOW_CARD_COUNT: { calm: [0, 1], normal: [0, 2], aggressive: [1, 3] },

  // Kırmızı kart görüldüğünde (10 kişi kalma) o takımın maç gücüne uygulanan ceza oranı —
  // kaleci hariç tüm güç gruplarına uygulanır (bkz. simulate.js applyRedCardPenalty).
  RED_CARD_POWER_PENALTY: 0.16,

  // [KULLANICI İSTEĞİ] "Atak/dengeli/defansif oyna seçenekleri gelsin maçtan önce" — seçilen
  // taktiğe göre hücum/defans gücü arasında transfer edilen oran (bkz. simulate.js applyTactic).
  // 'balanced' (dengeli) hiçbir değişiklik yapmaz — bu, taktik seçmeyen/eski istemcilerle de
  // geriye dönük uyumluluğu garanti eder.
  TACTIC_SHIFT: 0.12,

  ROOM_TTL_MS: 6 * 60 * 60 * 1000, // 6 saat işlem görmeyen odalar temizlenir

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — "kaç kullanıcı oynayacağını lobide
  // sorma, kaç kişi gelirse gelsin" — host'a bir hedef sayı sorulmuyor, oda sadece bu sabit
  // tavana kadar (dokümandaki N ≤ 8 sınırı) katılım kabul eder; draftı ne zaman başlatacağına
  // (kaç kişiyle) host kendisi karar verir (bkz. RoomManager.createRoom, draftSockets.js).
  MAX_ROOM_PLAYERS: 8,
};
