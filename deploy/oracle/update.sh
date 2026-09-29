#!/usr/bin/env bash
# Yeni kodu yayınla (sunucuda):  sudo bash /opt/pitchgavel/deploy/oracle/update.sh
# Not: yeniden başlatma, o an oynanan odaları sıfırlar (odalar bellekte tutuluyor).
set -euo pipefail
APP_DIR=/opt/pitchgavel
BRANCH="${BRANCH:-main}"
sudo -u pitchgavel git -C "$APP_DIR" fetch origin "$BRANCH"
sudo -u pitchgavel git -C "$APP_DIR" reset --hard "origin/$BRANCH"
sudo -u pitchgavel bash -c "cd $APP_DIR/server && npm ci --omit=dev"
systemctl restart pitchgavel
sleep 2
curl -fsS http://localhost:3000/api/health && echo " <- sağlıklı"
