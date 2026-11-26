# 시스템 성능 진단, 개선책 설계 및 실측 벤치마크 보고서

- **작성일:** 2026-11-26
- **대상 시스템:** YouTube to MP3 / MP4 Downloader (`http://localhost:3100/`)
- **검증 샘플:** `https://www.youtube.com/watch?v=wwhdy7YMYdM` (7분 40초 분량)
- **범위:** 백엔드(`yt-dlp` / `ffmpeg` / 캐시 / 스트리밍), 프론트엔드(렌더링 / 진행률 / 동시성 큐 / WebP), 인프라(Docker / `tmpfs` / Observability 스택)

---

## 1. 현재 시스템 실측 진단 요약

최적화 적용 전 실행 중인 컨테이너 실측 지표(`docker stats`, 프로세스 콜드 스타트, 파일시스템 구조)와 전체 소스 코드를 전수 분석하여 도출한 초기 병목 진단 결과입니다.

| 측정 항목 | 개선 전 실측치 | 핵심 병목 원인 |
| :--- | :--- | :--- |
| **`yt-dlp` 1회 프로세스 기동 오버헤드** | **`547.7ms`** (`--version` 기준) | `node_modules` 번들 `yt-dlp`(3.0MB Python Zipapp)가 매 실행 시 `.pyc` 캐시 없이 압축 해제 및 바이트코드 재컴파일 수행 |
| **단일 영상 분석 → 다운로드 과정** | **YouTube 추출 2회 중복** (총 +3~4초 손실) | [`/api/info`](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/info/route.js)에서 파싱한 메타데이터/포맷 정보를 버리고 다운로드 클릭 시 처음부터 재추출 |
| **목록 조회(`/api/playlist`, `/shorts`, `/channel-videos`)** | **`yt-dlp` 2회 직렬 실행** (+1.5~3.5초) | 본 목록 추출 완료 후에야 [`fetchMembersOnlyIds`](file:///Users/windows/work/Util/YoutubeDownload/src/lib/youtubeHelpers.js)를 순차 실행 + 채널 조회 시 고정 `sleepRequests: 0.5` 대기 |
| **MP3 / MP4 다운로드 TTFB 및 디스크 I/O** | **100% 변환 완료 후 전송 시작** | 전체 파일을 컨테이너 `overlayfs`([`/app/tmp`](file:///Users/windows/work/Util/YoutubeDownload/src/lib/cleanup.js))에 다 쓴 뒤 다시 읽는 Store-and-Forward 구조 |
| **유휴(Idle) 컨테이너 메모리 점유** | **총 `1.46 GiB` 상시 점유** | `app`(`409MiB`) + `otel-collector-contrib`(`377MiB`) + `grafana`(`471MiB`) + `prometheus`(`138MiB`) + `jaeger`(`69MiB`) |

---

## 2. 영역별 핵심 병목 및 개선책

### A. 백엔드 & `yt-dlp` / `ffmpeg` 실행 파이프라인 (가장 큰 속도 향상 구간)

1. **`yt-dlp` Zipapp 탈피 → 사전 컴파일 패키지(`yt-dlp[default]`) 전환 및 JS 캐시 영속화**
   - **문제**: [Dockerfile](file:///Users/windows/work/Util/YoutubeDownload/Dockerfile)에서 기존에 복사하던 `node_modules/youtube-dl-exec/bin/yt-dlp`는 ZIP 압축 스크립트라 호출마다 ~0.55초의 순수 파이썬 로딩 비용이 발생하며, 목록 API처럼 2회 호출 시 1.1초가 낭비됩니다.
   - **개선**: `runner` 스테이지에서 `pip3 install --break-system-packages -U --pre "yt-dlp[default]"`로 `.pyc` 바이트코드가 사전 컴파일된 패키지 및 `urllib3`/`curl_cffi` Keep-Alive 의존성을 설치하고, `/var/cache/yt-dlp`(`youtube-sigfuncs`)를 Docker 볼륨으로 유지합니다.
   - **기대 효과**: 프로세스 스폰 오버헤드 단축 및 컨테이너 재배포 후 첫 요청의 Deno JS 챌린지 지연 제거.

2. **메타데이터/Info-JSON 단기 인메모리 캐시 + Singleflight(중복 요청 병합)**
   - **문제**: [`page.js`](file:///Users/windows/work/Util/YoutubeDownload/src/app/page.js)에서 `Analyze`로 [`/api/info`](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/info/route.js)를 호출(약 3.5초)한 직후 다운로드 버튼을 누르면, 다운로드 라우트가 또다시 `yt-dlp`로 동일 URL의 메타데이터와 스트림 서명을 처음부터 추출합니다.
   - **개선**:
     - 정규화된 URL/영상 ID 기준 **LRU + TTL 캐시(3~5분)** 및 동일 URL 동시 요청을 하나로 묶는 **In-flight Promise 공유(Singleflight)** 도입.
     - `/api/info` 수행 시 추출한 경량 `info_dict` JSON을 메모리에 잠시 보관하고 다운로드 시 `--load-info-json`으로 재사용(만료 시 실시간 추출로 자동 폴백).
   - **기대 효과**: 분석 직후 다운로드 시작 대기 시간(TTFB) **2.5~3.5초 즉시 단축**, 동일 목록 재조회 **`3.5s` → `10ms 이하`**.

3. **MP3 실시간 파이프 스트리밍(Zero-Disk Pipe) 전환 및 `ffmpeg` 멀티스레드 인코딩**
   - **문제**: 기존 [`/api/download`](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/download/route.js)는 오디오 원본 전체 다운로드 완료 → `ffmpeg` 단일 스레드 MP3 변환 완료 → 그제야 첫 바이트 전송 순서로 직렬 동작했습니다.
   - **개선**: MP3는 스트리밍 친화 포맷이므로 `yt-dlp -f bestaudio/best -o -`의 `stdout`을 `ffmpeg -threads 0 -i pipe:0 -vn -codec:a libmp3lame -q:a 2 -f mp3 pipe:1`로 직결하여 Web `ReadableStream`으로 즉시 응답합니다.
   - **기대 효과**: 디스크 읽기/쓰기 **0바이트**, 장시간 영상의 MP3 다운로드 **TTFB `10~25초` → `2초대`로 단축**.

4. **MP4 병합용 `tmpfs`(RAM 디스크) 마운트 + 스트리밍 청크 확대 + 취소 시그널 전파**
   - **문제**:
     - [`/api/download/mp4`](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/download/mp4/route.js)가 느린 컨테이너 `overlayfs` 위에서 비디오·오디오 조각 저장 및 병합(Muxing)을 수행해 디스크 I/O가 2배로 발생합니다.
     - [`cleanup.js`](file:///Users/windows/work/Util/YoutubeDownload/src/lib/cleanup.js)가 `64KB` 단위로 `Buffer.allocUnsafe` 및 `fileHandle.read`를 반복 호출하며, 실행 중 클라이언트가 취소해도 `request.signal`이 서브프로세스에 전달되지 않아 좀비 `yt-dlp`/`ffmpeg`가 끝까지 CPU를 소모합니다.
   - **개선**:
     - [docker-compose.yml](file:///Users/windows/work/Util/YoutubeDownload/docker-compose.yml)에서 `/app/tmp`에 `tmpfs: size=1024m`를 마운트하여 MP4 조각 수집·병합을 100% 메모리에서 처리.
     - 스트리밍 청크 크기를 `64KB` → `256KB` 단일 재사용 버퍼로 상향(시스템 콜 4배 감소).
     - [`ytdl.js`](file:///Users/windows/work/Util/YoutubeDownload/src/lib/ytdl.js) 호출 시 `{ signal: request.signal }`을 전달하여 연결 중단 즉시 대기열 이탈 및 자식 프로세스 `SIGTERM` 종료.

5. **세마포어 큐 이원화(Bulkhead) 및 채널/플레이리스트 조회 병렬화**
   - **문제**:
     - 단일 세마포어를 공유하면 1080p 다운로드 4건이 돌 때 단순 URL 분석(`/api/info`)까지 모두 블로킹됩니다.
     - [`playlist/route.js`](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/playlist/route.js), [`shorts/route.js`](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/shorts/route.js), [`channel-videos/route.js`](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/channel-videos/route.js)가 본 목록 조회 후에 [`fetchMembersOnlyIds`](file:///Users/windows/work/Util/YoutubeDownload/src/lib/youtubeHelpers.js)를 직렬 대기하며, 채널 조회는 고정 `sleepRequests: 0.5` 지연을 강제합니다.
   - **개선**:
     - **메타데이터 전용 세마포어(`meta`, 동시성 6)**와 **다운로드 전용 세마포어(`download`, 동시성 4)** 분리.
     - `@handle → channelId` 캐시를 도입하여 재방문 채널 및 `UC...` 채널 URL에서 본 목록과 멤버십 목록을 동시 병렬 조회하고, 멤버십 미운영 채널의 404 결과는 6시간 네거티브 캐싱 적용.
     - 채널 목록 초기 조회 시 무조건적인 `sleepRequests: 0.5`를 제거하고 `429` 레이트 리밋 발생 시에만 백오프 재시도.

---

### B. 프론트엔드 렌더링 및 네트워크 최적화

1. **중첩 `backdrop-filter: blur(12px)` 제거 및 스크롤 GPU 부하 해소**
   - **문제**: [`VideoListView.js`](file:///Users/windows/work/Util/YoutubeDownload/src/components/VideoListView.js)에서 외곽 `.glass-panel` 내부의 개별 카드 20개 모두에 다시 `glass-panel`(`backdrop-filter: blur(12px)`)을 부여했고, [`globals.css`](file:///Users/windows/work/Util/YoutubeDownload/src/app/globals.css)의 `body { background-attachment: fixed }`와 결합되어 스크롤 시 매 프레임 21개 이상의 실시간 블러 합성 연산이 발생했습니다.
   - **개선**: 내부 아이템 카드(`.video-card-surface`)에서는 `backdrop-filter`를 제거하고 경량 반투명 배경 + `content-visibility: auto`를 적용하며, 배경 그라데이션은 고정 GPU 레이어(`body::before { position: fixed }`)로 분리합니다. 아울러 [`globals.css`](file:///Users/windows/work/Util/YoutubeDownload/src/app/globals.css) 내 미사용 레거시 `.shorts-view` / `.channel-view` 규칙(~300줄)을 정리합니다.

2. **개별 카드 `React.memo` 분리, WebP 썸네일 전환 및 클라이언트 동시 다운로드 큐**
   - **문제**: 버튼 1개의 상태만 바뀌어도 현재 페이지의 20개 카드와 60개 버튼이 모두 리렌더링되며, `img.youtube.com` JPEG 썸네일로 인한 도메인 리다이렉트 및 전송량 부담이 존재했습니다.
   - **개선**:
     - 개별 행을 `React.memo`(`VideoCardItem`) 컴포넌트로 분리하고 `useCallback` 핸들러 적용.
     - 썸네일을 직결 CDN WebP(`https://i.ytimg.com/vi_webp/${id}/mqdefault.webp`, 실패 시 `jpg` 자동 폴백) + [`layout.js`](file:///Users/windows/work/Util/YoutubeDownload/src/app/layout.js) `<link rel="preconnect" href="https://i.ytimg.com" />`로 교체(이미지 전송량 35~45% 감소).
     - `TransformStream`(150ms 스로틀링) 기반 **실시간 다운로드 진행률(`%` / `MB`) 표시** 및 다중 클릭 시 브라우저 소켓 고갈을 막는 **클라이언트 동시성 큐(최대 3개 병렬)** 추가.

---

### C. Docker 이미지 및 관측성(Observability) 메모리 다이어트

1. **미사용 패키지(`sharp` 34MB) 정리 및 Node V8 힙 상한 조정**
   - 컨테이너 내부 `/app/node_modules/@img` (`sharp` 34MB, 앱에서 `next/image` 미사용) 및 중복 구형 Zipapp 바이너리를 제거하고 `NODE_OPTIONS="--max-old-space-size=256"`을 적용하여 앱 컨테이너 유휴 메모리를 대폭 절감합니다.
2. **관측 스택(`otel-collector`, `jaeger`, `prometheus`, `grafana`) 리소스 최적화**
   - 각 Go 런타임 컨테이너에 `GOMEMLIMIT` 및 컨테이너 메모리 상한(`deploy.resources.limits.memory`), [otel-collector-config.yaml](file:///Users/windows/work/Util/YoutubeDownload/otel-collector-config.yaml) `memory_limiter` 프로세서를 적용하고, [prometheus.yml](file:///Users/windows/work/Util/YoutubeDownload/prometheus.yml)의 `scrape_interval`을 `5s` → `15s`로 조정합니다.

---

## 3. 권장 적용 우선순위 요약

| 단계 | 적용 항목 | 예상 체감 효과 |
| :--- | :--- | :--- |
| **1순위 (체감 속도 직결)** | `yt-dlp[default]` 프리컴파일 전환 + API/Info 캐시(Singleflight) + 세마포어 분리 + 멤버십 병렬/네거티브 캐싱 | URL 분석 및 다운로드 시작 속도 **40~70% 단축** |
| **2순위 (다운로드 I/O 혁신)** | MP3 실시간 파이프 스트리밍(Zero-Disk) + MP4용 `/app/tmp` `tmpfs` 마운트 + 취소 시 프로세스 즉시 종료 + 256KB 청크 | MP3 실시간 스트리밍 즉시 진입, 물리 디스크 쓰기 제거 |
| **3순위 (UI & 인프라 경량화)** | 중첩 `backdrop-filter` 제거 + `React.memo`/진행률 `%` 표시 + WebP 썸네일 + 관측성 스택 메모리 최적화 | 스크롤 60fps 유지, 전체 RAM 대폭 절감 |

---

## 4. 적용 전후 실측 성능 비교 (`http://localhost:3100/` 기준)

1~3순위 전체 항목을 코드 및 Docker 환경에 반영하여 재빌드(`docker compose up -d --build`)한 뒤 측정한 실제 벤치마크 결과입니다.

### 4-1. 속도 및 디스크 I/O 개선 실측치

| 측정 항목 | 개선 전 | 개선 후 | 결과 요약 |
| :--- | :--- | :--- | :--- |
| **`yt-dlp` 프로세스 콜드 스타트** | `547.7 ms` (Zipapp) | **`317.0 ms`** (`.pyc` 프리컴파일) | **42.1% 단축** (스폰당 ~231ms 절약) |
| **`GET /api/info` 재조회 응답** | `~3,570 ms` | **`9.8 ms`** (`X-Cache: HIT`) | **약 360배 단축** (`0.0098s`) |
| **`1080p MP4` 다운로드 (21.7MB)** | `~7.10초` (OverlayFS 경유) | **총 `2.22초`** (`TTFB 2.06초`) | **3.2배 가속** (`--load-info-json` + `tmpfs` + 8-스레드 병렬 조각) |
| **`MP3` 다운로드 (7.67MB) TTFB** | 전체 변환 후 전송 (`7~12초`) | **`TTFB 2.50초`** (`zero-disk-pipe`) | **디스크 쓰기 0B**, 실시간 파이프 즉시 전송 |
| **컨테이너 물리 디스크 I/O** | 다운로드마다 수백 MB 누적 | **`0B` 읽기 / `131KB` 쓰기** | `/app/tmp` `tmpfs`(1GB RAM 디스크) 처리 |

### 4-2. 컨테이너 메모리 점유율 절감 실측치 (`docker stats`)

| 컨테이너 | 개선 전 | 개선 후 (MP3·MP4 다운로드 직후) | 절감률 |
| :--- | :--- | :--- | :--- |
| **`youtube-download-app`** | `409.0 MiB` | **`111.4 MiB`** | **-72.8%** (`-297.6 MiB`) |
| **`otel-collector`** | `376.7 MiB` | **`43.3 MiB`** | **-88.5%** (`-333.4 MiB`) |
| **`grafana`** | `470.9 MiB` | **`144.2 MiB`** | **-69.4%** (`-326.7 MiB`) |
| **`prometheus`** | `137.8 MiB` | **`27.1 MiB`** | **-80.3%** (`-110.7 MiB`) |
| **`jaeger`** | `69.1 MiB` | **`14.8 MiB`** | **-78.6%** (`-54.3 MiB`) |
| **전체 5개 컨테이너 합계** | **`1,463.5 MiB` (`1.43 GiB`)** | **`340.8 MiB` (`0.33 GiB`)** | **총 `-1,122.7 MiB` (-76.7% 절감)** |

---

## 5. 반영된 주요 변경 내역

1. **코어 실행 엔진·세마포어 격리·캐시 계층**
   - [src/lib/cache.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/cache.js): O(1) LRU+TTL 캐시, 동시 중복 요청을 1회 실행으로 묶는 `withSingleflight`, 다운로드 시 재추출을 생략하기 위한 경량 `info_dict` 캐시(`rawInfoJsonCache`) 구현.
   - [src/lib/ytdl.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/ytdl.js): 메타데이터 풀(`meta`, 동시성 6)과 다운로드 풀(`download`, 동시성 4) 세마포어 이원화, `AbortSignal` 연동 대기열 즉시 이탈 및 자식 프로세스 `SIGTERM` 회수, `--load-info-json` 재사용(만료 시 자동 폴백) 적용.
   - [src/lib/youtubeHelpers.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/youtubeHelpers.js) & 메타데이터 라우트([src/app/api/info/route.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/info/route.js), [src/app/api/playlist/route.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/playlist/route.js), [src/app/api/shorts/route.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/shorts/route.js), [src/app/api/channel-videos/route.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/channel-videos/route.js)): `@handle → UC...` 매핑 캐시 기반 멤버십 병렬 조회, 미운영 채널 6시간 네거티브 캐싱, 채널 조회의 고정 `sleepRequests: 0.5` 제거(429 발생 시에만 조건부 백오프).

2. **무디스크 MP3 파이프 스트리밍 & 고속 MP4 파이프라인**
   - [src/app/api/download/route.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/download/route.js): `yt-dlp (stdout)` → `ffmpeg -threads 0 libmp3lame (stdout)` → Web `ReadableStream` 실시간 직결 파이프 전환(첫 청크 전 차단/권한 오류 발생 시 기존 한국어 에러 JSON 그대로 반환).
   - [src/app/api/download/mp4/route.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/api/download/mp4/route.js) & [src/lib/cleanup.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/cleanup.js): `tmpfs` 메모리 디스크 병합, `concurrentFragments: 8`, `ffmpeg -threads 0 -movflags +faststart`, `256KB` 단일 재사용 스트리밍 버퍼 적용.

3. **프론트엔드 렌더링 경량화·진행률 UI·동시성 큐**
   - [src/components/VideoListView.js](file:///Users/windows/work/Util/YoutubeDownload/src/components/VideoListView.js), [src/components/DownloadButton.js](file:///Users/windows/work/Util/YoutubeDownload/src/components/DownloadButton.js), [src/lib/fileDownload.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/fileDownload.js), [src/app/page.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/page.js): 개별 카드 `React.memo`(`VideoCardItem`) 분리, `TransformStream` 기반 실시간 진행률(`%` / `MB`) 표시, 브라우저 동시 다운로드 큐(최대 3개 병렬 + `대기중...` 자동 실행), `i.ytimg.com/vi_webp` WebP 썸네일(+ JPG 자동 폴백) 적용.
   - [src/app/globals.css](file:///Users/windows/work/Util/YoutubeDownload/src/app/globals.css), [src/app/layout.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/layout.js), [next.config.mjs](file:///Users/windows/work/Util/YoutubeDownload/next.config.mjs): 개별 카드의 중첩 `backdrop-filter` 및 `background-attachment: fixed` 제거(`body::before` 고정 레이어 + `content-visibility: auto`), 미사용 레거시 CSS ~300줄 정리, `i.ytimg.com` `preconnect` 및 응답 압축 설정 추가.

4. **Docker & 관측성 스택 다이어트**
   - [Dockerfile](file:///Users/windows/work/Util/YoutubeDownload/Dockerfile), [docker-compose.yml](file:///Users/windows/work/Util/YoutubeDownload/docker-compose.yml), [otel-collector-config.yaml](file:///Users/windows/work/Util/YoutubeDownload/otel-collector-config.yaml), [prometheus.yml](file:///Users/windows/work/Util/YoutubeDownload/prometheus.yml): 사전 컴파일 `yt-dlp[default]` 설치, `/app/tmp` `tmpfs` 마운트, `/var/cache/yt-dlp` 볼륨 영속화, 미사용 `@img/sharp`(34MB) 제거, `NODE_OPTIONS` 및 Go `GOMEMLIMIT`/`memory_limiter` 적용, Prometheus 스크랩 주기 `5s → 15s` 조정.
