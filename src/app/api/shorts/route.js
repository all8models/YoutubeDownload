import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';
import {
  fetchMembersOnlyIds,
  mapVideoEntries,
  validateYouTubeUrl,
  resolveKnownChannelId,
  rememberChannelIdForUrl,
} from '../../../lib/youtubeHelpers';
import { listResponseCache, withSingleflight } from '../../../lib/cache';

const MAX_SHORTS_ITEMS = 200;

/**
 * GET /api/shorts?url=SHORTS_PAGE_URL
 * YouTube 채널의 Shorts 페이지에서 쇼트 영상 목록을 반환합니다.
 * - 인메모리 캐시(3분) + Singleflight + 알려진 채널 핸들 병렬 멤버십 조회 적용
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');

  const validation = validateYouTubeUrl(rawUrl);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const url = validation.url;
  const cacheKey = `shorts:${url}`;

  const cached = listResponseCache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        'X-Cache': 'HIT',
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
      },
    });
  }

  try {
    const payload = await withSingleflight(cacheKey, async () => {
      const doubleCheck = listResponseCache.get(cacheKey);
      if (doubleCheck) return doubleCheck;

      // 이미 핸들 캐시에 채널 ID가 존재하면 본 목록 조회와 멤버십 조회를 동시(병렬) 실행
      const knownChannelId = resolveKnownChannelId(url);
      const preMembersPromise = knownChannelId ? fetchMembersOnlyIds(knownChannelId) : null;

      const info = await ytdl(
        url,
        {
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistEnd: MAX_SHORTS_ITEMS,
          noWarnings: true,
          extractorArgs: 'youtube:player_client=android;lang=is',
        },
        { pool: 'meta' }
      );

      rememberChannelIdForUrl(url, info.channel_id);

      const membersOnlyIds = preMembersPromise
        ? await preMembersPromise
        : await fetchMembersOnlyIds(info.channel_id);

      let videos;
      if (Array.isArray(info.entries) && info.entries.length > 0) {
        videos = mapVideoEntries(info.entries, membersOnlyIds);
      } else if (info.id) {
        videos = mapVideoEntries([info], membersOnlyIds);
      } else {
        videos = [];
      }

      const result = {
        channel_title: info.title || info.channel || 'Untitled Channel',
        video_count: videos.length,
        videos,
      };

      listResponseCache.set(cacheKey, result);
      return result;
    });

    return NextResponse.json(payload, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('Shorts fetch error:', error);
    return NextResponse.json(
      {
        error:
          'Failed to fetch shorts. Make sure the URL is a valid YouTube shorts page (e.g. https://www.youtube.com/@channel/shorts).',
      },
      { status: 500 }
    );
  }
}
