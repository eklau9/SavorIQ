# ── Stage 1: Build Expo web export ──────────────────────────────────
FROM node:20-slim AS web-builder

WORKDIR /app/mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY mobile/ ./
RUN npx expo export --platform web


# ── Stage 2: Python backend + serve web export ─────────────────────
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ app/

# Copy the freshly built web export from Stage 1
COPY --from=web-builder /app/mobile/dist static/

# Railway assigns PORT via environment variable
EXPOSE ${PORT:-8000}

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
