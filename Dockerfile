# ── Stage 1a: Build Expo web export ─────────────────────────────────
FROM node:20-slim AS web-builder

WORKDIR /app/mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY mobile/ ./
RUN npx expo export --platform web


# ── Stage 1b: Build Admin dashboard ────────────────────────────────
FROM node:20-slim AS admin-builder

WORKDIR /app/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci

COPY admin/ ./
RUN npm run build


# ── Stage 2: Python backend + serve web export ─────────────────────
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ app/

# Copy the freshly built web export from Stage 1a
COPY --from=web-builder /app/mobile/dist static/

# Copy admin dashboard build from Stage 1b
COPY --from=admin-builder /app/admin/dist static/admin/

# Railway assigns PORT via environment variable
EXPOSE ${PORT:-8000}

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
