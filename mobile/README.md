# SavorIQ Mobile App

The SavorIQ manager's intelligence dashboard, built with React Native and Expo.

## Overview

The mobile app is designed for restaurant managers to:
1. **Monitor Performance**: View aggregate ratings and sentiment stats for their location.
2. **Prioritize Intercepts**: Identify guests who had negative experiences and need immediate attention.
3. **Analyze Sentiment**: Deep-dive into specific areas of friction or strength (Service, Food, Atmosphere).
4. **Sync Data**: Manually trigger review scrapes for their location.

## Key Components

- **`app/`**: Expo Router navigation and screen definitions.
- **`app/(tabs)/`**: The main navigation tabs (Overview, Reviews, Guests, More).
- **`components/`**: Reusable UI elements (KPI cards, charts, list items).
- **`lib/`**: API clients, contexts, and shared utilities.
- **`assets/`**: Images, fonts, and local static icons.

## Local Development

1. Install dependencies: `npm install`
2. Set up environment: `npx expo install expo-location` (if missing).
3. Set `EXPO_PUBLIC_API_URL` to point to your local or staging backend.
4. **Unified Startup (App + Backend)**: `npm run dev`
   - This starts both the Expo server and the FastAPI backend concurrently.
5. Press `w` for Web or use a simulator/device.
