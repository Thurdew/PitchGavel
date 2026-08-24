// Oyun dengesi sabitleri. AUCTION-GAME-CLAUDE.md'de rakam olarak netleşmemiş noktalar
// ([AÇIK KARAR]) burada, dokümandaki önerilen varsayımlarla çözülüp tek yerde toplandı.

// Reyting bandı segmentleri — v1'deki WHEEL_SEGMENTS ile birebir aynı 7 bant, sadece artık her
// biri bir havuza (pool) etiketli. Ağırlıklar EŞİT DEĞİL (gerçek bir çarkın "büyük ödül dilimi
// küçük" hissi + 90+ havuzda zaten az aday olduğu için). module.exports'un DIŞINDA tanımlandı ki
// hem kendi anahtarına hem de aşağıdaki WHEEL_SEGMENT_CATALOG'a (bkz. "Çark Özelleştirme")
// bare identifier olarak referans verilebilsin — bir obje literal'i kendi property'sine ismiyle
// erişemiyor.
const WHEEL_RATING_BANDS = [
  { kind: 'rating', label: '90+', min: 90, max: 99, pool: 'iyi', weight: 4 },
  { kind: 'rating', label: '85-89', min: 85, max: 89, pool: 'iyi', weight: 9 },
  { kind: 'rating', label: '80-84', min: 80, max: 84, pool: 'orta', weight: 14 },
  { kind: 'rating', label: '75-79', min: 75, max: 79, pool: 'orta', weight: 18 },
  { kind: 'rating', label: '70-74', min: 70, max: 74, pool: 'orta', weight: 20 },
  { kind: 'rating', label: '65-69', min: 65, max: 69, pool: 'kötü', weight: 16 },
  // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "60 altı oyuncu geliyor ama ekranda 64'lük oyuncu
  // çıkıyor" — etiket "60 altı" ama gerçek sınır min:1/max:64'tü (65-69 bandıyla boşluk
  // kalmasın diye bilerek 64'e kadar genişletilmişti, ama etiket bu genişlemeyi yansıtmıyordu).
  // Etiket artık gerçek sınırla birebir eşleşiyor — sınırlar DEĞİŞMEDİ, sadece isim doğrulandı.
  { kind: 'rating', label: '64 ve altı', min: 1, max: 64, pool: 'kötü', weight: 10 },
];

