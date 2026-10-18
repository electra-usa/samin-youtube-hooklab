# HookLab: the Next.js app and the `hooklab` CLI (whose `refresh --loop` is the live-outliers
# worker) in one image. Data lives outside the image: mount a persistent volume at /data.
#
#   docker build -t hooklab .
#   docker build -t hooklab --build-arg INSTALL_YTDLP=true .   # + yt-dlp (My Channel sync, transcripts)
#
# See docs/DEPLOY.md and docker-compose.yml.

FROM node:24-slim AS build
WORKDIR /hooklab/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-slim
ARG INSTALL_YTDLP=false
# yt-dlp's standalone Linux build needs no Python. Optional: only My Channel sync and transcript
# attachments use it; the refresh pipeline doesn't.
RUN if [ "$INSTALL_YTDLP" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
      && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      && chmod +x /usr/local/bin/yt-dlp && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
    fi
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOOKLAB_DATA_DIR=/data \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    PORT=3000
WORKDIR /hooklab
# The app keeps its sources: the CLI runs app/src/lib/core with Node's type stripping.
COPY --from=build /hooklab/app ./app
COPY cli ./cli
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/refresh/freshness').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
WORKDIR /hooklab/app
# A bind-mounted ./data must be writable by the node user (uid 1000): say so instead of failing later.
CMD ["sh", "-c", "[ -w \"${HOOKLAB_DATA_DIR:-/data}\" ] || { echo \"HookLab: ${HOOKLAB_DATA_DIR:-/data} isn't writable by uid $(id -u). On the host: sudo chown -R 1000:1000 ./data\" >&2; exit 1; }; exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT}"]
