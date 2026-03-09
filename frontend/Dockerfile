FROM node:20-alpine AS builder

WORKDIR /app

# Copy the mobile Expo source
COPY ../mobile/package.json ../mobile/package-lock.json* ./
RUN npm ci --legacy-peer-deps

COPY ../mobile/ .

# Set Railway API URL at build time
ENV EXPO_PUBLIC_API_URL=https://savoriq-api-production.up.railway.app

RUN npx expo export --platform web

FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["serve", "dist", "-l", "3000", "--single"]
