
## 1. 핵심 기능 (Core Features)

1. **URL 입력 & 비디오 정보 표시**  
   - 유튜브 링크를 붙여 넣으면 → 썸네일, 제목, 길이, 해상도/포맷 옵션 자동 표시

2. **포맷/품질 선택**  
   - 비디오: MP4 (360p, 720p, 1080p, 4K, 8K), WEBM  
   - 오디오: MP3 (128kbps, 320kbps), M4A, FLAC, WAV

3. **다운로드/변환 실행**  
   - 선택한 포맷으로 서버에서 변환 후 파일 다운로드 링크 제공  
   - (또는 직접 클라이언트 측에서 변환? 거의 불가능 → 서버 필요)

4. **추가 기능** (y2down 수준)  
   - 재생목록(playlist) 지원  
   - 여러 동영상 일괄 변환 (배치 처리)  
   - 다크 모드, 모바일 반응형 UI  
   - 다운로드 이력 임시 저장 (세션 또는 로컬 스토리지)  
   - 무제한 무료 다운로드 (단, 서버 비용 고려)

---

## 2. 기술 스택 예시

### Frontend
- HTML5, CSS3 (Tailwind CSS 또는 Bootstrap)  
- JavaScript (React 또는 Vue.js 권장)  
- Axios 또는 Fetch API로 백엔드 통신

### Backend
- Node.js (Express) 또는 Python (FastAPI, Flask)  
- youtube-dl / yt-dlp 라이브러리 사용 (유튜브 다운로드 핵심)  
- FFmpeg (포맷 변환 및 품질 재인코딩)

### Server & Storage
- 임시 파일 저장: VPS에서 `/tmp` 또는 AWS S3 수명 짧은 버킷  
- 캐시: Redis (자주 요청되는 URL의 포맷 정보 캐싱)  
- 대기열 처리: Bull (Redis 기반) 또는 Celery

---

## 3. 작동 흐름 (User Flow)

1. 사용자: URL 입력 → [분석 요청]  
2. 서버: `yt-dlp --dump-json`로 비디오 메타데이터 + 가능한 포맷 목록 획득  
3. 사용자: 포맷 선택 → [변환 요청]  
4. 서버:  
   - `yt-dlp -f [format_code] -o temp.mp4`로 다운로드  
   - 필요 시 FFmpeg로 재인코딩 (MP4 → MP3 등)  
   - 파일을 임시 URL에 업로드 또는 바로 스트리밍 응답  
5. 사용자: 파일 다운로드  
6. 서버: 주기적으로 임시 파일 삭제 (예: 1시간 후)

---

## 4. 주의사항 및 법적 문제 ⚠️

---

## 5. 개발 시 난이도 및 대안

- **가장 어려운 부분**:  
  - 고화질(4K/8K) + 오디오 병합 (유튜브는 비디오/오디오 스트림 분리됨)  
  - 서버 부하 관리 (동시 변환 요청 → CPU/RAM 폭증)  
  - 재생목록 다운로드 (길면 수백 개 → 대기열 & 진행률 표시)

- **대안 제안**  
  - MVP(최소 기능 버전)에서는 MP4 최대 1080p + MP3 192kbps만 지원  
  - 재생목록은 링크 1개당 하나의 영상만 처리하도록 제한  
  - `yt-dlp` 대신 `ytdl-core`(Node.js)로 시작하면 더 가볍지만 포맷 선택이 제한적

---

## 6. 참고할 유사 오픈소스

GitHub에서 아래 레포 참고 가능:  
- `ytdl-python` (FastAPI + yt-dlp)  
- `youtube-dl-web-ui`  
- `tube-convert` (Node.js)

---

## 7. 간단한 예제 URL 분석 API 응답 구조 (JSON)

```
GET /api/info?url=VIDEO_URL

{
  "title": "Example Video",
  "thumbnail": "https://...",
  "duration": 365,
  "formats": [
    {"quality": "1080p", "type": "video", "format_id": "137", "ext": "mp4"},
    {"quality": "320kbps", "type": "audio", "format_id": "140", "ext": "m4a"}
  ]
}
```

다운로드 요청 시:  
```
POST /api/download
{
  "url": "...",
  "format_id": "137+140",   // 비디오+오디오 병합
  "output_ext": "mp4"
}
```

---

구체적으로 프론트엔드 샘플 코드나 백엔드 (Node.js + ytdl-core) 구현 예제도 필요하면 말해줘.  
처음 만들 때는 **MP3 다운로드 기능만 먼저** 구현하고, 점차 MP4 영상으로 확장하는 걸 추천해.