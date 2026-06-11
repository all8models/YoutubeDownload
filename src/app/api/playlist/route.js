import { NextResponse } from 'next/server';
import youtubedl from 'youtube-dl-exec';

/**
 * GET /api/playlist?url=PLAYLIST_URL
 * 
 * YouTube 재생목록(플레이리스트)의 영상 목록을 반환합니다.
 * --flat-playlist 옵션으로 각 영상의 상세 정보 없이 ID, 제목, 길이만 빠르게 가져옵니다.
 * 
 * 응답 예시:
 * {
 *   playlist_title: "My Playlist",
 *   video_count: 25,
 *   videos: [
 *     { id: "dQw4w9WgXcQ", title: "Video 1", url: "https://youtube.com/watch?v=...", thumbnail: "...", duration: 212 },
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
    const info = await youtubedl(url, {
      dumpSingleJson: true,      // JSON 형태로 정보 출력
      flatPlaylist: true,        // 재생목록 항목만 빠르게 추출 (상세 정보 생략)
      noWarnings: true,
      callHome: false,
      noCheckCertificate: true,
    });

    // entries 배열에서 null(삭제된 영상 등) 제외하고 필요한 정보만 매핑
    const videos = (info.entries || [])
      .filter(Boolean)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        url: entry.url || `https://youtube.com/watch?v=${entry.id}`,
        thumbnail: `https://img.youtube.com/vi/${entry.id}/mqdefault.jpg`,
        duration: entry.duration,
      }));

    return NextResponse.json({
      playlist_title: info.title || 'Untitled Playlist',
      video_count: videos.length,
      videos,
    });
  } catch (error) {
    console.error('Playlist fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch playlist info. Make sure the URL is a valid YouTube playlist.' },
      { status: 500 }
    );
  }
}
