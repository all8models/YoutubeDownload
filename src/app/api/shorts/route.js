import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';
import { fetchMembersOnlyIds, mapVideoEntries } from '../../../lib/youtubeHelpers';

/**
 * GET /api/shorts?url=SHORTS_PAGE_URL
 *
 * YouTube 채널의 Shorts 페이지에서 쇼트 영상 목록을 반환하는 API입니다.
 * yt-dlp의 --flat-playlist 옵션을 사용하여 개별 영상의 상세 정보 다운로드 없이
 * 영상 ID, 제목, 길이 등 메타데이터만 빠르게 추출합니다.
 *
 * @example
 * GET /api/shorts?url=https://www.youtube.com/@channel/shorts
 * 
 * @returns {JSON} 
 * {
 *   "channel_title": "Channel Name",
 *   "video_count": 50,
 *   "videos": [
 *     { "id": "abc123", "title": "Short 1", "url": "...", "thumbnail": "...", "duration": 15, "accessible": true },
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
    // 2. yt-dlp를 통해 Shorts 플레이리스트 정보 추출
    const info = await ytdl(url, {
      dumpSingleJson: true,      // 결과를 파싱하기 쉬운 JSON 형태로 반환
      flatPlaylist: true,        // 재생목록에 있는 항목의 메타데이터만 빠르게 추출
      noWarnings: true,          // 불필요한 경고 메시지 억제
      callHome: false,           // 분석 데이터 전송 방지
      noCheckCertificate: true,  // SSL 인증서 오류 무시 (일부 환경 호환성)
      // 안드로이드 클라이언트를 사용하여 쇼츠 데이터를 안정적으로 가져오며,
      // 아이슬란드어(is) 설정을 통해 원본 언어(영어/한국어) 제목이 우선 반환되도록 유도합니다.
      extractorArgs: 'youtube:player_client=android;lang=is',
    });

    // 3. 해당 채널의 멤버십 전용 영상 ID 목록 수집 (공통 헬퍼 함수 사용)
    const membersOnlyIds = await fetchMembersOnlyIds(info.channel_id);

    // 4. yt-dlp 결과(entries)를 프론트엔드에서 렌더링하기 좋은 형태로 정제
    const videos = mapVideoEntries(info.entries, membersOnlyIds);

    // 5. 성공적인 응답 반환
    return NextResponse.json({
      channel_title: info.title || info.channel || 'Untitled Channel',
      video_count: videos.length,
      videos,
    });
  } catch (error) {
    console.error('Shorts fetch error:', error);
    // 에러 발생 시 사용자 친화적인 메시지 반환
    return NextResponse.json(
      { error: 'Failed to fetch shorts. Make sure the URL is a valid YouTube shorts page (e.g. https://www.youtube.com/@channel/shorts).' },
      { status: 500 }
    );
  }
}
