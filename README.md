# YouTube to MP3 / MP4 Downloader

Next.js 기반의 간단하고 빠른 유튜브 동영상/오디오 다운로드 웹 애플리케이션입니다. `youtube-dl-exec` (yt-dlp 래퍼)와 `ffmpeg`를 활용하여 서버 측에서 미디어를 추출하고 변환하여 사용자에게 제공합니다.

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
│   │   │   ├── info/           # URL 메타데이터 및 포맷 분석 API
│   │   │   │   └── route.js    
│   │   │   └── download/       # 다운로드 처리 로직 (MP3 / MP4)
│   │   │       ├── route.js    # MP3 변환 및 추출 API
│   │   │       └── mp4/
│   │   │           └── route.js # MP4 (비디오+오디오 병합) 다운로드 API
│   │   ├── layout.js           # Next.js 전역 레이아웃 설정
│   │   ├── page.js             # 메인 클라이언트 페이지 (검색바, 결과 표시)
│   │   ├── globals.css         # 전역 스타일 및 디자인 시스템
│   │   └── page.module.css
│   ├── components/
│   │   ├── DownloadButton.js   # 재사용 가능한 다운로드 버튼 컴포넌트
│   │   └── VideoInfo.js        # 썸네일, 제목, 포맷 선택 드롭다운 컴포넌트
├── tmp/                        # 다운로드 및 변환 시 사용되는 임시 파일 저장소 (자동생성)
├── package.json                # 프로젝트 의존성 관리
├── Plan.md                     # 초기 기획 및 스펙 문서
└── README.md                   # 프로젝트 설명 문서 (현재 파일)
```

---

## ⚙️ 주요 기능 및 사양 (Specifications)

1. **URL 메타데이터 분석**
   - 유튜브 링크 입력 시 썸네일, 제목, 영상 길이를 파싱합니다.
   - 재생목록 URL(`&list=...`)이 입력되어도 속도 저하를 방지하기 위해 단일 영상(`--no-playlist`)으로만 처리합니다.

2. **포맷별 다운로드 지원**
   - **MP3 다운로드:** 비디오에서 오디오만 추출한 뒤 `ffmpeg`를 통해 MP3 파일로 변환하여 스트리밍 다운로드 제공.
   - **MP4 다운로드:** 고화질(최대 720p) 비디오와 오디오 스트림을 각각 다운로드한 뒤 서버에서 `ffmpeg`로 병합하여 완벽한 MP4 파일 제공.

3. **안정성 처리**
   - 서버에 기본 `ffmpeg`가 설치되어 있지 않은 환경을 대비하여 `ffmpeg-static`을 내장하여 플랫폼 독립적으로 작동합니다.
   - 윈도우/맥/리눅스 어디서나 동일한 로직으로 다운로드 및 병합이 가능합니다.

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

## 🐳 도커(Docker)로 실행하기
프로젝트에 포함된 `Dockerfile`을 통해 도커 컨테이너 환경에서 애플리케이션을 구동할 수 있습니다. `youtube-dl-exec` 동작을 위해 필요한 파이썬과 FFmpeg가 내장되어 있어 환경 설정이 훨씬 간편합니다.

### 1. 도커 이미지 빌드
```bash
docker build -t youtube-download .
```

### 2. 도커 컨테이너 실행
```bash
docker run -d -p 3000:3000 --name youtube-download-service youtube-download
```
- 컨테이너가 정상적으로 실행되면 브라우저에서 `http://localhost:3000`으로 접속하여 서비스를 이용할 수 있습니다.

### 3. 도커 서비스 정지 및 정리
사용이 끝난 후 컨테이너를 중지하고 정리하려면 아래 명령어를 사용합니다.
```bash
docker stop youtube-download-service
docker rm youtube-download-service
docker rmi youtube-download
```


---

## ⚠️ 주의사항
- 본 프로젝트를 퍼블릭 서버에 배포할 경우 여러 사용자의 동시 변환 요청(특히 MP4 병합)으로 인해 서버의 CPU/RAM 리소스가 급격히 소모될 수 있습니다.
- 다운로드 과정에서 생성되는 `tmp/` 폴더 내의 임시 파일들은 현재 스트리밍 완료 후 자동 삭제 로직이 완벽히 적용되어 있지 않으므로, 실 서비스 시에는 주기적인 `tmp/` 폴더 초기화 스크립트 설정이 필요합니다.
