---
description: Start all SavorIQ dev servers (mobile + backend + admin)
---

# Start Mobile (All Servers)

"Start mobile" means start **all three** dev servers: backend (FastAPI), mobile (Expo), and admin (Vite).

**Backend starts first** so the API is ready before the mobile app loads.

// turbo-all

1. Start the FastAPI backend server:
```bash
cd /Users/Ed/Apps/SavorIQ/backend && source venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

2. Start the Expo mobile dev server:
```bash
cd /Users/Ed/Apps/SavorIQ/mobile && npx expo start --web --port 8081
```

3. Start the Vite admin dashboard dev server:
```bash
cd /Users/Ed/Apps/SavorIQ/admin && npm run dev
```

## Expected Ports

| Server   | Port   |
|----------|--------|
| Backend  | :8000  |
| Mobile   | :8081  |
| Admin    | :5173  |
