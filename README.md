# YouTube to MP3 / MP4 Downloader

Next.js 기반의 간단하고 빠른 유튜브 동영상/오디오 다운로드 웹 애플리케이션입니다. `youtube-dl-exec` (yt-dlp 래퍼)와 `ffmpeg`를 활용하여 서버 측에서 미디어를 추출하고 변환하여 사용자에게 제공합니다.

### 🆕 추가 기능 (2026-06-15)

- **쇼트(Shorts) 다운로드 지원**: 채널 쇼트 페이지(`@channel/shorts`) URL 입력 시, 쇼트 영상 목록을 불러와 각 영상별로 MP3 / MP4(720p) / MP4(1080p) 개별 다운로드 가능

### 🆕 추가 기능 (2026-06-11)

- **플레이리스트 지원**: URL에 `list=`가 포함된 재생목록 링크 입력 시, 영상 목록을 불러와 각 영상별로 MP3 / MP4(720p) / MP4(1080p) 개별 다운로드 가능
- **자동 저장 (폴더 지정)**: Chrome/Edge 등 최신 브라우저에서 `Choose Save Folder` 버튼으로 저장 폴더를 한 번 지정하면, 이후 모든 파일이 다이얼로그 없이 자동 저장됨 (File System Access API)
- **Docker Compose 지원**: `docker compose up -d --build` 한 줄로 전체 환경 구성 및 실행

---

## 🛠️ 기술 스택 (Tech Stack)

- **Frontend:** Next.js (App Router), React, CSS Modules (Custom Glassmorphism UI)
- **Backend:** Next.js API Routes (`src/app/api`)
- **Core Library:** 
  - `youtube-dl-exec` (yt-dlp 실행)
  - `ffmpeg-static` (Node.js 환경 내장 FFmpeg 바이너리, 영상/음성 병합 및 mp3 변환용)
- **Environment:** Node.js (v18 이상 권장)

---

## 📁 폴더 구조 (Directory Structure)

```text
YoutubeDownload/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── info/              # 단일 영상 메타데이터 및 포맷 분석 API
│   │   │   │   └── route.js    
│   │   │   ├── playlist/          # 🆕 플레이리스트 정보 API (--flat-playlist)
│   │   │   │   └── route.js
│   │   │   ├── shorts/            # 🆕 쇼트(Shorts) 목록 API (--flat-playlist)
│   │   │   │   └── route.js
│   │   │   └── download/          # 다운로드 처리 로직 (MP3 / MP4)
│   │   │       ├── route.js       # MP3 변환 및 추출 API
│   │   │       └── mp4/
│   │   │           └── route.js   # MP4 (비디오+오디오 병합) 다운로드 API
│   │   ├── layout.js              # Next.js 전역 레이아웃 설정
│   │   ├── page.js                # 메인 클라이언트 페이지 (단일/플레이리스트 분기)
│   │   ├── globals.css            # 전역 스타일 및 디자인 시스템
│   │   └── page.module.css
│   ├── components/
│   │   ├── DownloadButton.js      # 재사용 가능한 다운로드 버튼 컴포넌트
│   │   ├── DownloadFolderPicker.js# 🆕 자동 저장 폴더 선택 버튼 컴포넌트
│   │   ├── PlaylistView.js        # 🆕 플레이리스트 뷰 컴포넌트
│   │   ├── ShortsView.js          # 🆕 쇼트(Shorts) 뷰 컴포넌트
│   │   └── VideoInfo.js           # 썸네일, 제목, 포맷 선택 드롭다운 컴포넌트
│   └── lib/
│       ├── fileDownload.js        # 🆕 File System Access API 파일 저장 유틸리티
│       └── ytdl.js                # yt-dlp 바이너리 자동 탐색 래퍼 (Docker/macOS 호환)
├── doc/
│   ├── DOCKER_TROUBLESHOOTING.md  # 🆕 Docker 기동 트러블슈팅 기록
│   └── ...
├── tmp/                           # 다운로드 및 변환 시 사용되는 임시 파일 저장소 (자동생성)
├── docker-compose.yml             # Docker Compose 설정 (3100:3000)
├── Dockerfile                     # 멀티스테이지 Docker 빌드 (node:20-bookworm-slim)
├── package.json                   # 프로젝트 의존성 관리
├── Plan.md                        # 초기 기획 및 스펙 문서
└── README.md                      # 프로젝트 설명 문서 (현재 파일)
```

