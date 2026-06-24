# syntax=docker/dockerfile:1
#
# Multi-stage build for the PRPilot Next.js app. Produces a small, non-root
# runtime image from Next's standalone output (no node_modules in the final
# layer). The same image base is reused for the Phase-3 Lambda worker.
#
# Build context excludes .env* (see .dockerignore) so no secrets are baked in —
# every credential is supplied at *runtime* via the environment.

# ---- Base ----
FROM node:22-alpine AS base
# Some transitive native deps expect glibc symbols; libc6-compat provides them.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---- Dependencies (cached unless the lockfile changes) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No secrets needed to build: config is read from the environment at runtime,
# and no NEXT_PUBLIC_* value is referenced from client code.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Drop root.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next's standalone output ships a self-contained server.js but deliberately
# omits public/ and .next/static — copy those two in explicitly.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
