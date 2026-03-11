# FinGOAT Frontend

React + TypeScript + Vite frontend for FinGOAT.

## What this app does

- User register/login (JWT token persisted in browser storage)
- Market/news article feed UI
- Trading analysis request form (ticker + date + model/provider settings)
- Polling task status and rendering multi-agent decision/report

## Main files

- `src/App.tsx`: auth flow + dashboard shell
- `src/components/TradingAnalysis.tsx`: analysis form, status polling, result rendering
- `src/services/tradingService.ts`: backend API client
- `src/App.css` and `src/TradingAnalysis.css`: styling

## Environment

Optional:

- `VITE_API_URL`: backend base URL (for example `http://localhost:3000`)

If omitted, the app uses same-origin requests (works behind Nginx reverse proxy).

## Run locally

```bash
cd frontend
npm install
npm run dev
```

Default dev URL: `http://localhost:5173`

## Build

```bash
cd frontend
npm run build
npm run preview
```

## Backend API expectations

The frontend expects the following backend routes:

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/articles`
- `GET /api/articles/:id/like`
- `POST /api/articles/:id/like`
- `POST /api/trading/analyze`
- `GET /api/trading/analysis/:task_id`
- `GET /api/trading/analyses`
- `GET /api/trading/stats`
- `GET /api/trading/health`

## Docker

This folder includes a production Dockerfile:

- build: Node 20 + `npm ci` + `npm run build`
- serve: Nginx (`frontend/nginx.conf`)
