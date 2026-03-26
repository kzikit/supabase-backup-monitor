# --- Build stage ---
FROM node:24-alpine AS build

WORKDIR /app

# Installeer pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Kopieer alleen lockfile en package.json eerst voor optimale layer caching
COPY package.json pnpm-lock.yaml ./

# Installeer alle dependencies (inclusief devDependencies voor de build)
RUN pnpm install --frozen-lockfile

# Kopieer broncode
COPY . .

# Build de SvelteKit app
RUN pnpm build

# Verwijder devDependencies, houd alleen productie-dependencies
RUN pnpm prune --prod

# --- Runtime stage ---
FROM node:24-alpine AS runtime

WORKDIR /app

# Kopieer alleen wat nodig is voor productie
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "build"]
