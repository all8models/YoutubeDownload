import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';
import { fetchMembersOnlyIds, mapVideoEntries } from '../../../lib/youtubeHelpers';

/**
 * GET /api/channel-videos?url=CHANNEL_VIDEOS_URL
 *
 * YouTube 채널의 /videos (동영상) 페이지에서 업로드한 영상 목록 전체를 반환하는 API입니다.
 * yt-dlp의 --flat-playlist 옵션으로 각 영상의 상세 정보 없이 메타데이터만 빠르게 가져옵니다.
 *
 * @example
 * GET /api/channel-videos?url=https://www.youtube.com/@channel/videos&max_results=50
 *
 * ⚠️ 레이트 리밋 방지를 위해 max_results 파라미터가 없으면 영상 전체를 가져오지만
 * 처리 시간이 지연될 수 있습니다. (기본적으로 클라이언트에서 요청 시 제한이 필요할 수 있음)
 *
 * @returns {JSON}
 * {
 *   "channel_title": "Channel Name",
 *   "video_count": 50,
 *   "total_available": 561,
 *   "limited": true,
 *   "videos": [...]
 * }
 */
export async function GET(request) {
  // 1. 요청 URL에서 'url' 및 'max_results' 쿼리 파라미터 파싱
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    // max_results 파라미터 확인 (지정된 개수만큼만 가져와서 속도 및 리소스 최적화)
    const maxResultsParam = searchParams.get('max_results');
    const limit = maxResultsParam ? parseInt(maxResultsParam, 10) : null;

    // 2. yt-dlp 실행 옵션 설정
    const ytdlOptions = {
      dumpSingleJson: true,                 // JSON 형태로 반환
      flatPlaylist: true,                   // 채널 영상 목록만 빠르게 추출 (상세 생략)
      noWarnings: true,
      callHome: false,
      noCheckCertificate: true,
      youtubeSkipDashManifest: true,        // DASH 매니페스트 생략 (속도 향상 및 불필요한 요청 제거)
      sleepRequests: 0.5,                   // 유튜브의 안티 봇(Rate Limit) 방지를 위해 요청 간 0.5초 대기
      extractorArgs: 'youtube:player_client=android;lang=is', // Android 클라이언트 + 원본 언어(is) 설정
      ignoreErrors: true,                   // 개별 영상 조회 시 발생한 오류는 무시하고 계속 리스트 수집
    };

    // 추출할 영상 개수에 제한이 있는 경우에만 playlistEnd 옵션을 추가합니다.
    if (limit && !isNaN(limit) && limit > 0) {
      ytdlOptions.playlistEnd = limit;
    }

    // 3. yt-dlp 실행하여 채널 영상 목록 조회
    const info = await ytdl(url, ytdlOptions);

    // 4. 해당 채널의 멤버십 전용 영상 ID 목록 수집 (공통 헬퍼 함수 사용)
    const membersOnlyIds = await fetchMembersOnlyIds(info.channel_id);

    // 5. yt-dlp 결과(entries)를 프론트엔드에서 렌더링하기 좋은 형태로 정제
    const videos = mapVideoEntries(info.entries, membersOnlyIds);

    // 전체 영상 갯수 (info.playlist_count가 있으면 해당 값, 없으면 파싱된 videos 배열 길이)
    const totalAvailable = info.playlist_count || videos.length;

    // 6. 성공적인 응답 반환 (전체 개수와 제한 여부(limited)를 함께 전달)
    return NextResponse.json({
      channel_title: info.title || info.channel || info.uploader || 'Unknown Channel',
      channel_url: info.channel_url || info.uploader_url || url,
      video_count: videos.length,
      total_available: totalAvailable,
      limited: totalAvailable > videos.length,
      videos,
    });
  } catch (error) {
    console.error('Channel videos fetch error:', error);
    // 에러 발생 시 상태 코드 500과 상세 메시지 반환
    return NextResponse.json(
      { error: 'Failed to fetch channel videos. Make sure the URL is a valid YouTube channel videos page (e.g. https://www.youtube.com/@channel/videos).' },
      { status: 500 }
    );
  }
}