---

## ⚙️ 주요 기능 및 사양 (Specifications)

### 1. URL 메타데이터 분석
- 유튜브 링크 입력 시 썸네일, 제목, 영상 길이를 파싱합니다.
- **단일 영상**, **재생목록(플레이리스트)**, **쇼트(Shorts) 페이지** URL을 자동으로 구분하여 처리합니다.

### 2. 플레이리스트 지원 🆕
- URL에 `list=` 파라미터가 포함되어 있으면 자동으로 플레이리스트로 인식합니다.
- `--flat-playlist` 옵션으로 각 영상의 ID, 제목, 길이, 썸네일만 빠르게 추출합니다 (대용량 플레이리스트도 부담 없음).
- 플레이리스트 UI에서 각 영상별로 MP3 / MP4(720p) / MP4(1080p) 개별 다운로드가 가능합니다.
- 각 영상의 다운로드 상태는 독립적으로 관리됩니다.

### 3. 쇼트(Shorts) 다운로드 지원 🆕
- 채널 쇼트 페이지 URL(`https://www.youtube.com/@channel/shorts`)을 입력하면 자동으로 쇼트로 인식합니다.
- URL 경로에 `/shorts`가 포함되어 있으면 쇼트 전용 API(`/api/shorts`)를 호출합니다.
- 세로형(9:16) 썸네일과 함께 쇼트 목록을 표시하며, 각 쇼트별 MP3 / MP4(720p) / MP4(1080p) 다운로드 가능.
- `youtube:player_client=android` extractor args로 쇼트 페이지 추출 안정성 향상.
- 소스는 플레이리스트와 완전히 분리된 `/api/shorts`, `ShortsView` 컴포넌트로 구현되어 있습니다.

### 4. 포맷별 다운로드 지원
- **MP3 다운로드:** 비디오에서 `bestaudio` 오디오 스트림을 추출한 뒤 `ffmpeg`를 통해 MP3 파일로 변환하여 제공.
- **MP4 720p 다운로드:** 720p 이하 최고 화질 비디오 + 오디오 스트림을 `ffmpeg`로 병합하여 완벽한 MP4 파일 제공.
- **MP4 1080p 다운로드:** 1080p 이하 최고 화질 비디오 + 오디오 스트림을 병합하여 제공.

### 5. 자동 파일 저장 (폴더 지정) 🆕
- Chrome / Edge 등 File System Access API 지원 브라우저에서 `Choose Save Folder` 버튼 제공.
- 폴더를 한 번 지정하면 이후 모든 다운로드가 **다운로드 다이얼로그 없이** 자동으로 해당 폴더에 저장됩니다.
- 파일명은 영상 제목을 기반으로 자동 생성됩니다 (특수문자 자동 치환).
- Safari / Firefox 등 미지원 브라우저에서는 버튼이 표시되지 않으며 기존 브라우저 다운로드 방식으로 동작합니다.

### 6. 안정성 처리
- 서버에 기본 `ffmpeg`가 설치되어 있지 않은 환경을 대비하여 `ffmpeg-static`을 내장하여 플랫폼 독립적으로 작동합니다.
- Docker 이미지에는 Python3와 ffmpeg가 내장되어 있어 호스트 환경과 무관하게 안정적으로 동작합니다.

---

## 🚀 실행 방법 (How to run)

### 1. 패키지 설치
프로젝트 루트 디렉토리에서 아래 명령어를 실행하여 필요한 라이브러리를 설치합니다.
```bash
npm install
```

### 2. 개발 서버 실행
로컬 개발 서버를 구동합니다.
```bash
npm run dev
```
- 터미널에 `ready - started server on 0.0.0.0:3000` 메시지가 출력되면 정상 실행된 것입니다.

### 3. 접속 및 사용
브라우저를 열고 아래 주소로 접속합니다.
```text
http://localhost:3000
```
- 화면 중앙의 입력란에 유튜브 링크(예: `https://www.youtube.com/watch?v=ACHMhqDoYgw`)를 넣고 **[Analyze]** 버튼을 누릅니다.
- 분석이 완료되면 하단에 생성되는 **Download MP3** 또는 **Download MP4** 버튼을 클릭하여 파일을 다운로드합니다.

---

## 🐳 도커(Docker)로 실행하기 (권장)

