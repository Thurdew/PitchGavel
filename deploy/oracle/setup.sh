#!/usr/bin/env bash
# PitchGavel — Oracle Cloud (Ubuntu 22.04/24.04) tek seferlik sunucu kurulumu.
# Kullanım (sunucuda, ubuntu kullanıcısıyla):
#   curl -fsSL https://raw.githubusercontent.com/Thurdew/PitchGavel/main/deploy/oracle/setup.sh -o setup.sh
#   sudo DOMAIN=pitchgavel.com bash setup.sh
# Repo private ise REPO_URL'e token'lı bir adres ver:
#   sudo DOMAIN=pitchgavel.com REPO_URL=https://<TOKEN>@github.com/Thurdew/PitchGavel.git bash setup.sh
set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN gerekli, ör. DOMAIN=pitchgavel.com}"
REPO_URL="${REPO_URL:-https://github.com/Thurdew/PitchGavel.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/pitchgavel
APP_USER=pitchgavel
ENV_FILE=/etc/pitchgavel.env

echo "==> Paketler"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

echo "==> Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Caddy (otomatik HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Küçük makineler için swap (1GB RAM'li E2.1.Micro'da npm install'ın çökmemesi için)"
if [ ! -f /swapfile ] && [ "$(free -m | awk '/Mem:/{print $2}')" -lt 2000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Oracle Ubuntu imajının iptables REJECT kuralından önce 80/443'ü aç"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
done
netfilter-persistent save

echo "==> Uygulama kullanıcısı + kod"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/server && npm ci --omit=dev"

echo "==> Ortam değişkenleri ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
APP_BASE_URL=https://$DOMAIN
EMAIL_FROM=PitchGavel <noreply@$DOMAIN>
# Aşağıdakileri doldur (Render dashboard'undaki değerlerin aynısı):
RESEND_API_KEY=
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
EOF
  chmod 600 "$ENV_FILE"
  echo "!!! $ENV_FILE oluşturuldu — sırları doldurup 'sudo systemctl restart pitchgavel' çalıştır."
fi

echo "==> systemd servisi"
install -m 644 "$APP_DIR/deploy/oracle/pitchgavel.service" /etc/systemd/system/pitchgavel.service
systemctl daemon-reload
systemctl enable --now pitchgavel

echo "==> Caddy ayarı"
sed "s/{\$DOMAIN}/$DOMAIN/g" "$APP_DIR/deploy/oracle/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo
echo "Kurulum bitti. Kontrol:  curl -s http://localhost:3000/api/health"
echo "Log:                     journalctl -u pitchgavel -f"
