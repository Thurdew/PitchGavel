# PitchGavel — Açık Artırmalı Kadro Kurma & Maç Simülasyonu

"Pitch" (saha) + "gavel" (müzayede çekici). Eski çalışma adı "Kadro Kur" — iç adlarda hâlâ geçebilir (`kadro-kur-server`, `kk_` önekleri). Bu dosya güncel kuralları ve mimari özeti tutar. **Kararların gerekçeleri, denenip vazgeçilen tasarımlar, bug kök nedenleri ve yamaların ayrıntıları: `docs/HISTORY.md`.** Arayüz dili: `design.md`.

## Çalışma Kuralları

Kullanıcı sürekli onay beklemeden ilerlenmesine tam yetki veriyor.

**Sormadan yap:** dosya/klasör işleri, paket kurulumu, `[AÇIK KARAR]` işaretli noktalarda önerilen varsayımla ilerleme (seçimi not et), kod stili/organizasyon, test, hata ayıklama.

**Dur ve sor:** gerçek para harcatan karar; geri döndürülemez/yıkıcı işlem (veri dosyası silme, ETL çıktısını sıfırdan ezme); spesifikasyonun hiç kapsamadığı yeni ürün/tasarım kararı; harici hesap açma veya üçüncü taraf ayar/izin değişikliği. Değer katacak bir fikrin varsa önerip görüş alabilirsin.

**Belgeleme:** Her anlamlı tur için `docs/HISTORY.md` sonuna ("## Sonraki Turlar") bir kayıt ekle (ne istendi, ne yapıldı, etkilenen dosyalar, nasıl doğrulandı). Bu dosyayı sadece güncel kural/mimari değiştiğinde güncelle ve **15.000 karakterin altında tut**.

## Oyun Akışı

1. Oda kurulur/katılınır (kısa oda kodu, `/?join=KOD` tıkla-katıl linki), 2-8 oyuncu (`MAX_ROOM_PLAYERS`). Herkes "hazırım" der, **sadece host** draftı başlatır. Host bağlantısı koparsa rol sıradaki bağlı oyuncuya geçer (geri dönmez). Oyun başladıktan sonra yeni kişi katılamaz (`ROOM_IN_PROGRESS`), eski oyuncu yeniden bağlanabilir.
2. Durum makinesi: `lobby → [prep_wheel →] draft → [trade →] squad_select → match → finished`.
3. Draft başında 5 sn geri sayım (`START_COUNTDOWN_MS`) ve formasyon kurası — herkes draftı AYNI formasyonla yapar (simetrik pozisyon ihtiyacı).
4. Draft sonrası kullanıcı kadrosuyla gerçekten kurulabilen formasyonlar arasından seçer (kurulamayanlar gösterilmez); ev ve deplasman maçı için ayrı ayrı.
5. Round-robin: her ikili ev + deplasman oynar. **Lig usulü:** her maç bağımsız 3/1/0 puan; aggregate sadece bilgi. Tablo O/G/B/M/A/Y/AV/P, sıralama puan → averaj → atılan gol; 1. şampiyon. Penaltı yok (`penalties.js` ileride kupa modu için duruyor).

## Draft Kuralları

- Kadro kesin 11. Formasyon havuzu `server/src/shared/football.js` `FORMATIONS` (4-4-2, 4-3-3, 3-5-2, 4-2-3-1, 5-3-2) — hiçbir yerde formasyon adı hardcode edilmez. Her formasyonda tam 1 GK.
- **Münhasır sahiplik:** satılan oyuncu o odada havuzdan düşer.
- **Bütçe güvenliği** (kişisel tavan, global değil): `maks teklif = kalan bütçe − (kalan slot − 1) × min oyuncu fiyatı`.
- Oyuncu havuzu (`room.playerPool`, draft modundan bağımsız): `all` veya `super-lig` (Süper Lig + sadece 9 Türk icon).

## Draft Modları (`room.draftMode`, oda ömrü boyunca sabit)

