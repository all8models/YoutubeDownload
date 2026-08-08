import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';

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
    const info = await ytdl(url, {
      dumpSingleJson: true,      // JSON 형태로 정보 출력
      flatPlaylist: true,        // 재생목록 항목만 빠르게 추출 (상세 정보 생략)
      noWarnings: true,
      callHome: false,
      noCheckCertificate: true,
      extractorArgs: 'youtube:lang=is', // 아이슬란드어(is) 설정으로 원본 언어(영어/한국어 등) 제목 우선설정
    });

    // 멤버십 전용 영상 ID 목록 수집
    const membersOnlyIds = new Set();
    const channelId = info.channel_id;
    if (channelId && channelId.startsWith('UC')) {
      const membersPlaylistId = 'UUMO' + channelId.substring(2);
      try {
        const membersInfo = await ytdl(`https://www.youtube.com/playlist?list=${membersPlaylistId}`, {
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistEnd: 100,
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
        console.log('No membership playlist found or error:', err.message);
      }
    }

    // entries 배열에서 null(삭제된 영상 등) 제외하고 필요한 정보만 매핑
    const isRestrictedTitle = (title, availability) => {
      if (availability && ['subscriber_only', 'premium_only', 'needs_auth', 'private'].includes(availability)) {
        return true;
      }
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
        const accessible = !isMembersOnly && !isRestrictedTitle(entry.title, entry.availability);
        return {
          id: entry.id,
          title: entry.title || (accessible ? 'Untitled Video' : '멤버십 전용 또는 비공개 동영상'),
          url: entry.url || `https://youtube.com/watch?v=${entry.id}`,
          thumbnail: `https://img.youtube.com/vi/${entry.id}/mqdefault.jpg`,
          duration: entry.duration,
          accessible,
        };
      });

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
