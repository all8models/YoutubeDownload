FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# youtube-dl-exec(yt-dlp)와 ffmpeg-static의 원활한 동작을 위해 파이썬과 시스템 ffmpeg 설치
RUN apt-get update && apt-get install -y python3 ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
