# ---- Base ----
FROM node:22-alpine AS base
RUN npm install -g pnpm@11
WORKDIR /app

# ---- Dépendances ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js permet un projet sans assets publics ; la copie vers runner exige ce dossier.
RUN mkdir -p public && pnpm prisma generate && pnpm next build

# ---- Exécution ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
RUN mkdir -p storage certs
EXPOSE 3000
# Démarre après la base (retry migrations), génère le certificat P12 s'il est absent
# (monté en volume : il persiste entre les redémarrages), puis lance Next.
CMD ["sh", "-c", "i=0; until ./node_modules/.bin/prisma migrate deploy; do i=$((i+1)); [ $i -gt 30 ] && exit 1; echo 'attente de la base...'; sleep 2; done; [ -f \"${SIGN_CERT_PATH:-/app/certs/signing.p12}\" ] || node scripts/generate-cert.mjs; exec ./node_modules/.bin/next start -p 3000"]
