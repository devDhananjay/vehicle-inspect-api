#!/usr/bin/env bash
# Add /vehicle-inspect/ proxy to contentverse.co.in nginx (run once on EC2 via SSH).
set -euo pipefail

PEM="${PEM:-$HOME/Downloads/content.pem}"
HOST="${HOST:-ec2-user@52.66.204.66}"
CONF="/etc/nginx/conf.d/contentverse.conf"
MARKER="vehicle-inspect-api (PM2 :3010)"

SSH=(ssh -i "$PEM" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes)

"${SSH[@]}" "$HOST" bash <<REMOTE
set -e
if grep -q "$MARKER" "$CONF"; then
  echo "nginx snippet already present"
else
  sudo sed -i '/location \^~ \\/uploads\\//i\\
    # $MARKER\\
    location /vehicle-inspect/ {\\
        proxy_pass http://127.0.0.1:3010/;\\
        proxy_http_version 1.1;\\
        proxy_set_header Host \\\$host;\\
        proxy_set_header X-Real-IP \\\$remote_addr;\\
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;\\
        proxy_set_header X-Forwarded-Proto \\\$scheme;\\
    }\\
' "$CONF"
fi
sudo nginx -t
sudo systemctl reload nginx
echo "NGINX_OK /vehicle-inspect/"
REMOTE