Docker를 사용하면 Python 버전, ffmpeg 설치 등의 환경 설정 없이 바로 실행할 수 있습니다.

### 1. Docker Compose로 빌드 및 실행
```bash
docker compose up -d --build
```
- 컨테이너 이름: `youtube-download-app`
- 포트 매핑: `3100:3000` (호스트 3100 → 컨테이너 3000)
- 접속: **http://localhost:3100**

### 2. 컨테이너 상태 확인
```bash
docker ps --filter name=youtube-download-app
docker logs youtube-download-app
```

### 3. 컨테이너 중지 및 정리
```bash
docker compose down
```

### Dockerfile 구성
- **Base Image**: `node:20-bookworm-slim`
- **내장 패키지**: Python3, ffmpeg, ca-certificates
- **빌드 방식**: 멀티스테이지 (builder → runner)
- **실행 모드**: Next.js standalone (`node server.js`)

> ⚠️ Docker 기동 중 문제가 발생하면 [doc/DOCKER_TROUBLESHOOTING.md](doc/DOCKER_TROUBLESHOOTING.md) 를 참고하세요.


---

## ⚠️ 주의사항
- 본 프로젝트를 퍼블릭 서버에 배포할 경우 여러 사용자의 동시 변환 요청(특히 MP4 병합)으로 인해 서버의 CPU/RAM 리소스가 급격히 소모될 수 있습니다.
- 다운로드 과정에서 생성되는 `tmp/` 폴더 내의 임시 파일들은 현재 스트리밍 완료 후 자동 삭제 로직이 완벽히 적용되어 있지 않으므로, 실 서비스 시에는 주기적인 `tmp/` 폴더 초기화 스크립트 설정이 필요합니다.

---

## 🚨 알려진 이슈: YouTube HTTP 503 Rate Limiting

### 발생 상황 (2026-06-11)
- 한 세션에서 **40개의 다운로드 버튼을 연속 클릭**하여 다운로드를 시도함.
- 약 30~40회차 다운로드 진행 중, YouTube 서버가 **HTTP 503 (Service Unavailable)** 응답을 반환하기 시작함.

### 상세 로그
```
[download] Got error: HTTP Error 503: Service Unavailable. Retrying (1/10)...
[download] Got error: HTTP Error 503: Service Unavailable. Retrying (2/10)...
...
[download] Got error: HTTP Error 503: Service Unavailable. Giving up after 10 retries
```

- 다운로드가 약 **86.7%** 진행된 상태에서 503 오류 발생
- yt-dlp가 자체적으로 10회 재시도했으나 모두 실패
- 오류 발생 명령어: `yt-dlp`가 `--no-check-certificate` 옵션으로 실행됨

### 원인
- **YouTube의 Rate Limiting (속도 제한)**: 짧은 시간 내 대량의 다운로드 요청이 발생하면 YouTube CDN에서 이를 자동으로 차단함.
- **IP 기반 제한**: 동일 IP(도커 컨테이너)에서 연속 다운로드가 감지되면 일시적으로 503 응답을 반환하여 트래픽을 제어함.
- **일시적 현상**: 일정 시간(보통 수십 분 ~ 1시간)이 지나면 IP 제한이 해제되어 정상 다운로드가 가능해짐.

### 대처 방법
1. **대기 후 재시도**: 30분 ~ 1시간 후 다시 다운로드를 시도하면 정상 동작함.
2. **동시 다운로드 자제**: 한 번에 1~2개의 다운로드만 실행하고, 완료 후 다음 파일을 받는 것을 권장.
3. **yt-dlp 업데이트**: 최신 버전의 yt-dlp는 YouTube의 제한 정책에 더 잘 대응하도록 개선됨.
   ```bash
   docker exec youtube-download-app yt-dlp -U
   ```
4. **컨테이너 재시작**: IP 차단이 의심될 경우 Docker 네트워크 재할당을 위해 컨테이너를 재시작.
   ```bash
   docker restart youtube-download-app
   ```
   단, 동일한 네트워크/IP를 사용하므로 근본적인 해결책은 아님.

### 참고
- 이 문제는 **애플리케이션 버그가 아니라 YouTube 서버 정책**에 의한 현상입니다.
- `npm run dev` (로컬 실행) 환경에서도 동일한 제한이 적용될 수 있습니다.
