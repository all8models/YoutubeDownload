import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';
import { fetchMembersOnlyIds, mapVideoEntries } from '../../../lib/youtubeHelpers';

/**
 * GET /api/playlist?url=PLAYLIST_URL
 * 
 * YouTube 일반 재생목록(Playlist)의 영상 목록을 반환하는 API입니다.
 * yt-dlp의 --flat-playlist 옵션을 사용하여 각 영상의 상세 정보 없이 ID, 제목, 길이만 빠르게 가져옵니다.
 * 
 * @example
 * GET /api/playlist?url=https://www.youtube.com/playlist?list=PL...
 * 
 * @returns {JSON}
 * {
 *   "playlist_title": "My Playlist",
 *   "video_count": 25,
 *   "videos": [
 *     { "id": "dQw4w9WgXcQ", "title": "Video 1", "url": "...", "thumbnail": "...", "duration": 212, "accessible": true },
 *     ...
 *   ]
 * }
 */
export async function GET(request) {
  // 1. 요청 URL에서 'url' 쿼리 파라미터 파싱
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    // 2. yt-dlp를 통해 플레이리스트 정보 추출
    const info = await ytdl(url, {
      dumpSingleJson: true,      // 결과를 파싱하기 쉬운 JSON 형태로 반환
      flatPlaylist: true,        // 재생목록 항목만 빠르게 추출 (상세 정보 생략하여 속도 대폭 향상)
      noWarnings: true,
      callHome: false,
      noCheckCertificate: true,
      extractorArgs: 'youtube:lang=is', // 아이슬란드어(is) 설정으로 원본 언어(영어/한국어 등) 제목을 우선 추출
    });

    // 3. 해당 채널의 멤버십 전용 영상 ID 목록 수집 (공통 헬퍼 함수 사용)
    // 플레이리스트 정보에도 채널 ID가 포함되므로 이를 기반으로 조회합니다.
    const membersOnlyIds = await fetchMembersOnlyIds(info.channel_id);

    // 4. yt-dlp 결과(entries)를 프론트엔드에서 렌더링하기 좋은 형태로 정제
    const videos = mapVideoEntries(info.entries, membersOnlyIds);

    // 5. 성공적인 응답 반환
    return NextResponse.json({
      playlist_title: info.title || 'Untitled Playlist',
      video_count: videos.length,
      videos,
    });
  } catch (error) {
    console.error('Playlist fetch error:', error);
    // 에러 발생 시 상태 코드 500과 함께 상세 에러 메시지 반환
    return NextResponse.json(
      { error: 'Failed to fetch playlist info. Make sure the URL is a valid YouTube playlist.' },
      { status: 500 }
    );
  }
}
