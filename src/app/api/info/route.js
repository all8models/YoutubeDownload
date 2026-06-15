import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';

/**
 * GET /api/info?url=YOUTUBE_URL
 * YouTube 영상의 메타데이터(제목, 썸네일, 길이, 사용 가능한 포맷 목록)를 반환합니다.
 * 
 * 응답 예시:
 * {
 *   title: "Video Title",
 *   thumbnail: "https://...",
 *   duration: 300,
 *   formats: [
 *     { quality: "128kbps", type: "audio", format_id: "140", ext: "m4a", abr: 128 },
 *     { quality: "720p", type: "video", format_id: "137", ext: "mp4", height: 720 },
 *     ...
 *   ]
 * }
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    // yt-dlp로 영상 정보 조회 (--dump-json 옵션)
    const info = await ytdl(url, {
      dumpSingleJson: true,            // JSON 형태로 정보만 출력
      noWarnings: true,                // 경고 메시지 숨김
      callHome: false,                 // 홈 호출 비활성화
      noCheckCertificate: true,        // SSL 인증서 검증 건너뜀
      youtubeSkipDashManifest: true,   // DASH 매니페스트 생략 (속도 향상)
      noPlaylist: true,                // 재생목록이 아닌 단일 영상만 처리
    });

    // 오디오 전용 포맷(비디오 코덱 없음) 필터링 → MP3 다운로드용
    const audioFormats = info.formats
      .filter((f) => f.vcodec === 'none' && f.acodec !== 'none')
      .map((f) => ({
        quality: `${Math.round(f.abr || 0)}kbps`,  // 비트레이트 기준 표시
        type: 'audio',
        format_id: f.format_id,
        ext: f.ext,
        abr: f.abr,
      }));

    // MP4 비디오 포맷 (최대 1080p) 필터링
    const videoFormats = info.formats
      .filter((f) => f.vcodec !== 'none' && f.ext === 'mp4' && (f.height || 0) <= 1080)
      .map((f) => ({
        quality: `${f.height}p`,     // 해상도 기준 표시 (360p, 720p, 1080p 등)
        type: 'video',
        format_id: f.format_id,
        ext: f.ext,
        height: f.height,
      }));

    // 오디오 → 비디오 순서로 정렬하여 병합
    const allFormats = [
      ...audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0)),
      ...videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0)),
    ];

    return NextResponse.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      formats: allFormats,
    });
  } catch (error) {
    console.error('youtube-dl error:', error);
    return NextResponse.json({ error: 'Failed to fetch video info' }, { status: 500 });
  }
}
