# syntax=docker/dockerfile:1

# NutriPlan — production image.
#
# Three stages so the runtime layer holds only the standalone server, its
# traced dependencies and the static assets. No dev dependencies, no source,
# no local database, no API keys.
#
# The app is a single-user tool with no authentication. Do not publish this
# port directly to the internet: put a TLS-terminating reverse proxy in
# front and choose a gate mode (see docs/DEPLOYMENT.md).

# ─── dependencies ───────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# `npm ci` is reproducible and refuses a lockfile that disagrees with
# package.json. Install scripts are not disabled: Next's own install step is
# part of the build.
COPY package.json package-lock.json ./
RUN npm ci

# ─── build ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next.config.ts` reads this while building, and Next serialises config into
# the build, so it is a build-time value rather than a runtime one. It is not
# a secret (it is a hostname list). Never pass API keys as build args — they
# would be visible in image history.
ARG NUTRIPLAN_ALLOWED_ORIGINS=""
ENV NUTRIPLAN_ALLOWED_ORIGINS=${NUTRIPLAN_ALLOWED_ORIGINS}

RUN npm run build

# ─── runtime ────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NUTRIPLAN_DATA_DIR=/data

# Run unprivileged. The data directory is created here and owned by that
# user; a named volume inherits the ownership on first use. A bind mount
# must be made writable by uid 1001 on the host.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p /data \
 && chown nextjs:nodejs /data

# `output: "standalone"` emits a server plus only the node_modules it traced.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Probes the app's own endpoint, which reports only whether the database can
# be opened. It is exempt from the request gate so an orchestrator on another
# host can reach it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