**Canlı açık artırma (`live`):** Sistem rastgele pozisyon getirir (nomination yok). Pozisyona ihtiyacı olan K kişi için 1 ana + K−1 yedek merdiveni (`pool.js pickMainAndLadder`). Ana oyuncu en az 80 (`MAIN_MIN_RATING`; aday yoksa en yükseği). Her draftta rastgele 2 pozisyon "büyük fark" (ana-yedek farkı 25, normalde ~5; `BIG_GAP_*`), istemci rozet gösterir.
- **Kaskad:** K kişilik tur K aşamadır: aşama 0'da herkes ana oyuncu için yarışır, kazanan çıkar, kalanlar sıradaki aday için TAZE açık artırmaya girer… son kalan son adayı `BACKUP_PLAYER_PRICE`'a rakipsiz alır (K−1 gerçek açık artırma). K=1 ise ana oyuncu düşük sabit fiyata gider, yedek gösterilmez.
- Anti-snipe: son 5 sn'de teklif gelirse +5 sn. Tur sonunda herkesin teklifini gösteren "Tur Sonucu" paneli (`ROUND_RESULT_DELAY_MS`, ~4 sn).
- Sadece turun katılımcıları teklif verebilir. Duraklatma tüm insan oyuncuların oyunu ister.

**Kör draft (`blind`):** Aynı reveal/kaskad/bütçe mantığı; gizli tek teklif, first-price, anti-snipe yok, `BLIND_BID_DURATION_SECONDS` (20). Sunucu teklif miktarlarını tur bitene kadar asla yayınlamaz (sadece kim kilitledi). Herkes kilitlerse erken çözülür. Eşitlikte önce gönderen, o da eşitse rastgele kazanır.

**Çark modu (`wheel`):** Bütçe yok, tamamen ücretsiz (bütçe arayüzde gizli). Tek kişilik turlar, sabit karışık sıra (`wheelOrder`/`wheelCursor`); sıradaki kişi kendi eksik slotlarından biri için çevirir. Çark draft başında `buildWheelSegments` ile kurulur: katalog `WHEEL_SEGMENT_CATALOG` (7 reyting bandı + 8 özel: icon, steal, league, nation, club, forced_worst, give_best, respin); iyi/orta/kötü havuzlarından dengeli 9 dilim ya da host'un oda kurarken seçtiği tam 10 dilim (`WHEEL_CUSTOM_PICK_COUNT`; geçersizse sessizce dengeliye düşer); son adımda karıştırılır. Sonuç sunucuda belirlenir. **Pity:** art arda 'kötü' gelen oyuncunun sonraki çevirmesinde 'iyi' dilim ağırlığı artar (`WHEEL_PITY_*`). Uygulanamayan segment (verilecek/çalınacak oyuncu yok, havuz boş) asla daha iyi bir ödüle dönüşmez → `triggerRespin`. "Bilgisayar Seçsin" (`draft:wheelAutoPick`) ve süre dolunca otomatik çevir/seç vardır; draft asla kilitlenmez.

**Hazırlık Çarkı** (sadece live/blind, host açar): draft öncesi sırayla her oyuncu çevirir ya da risksiz geçer; sonuçlar herkese açık. Süre dolarsa otomatik geçer, asla otomatik çevrilmez. Perk'ler `PREP_WHEEL_SEGMENTS`: bütçe ±, anti-snipe kalkanı, kumarbaz, tavan düşüşü, kör ilk tur, joker (ilk turda rekabetsiz 0₺), gözcü (kör draftta teklifleri bir kez görme). Sonuç sunucuda anında çözülür, istemci animasyon bitene kadar gizler (`isPrepWheelSpinActive`).

**Takas Turu** (her modda, host açar, draft sonrası): 1↔1 + karşılıklı onay, para yok, kaleci takas edilemez, takas sonrası iki kadro da en az bir formasyon kurabilmeli, aynı ikili en fazla 2 takas, 5 dk ya da herkes "bitti". Teklifler sadece iki tarafa, tamamlananlar herkese görünür. `server/src/trade/TradeEngine.js`.

## Maç Simülasyonu

