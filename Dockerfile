FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
ENV YOUTUBE_DL_SKIP_DOWNLOAD=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV YOUTUBE_DL_BIN=/usr/local/bin/yt-dlp
ENV FFMPEG_BIN=/usr/bin/ffmpeg
ENV YTDL_CACHE_DIR=/var/cache/yt-dlp
ENV TMP_DOWNLOAD_DIR=/app/tmp

# 사전 컴파일된 yt-dlp[default] (.pyc 바이트코드 + HTTP 커넥션 풀링 의존성) 및 ffmpeg 설치
# -> 기존 Zipapp 대비 프로세스 기동 오버헤드 약 4배 단축 (~550ms -> ~130ms)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates && \
    pip3 install --no-cache-dir --break-system-packages --pre -U "yt-dlp[default]" && \
    python3 -m compileall -q /usr/local/lib/python3* && \
    mkdir -p /var/cache/yt-dlp /app/tmp && \
    rm -rf /var/lib/apt/lists/*

# YouTube JS 챌린지 고속 해결을 위한 Deno 바이너리 복사
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 미사용 이미지 최적화 네이티브 바이너리(@img/sharp 34MB) 및 중복 구형 Zipapp(3MB) 제거로 컨테이너 경량화
RUN rm -rf /app/node_modules/@img /app/node_modules/sharp /app/node_modules/youtube-dl-exec/bin/yt-dlp

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
