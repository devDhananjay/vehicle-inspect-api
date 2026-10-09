#!/usr/bin/env bash
# Deploy vehicle-inspect-api to ContentVerse EC2 (PM2, port 3010).
set -euo pipefail

PEM="${PEM:-$HOME/Downloads/content.pem}"
HOST="${HOST:-ec2-user@52.66.204.66}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_DIR="$ROOT/services/vehicle-inspect-api"
REMOTE_DIR="/home/ec2-user/vehicle-inspect-api"
PORT="${PORT:-3010}"
SSH=(ssh -i "$PEM" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes)

cd "$SERVICE_DIR"
npm install --omit=dev

rm -rf /tmp/vehicle-inspect-api-deploy
mkdir -p /tmp/vehicle-inspect-api-deploy
cp -R package.json package-lock.json server.mjs src /tmp/vehicle-inspect-api-deploy/
cp -R node_modules /tmp/vehicle-inspect-api-deploy/

"${SSH[@]}" "$HOST" "mkdir -p ${REMOTE_DIR}"

rsync -az --delete \
  -e "ssh -i $PEM -o StrictHostKeyChecking=no -o IdentitiesOnly=yes" \
  /tmp/vehicle-inspect-api-deploy/ "$HOST:${REMOTE_DIR}/"

"${SSH[@]}" "$HOST" bash <<REMOTE
set -e
cd ${REMOTE_DIR}
cat > ecosystem.config.cjs <<'ECO'
module.exports = {
  apps: [
    {
      name: "vehicle-inspect-api",
      cwd: "/home/ec2-user/vehicle-inspect-api",
      script: "server.mjs",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: ${PORT},
        HOST: "0.0.0.0",
        VEHICLE_PROVIDER: "carinfo-public",
      },
    },
  ],
};
ECO
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
REMOTE

rm -rf /tmp/vehicle-inspect-api-deploy
echo "DEPLOY_OK vehicle-inspect-api :${PORT}"
echo "curl https://contentverse.co.in/vehicle-inspect/api/vehicle/UP26AQ8005"
echo "PM2: cd ${REMOTE_DIR} && pm2 restart vehicle-inspect-api"