- 4 grup gücü: FW, MF, DF, GK. `xG_A = baz × (Hücum_A + ağırlıklı OS_A) / Defans_B × (1 − kaleci_B kurtarış faktörü)` — kaleci çarpımsal, güçlü kaleci zayıf takımı taşıyabilir. Skor xG etrafında Poisson. Ev sahibinin hücumuna küçük bonus.
- Skor sunucuda kesinleşir; `narration.js` dakika bazlı olay akışı üretir, istemci oynatır (gerilim satırı, zaman çizelgesi). Yavaş/Hızlı ve "Sonuca Geç" **insanların oy birliğini** ister (`room.playbackSync`). Çok maçlı anlatımda maç sırası karışıktır (`buildMatchOrder`). Oynatma gerçek zamana çıpalıdır (arka plan sekmesi geride kalmaz).
- Sonuçlar `shared_results`'a yazılır, `/sonuc/:id` paylaşım sayfası (noindex, OG sunucuda yazılır).
- **[AÇIK KARAR]** "Kontra" taktiği dengeli rakibe karşı her zaman en yüksek beklenen puanı veriyor (bot hep onu seçiyor) — taktik dengesi ele alınmalı.

## Bilgisayara Karşı (Bot)

Lobide ayrı kart, üç modda çalışır; prep wheel ve takas kapalı; coin vermez; zorluk yok. Bot `isBot` işaretli normal oyuncudur; `server/src/bot/BotController.js` (300 ms tik) motor fonksiyonlarını doğrudan çağırır, kararlar `BotBrain.js`'te. Hazır/oy eşikleri sadece insanları sayar (`RoomManager.humanPlayers`/`allHumansIn`). Host bota geçmez.

## Veri ve Reytingler

