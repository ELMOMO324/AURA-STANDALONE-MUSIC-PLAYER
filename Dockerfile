FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir 'yt-dlp[default]==2026.10.26' \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node bridge.js online-bridge.js server-runtime.js package.json ./
ENV NODE_ENV=production AURA_CLOUD=1 HOST=0.0.0.0 PORT=10000 YT_DLP_PATH=/opt/venv/bin/yt-dlp FFMPEG_DIR=/usr/bin AURA_TEMP_DIR=/tmp/aura-audio
USER node
EXPOSE 10000
CMD ["node", "bridge.js"]
