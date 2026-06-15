import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';

/**
 * GET /api/shorts?url=SHORTS_PAGE_URL
 *
 * YouTube 채널의 Shorts 페이지에서 쇼트 영상 목록을 반환합니다.
 * --flat-playlist 옵션으로 각 영상의 상세 정보 없이 ID, 제목, 길이만 빠르게 가져옵니다.
 *
 * 예: https://www.youtube.com/@gohelrakesh/shorts
 *
 * 응답 예시:
 * {
 *   channel_title: "Channel Name",
 *   video_count: 50,
 *   videos: [
 *     { id: "abc123", title: "Short 1", url: "https://youtube.com/watch?v=...", thumbnail: "...", duration: 15 },
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
    const info = await ytdl(url, {
      dumpSingleJson: true,      // JSON 형태로 정보 출력
      flatPlaylist: true,        // 재생목록(쇼트) 항목만 빠르게 추출
      noWarnings: true,
      callHome: false,
      noCheckCertificate: true,
      extractorArgs: 'youtube:player_client=android', // Android 클라이언트 사용 (shorts 추출 안정성 향상)
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
      channel_title: info.title || info.channel || 'Untitled Channel',
      video_count: videos.length,
      videos,
    });
  } catch (error) {
    console.error('Shorts fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shorts. Make sure the URL is a valid YouTube shorts page (e.g. https://www.youtube.com/@channel/shorts).' },
      { status: 500 }
    );
  }
}
