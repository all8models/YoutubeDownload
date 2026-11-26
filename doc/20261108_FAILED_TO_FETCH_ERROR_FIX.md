# YouTube 다운로드 시 `Failed to fetch` 오류 원인 분석 및 대응 보고서

- **작성일:** 2026-11-08
- **대상 URL:** `https://www.youtube.com/watch?v=wwhdy7YMYdM` (`The Chain Rule Explained Visually (With Examples)`)
- **발생 환경:** `http://localhost:3100/` (Docker `youtube-download-app` 컨테이너)
- **관련 프로젝트:** YouTube to MP3 / MP4 Downloader (Next.js 16 + yt-dlp + Docker)

---

## 1. 증상 (Symptom)

- `http://localhost:3100/` 접속 후 `https://www.youtube.com/watch?v=wwhdy7YMYdM` URL을 입력하여 분석(Analyze)하거나 **1080p / 720p / MP3** 다운로드 버튼을 클릭했을 때 화면에 **`Failed to fetch`** 에러 배너가 표시됨.
- Jaeger 분산 추적(`http://localhost:16686`) 로그 확인 결과:
  - `15:49:19` — `GET /api/info?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dwwhdy7YMYdM` (`200 OK`, 3.57초 소요)
  - `15:49:24`, `15:50:35`, `15:56:37` — `GET /api/download/mp4?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dwwhdy7YMYdM&quality=1080` 호출 시 서버 측 변환(약 7.1초) 후 응답 스트리밍 단계 또는 요청 직후 클라이언트에서 `TypeError: Failed to fetch` 발생.

---

## 2. 원인 분석 (Root Cause)

### 2-1. 장기 미갱신 Docker 컨테이너 및 구버전 `yt-dlp` 구동
- `http://localhost:3100/`은 로컬 Node 프로세스가 아닌 Docker 컨테이너(`youtube-download-app`, `0.0.0.0:3100->3000/tcp`)가 서빙하고 있었음.
- 해당 컨테이너는 **2개월 전(2026-08-22) 빌드된 이미지** 상태로 구동 중이었으며, 내부 `yt-dlp` 버전도 `2026.08.04.234419`에 머물러 있어 로컬 코드의 최신 수정 사항이 전혀 반영되지 않은 상태였음.

### 2-2. File System Access API(`showDirectoryPicker`) 호출 타이밍 및 스트림 이중 소비 충돌
- 사용자가 **Choose Save Folder** 기능(`downloadDirHandle`)을 활성화한 상태에서, 저장 대상 폴더(`/Users/windows/Downloads/엔지니어 J의 공학노트/`)에 이미 동일 파일(`The Chain Rule Explained Visually (With Examples).mp4`, 권한 `-rw-------@`)이 존재하고 있었음.
- 기존 [src/lib/fileDownload.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/fileDownload.js)의 `saveResponseStream` 흐름은 **`await fetch(endpoint)`가 완료된 이후(약 7~15초 경과 후)** 폴더 권한 확인(`requestPermission`), 중복 파일 확인(`window.confirm`), 파일 쓰기(`pipeTo`)를 수행했음:

| 단계 | 기존 동작 (`fetch` 완료 후 실행) | 발생한 문제점 |
|---|---|---|
| ① 권한 확인 | `dirHandle.requestPermission({ mode: 'readwrite' })` | `fetch` 대기(7초 이상) 후에는 브라우저의 **Transient User Activation(5초)**이 만료되어 권한 요청이 거부됨 |
| ② 중복 파일 확인 | `fileExists` → `window.confirm` 블로킹 모달 대기 | 모달이 떠 있는 동안 서버의 Push 기반 `fs.createReadStream`이 백프레셔 없이 데이터를 밀어내어 연결이 유실되거나 중단됨 |
| ③ 스트림 저장 실패 시 폴백 | `await response.body.pipeTo(writable)` 실패 후 `catch` 블록에서 `await response.blob()` 호출 | `pipeTo()` 시작 시점에 이미 `response.body`가 잠기거나 소비(`response.bodyUsed === true`)되어 `response.blob()`에서 `TypeError` 예외가 발생함 |

