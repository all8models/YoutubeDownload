# Project Sequence Diagrams

이 프로젝트의 주요 이벤트 흐름을 시퀀스 다이어그램으로 정리하였습니다. Mermaid 문법을 사용하여 작성되었습니다.

---

## 1. 비디오 정보 분석 (Analyze Video Info)
사용자가 URL을 입력하고 'Analyze' 버튼을 눌렀을 때의 흐름입니다.

```mermaid
sequenceDiagram
    participant User
    participant Client as Web Browser (React)
    participant API as Next.js API (/api/info)
    participant YTDL as yt-dlp (youtube-dl-exec)

    User->>Client: 유튜브 URL 입력 & Analyze 클릭
    Client->>API: GET /api/info?url={URL}
    API->>YTDL: yt-dlp --dump-json --no-playlist
    YTDL-->>API: 비디오 메타데이터 및 포맷 JSON 반환
    API-->>Client: 정제된 정보(제목, 썸네일, 포맷 목록) 반환
    Client->>User: 영상 정보 및 다운로드 버튼 표시
```

---

## 2. MP3 다운로드 (Download MP3)
사용자가 'Download MP3' 버튼을 클릭했을 때의 오디오 추출 및 변환 흐름입니다.

```mermaid
sequenceDiagram
    participant User
    participant Client as Web Browser (React)
    participant API as Next.js API (/api/download)
    participant YTDL as yt-dlp (youtube-dl-exec)
    participant FFmpeg as FFmpeg (ffmpeg-static)
    participant Storage as Temp Storage (/tmp)

    User->>Client: Download MP3 클릭
    Client->>API: POST /api/download {url, format_id}
    API->>YTDL: 오디오 스트림 다운로드 요청
    YTDL->>FFmpeg: 오디오 데이터 전달
    FFmpeg->>Storage: MP3로 변환 및 저장
    Storage-->>API: .mp3 파일 준비 완료
    API-->>Client: 파일 스트림 응답 (Blob)
    Client->>User: 브라우저 파일 저장 (download.mp3)
```

---

## 3. MP4 다운로드 (Download MP4)
사용자가 'Download MP4' 버튼을 클릭했을 때의 비디오/오디오 병합 흐름입니다.

```mermaid
sequenceDiagram
    participant User
    participant Client as Web Browser (React)
    participant API as Next.js API (/api/download/mp4)
    participant YTDL as yt-dlp (youtube-dl-exec)
    participant FFmpeg as FFmpeg (ffmpeg-static)
    participant Storage as Temp Storage (/tmp)

    User->>Client: Download MP4 클릭
    Client->>API: GET /api/download/mp4?url={URL}
    API->>YTDL: 최적 비디오 + 오디오 스트림 요청
    YTDL->>FFmpeg: 두 스트림을 병합 요청
    FFmpeg->>Storage: MP4 파일 생성 및 저장
    Storage-->>API: .mp4 파일 준비 완료
    API-->>Client: 파일 스트림 응답 (Blob)
    Client->>User: 브라우저 파일 저장 (download.mp4)
```