- Aktif havuz: 6 lig (Süper Lig + PL, La Liga, Bundesliga, Serie A, Ligue 1), ~3261 oyuncu, `server/data/processed/players.json`. Runtime'da canlı API çağrısı yok.
- **Aktif oyuncuların reytingleri, kulüpleri ve havuzun kendisi EA FC27'den** (`fetchFc27Ratings.js` → `applyFc27.js`, kaynak fcratings.com ham HTML, `ratingOverrideSource: 'fc27-2026-27'`). "EA verisi kullanma" politikası **kullanıcı tarafından bilinçli olarak geri alındı.** Güncelleme: `node src/etl/fetchFc27Ratings.js` → `node src/etl/applyFc27.js --dry-run` → `node src/etl/applyFc27.js`.
- `run.js` (tam ETL; ham Transfermarkt CSV'leri gerekir, bu ortamda yok) hâlâ FC26 dosyalarını ve kendi formülünü (piyasa değeri + performans + lig gücü + turnuva/kulüp bonusları, v1-v13 — bkz. HISTORY) kullanır; çalıştırılırsa ardından `applyFc27.js` de çalıştırılmalı. Takma ad tabloları `run.js` ile `reapplyFc26Overrides.js` arasında senkron tutulmalı.
- **38 icon** (9 Türk + 29 dünya; liste HISTORY'de): Wikidata ödül/başarı verisinden kendi "efsane skorumuz"; taban `ICON_RATING_FLOOR` 80, tavan 99. Pozisyon `SUB_POSITION_TO_SLOT` ile slot koduna map'lenir.
- Robots.txt yasakları ve bot korumaları asla bypass edilmez (Mackolik, FBref). Veri yoksa fabrikasyon/tahmin yapılmaz.

## Hesaplar, Ekonomi, Kozmetik

- **Hesap isteğe bağlı**; misafir akışı (anonim `clientId`) değişmez. E-posta+parola (scrypt), `kk_session` cookie (HttpOnly, SameSite=Lax, prod'da Secure), 30 gün. Login/register/resend/şifre sıfırlama rate limiter'ları el yapımı `Map` sayaçları. Enumeration koruması (aynı hata/aynı yanıt). Güvenlik header'ları var; CSP yok (GTM yüzünden, bilinçli).
- E-posta doğrulama ve parola sıfırlama: Resend (`RESEND_API_KEY`, `EMAIL_FROM=PitchGavel <noreply@pitchgavel.com>`, domain doğrulanmış); key yoksa dev modda link konsola yazılır. Doğrulama linki o tarayıcıda giriş de yaptırır. Sıfırlama token'ı DB'de SHA-256 hash, 1 saat, tek kullanım, tüm oturumları kapatır.
- **DB:** `server/src/db/adapter.js` — `TURSO_DATABASE_URL` varsa Turso (`@libsql/client/web`), yoksa yerel `node:sqlite` (`server/data/pitchgavel.sqlite`, gitignored). Tüm erişim async; yarışlar koşullu `UPDATE ... WHERE` ile kapatılır. Şema `initSchema`, yeni kolonlar guard'lı `ALTER`. Foreign key CASCADE'e güvenilmez.
- **Günlük ödül:** günde 1 ücretsiz çevirme (reklam stub'ı kaldırıldı); dilimler prep wheel'in 'iyi' perk'leri (`perk_grants`'te birikir) + coin dilimleri (50/100/250, `DAILY_REWARD_COIN_SEGMENTS`; anında bakiyeye, maç tavanına sayılmaz). Host açtıysa (`bankedPerksEnabled`, prep wheel şart) hazırlık çarkı turunda HTTP `POST /api/rewards/redeemInRoom` ile harcanır.
- **Hızlı Eşleş:** 2 kişilik, `draftMode:playerPool` kuyruğu (çark modu yok); eşleşince oda kurulur, draft host onayı olmadan başlar; prep wheel/takas/envanter kapalı.
- **Arkadaşlar** (`friends/`): `friend_code` + `?ekle=KOD`, karşılıklı onay, engelleme. Presence bellekte (`presence:hello` biletle); oda kodu sadece katılınabilir lobide, sadece arkadaşa.
- **Görevler** (`shared/quests.js`, `quests/`): günlük/haftalık (UTC)/tek seferlik, header paneli + Topla. Sadece coin kurallarına göre geçerli maçlar sayılır (`awardRoomResult` `events`); ilerleme anlatım bitince çekilir (spoiler).
- **Coin** sadece kozmetik içindir. Galibiyet 100 / beraberlik 40 / mağlubiyet 20, günün ilk galibiyeti +100, günlük tavan 500, aynı çift günde 3 ödüllü maç (`shared/economy.js COIN_REWARDS`). Şartlar: iki taraf da doğrulanmış farklı hesap (Gmail varyantları aynı sayılır), aynı IP'de sadece galibiyet, bota karşı yok. Hesap ↔ oda bağı: `POST /api/rooms/ticket` → tek kullanımlık bilet → socket `room:bindAccount`; takım/forma/kozmetik DB'den ve sahiplik süzgecinden geçer, istemciye güvenilmez. Ödül anlatım bitene kadar gösterilmez (spoiler).
- **Mağaza** (`/magaza`): premium formalar, kozmetikler (çerçeve, unvan, saha zemini, gol efekti, tribün sesi, satıldı damgası, çark kaplaması), tepki paketi. 4 emoji tepki ücretsiz, hız sınırlı. İleride parayla coin satılırsa: coin ile rastgele ödül satılmamalı, coin paraya çevrilmemeli.
- **Takım teması:** tuttuğun takım (17 Süper Lig takımı) sadece renk/desen; arma/logo/marş YOK, ücretli ürünler kulüp adı taşımaz. Forma oyunda maç anlatımının mini sahasında, dizilim ekranında ve maç sonucu sahalarında (oyuncu kartının köşesinde) görünür; üçü de `views.js matchKits` ile aynı çakışma kuralını kullanır, kaleci hep sarı. `client/public/teams.js` ve `server/src/shared/teams.js` id/forma listeleri **aynı kalmalı**. `resolveClash` renk mesafesi (`KIT_CLASH_DISTANCE`) kullanır — gelen yamalar bunu defalarca "aynı desen + aynı renk" haline geri aldı, korunmalı.
- **Yönetici:** `server/src/admin/grant.js` (sadece CLI, bilinçli olarak HTTP yok): `node src/admin/grant.js <e-posta> [--coins N] [--all] [--item id]`.

## Mimari

- Node.js + Express + Socket.io. Backend tüm oyun mantığını ve doğrulamayı yönetir; istemci (`client/public/` — `app.js` route/state, `views.js` ekranlar, `helpers.js`, `sfx.js`, `teams.js`, `cosmetics.js`, `styles.css`) sadece arayüzdür. Oda durumu bellekte (deploy anında aktif odalar kaybolur).
- Sunucu: `rooms/RoomManager.js`, `draft/{DraftEngine,pool}.js`, `match/{orchestrate,simulate,narration,story}.js`, `trade/`, `bot/`, `auth/`, `rewards/`, `coins/`, `matchmaking/`, `db/`, `sockets/*Sockets.js`, `shared/{gameConfig,football,economy,teams}.js`, `etl/`. Hata dönüş konvansiyonu `{ error: 'CODE' }`.
- Bağımlılıklar minimal (express, socket.io, csv-parse, @libsql/client). Yeni npm paketi eklemekten kaçın; `.env` el yapımı `loadEnv.js` ile okunur. Node ≥ 22.5 (`node:sqlite`).
- **Barındırma:** Oracle Cloud Always Free VM (Ubuntu 24.04, Frankfurt), Caddy (HTTPS) + systemd. Sırlar `/etc/pitchgavel.env`. Yayın elle: `deploy/oracle/update.sh`. Kurulum: `deploy/oracle/KURULUM.md`. Render artık kullanılmıyor.
- Bilinen sınır: oda kimliği istemcinin `clientId`'sine dayanır; bilen biri o oyuncunun yerine bağlanabilir (coin bağının devri engelli).

## Geliştirme Dersleri / Tuzaklar

- **Yamalar (zip):** "üzerine kopyala" talimatına körü körüne uyma. Önce `diff --strip-trailing-cr` ile karşılaştır; yamalar çoğu zaman eski koddan üretilmiştir ve yeni özellikleri (doğrulama duvarı, güvenlik sertleştirmesi, bot, `resolveClash` düzeltmesi…) siler. Sadece gerçekten yeni kısımları taşı.
- **CSS yorumları:** yorum içinde `*/` oluşturan bitişik yazım (ör. `.lineup-pitch*` ardından `/`) sonraki kuralları sessizce iptal eder. Ayırırken virgül/boşluk kullan; değişiklikten sonra `/*` ve `*/` sayılarını karşılaştır.
- **Dokunma:** `.pitch-*`, `.mini-pitch`, `.lineup-pitch*`, `.pitch-lineup-*` saha formatları (kullanıcı isteği); sadece bağlı renk token'ları değişebilir.
- `prefers-reduced-motion` kuralı `.wheel-disk`'i hariç tutar — çarkın dönüşü sonucun zamanlamasının parçası.
- `route()` DOM'u her state değişikliğinde sıfırdan kurar: odak korunması için input'lara `data-focus-key`; animasyon durumu render dışında (Map'lerde) tutulmalı; sayı input'ları `type="text" inputmode="numeric"`.
- Bir ekranı değiştirince o ekrana giden yolu en az bir kez uçtan uca dene (maç sonucu ekranı bir kez haftalarca boş kaldı).
- **Testler:** `server/test/phaseN-*.test.js`, her faz ayrı port, `npm test` hepsini `&&` ile zincirler. `phase8-prep-wheel` zincirde zamanlama yüzünden ara sıra düşer — tek başına geçiyorsa sonraki fazları ayrı ayrı çalıştır. Testlerde `RESEND_API_KEY=''` yap (silmek `.env`'deki gerçek anahtarı geri yükler). phase9/13 elle DDL tutar — şema değişince güncelle. Birim testinde gerçek `setTimeout` bırakma. İstemci kodu otomatik test kapsamında değil; tarayıcıda manuel ya da headless kontrol et.

## Gelecek Fikirleri

Efsaneler Modu (sadece 38 icon), Bütçe Şoku (draft ortası ±%10), Transfer Penceresi, Dynasty/Sezon, icon alt seviyeleri, gol anında konfeti/tribün sesi genişletmesi, reyting hikâyesi içerik sayfası (SEO), oturum tabanlı oyuncu kimliği.
