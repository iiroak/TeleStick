# ---- builder ----
# node:22-bookworm-slim (not a pinned exact patch): the 22.12.0-bookworm-slim
# tag was tested and segfaults when loading better-sqlite3's prebuilt
# addon (dlopen succeeds but the module init crashes; same behavior with
# the vendored .node file and with node-gyp rebuild output). Same Debian
# 12 base, same glibc 2.36, same reported NODE_MODULE_VERSION 127 -- the
# rolling 22-bookworm-slim tag (verified at build time: v22.23.2) does not
# reproduce it. Track upstream if this needs re-pinning.
FROM node:22-bookworm-slim AS builder

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl ca-certificates bash \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/share/pnpm \
    && curl --fail --silent --show-error --location https://get.pnpm.io/install.sh \
        | env SHELL=/bin/bash ENV=/etc/bash.bashrc PNPM_HOME=/usr/local/share/pnpm PNPM_VERSION=10.34.4 bash - \
    && ln -sf /usr/local/share/pnpm/.tools/pnpm-exe/10.34.4/pnpm /usr/local/bin/pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- runtime ----
FROM node:22-bookworm-slim AS production

WORKDIR /app
ENV NODE_ENV=production
ENV PYTHONDONTWRITEBYTECODE=1

# ffmpeg: video sticker (.webm VP9-alpha) conversion.
# webp: img2webp/cwebp for animated/static WebP assembly (package "webp",
#   NOT "libwebp*" -- those are the shared libs, this ships the CLI tools).
# python3 + pip: rlottie-python renders Telegram's .tgs (gzipped Lottie)
#   animations using the same rlottie engine Telegram itself uses.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ffmpeg webp python3 python3-pip ca-certificates curl bash \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages --no-cache-dir rlottie-python==1.3.8 Pillow==11.0.0 \
    && mkdir -p /usr/local/share/pnpm \
    && curl --fail --silent --show-error --location https://get.pnpm.io/install.sh \
        | env SHELL=/bin/bash ENV=/etc/bash.bashrc PNPM_HOME=/usr/local/share/pnpm PNPM_VERSION=10.34.4 bash - \
    && ln -sf /usr/local/share/pnpm/.tools/pnpm-exe/10.34.4/pnpm /usr/local/bin/pnpm

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV DATA_DIR=/app/data
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
