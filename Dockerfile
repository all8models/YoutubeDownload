FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
# 최신 YouTube 스트리밍 프로토콜(SABR) 대응을 위해 yt-dlp 최신 nightly 버전으로 갱신
RUN /app/node_modules/youtube-dl-exec/bin/yt-dlp --update-to nightly
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# youtube-dl-exec(yt-dlp)와 ffmpeg를 위한 시스템 의존성 설치
RUN apt-get update && apt-get install -y python3 ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*

# YouTube JS 챌린지 해결을 위한 Deno 바이너리를 멀티스테이지로 직접 복사 (경량화 & 빌드 속도 향상)
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
