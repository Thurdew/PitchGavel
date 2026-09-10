# Tasarım Dili — PitchGavel

Bu doküman, arayüzün "tipik yapay zeka tarafından üretilmiş" görünümünden kaçınıp oyunun kendi kimliğine sahip olması için var. Claude Code, UI implementasyonunda bu dosyayı referans almalı; kararsız kaldığı her noktada "bu jenerik mi duruyor, yoksa gerçekten bu oyuna mı ait" sorusunu sormalı.

## Neden Bu Doküman Var

Yapay zekayla üretilen arayüzler zamanla tanınır bir "imza" bırakıyor — belirli renk tonları, belirli köşe yuvarlaklıkları, belirli düzen kalıpları. Bu oyun bir açık arttırma + canlı maç heyecanı üzerine kurulu; arayüzün de bunu hissettirmesi gerekiyor, jenerik bir SaaS panosu gibi değil.

## Kaçınılması Gerekenler (Klasik "AI Tasarımı" İşaretleri)

- Mor/eflatun/indigo ağırlıklı gradyanlar — Claude'un kendi marka kimliğinin arayüze sızmış hali gibi durur, bu oyunla hiçbir ilgisi yok.
- Her elemana aynı büyük köşe yuvarlaklığı (`rounded-2xl` her yerde) — köşe yarıçapı bir tasarım kararı olmalı, varsayılan alışkanlık değil.
- Varsayılan Inter/system-ui fontu — karaktersiz, herhangi bir üründe olabilir, bu oyuna ait bir "ses" taşımıyor.
- Ortalanmış, simetrik "hero" bölümü + arka planda soluk/bulanık gradyan lekeler — bu düzeni gören herkes "AI ile yapılmış" diyor artık.
- Hap (pill) şeklinde butonlar, her kartta aynı yumuşak gölge — düz, kişiliksiz.
- Genel "bento grid" kart mozaiği — her ürün için kullanılan, bu ürüne özgü olmayan bir kalıp.
- Cam efekti (glassmorphism) her yüzeyde — aşırı kullanılınca ucuzlaştırıyor.
- Başlıklarda gradyan metin efekti.
- Aşırı beyaz alan + kişiliksiz minimalizm ("temiz" ile "karaktersiz" farklı şeyler).

## Bunun Yerine: Oyunun Kendi Kimliği

Referans noktası şu üçü olmalı: **canlı spor yayını grafikleri** (transfer deadline day ekranları, skorbord estetiği), **açık arttırma salonu gerilimi** (yükselen teklif, geri sayım, kazananın ilan edilme anı) ve **stadyum/saha ışığı** dokusu. Jenerik bir "web app" değil, ekrana "maç günü" hissi vermesi gereken bir ürün.

## Tipografi

