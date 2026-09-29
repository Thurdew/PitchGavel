# PitchGavel — Oracle Cloud'a Taşıma

Render'ın yerine Oracle Cloud "Always Free" sanal sunucusu: 7/24 açık, uyumaz, süresiz ücretsiz.
Hesap veritabanı zaten Turso'da, o yüzden veri taşıma YOK — sadece sunucu değişiyor.

## 1. Oracle hesabı (sen yapacaksın)
1. https://www.oracle.com/cloud/free/ → "Start for free".
2. **Home Region**'ı dikkatli seç (sonradan değişmez): **Germany Central (Frankfurt)** — Render'da da Frankfurt kullanıyorduk.
3. Kart doğrulaması istenir; Always Free kaynaklarda ücret çekilmez. Hesabı "Pay As You Go"ya YÜKSELTME.

## 2. Sanal makine oluştur
Menü → Compute → Instances → **Create instance**
- **Image:** Canonical Ubuntu 24.04 (ya da 22.04)
- **Shape:** Ampere → **VM.Standard.A1.Flex**, 1-2 OCPU, 6-12 GB RAM (Always Free).
  "Out of capacity" hatası alırsan: birkaç saat sonra tekrar dene ya da **VM.Standard.E2.1.Micro**
  (AMD, 1 GB RAM — o da Always Free, oyun için yeterli; setup.sh otomatik swap ekler).
- **Networking:** yeni VCN + public subnet, **"Assign a public IPv4 address"** açık.
- **SSH keys:** "Generate a key pair" → **özel anahtarı indir** (kaybetme).
- Create. Makine açılınca **Public IP**'yi not al.

## 3. Portları aç (Oracle panelinde)
Instance → Subnet → **Default Security List** → **Add Ingress Rules**:
- Source CIDR `0.0.0.0/0`, TCP, Destination port **80**
- Source CIDR `0.0.0.0/0`, TCP, Destination port **443**

(Sunucunun kendi iptables kuralını setup.sh açıyor.)

## 4. DNS'i yeni sunucuya çevir (Hostinger)
`pitchgavel.com` DNS ayarlarında:
- `A` kaydı `@` → Oracle Public IP (Render'ı gösteren A/CNAME kaydını sil)
- `A` kaydı `www` → aynı IP (ya da `www` CNAME → `pitchgavel.com`)

**Resend kayıtlarına (MX `send`, SPF/TXT `send`, DKIM `resend._domainkey`) DOKUNMA** — e-posta bunlarla çalışıyor.
Yayılması birkaç dakika–birkaç saat sürebilir: `nslookup pitchgavel.com` yeni IP'yi gösterene kadar bekle.

## 5. Sunucuya bağlan ve kur
Windows PowerShell'de:
```powershell
ssh -i C:\yol\ssh-key.key ubuntu@<PUBLIC_IP>
```
("permissions too open" hatası verirse: anahtar dosyasına sağ tık → Özellikler → Güvenlik → sadece kendi kullanıcına okuma izni bırak.)

Sunucuda:
```bash
curl -fsSL https://raw.githubusercontent.com/Thurdew/PitchGavel/main/deploy/oracle/setup.sh -o setup.sh
sudo DOMAIN=pitchgavel.com bash setup.sh
```
Repo **private** ise ham dosya da inmez — o durumda GitHub'da bir Personal Access Token (sadece bu repo, "Contents: Read-only") oluştur ve:
```bash
git clone https://<TOKEN>@github.com/Thurdew/PitchGavel.git /tmp/pg
sudo DOMAIN=pitchgavel.com REPO_URL=https://<TOKEN>@github.com/Thurdew/PitchGavel.git bash /tmp/pg/deploy/oracle/setup.sh
```

## 6. Sırları gir
```bash
sudo nano /etc/pitchgavel.env
```
`RESEND_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` değerlerini Resend ve Turso panellerinden (ya da yerel `server/.env`'den) kopyala. Kaydet, sonra:
```bash
sudo systemctl restart pitchgavel
curl -s http://localhost:3000/api/health
```

## 7. Kontrol
- `https://pitchgavel.com` açılıyor mu. Caddy sertifikayı DNS yeni IP'yi gösterdikten sonra alabilir; kurulum DNS'ten önce yapıldıysa birkaç dakika içinde kendisi yeniden dener (beklemek istemezsen `sudo systemctl restart caddy`).
- Giriş yap → hesabın duruyor mu (Turso).
- İki sekmeyle oda kurup draft oyna (WebSocket).
- Sorun olursa: `journalctl -u pitchgavel -f` (uygulama), `journalctl -u caddy -f` (HTTPS).

Her şey çalışınca Render servisini silebilir ya da askıya alabilirsin; cron-job.org ping'ine de artık gerek yok (sunucu uyumuyor).

## Güncelleme (yeni kod yayınlamak)
Otomatik deploy yok — `main`'e merge'ten sonra sunucuda:
```bash
sudo bash /opt/pitchgavel/deploy/oracle/update.sh
```
Yeniden başlatma o an oynanan odaları sıfırlar (odalar bellekte), hesaplar etkilenmez.

## Notlar
- Oracle, Always Free makineleri uzun süre **çok düşük kullanımda** kalırsa geri alabileceğini söylüyor
  (CPU/ağ/bellek kullanımı 7 gün boyunca %20'nin altında kalırsa). Hesabı Pay As You Go'ya yükseltmek
  bunu kaldırıyor ama o zaman limit aşımı faturalanabilir — şimdilik yükseltme, makineyi izle.
- Ücretsiz planların şartları değişebilir; hesap açarken Oracle'ın güncel Always Free sayfasına bak.
