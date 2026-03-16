---
description: How to sync new features from Mobile to Web
---

# Workflow: Seamless Mobile-to-Web Sync

Use this workflow when the user wants to port a feature from the `mobile/` (React Native) app to the `frontend/` (Next.js) web app.

## Execution Steps

1. **Audit Mobile Feature**:
   - Inspect the recent changes in `mobile/app/` and `mobile/components/`.
   - Identify new API calls in `mobile/lib/api.ts`.
   - Identify new state logic (Context, Data Hooks).

2. **Translate to Web UI**:
   - Map React Native components (`View`, `Text`, `ScrollView`) to Semantic HTML (`div`, `p`, `main`, `section`).
   - Translate `StyleSheet` logic into `Vanilla CSS` in `frontend/src/app/globals.css` or component-specific CSS modules.
   - Use Next.js `Link` for navigation instead of `expo-router`.

3. **Verify API Shared Logic**:
   - Check if `frontend/src/lib/api.js` needs new wrapper functions that match the new logic in `mobile/lib/api.ts`.
   - Ensure `X-Restaurant-ID` and `X-Access-Key` headers are maintained.

4. **Preserve Premium Aesthetics**:
   - Maintain the "Command Center" / "Glassmorphism" aesthetic from the Mobile app.
   - Ensure the Web version feels like a "Pro" expansion of the mobile tool (e.g., more detailed charts if space allows).

## Constraints
- **Do not delete mobile code**.
- **Always use environment-aware links** for admin-only features.
- Assume Mobile is the "Source of Truth" for new features.

## Interaction Rules (MANDATORY)
These rules apply to ALL interactions with User Ed, not just this workflow:

1. **Always confirm before acting destructively**:
   - Do NOT stop, restart, or switch running servers without asking first.
   - Do NOT rebuild, export, or overwrite files without confirming.
   - Do NOT install or remove packages without permission.
   - Instead, explain what needs to happen and ask: "Would you like me to do this?"

3. **Always apply best practices proactively**:
   - Think through UX edge cases BEFORE writing code (e.g., "how does the user navigate back?").
   - Present a clear proposal and confirm with Ed before implementing.
   - Do NOT implement a half-solution and fix it later — get it right the first time.

4. **Communication style**:
   - When describing changes or status, use **tables** showing feature parity across all locations.
   - List all locations first, then show what's applied vs missing, then ask to proceed.
   - Ed prefers concise, structured summaries over long prose.

2. **"Start mobile app" means start everything**:
   - When asked to start the mobile app, also start the **backend** and the **admin dashboard**.
   - Mobile: `npx expo start --web` or `node server.js` (confirm which one).
   - Backend: `/Users/Ed/Apps/SavorIQ/backend/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
   - Admin: `npm run dev` in `admin/` directory (port 5174).

## Development & Deployment Context
- Ed builds the **Mobile app** (React Native / Expo) as his primary focus.
- All local testing is done in a **desktop web browser** via `npx expo start --web`.
- `Platform.OS` is always `'web'` — the app is never run as a native iOS/Android binary.
- Production deployment is on **Railway**: `npx expo export --platform web` → `node server.js` serves the static build.
- End users access the app on their **phones via a mobile browser** (not an app store).
- The **`__DEV__` flag** is the correct way to gate dev-only features (true locally, false on Railway).
