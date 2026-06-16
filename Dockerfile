# syntax=docker/dockerfile:1

# ---- Build stage: compile the Vite frontend into /app/dist ----
FROM node:20-alpine AS build
WORKDIR /app
# Install all deps (incl. dev) — Vite/esbuild are devDependencies needed to build.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime stage: Express serves /dist and the /api endpoints ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# Only production deps are needed to run the server (express); skip devDeps.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Copy the server, the runtime libs it imports, and the built frontend.
COPY server.js ./
COPY src/lib ./src/lib
COPY --from=build /app/dist ./dist
# Run as the unprivileged built-in `node` user, not root.
USER node
EXPOSE 3001
# Healthy once the app shell is served.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3001/ || exit 1
# Analysis-only by default. To enable the AI read, pass ANTHROPIC_API_KEY as an
# environment variable to the container (never bake it into the image).
CMD ["node", "server.js"]