İki katmanlı bir tipografi hiyerarşisi kur: **büyük sayılar için** (teklif miktarları, geri sayım, skor) kalın, dar (condensed) bir grotesk — skorbord/forma numarası hissi veren bir font (Bebas Neue, Anton, Oswald tarzı — bunlardan biri ya da benzeri, ücretsiz/Google Fonts üzerinden erişilebilir olanlar tercih edilsin). **Gövde metni için** bunun karşıtı, daha nötr ama karaktersiz olmayan bir font (Inter'i doğrudan kullanma — Space Grotesk, General Sans, ya da benzeri bir alternatif dene). Ölçek farkı abartılı olsun: teklif rakamları ekranda gerçekten "bağırmalı", etiketler küçük ve sessiz kalmalı.

## Renk Paleti

Mor/indigo'dan tamamen uzak dur. Koyu bir taban üstüne (saha/gece maçı floodlight hissi — çok koyu yeşil-siyah bir taban, düz siyah değil) yüksek kontrastlı, doygun bir vurgu rengi kur — pastel/soluk tonlar değil, TV yayın grafiklerindeki gibi keskin ve doygun renkler. Öneri: ana vurgu için elektrik sarısı/altın (kazanma anı, para, ödül hissi) + ikincil bir aciliyet rengi (geri sayım kritikleşince kırmızıya kayan bir turuncu). "Büyük fark" pozisyonları gibi özel anlar için ayrı, çarpıcı bir üçüncü renk ayrılabilir.

## Yerleşim / Kompozisyon

Simetrik, ortalanmış kart düzenlerinden kaçın. Sürekli görünen bir "skorbord" üst şeridi olsun (bütçe, skor, geri sayım — her zaman görünür, oyunun neresinde olursan ol). Açık arttırma anı küçük bir kart içinde değil, **tam ekran dramatik bir sahne** gibi kurulsun — oyuncu fotoğrafı/kartı büyük, teklif rakamı ekranın odağı. Asimetrik/köşeli (diagonal) ayraçlar, yayın alt-bant (lower third) grafiklerini andıran keskin geçişler kullan — yumuşak/yuvarlak her şeyin aksine.

## Hareket / Mikro-etkileşim

Teklif miktarları anlık belirmesin, gerçek bir arttırma gibi **sayarak yükselsin** (count-up animasyon). Geri sayım son saniyelerde renk/hız değiştirerek gerçek bir aciliyet hissettirsin (pulse efekti). Kazananın açıklandığı an, sade bir fade-in değil, yayın grafiği geçişi gibi (wipe/slide) hissettirilsin — bu oyunun en heyecanlı anı, en sönük geçiş orada olmamalı.

## İkonografi / Doku

Jenerik outline ikon setlerini (Lucide/Heroicons) her yerde beklenen şekilde kullanmaktan kaçın — sadece gerçekten gerekli yerlerde, sade. Arka planlarda soyut gradyan lekeleri yerine, çim/saha dokusuna ya da stadyum ışığına gönderme yapan hafif, düşük kontrastlı bir doku katmanı denenebilir (aşırıya kaçmadan).

## Oyuncu Kartı Sistemi (En Önemli Görsel Eleman)

Bu oyunda oyuncu kartı, tüm deneyimin merkezinde — bir trading-card oyunundaki kart kadar özenli tasarlanmalı, sade bir "isim + fotoğraf" satırı olmamalı. Kartın kendi bir katmanlı yapısı olsun: arka planda reytinge göre değişen bir doku/desen, üstte oyuncu görseli büyük ve baskın, altta reyting (skorbord fontuyla, iri) + pozisyon rozeti + kulüp/milliyet küçük detaylar. Kart, açık arttırma sahnesinde döndürme/parlama gibi küçük bir "reveal" animasyonuyla sahneye girsin — bir e-ticaret ürün kartı gibi sessizce belirmesin.

**Reyting bandına göre kart çerçevesi farklılaşsın** (bu hem görsel zenginlik katar hem de oyuncuya anlık bilgi verir): örneğin 90+ reyting altın/parlak bir çerçeve, 80-89 gümüş, 80 altı standart koyu çerçeve gibi bir kademelendirme. **Icon oyuncular (38 kişilik liste) için tamamen ayrı, özel bir kart tasarımı** olmalı — farklı bir doku/desen, belki hafif bir parlama/foil efekti — bunlar oyunun "efsane" kategorisi, sıradan bir aktif oyuncuyla aynı görsel ağırlıkta olmamalı.

## Nadir Anlar İçin Özel Görsel Dil

"Büyük fark" pozisyonları (draft başında rastgele işaretlenen 2 slot, ana/yedek reyting farkının ~25'e çıktığı turlar) görsel olarak da hissettirilmeli — o tur geldiğinde ekranda ayrı bir renk/ışık teması (örn. ekranın kenarlarında hafif bir kırmızı/altın parıltı, uyarı rozetinin yanında küçük bir animasyon) devreye girsin, oyuncu "bu tur farklı" olduğunu bir bakışta anlasın.

## Ekran Bazlı Kompozisyon Notları

**Draft/Açık Arttırma ekranı:** Tam ekran, ortada büyük oyuncu kartı, üstte skorbord şeridi (bütçe/kalan slot), altta iki tarafın teklif göstergesi (count-up animasyonlu). Bu, oyunun "hero" ekranı — en fazla görsel özen burada olmalı.

**Kadro/Formasyon ekranı:** Saha üstten görünüm (taktik tahtası hissi) üzerine oyuncu kartları küçük ikonlar olarak yerleştirilsin — düz bir liste değil, gerçek bir saha diyagramı. Formasyon değişince kartlar saha üzerinde animasyonlu şekilde yeni pozisyonlarına kaysın.

**Maç Simülasyonu/Sonuç ekranı:** Statik bir skor metni yeterli değil — basit bir "canlı maç" hissi verecek bir zaman çizelgesi/ticker (gol anları, dakika bazlı küçük olaylar) düşünülmeli; xG/olasılık hesaplamasının arkasındaki "hikaye" görselleştirilsin, sadece sonuç değil.

## Ses Kimliği

Sessiz bir arayüz bu oyuna yetmiyor — açık arttırma çekici sesi (kazananın belli olduğu an), geri sayımın son saniyelerinde hafif bir tık sesi, gol/kazanma anında kısa bir kalabalık/stadyum sesi gibi minimal ama atmosferi güçlendiren ses efektleri eklenebilir (tamamen sessize alınabilir seçenek olmalı, ama varsayılan açık bir deneyim düşünülmeli).

## Boş / Yükleniyor Durumları

Genel spinner/loading çemberi yerine temaya uygun bekleme animasyonları düşün — "rakip bekleniyor" ekranı bir stadyum tüneli ya da isınma hareketi gibi hissettirilebilir. Boş durumlar (henüz kimse katılmadı, kadro henüz boş) da düz bir "veri yok" mesajından çok, oyunun görsel diline uygun küçük bir illüstrasyon/ikonla desteklenmeli.

## Mobil Uyarlama

Tam ekran dramatik açık arttırma sahnesi küçük ekranda da etkisini kaybetmemeli — kart boyutu ölçeklenirken skorbord şeridi sıkışıp kaybolmamalı, gerekirse ikincil bilgiler (kulüp/milliyet gibi detaylar) mobilde bir dokunuşla açılan küçük bir panele taşınabilir, ama teklif rakamı ve geri sayım her zaman büyük ve net kalmalı.

## Erişilebilirlik Notu

Doygun/yüksek kontrastlı bir palet kullanmak erişilebilirlikten ödün vermek anlamına gelmemeli — metin/arka plan kontrast oranları WCAG AA seviyesinin altına düşmemeli, sadece renklerle iletilen bilgi (örn. "büyük fark" turu) her zaman bir ikon/metin etiketiyle de desteklenmeli, sadece renkle anlaşılır olmamalı.

## Kontrol Sorusu

Herhangi bir tasarım kararı verirken: "Bu ekran görüntüsünü gösterip 'bu hangi ürün' diye sorsam, biri 'bir AI aracıyla yapılmış jenerik bir şey' mi der, yoksa 'bu bir futbol açık arttırma oyunu' mu der?" İkinci cevabı vermiyorsa, karar gözden geçirilmeli.