### 2-3. 서버 스트리밍 백프레셔(Backpressure) 미지원
- 기존 `/api/download` 및 `/api/download/mp4` 라우트는 Node.js의 Push 스트림인 `fs.createReadStream(tempPath)`을 그대로 `new NextResponse(fileStream)`에 전달했음.
- 클라이언트가 파일 다이얼로그 대기 등으로 수신을 일시 멈추거나 연결이 재설정될 때 Web `ReadableStream`의 Pull 백프레셔와 맞물리지 않아 스트림 에러 및 임시 파일 조기 삭제 위험이 존재했음.

### 2-4. HTTP Keep-Alive(5초) 유휴 소켓 종료 경합
- Node.js 기본 `Keep-Alive: timeout=5` 설정으로 인해, `GET /api/info` 완료(`15:49:19`) 후 정확히 **5초 뒤(`15:49:24`)** 다운로드 버튼을 클릭했을 때 서버가 유휴 소켓을 닫는 시점과 브라우저의 소켓 재사용 시점이 겹치면서 간헐적인 `TypeError: Failed to fetch`가 발생함.

---

## 3. 대응 및 개선 내용 (Resolution)

### 변경 파일 요약

| # | 파일 | 주요 변경 내용 |
|---|---|---|
| 1 | [src/lib/fileDownload.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/fileDownload.js) | `fetch()` 호출 **전** 폴더 권한·중복 파일명을 먼저 확정하는 `prepareDirectoryTarget` 도입, `response.bodyUsed` 검사 및 `triggerNativeBrowserDownload` 폴백 추가 |
| 2 | [src/lib/cleanup.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/cleanup.js) | `fs.promises.open` 기반의 Pull 방식 Web `ReadableStream` (`createStreamingFileResponse`) 구현 및 안전한 `/tmp` 파일 정리 |
| 3 | [src/components/VideoListView.js](file:///Users/windows/work/Util/YoutubeDownload/src/components/VideoListView.js) | `prepareDirectoryTarget` 선행 호출, `fetchWithRetry`(`cache: 'no-store'`) 재시도 및 네이티브 브라우저 다운로드 폴백 적용 |
| 4 | [src/app/page.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/page.js) | `/api/info`, `/api/playlist`, `/api/shorts`, `/api/channel-videos` 호출 시 Keep-Alive 소켓 리셋 대비 `fetchApi` 자동 재시도 적용 |
| 5 | [Dockerfile](file:///Users/windows/work/Util/YoutubeDownload/Dockerfile) | 런타임(`runner`) 스테이지에서도 `yt-dlp --update-to nightly`가 실행되도록 개선 및 컨테이너 재빌드 |

---

### 3-1. [src/lib/fileDownload.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/fileDownload.js) — 선(先) 폴더 검증 및 안전한 폴백

1. **`prepareDirectoryTarget(filename, dirHandle)` 추가**:
   - 사용자가 다운로드 버튼을 클릭한 직후(`fetch()` 실행 전, User Activation이 유효한 상태)에 폴더 쓰기 권한(`queryPermission` / `requestPermission`)과 중복 파일 존재 여부(`handleDuplicateFile`)를 먼저 확인하여 최종 저장 파일명을 확정합니다.
2. **스트림 소비 상태(`response.bodyUsed`) 확인 및 네이티브 폴백**:
   - `response.body.pipeTo(writable)` 도중 권한/파일 잠금 오류 등으로 실패한 경우, 이미 소비된 `response.body`에 `response.blob()`을 호출하지 않고 `triggerNativeBrowserDownload(options.fallbackUrl, filename)`로 즉시 전환하여 브라우저 기본 다운로드로 안전하게 처리합니다.

```js
// src/lib/fileDownload.js 핵심 구조
export async function prepareDirectoryTarget(filename, dirHandle) {
  const safeName = sanitizeFilename(filename);
  if (!dirHandle) return { finalFilename: safeName, activeDirHandle: null, cancelled: false };

  // fetch 시작 전에 권한 확인 및 중복 파일 확인 수행 (User Gesture 유지 상태)
  if (typeof dirHandle.queryPermission === 'function') {
    let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && typeof dirHandle.requestPermission === 'function') {
      perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') return { finalFilename: safeName, activeDirHandle: null, cancelled: false };
  }

  const finalFilename = await handleDuplicateFile(dirHandle, safeName);
  if (finalFilename === null) return { finalFilename: null, activeDirHandle: dirHandle, cancelled: true };
  return { finalFilename, activeDirHandle: dirHandle, cancelled: false };
}
```

### 3-2. [src/lib/cleanup.js](file:///Users/windows/work/Util/YoutubeDownload/src/lib/cleanup.js) — Pull 기반 Web `ReadableStream` 스트리밍

- Node.js `fs.createReadStream` 대신 `fs.promises.open(tempPath, 'r')` 파일 핸들과 Web `ReadableStream`의 `pull(controller)` 메서드를 사용하여, 클라이언트가 데이터를 읽어가는 속도에 맞춰 **64KB 청크 단위로 읽어서 전송**하도록 개선했습니다.
- 스트림이 끝까지 전송되거나 클라이언트 연결이 중단(`cancel` / `signal.addEventListener('abort')`)될 때만 파일 핸들을 닫고 임시 파일(`.mp4`, `.mp3`, `.part`, `.ytdl`)을 삭제합니다.

### 3-3. [src/components/VideoListView.js](file:///Users/windows/work/Util/YoutubeDownload/src/components/VideoListView.js) & [src/app/page.js](file:///Users/windows/work/Util/YoutubeDownload/src/app/page.js) — Keep-Alive 재시도

- `fetchWithRetry` 및 `fetchApi` 헬퍼를 통해 `cache: 'no-store'`를 기본 적용하고, 유휴 Keep-Alive 소켓 종료로 인한 `TypeError: Failed to fetch` 발생 시 새 소켓으로 즉시 1회 자동 재시도하도록 보강했습니다.
- 만약 재시도 후에도 `fetch` 자체가 실패할 경우 `triggerNativeBrowserDownload(endpoint, finalFilename)`로 브라우저 직접 다운로드를 수행합니다.

### 3-4. [Dockerfile](file:///Users/windows/work/Util/YoutubeDownload/Dockerfile) — 컨테이너 재빌드 및 `yt-dlp` 최신화

- `docker compose up -d --build app`을 통해 `http://localhost:3100/` 컨테이너 이미지를 최신 소스 코드로 재빌드하고, 컨테이너 내부 `yt-dlp`를 `nightly@2026.08.04.234419` → **`nightly@2026.11.04.232659`**로 업데이트했습니다.

---

## 4. 검증 결과 (Verification)

1. **ESLint 및 프로덕션 빌드 검증**:
   - `npm run lint` → 에러 0건, 경고 0건 통과
   - `npm run build` → Next.js 16.2.6 Standalone 프로덕션 빌드 정상 완료
2. **`http://localhost:3100/` API 및 다운로드 검증**:
   - 메타데이터 조회 (`GET /api/info`):
     ```bash
     curl -s "http://localhost:3100/api/info?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dwwhdy7YMYdM"
     ```
     → `HTTP 200 OK`, 제목 `"The Chain Rule Explained Visually (With Examples)"` 및 오디오/비디오 포맷 정상 반환.
   - 1080p MP4 다운로드 스트리밍 (`GET /api/download/mp4`):
     ```bash
     curl -s -D - -o /tmp/test_1080.mp4 "http://localhost:3100/api/download/mp4?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dwwhdy7YMYdM&quality=1080"
     ```
     → `HTTP/1.1 200 OK`, `content-length: 21727052` (21.7MB) 정상 수신 완료 및 컨테이너 내부 `/tmp` 임시 파일 즉시 삭제 확인.

