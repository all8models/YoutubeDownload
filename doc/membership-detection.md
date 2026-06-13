# 멤버십 한정 콘텐츠 다운로드 차단 기능

## 📌 목적

YouTube 재생목록(플레이리스트)에서 **멤버십 한정(subscriber_only)** 등 접근 불가능한 영상의 다운로드 버튼을 비활성화하고, 시각적으로 구분하여 표시합니다.

---

## 🔍 접근 불가 판별 기준

### 1. title 기반 (flat-playlist 단계)
| 패턴 | 설명 |
|------|------|
| `null` / `''` | 제목 없음 |
| `[Private video]` | 비공개 영상 |
| `[Deleted video]` | 삭제된 영상 |
| `[Members-only video]` | 멤버십 전용 표시 |

### 2. availability 기반 (배치 확인 단계)
| 값 | 설명 |
|------|------|
| `subscriber_only` | 채널 멤버십 한정 |
| `premium_only` | YouTube Premium 한정 |
| `needs_auth` | 인증 필요 |
| `private` | 비공개 |

---

## 🏗 전체 처리 흐름

```
클라이언트 요청: GET /api/playlist?url=PLAYLIST_URL
│
├── 1단계: --flat-playlist + --dumpSingleJson
│   └── youtube-dl-exec 로 빠르게 영상 목록 확보 (~3초)
│
├── 2단계: availability 확인
│   ├── flat 데이터에 availability 있음? → 바로 사용
│   └── 없음 → child_process.execFile 로 yt-dlp 직접 배치 호출
│       └── 바이너리: /app/node_modules/youtube-dl-exec/bin/yt-dlp
│       └── 옵션: --dump-json --skip-download
│       └── 타임아웃: 30초
│       └── 실패 시: 모든 영상 accessible=true (fallback)
│
└── 3단계: 결과 매핑
    └── accessible: false → 프론트에서 버튼 비활성화 + 자물쇠 표시
```

---

## 📁 변경된 파일

### 1. `src/app/api/playlist/route.js`
- `isAccessible()` → `titleLooksRestricted()` + `BLOCKED_AVAILABILITY` Set
- `batchCheckAvailability()` 함수: `child_process.execFile` 로 yt-dlp 직접 호출
- `--flat-playlist` 유지 (속도) → availability 없을 때만 2차 배치 호출

### 2. `src/components/DownloadButton.js`
- `disabled` prop 추가
- `disabled === true` 시: 🔒 자물쇠 아이콘 + `restricted` 클래스 + `title="멤버십 한정 콘텐츠 - 다운로드 불가"`

### 3. `src/components/PlaylistView.js`
- `video.accessible === false` 체크
- 제한 영상: 썸네일 오버레이(어두움+자물쇠), 제목 회색, "멤버십 한정 · 다운로드 불가" 뱃지
- 모든 DownloadButton에 `disabled={isRestricted}` 전달

### 4. `src/app/globals.css`
```css
.video-restricted        /* 투명도↓, 호버 무효 */
.restricted-overlay      /* 썸네일 위 어두운 덮개 */
.restricted-badge        /* 빨간 경고 뱃지 */
.text-muted              /* 회색 텍스트 */
button.restricted        /* 회색 비활성화 버튼 */
.playlist-thumbnail-wrapper /* 썸네일 + 오버레이 래퍼 */
```

---

## 🐳 Docker 관련

```bash
# 변경사항 반영하여 재빌드
docker compose up -d --build
```

- yt-dlp 바이너리 위치: `/app/node_modules/youtube-dl-exec/bin/yt-dlp`
- yt-dlp 버전: `2026.06.09`
- `python3 -m yt_dlp` ❌ (모듈 없음)
- `yt-dlp` PATH ❌ (Node.js 런타임에서 PATH 미포함)
- 절대경로 `/app/.../bin/yt-dlp` ✅

---

## ⚠️ 주의사항

1. **flat-playlist 모드**에서는 `availability` 필드가 대부분 `null` → 2차 배치 호출 필수
2. **배치 호출 실패 시** 모든 영상을 `accessible: true`로 처리 (오탐 방지)
3. 배치 호출은 `child_process.execFile` 사용 — `youtube-dl-exec`의 배열 URL 처리가 불안정하기 때문
4. 100개 초과 플레이리스트는 `playlistEnd: 100` 으로 제한
