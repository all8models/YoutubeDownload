import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';

/**
 * GET /api/channel-videos?url=CHANNEL_VIDEOS_URL
 *
 * YouTube 채널의 /videos 페이지에서 업로드한 영상 목록을 반환합니다.
 * --flat-playlist 옵션으로 각 영상의 상세 정보 없이 ID, 제목, 길이만 빠르게 가져옵니다.
 *
 * 예: https://www.youtube.com/@moyamoya_labo/videos
 *
 * ⚠️ 레이트 리밋 방지를 위해 최대 50개 영상만 가져옵니다 (playlistEnd: 50).
 * 필요 시 ?max_results=100 파라미터로 조정 가능합니다.
 *
 * 응답 예시:
 * {
 *   channel_title: "Channel Name",
 *   video_count: 50,
 *   total_available: 561,
 *   limited: true,
 *   videos: [
 *     { id: "abc123", title: "Video 1", url: "https://youtube.com/watch?v=...", thumbnail: "...", duration: 212 },
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
    // URL에 max_results 파라미터가 있으면 그 값을 사용 (기본값은 제한 없음)
    const maxResultsParam = searchParams.get('max_results');
    const limit = maxResultsParam ? parseInt(maxResultsParam, 10) : null;

    const ytdlOptions = {
      dumpSingleJson: true,                 // JSON 형태로 정보 출력
      flatPlaylist: true,                   // 채널 영상 목록만 빠르게 추출 (상세 정보 생략)
      noWarnings: true,
      callHome: false,
      noCheckCertificate: true,
      youtubeSkipDashManifest: true,        // DASH 매니페스트 생략 (속도 향상)
      sleepRequests: 0.5,                  // 요청 간 0.5초 대기 (레이트 리밋 방지)
      extractorArgs: 'youtube:player_client=android;lang=ko', // Android 클라이언트 사용 (안정성 향상) + 한국어/다국어 제목 표시 우선설정
      ignoreErrors: true,                   // 개별 영상 오류는 무시하고 계속 진행
    };

    if (limit && !isNaN(limit) && limit > 0) {
      ytdlOptions.playlistEnd = limit;      // 파라미터가 지정된 경우에만 개수 제한 적용
    }

    const info = await ytdl(url, ytdlOptions);

    // 멤버십 전용 영상 ID 목록 수집
    const membersOnlyIds = new Set();
    const channelId = info.channel_id;
    if (channelId && channelId.startsWith('UC')) {
      const membersPlaylistId = 'UUMO' + channelId.substring(2);
      try {
        const membersInfo = await ytdl(`https://www.youtube.com/playlist?list=${membersPlaylistId}`, {
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistEnd: 100, // 최대 100개 멤버십 영상 정보만 수집
          noWarnings: true,
          callHome: false,
          noCheckCertificate: true,
          youtubeSkipDashManifest: true,
        });
        if (membersInfo && membersInfo.entries) {
          membersInfo.entries.forEach(entry => {
            if (entry && entry.id) {
              membersOnlyIds.add(entry.id);
            }
          });
        }
      } catch (err) {
        // 멤버십 플레이리스트가 없거나 에러 시 무시
        console.log('No membership playlist found or error:', err.message);
      }
    }

    // entries 배열에서 null(삭제된 영상 등) 제외하고 필요한 정보만 매핑
    const isRestrictedTitle = (title) => {
      if (!title) return true;
      const lower = title.toLowerCase();
      return (
        lower.includes('members-only') ||
        lower.includes('private video') ||
        lower.includes('deleted video') ||
        title.includes('멤버 전용') ||
        title.includes('비공개') ||
        title.includes('삭제된')
      );
    };

    const videos = (info.entries || [])
      .filter(Boolean)
      .map((entry) => {
        const isMembersOnly = membersOnlyIds.has(entry.id);
        const accessible = !isMembersOnly && !isRestrictedTitle(entry.title);
        return {
          id: entry.id,
          title: entry.title,
          url: entry.url || `https://youtube.com/watch?v=${entry.id}`,
          thumbnail: `https://img.youtube.com/vi/${entry.id}/mqdefault.jpg`,
          duration: entry.duration,
          accessible,
        };
      });

    return NextResponse.json({
      channel_title: info.title || info.channel || info.uploader || 'Unknown Channel',
      channel_url: info.channel_url || info.uploader_url || url,
      video_count: videos.length,
      total_available: info.playlist_count || videos.length,
      limited: (info.playlist_count || videos.length) > videos.length,
      videos,
    });
  } catch (error) {
    console.error('Channel videos fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch channel videos. Make sure the URL is a valid YouTube channel videos page (e.g. https://www.youtube.com/@channel/videos).' },
      { status: 500 }
    );
  }
}
