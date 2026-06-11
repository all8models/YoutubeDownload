# Docker 기동 트러블슈팅 기록

> 발생일: 2026-06-11
> 프로젝트: `/Users/windows/work/Util/YoutubeDownload`
> 목표: 플레이리스트 기능이 추가된 YouTube Download 앱을 Docker로 기동

---

## 트러블 목록 요약

| # | 문제 | 원인 | 해결 |
|---|------|------|------|
| 1 | `npm: command not found` | Node.js 미설치 | `brew install node` |
| 2 | `Python 3.9 unsupported` | 시스템 Python이 3.9라 yt-dlp 실행 불가 | Docker 사용 (내부 Python3 정상) |
| 3 | `port 3000 already allocated` | `benchmark-frontend`가 3000 사용 중 | `docker-compose.yml` 포트를 `3100:3000`으로 변경 |
| 4 | `port 3100 already allocated` | 이전 컨테이너 `youtube-download-service` 잔존 | `docker stop/rm` 후 재시작 |
| 5 | `EAI_AGAIN` hostname 해석 실패 | Next.js standalone이 컨테이너 hostname을 DNS 해석 시도 | `HOSTNAME=0.0.0.0` 환경변수 추가 |

---

## 1. `npm: command not found`

### 현상
```bash
$ npm run dev
zsh: command not found: npm
```

### 원인
시스템에 Node.js가 설치되어 있지 않음. Homebrew는 설치되어 있었으나(`/opt/homebrew/bin/brew`) node 패키지는 없었음.

### 조사 방법
```bash
which node          # → node not found
which npm           # → npm not found
brew list node      # → Error: No such keg
ls /usr/local/bin/node /opt/homebrew/bin/node  # → No such file
```

### 해결
```bash
brew install node
# 설치 버전: Node.js v26.3.0, npm 11.16.0
```

### 예방
- 프로젝트에 `.nvmrc` 또는 `.node-version` 파일을 추가하여 요구 Node.js 버전을 명시
- Docker를 사용할 경우 호스트 Node.js 불필요 (단, 개발 모드 시 필요)

---

## 2. Python 3.9 × yt-dlp 호환성 오류

### 현상
```python
ImportError: You are using an unsupported version of Python.
Only Python versions 3.10 and above are supported by yt-dlp
```

### 원인
`youtube-dl-exec` npm 패키지가 내부적으로 번들링된 yt-dlp를 실행할 때, 시스템에 설치된 Python을 사용함. macOS의 Xcode Command Line Tools가 제공하는 Python 3.9(`/Applications/Xcode.app/.../Python3.framework/Versions/3.9/`)는 yt-dlp가 요구하는 3.10+를 충족하지 못함.

### 조사 방법
```bash
python3 --version
# → Python 3.9.x (Xcode 번들)
```

### 해결
**Docker 사용** — `Dockerfile`에서 `node:20-bookworm-slim` 이미지가 Python3를 설치하므로 컨테이너 내부에서는 호환 버전의 Python이 제공됨.

Dockerfile의 관련 부분:
```dockerfile
RUN apt-get update && apt-get install -y python3 ffmpeg ca-certificates
```

### 대안 (Docker 미사용 시)
```bash
brew install python@3.12
# PATH에 /opt/homebrew/opt/python@3.12/libexec/bin 추가
```

> ⚠️ 단순히 `brew install python` 만으로는 Xcode의 Python 3.9가 우선될 수 있으므로 PATH 순서 확인 필요

---

## 3. Docker 포트 충돌 — 3000

### 현상
```
Error response from daemon: ... Bind for 0.0.0.0:3000 failed: port is already allocated
```

### 원인
- `docker-compose.yml`의 포트 매핑이 `3000:3000`으로 설정되어 있었음
- 동일 호스트에서 `benchmark-frontend` 컨테이너가 이미 3000 포트를 사용 중
- 또한 `redmine_app`도 8080→3000 매핑으로 3000 사용 중

### 조사 방법
```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
lsof -i:3000
```
→ `benchmark-frontend`가 `0.0.0.0:3000->3000/tcp` 점유 확인

### 해결
`docker-compose.yml`의 포트 매핑을 `3100:3000`으로 변경:
```yaml
ports:
  - "3100:3000"
```

---

## 4. Docker 포트 충돌 — 3100

### 현상
```
Error response from daemon: ... Bind for 0.0.0.0:3100 failed: port is already allocated
```

### 원인
- 과거에 `docker run`으로 실행된 `youtube-download-service` 컨테이너가 `3100:3000` 매핑을 점유 중
- `docker compose down`은 compose로 생성된 컨테이너만 정리하므로, 별도로 생성된 컨테이너는 정리되지 않음

### 조사 방법
```bash
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```
→ `youtube-download-service` Up 상태에서 3100 점유 확인

### 해결
```bash
docker stop youtube-download-service
docker rm youtube-download-service
docker compose up -d
```

---

## 5. `EAI_AGAIN` — Next.js Hostname 해석 실패

### 현상
```
⨯ Failed to start server
Error: getaddrinfo EAI_AGAIN 1f1bca00414b
    at ignore-listed frames {
  errno: -3001,
  code: 'EAI_AGAIN',
  syscall: 'getaddrinfo',
  hostname: '1f1bca00414b'
}
```

컨테이너 상태: `Restarting (1)` 반복

### 원인
Next.js standalone 모드(`node server.js`)에서 서버가 바인딩할 호스트를 결정할 때, Docker 컨테이너의 hostname(예: `1f1bca00414b` — 컨테이너 ID)을 DNS 해석하려 시도함. 컨테이너 내부 DNS가 이 hostname을 해석할 수 없어 `EAI_AGAIN` 오류 발생.

### 조사 방법
```bash
docker logs youtube-download-app
# → getaddrinfo EAI_AGAIN <container-id>
```

### 해결
`docker-compose.yml`에 `HOSTNAME` 환경변수를 명시적으로 `0.0.0.0`으로 설정:
```yaml
environment:
  - NODE_ENV=production
  - PORT=3000
  - HOSTNAME=0.0.0.0
```

이렇게 하면 Next.js가 `0.0.0.0`(모든 인터페이스)에 바인딩되어 hostname DNS 해석을 시도하지 않음.

### 참고
- Next.js 14+ standalone 모델에서 발생하는 알려진 이슈
- `server.js` 내에서 `hostname`이 설정되지 않으면 `os.hostname()`을 사용하는데, Docker 컨테이너에서는 이것이 컨테이너 ID로 설정됨

---

## 최종 Docker 설정

### `docker-compose.yml`
```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: youtube-download-app
    ports:
      - "3100:3000"
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOSTNAME=0.0.0.0
```

### `Dockerfile` (핵심 부분)
```dockerfile
FROM node:20-bookworm-slim AS runner
RUN apt-get update && apt-get install -y python3 ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
```

### 기동 확인
```bash
docker compose down
docker compose up -d --build
docker ps --filter name=youtube-download-app
# → 0.0.0.0:3100->3000/tcp, Status: Up
```

**접속**: http://localhost:3100

---

## 교훈

1. **`docker compose down` ≠ 모든 컨테이너 정리** — compose로 생성되지 않은 컨테이너는 별도 관리 필요
2. **Next.js Docker 배포 시 `HOSTNAME=0.0.0.0` 필수** — standalone 모드의 DNS 이슈 방지
3. **yt-dlp는 Python 3.10+ 요구** — 로컬 개발 환경의 Python 버전 확인 필요
4. **포트 충돌 시 `docker ps` + `lsof` 조합으로 원인 파악** — Docker 컨테이너와 호스트 프로세스 모두 확인
