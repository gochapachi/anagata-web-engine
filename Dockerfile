# ---- Build stage -----------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# npm ci needs the lockfile; copying manifests first keeps this layer cached
# when only source changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# The build must not talk to Supabase. Pages are dynamic (they read the Host
# header per request), so nothing is pre-rendered from live data at build time.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runtime stage ---------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Tailwind compiles at request time from /api/compile, so the compiler needs a
# writable temp dir inside the container.
ENV TMPDIR=/tmp

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Coolify's Dockerfile-based healthcheck shells out to `curl` (falling back to
# `wget`); neither exists on alpine, so a perfectly healthy container gets marked
# unhealthy and the deploy rolls back. Install curl and ignore the Dockerfile's
# own HEALTHCHECK below, which Coolify does not use for image-based apps.
RUN apk add --no-cache curl

# Next standalone output is a self-contained server plus the traced module set.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Tailwind's compiler runs at REQUEST time (see src/lib/compile.ts), so its
# package must be fully present at runtime. `next build` tracing follows JS
# imports only, and Tailwind's entry point is a CSS file referenced through the
# package's `exports` map - so the trace copies dist/ and package.json but NOT
# the .css files. Without this the compile gate fails with:
#   "Package path . is exported from package .../tailwindcss, but no valid
#    target file was found"
# Copy the CSS entry points explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tailwindcss/index.css ./node_modules/tailwindcss/index.css
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tailwindcss/theme.css ./node_modules/tailwindcss/theme.css
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tailwindcss/preflight.css ./node_modules/tailwindcss/preflight.css
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tailwindcss/utilities.css ./node_modules/tailwindcss/utilities.css

# Persistent ISR cache: mounted at runtime so cached tenant HTML survives a
# container restart and keeps serving while Supabase is unreachable.
RUN mkdir -p /app/.next/cache && chown -R nextjs:nodejs /app/.next/cache

USER nextjs
EXPOSE 3000

# Coolify healthcheck target.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]