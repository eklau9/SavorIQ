---
description: Start all SavorIQ dev servers (mobile + backend + admin)
---

# Start Mobile (All Servers)

"Start mobile" means start **all three** dev servers: mobile (Expo), backend (FastAPI), and admin (Vite).

// turbo-all

1. Start the Expo mobile dev server:
```bash
cd /Users/Ed/Apps/SavorIQ/mobile && npx expo start --web
```

2. Start the FastAPI backend server:
```bash
cd /Users/Ed/Apps/SavorIQ/backend && ./venv/bin/python3 -m uvicorn app.main:app --port 8000 --reload
```

3. Start the Vite admin dashboard dev server:
```bash
cd /Users/Ed/Apps/SavorIQ/admin && npm run dev
```

## Expected Ports

| Server   | Port   |
|----------|--------|
| Mobile   | :8081  |
| Backend  | :8000  |
| Admin    | :5173  |
