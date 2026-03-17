FROM node:20-slim AS web-builder

WORKDIR /web
COPY mobile/package.json mobile/package-lock.json* ./
RUN npm ci --legacy-peer-deps 2>/dev/null || npm install --legacy-peer-deps
COPY mobile/ .
RUN npx expo export --platform web

# --- Backend ---
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ app/

# Copy the built web app from the builder stage
COPY --from=web-builder /web/dist /app/static

# Railway assigns PORT via environment variable
EXPOSE ${PORT:-8000}

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
