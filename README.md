# vehicle-inspect-api

Provider-based vehicle / RC lookup API (standalone copy for hosting on any server).

## Providers (`src/providers/`)

| `VEHICLE_PROVIDER` | Behavior |
|--------------------|----------|
| `carinfo-public` | Public HTML scraper (default) |
| `carinfo-authorized` | Official CarInfo / Business API (`CARINFO_*`) |
| `licensed` | Alternate licensed vendor (`LICENSED_PROVIDER_*`) |
| `fallback` | Try `carinfo-authorized` → on failure `carinfo-public` |

## Endpoints

- `GET /health`
- `POST /ulip/v1.0.0/VAHAN/01` — ULIP VAHAN format  
  Body: `{ "vehiclenumber": "UP25EB9518" }`
- `GET /api/vehicle/:registrationNumber` (legacy)
- `GET /api/vehicle/:registrationNumber?debug=1` (legacy)
- `GET /api/rc/:registrationNumber` (legacy alias)

## Local / new server

```bash
npm install
npm test
npm start
```

See **HOSTING.md** for PM2 + nginx on another server.