// Özel aksiyon segmentleri — [KULLANICI İSTEĞİ] "rakipten istediğin oyuncuyu al, rakibine en iyi
// oyuncunu ver, ligden/milliyetten seç" örnekleri + kullanıcının "mantıklı bir şey düşünürsen
// ekle" daveti üzerine eklenen 2 ek fikir (icon havuzu, şanssız/en düşük reyting zorunlu).
// 'league'/'nation' segmentlerinin TAM lig/milliyet değeri sabit/hardcode DEĞİL — her
// çevrildiğinde o an havuzda kalan adaylar arasından rastgele seçilip round.revealValue'ya
// yazılır (bkz. DraftEngine.resolveSpin) — hem asla boş çıkmaz hem de tekrar tekrar farklı
// lig/milliyet gösterip çeşitliliği artırır. Havuzda gerçekten uygun aday kalmadıysa (steal:
// rakipte o pozisyon yok, icon: o pozisyonda icon kalmadı) segment sunucuda otomatik "genel
// havuzdan seç"e düşürülür — draft asla tıkanmaz (bkz. DraftEngine.resolveSpin fallback mantığı).
const WHEEL_SPECIAL_SEGMENTS = [
  { kind: 'icon', label: '⭐ Efsaneler Havuzu', pool: 'iyi', weight: 4 },
  { kind: 'steal', label: '🎁 Rakipten Çal', pool: 'iyi', weight: 5 },
  { kind: 'league', label: '🌍 Lig Piyangosu', pool: 'orta', weight: 10 },
  { kind: 'nation', label: '🏳️ Milliyet Piyangosu', pool: 'orta', weight: 10 },
  { kind: 'forced_worst', label: '💀 Şanssız Tur', pool: 'kötü', weight: 10 },
  { kind: 'give_best', label: '😱 En İyisini Ver', pool: 'kötü', weight: 8 },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Daha fazla çark özelliği gelsin." — league/nation
  // segmentiyle AYNI mekanizma (bkz. DraftEngine.resolveSpin/candidatesForSegment), sadece
  // alan `club` — o an havuzda kalan bir kulüp rastgele seçilip revealValue'ya yazılır, o
  // kulüpten (bu pozisyonda) uygun adaylar arasından seçim yapılır.
  { kind: 'club', label: '🏟️ Kulüp Piyangosu', pool: 'orta', weight: 8 },
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Şanslı Tekrar" — forced_worst/give_best gibi seçim
  // gerektirmeden otomatik uygulanan bir segment, ama sonucu bir oyuncu ATAMAK değil: turu
  // KAYBETMEDEN aynı kişiye/pozisyona TAZE bir çark daha vermek (bkz. DraftEngine
  // resolveAutoWheelOutcome 'respin' dalı) — round awaiting_spin'e sıfırlanır, oyuncu tekrar
  // çevirir. 'iyi' havuzda (kazanç hissi taşıyan bir sonuç) ve düşük ağırlıkta (nadir/heyecanlı
  // kalsın diye, icon/steal ile aynı seviye).
  { kind: 'respin', label: '🍀 Şanslı Tekrar', pool: 'iyi', weight: 4 },
];

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

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] "Taktik seçeneklerini ikiden fazlaya çıkaralım — zayıf
  // takıma gerçek bir strateji şansı vermiyor, sadece şansına küs ya da güven. 'Kontra' — kendi
  // Hücum/OrtaSaha gücünü biraz düşürüp karşılığında rakibin Hücum gücünü belli oranda kısan bir
  // taktik olsun." — Atak/Defansif (TACTIC_SHIFT) kendi güç grupları ARASINDA transfer yapan
  // "geniş/genel" taktiklerdi (defansif = kendi DF'ini büyütür, bu da defenseFactor üzerinden
  // rakibin xG'sini dolaylı düşürür — ama zayıf bir DF'in kendisi zaten zayıfsa bu pek işe
  // yaramaz). Kontra farklı bir kaldıraç kullanıyor: rakibin HÜCUM gücünü DOĞRUDAN kısıyor (bkz.
  // simulate.js simulateSingleMatch) — kendi savunmanın kalitesinden bağımsız, organize/disiplinli
  // bir kontra-pres bloğunun tasviri. Bu yüzden zayıf defansı olan bir kadro bile, kontra
  // seçtiğinde güçlü bir rakibin hücumunu gerçekten körelten bir avantaj elde ediyor — "şansa
  // küs/güven" yerine gerçek bir taktik tercihi. Bedeli: kendi hücum/orta saha gücünden bir kısmı
  // feragat ediliyor (COUNTER_OWN_ATTACK_PENALTY, orta sahada yarı oranda — kontra atakta orta
  // saha tamamen devre dışı kalmıyor, hızlı geçiş için hâlâ kullanılıyor).
  // [DÜZELTİLDİ — Monte Carlo ile ölçülüp ayarlandı] İlk denemede (0.10/0.15, sadece FW'ye
  // uygulanan opponent-penalty) etkisi istatistiksel gürültü seviyesindeydi (55 vs 75 rating
  // farkında zayıfın kazanma ihtimalini 20.000 denemede ~%19.0'dan ~%19.8'e, yani sadece 1 puan
  // taşıyordu) — "gerçek bir taktik şansı" hissi vermiyordu. Ölçülerek yükseltildi (bkz.
  // simulate.js applyCounterDefense — artık MF'yi de kısıyor, sadece FW'yi değil): aynı 55 vs 75
  // senaryosunda zayıfın kazanma ihtimalini ~%19.0'dan ~%24.6'ya (favorinin kazanma ihtimali
  // ~%57.2'den ~%46.4'e) çıkarıyor — gerçek, hissedilir bir taktik avantajı ama favoriyi alt üst
  // edecek kadar da değil (hâlâ favori olmaya devam ediyor).
  COUNTER_OWN_ATTACK_PENALTY: 0.08,
  COUNTER_OPPONENT_ATTACK_PENALTY: 0.28,

  ROOM_TTL_MS: 6 * 60 * 60 * 1000, // 6 saat işlem görmeyen odalar temizlenir

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çark Modu — üçüncü draftMode ('live'/'blind'den
  // bağımsız). [KULLANICI İSTEĞİ] bütçe bu modda HİÇ devreye girmiyor — tamamen ücretsiz,
  // şans+seçim temelli bir deneyim (mevcut açık arttırma modlarının ekonomi/pazarlık
  // gerginliğinden bilinçli olarak farklı).
  //
  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "Çarka animasyon ekle, döndüğü belli
  // olsun, daha güzel bir çark olsun, çıkan sonuç ekrana gelsin. Her oyunda çarktaki yazılanlar
  // değişsin. Çark havuzu yap, iyi/orta/kötü diye ayır, her oyun 3 havuzdan da belli miktarda
  // getir. Rakipten oyuncu al, rakibe en iyi oyuncunu ver, ligden/milliyetten seç gibi şeyler de
  // olsun. Herkes 11 olana kadar çevirmeye devam etsin — biri diğerinden çalarsa mağdur olan,
  // diğeri 11'i tamamlasa bile kendi 11'ine ulaşana kadar çevirmeye devam etsin." — eski v1
  // (tek düz WHEEL_SEGMENTS listesi + pozisyon bazlı SENKRON round) tamamen bırakıldı:
  //
  // 1) Segmentler artık İKİ havuzdan geliyor: reyting bantları (WHEEL_RATING_BANDS) + özel
  //    aksiyon segmentleri (WHEEL_SPECIAL_SEGMENTS) — HER İKİSİ de 'iyi'/'orta'/'kötü' etiketi
  //    taşıyor. Draft başında (bkz. pool.js buildWheelSegments) HER havuzdan rastgele
  //    WHEEL_POOL_PICK_COUNT kadarı seçilip o draftın ÇARKINI oluşturuyor — bu yüzden hangi
  //    yazıların çarkta olduğu (ve kaçının iyi/orta/kötü olduğu karışımı) her draftta değişiyor,
  //    ama üç havuzdan da mutlaka bir şeyler geliyor (dengeli bir çark garantisi).
  // 2) Tur yapısı artık pozisyon bazlı SENKRON değil — her katılımcı SIRAYLA (round-robin,
  //    bkz. DraftEngine.nextWheelTurn) kendi turunda kendi ihtiyaç duyduğu bir pozisyon için
  //    çevirir. Çalma/verme segmentleri bir başka katılımcının kadrosunu değiştirebildiği için
  //    (bkz. aşağıdaki özel segmentler) artık "herkes aynı anda aynı pozisyonu doldursun" diye
  //    bir varsayım YOK; her katılımcı kendi 11'i tamamlanana kadar (slotsNeeded toplamı 0
  //    olana kadar) sıraya girmeye devam ediyor.
  WHEEL_POOL_PICK_COUNT: 3,

  WHEEL_RATING_BANDS,
  WHEEL_SPECIAL_SEGMENTS,

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK ÖZELLEŞTİRME] "10 zorunlu seçim olacak, hepsini
  // iyi/kötü/karışık seçmek kullanıcının bileceği iş, bir havuz olacak, kullanıcının tıkladıkları
  // çarkta olacak, seçmek istemezse bilgisayar dengeli bir şekilde atar." — host oda kurarken bu
  // 13 olası segmentin (7 reyting bandı + 6 özel aksiyon) TAM WHEEL_CUSTOM_PICK_COUNT tanesini
  // serbestçe (istediği kombinasyonda, pool zorunluluğu YOK) işaretleyebilir; hiç işaretlemezse
  // (bkz. RoomManager.createRoom/pool.js buildWheelSegments) eski dengeli-rastgele (her pooldan
  // WHEEL_POOL_PICK_COUNT) davranış aynen sürer. Katalog `label` alanına göre benzersiz — hem
  // istemcinin checklist'i hem sunucunun doğrulaması bu alanı anahtar olarak kullanıyor.
  WHEEL_SEGMENT_CATALOG: [...WHEEL_RATING_BANDS, ...WHEEL_SPECIAL_SEGMENTS],
  WHEEL_CUSTOM_PICK_COUNT: 10,

  // Çark çevrildikten sonra oyuncu seçme ekranında karar vermek için süre (bkz.
  // AUCTION_DURATION_SECONDS/BLIND_BID_DURATION_SECONDS ile aynı desen). Süre dolarsa o
  // bantta/pozisyonda uygun rastgele bir oyuncu otomatik atanır (draftın tıkanmaması için).
  WHEEL_PICK_DURATION_SECONDS: Number(process.env.DRAFT_WHEEL_SECONDS) || 20,

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI — ÇARK MODU v2] "forced_worst"/"give_best" gibi seçim
  // gerektirmeyen (otomatik uygulanan) segmentlerin, istemcideki çark döndürme animasyonu
  // bitmeden sonucu açığa çıkarmaması için kısa bir gecikme.
  // [DÜZELTİLDİ — KULLANICI GERİ BİLDİRİMİ] "Şanssız tur gelince ekran çok hızlı geçiyor, bir
  // anda bir oyuncu veriyor geçiyor" — kök neden: istemcideki çark animasyonu+reveal ~3350ms
  // sürüyor (bkz. views.js WHEEL_REVEAL_DELAY_MS = WHEEL_SPIN_DURATION_MS + 150) ama bu değer
  // 2800ms'ydi — sunucu, istemcinin animasyonu GÖSTERMEYİ bitirmeden turu çözüp "Tur Sonucu"
  // paneline geçiriyordu (round null olunca renderWheelRound yerine anında sonuç ekranı
  // render ediliyor — bkz. app.js RESOLVED_EVENT_TYPES). Artık istemcinin reveal anından
  // (3350ms) belirgin şekilde SONRA tetikleniyor — kullanıcı önce "⚡ ... sonuç uygulanıyor!"
  // bandını bir süre görüyor, sonra sonuç paneline geçiyor.
  WHEEL_AUTO_RESOLVE_DELAY_MS: Number(process.env.DRAFT_WHEEL_AUTO_RESOLVE_MS) || 4200,

  // [KULLANICI İSTEĞİ, KARARLAŞTIRILDI] Çok Oyunculu Mod — "kaç kullanıcı oynayacağını lobide
  // sorma, kaç kişi gelirse gelsin" — host'a bir hedef sayı sorulmuyor, oda sadece bu sabit
  // tavana kadar (dokümandaki N ≤ 8 sınırı) katılım kabul eder; draftı ne zaman başlatacağına
  // (kaç kişiyle) host kendisi karar verir (bkz. RoomManager.createRoom, draftSockets.js).
  MAX_ROOM_PLAYERS: 8,
};
