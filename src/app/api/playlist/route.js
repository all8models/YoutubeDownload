import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import youtubedl from 'youtube-dl-exec';

const execFileAsync = promisify(execFile);

/**
 * GET /api/playlist?url=PLAYLIST_URL
 * 
 * YouTube 재생목록(플레이리스트)의 영상 목록을 반환합니다.
 * 멤버십 한정 등 접근 불가 영상은 accessible: false로 표시.
 * 
 * 전략:
 * 1. yt-dlp --dump-json --flat-playlist 로 각 영상의 JSON을 직접 수집
 *    (availability 필드가 포함될 수 있음)
 * 2. availability 기반 + title 패턴 기반으로 accessible 판별
 */

const BLOCKED_AVAILABILITY = new Set([
  'subscriber_only',
  'premium_only',
  'needs_auth',
  'private',
]);

function titleLooksRestricted(title) {
  if (title == null || title === '') return true;
  return (
    title.startsWith('[Private video]') ||
    title.startsWith('[Deleted video]') ||
    title.startsWith('[Members-only video]')
  );
}

/**
 * yt-dlp --dump-json --flat-playlist 로 직접 호출
 * 각 영상마다 한 줄씩 JSON 출력 → availability 필드 수집
 */
async function fetchPlaylistWithAvailability(url) {
  const entries = [];
  let playlistTitle = 'Untitled Playlist';
  
  try {
    const { stdout } = await execFileAsync(
      '/app/node_modules/youtube-dl-exec/bin/yt-dlp',
      [
        '--dump-json',
        '--flat-playlist',
        '--skip-download',
        '--no-warnings',
        '--no-check-certificate',
        '--playlist-end', '100',
        url,
      ],
      { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
    );

    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        
        // 플레이리스트 메타데이터
        if (obj._type === 'playlist') {
          playlistTitle = obj.title || playlistTitle;
          continue;
        }
        
        // 영상 엔트리
        if (obj.id) {
          entries.push(obj);
        }
      } catch (e) {
        // 파싱 실패 라인은 무시
        console.debug('Parse error:', e.message);
      }
    }
  } catch (error) {
    console.error('fetchPlaylistWithAvailability error:', error.message);
    throw error; // 재시도 불가하면 그냥 실패
  }

  return { playlistTitle, entries };
}

/** entry → response video object */
function toVideo(entry) {
  const title = entry.title;
  const avail = entry.availability;
  
  // title 기반 판별 (확실함)
  if (titleLooksRestricted(title)) {
    return {
      id: entry.id,
      title,
      url: entry.url || `https://youtube.com/watch?v=${entry.id}`,
      thumbnail: `https://img.youtube.com/vi/${entry.id}/mqdefault.jpg`,
      duration: entry.duration,
      accessible: false,
    };
  }

  // availability 기반 판별
  if (avail != null && BLOCKED_AVAILABILITY.has(avail)) {
    return {
      id: entry.id,
      title,
      url: entry.url || `https://youtube.com/watch?v=${entry.id}`,
      thumbnail: `https://img.youtube.com/vi/${entry.id}/mqdefault.jpg`,
      duration: entry.duration,
      accessible: false,
    };
  }

  // 기본: 접근 가능
  return {
    id: entry.id,
    title,
    url: entry.url || `https://youtube.com/watch?v=${entry.id}`,
    thumbnail: `https://img.youtube.com/vi/${entry.id}/mqdefault.jpg`,
    duration: entry.duration,
    accessible: true,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    // --dump-json --flat-playlist 로 한 번에 가져오기
    const { playlistTitle, entries } = await fetchPlaylistWithAvailability(url);

    // 결과 매핑
    const videos = entries.map((entry) => toVideo(entry));

    return NextResponse.json({
      playlist_title: playlistTitle,
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
