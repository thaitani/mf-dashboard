FROM node:24.22.1-bookworm-slim
WORKDIR /app
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/pnpm/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH=/pnpm:$PATH \
    HOME=/home/node

RUN mkdir -p /pnpm \
    && corepack enable \
    && apt-get update && apt-get install -y --no-install-recommends curl ca-certificates sqlite3 tini \
    && rm -rf /var/lib/apt/lists/*

ARG SUPERCRONIC_VERSION=v0.2.51
ARG SUPERCRONIC_SHA256_AMD64=cc232108374e8e2b537045f2d5eaa1229f619db314c3ba6a14d38b35dc0aa123
ARG SUPERCRONIC_SHA256_ARM64=4ae22576a78223d8ccdf5f3b3660a5cbb5288416bf0ca96afc4a36d195932b94
RUN arch="$(dpkg --print-architecture)" \
    && case "${arch}" in \
      amd64) supercronic_arch="amd64"; supercronic_sha256="${SUPERCRONIC_SHA256_AMD64}" ;; \
      arm64) supercronic_arch="arm64"; supercronic_sha256="${SUPERCRONIC_SHA256_ARM64}" ;; \
      *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${supercronic_arch}" \
      -o /tmp/supercronic \
    && echo "${supercronic_sha256}  /tmp/supercronic" | sha256sum -c - \
    && install -m 0755 /tmp/supercronic /usr/local/bin/supercronic \
    && rm -f /tmp/supercronic

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/crawler/package.json ./apps/crawler/
COPY packages/db/package.json ./packages/db/
COPY packages/date-utils/package.json ./packages/date-utils/
COPY packages/meta/package.json ./packages/meta/
COPY packages/analytics/package.json ./packages/analytics/

RUN package_manager=$(node -p "require('./package.json').packageManager") \
    && corepack prepare "$package_manager" --activate \
    && pnpm install --frozen-lockfile --prod --filter "@mf-dashboard/crawler..." --ignore-scripts \
    && pnpm rebuild --pending --filter "@mf-dashboard/crawler..." \
    && pnpm --filter "@mf-dashboard/crawler" exec playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /pnpm/store /var/lib/apt/lists/*

COPY . .

RUN mkdir -p /app/data /app/crawler-state \
    && chmod 1777 /app/crawler-state \
    && chmod 0755 /app/docker/crawler/entrypoint.sh
USER node

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/crawler/entrypoint.sh"]
