# SavorIQ Admin — Command Center

A standalone monitoring dashboard for SavorIQ operators. Provides real-time visibility into API quotas, token health, and system status — completely separate from the customer-facing app.

## Quick Start

```bash
# 1. Start the backend (if not already running)
cd ../backend && ./venv/bin/uvicorn app.main:app --reload --port 8000

# 2. Start the admin dashboard
cd ../admin && npm run dev
```

Open **http://localhost:5174** in your browser.

## Tech Stack

- **Framework**: React 19 (via Vite)
- **Routing**: React Router v7
- **Styling**: Vanilla CSS (dark Command Center theme)
- **API**: Proxied to FastAPI backend at `/api/admin/*`

## Project Structure

```
admin/
├── src/
│   ├── App.jsx              # Layout shell + routing
│   ├── main.jsx             # Entry point
│   ├── index.css            # Design system (dark theme)
│   ├── components/
│   │   ├── Sidebar.jsx      # Navigation (extensible)
│   │   ├── TokenCard.jsx    # Apify token status card
│   │   └── ServiceCard.jsx  # Generic service quota card
│   └── pages/
│       └── QuotasPage.jsx   # API Quotas dashboard
├── vite.config.js           # Dev server + API proxy
└── package.json
```

## Adding New Pages

1. Create a component in `src/pages/NewPage.jsx`
2. Add a route in `src/App.jsx`
3. Add a nav entry in `src/components/Sidebar.jsx` (just add to the `NAV_ITEMS` array)

## Backend API

The admin dashboard consumes endpoints from the backend's admin router:

| Endpoint | Description |
| :--- | :--- |
| `GET /api/admin/quotas` | Live quota data for all external services |

## Configuration

The Vite dev server proxies `/api` requests to the backend. Configured in `vite.config.js`:
- **Admin Port**: `5174`
- **Backend Target**: `http://127.0.0.1:8000`
