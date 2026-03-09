FROM node:20-alpine AS builder

WORKDIR /app

COPY mobile/package.json mobile/package-lock.json* ./
RUN npm ci --legacy-peer-deps

COPY mobile/ .

# Bake in the Railway backend API URL at build time
ENV EXPO_PUBLIC_API_URL=https://savoriq-api-production.up.railway.app

RUN npx expo export --platform web --clear

# Serve static files with compression
FROM node:20-alpine AS runner
WORKDIR /app

# Install production dependencies for the server
COPY mobile/package.json mobile/package-lock.json* ./
RUN npm ci --only=production --legacy-peer-deps

COPY --from=builder /app/dist ./dist
COPY mobile/server.js ./

CMD ["node", "server.js"]
