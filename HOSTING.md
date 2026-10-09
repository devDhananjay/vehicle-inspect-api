# Host on another server

## Requirements
- Node.js 18+ (20 recommended)

## Run

```bash
cd vehicle-inspect-api
npm install --omit=dev
npm start
```

Default: `http://0.0.0.0:3010`

## Test

```bash
curl http://localhost:3010/health
curl http://localhost:3010/api/vehicle/UP26AQ8005
```

## PM2 (recommended)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Nginx reverse proxy (optional)

Point your domain path or subdomain to `http://127.0.0.1:3010`.
See `deploy/nginx-vehicle-inspect-snippet.conf` for a path-based example.

## Env

Copy/edit `.env` (or set env in PM2 `ecosystem.config.cjs`):

- `PORT=3010`
- `VEHICLE_PROVIDER=carinfo-public` (default)

Note: this app reads `process.env` only — for `.env` file support either export vars before start, use PM2 env, or `export $(grep -v '^#' .env | xargs) && npm start`.
