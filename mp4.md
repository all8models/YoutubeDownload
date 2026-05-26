# MP4 비디오 다운로드 기능 추가 구현 계획

이전 단계에서 구현한 MP3(오디오) 다운로드 기능에 이어, 원래 계획(`Plan.md`)에 명시된 MP4(비디오) 다운로드 기능을 추가로 구현하기 위한 계획입니다.

## 제안하는 변경 사항 (Proposed Changes)

### 1. 백엔드 API 수정 (`src/app/api/...`)
#### [MODIFY] `src/app/api/info/route.js`
- 기존에는 오디오 포맷만 추출했지만, 비디오 포맷(MP4)도 함께 추출하도록 로직을 수정합니다.
- 해상도별(360p, 720p, 1080p 등)로 비디오 포맷 목록을 수집하고 필터링합니다.

#### [MODIFY] `src/app/api/download/route.js`
- 클라이언트가 요청한 타입(audio 또는 video)에 따라 `yt-dlp`의 인자(arguments)를 분기 처리합니다.
- 비디오 다운로드 요청 시: `format` 옵션을 클라이언트가 선택한 비디오 화질과 최적의 오디오를 병합하는 포맷(예: `137+140` 또는 `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best`)으로 설정하여 스트리밍합니다.
- 응답 헤더의 `Content-Type`을 `video/mp4`로 설정하고 파일 확장자를 `.mp4`로 내려줍니다.

### 2. 프론트엔드 UI 수정 (`src/components/...` 및 `src/app/...`)
#### [MODIFY] `src/components/VideoInfo.js`
- 포맷 선택 UI(`select`)를 수정하여 "Audio (MP3)" 목록과 "Video (MP4)" 목록을 그룹화(`<optgroup>`)하여 모두 보여줍니다.

#### [MODIFY] `src/app/page.js`
- 다운로드 완료 후 생성하는 파일명과 확장자를 사용자가 선택한 포맷 타입(audio/video)에 맞춰 동적으로 지정(`.mp3` 또는 `.mp4`)하도록 수정합니다.
- 다운로드 버튼의 텍스트가 현재 선택된 타입에 맞게 "Download MP3" 또는 "Download MP4"로 바뀌도록 조정합니다.

## 미해결 질문 및 사용자 검토 (Open Questions)

> [!IMPORTANT]  
> 비디오 포맷의 경우, 고해상도(예: 1080p 이상) 영상은 영상 스트림과 오디오 스트림이 분리되어 있어 서버에서 `yt-dlp`가 이를 병합(muxing)해야 할 수 있습니다. 이 경우 서버 자원(CPU, 메모리)을 꽤 소모하게 됩니다. 
> MVP 단계에서는 서버 부하를 줄이기 위해 별도의 병합 과정 없이 **이미 영상과 오디오가 합쳐져 있는 기본 최고 화질(주로 720p 이하)**만 제공하도록 할까요, 아니면 1080p 이상의 고화질 병합까지 모두 지원하도록 설정할까요?
