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

const MAX_PLAYLIST_ITEMS = 200;

/**
 * GET /api/playlist?url=PLAYLIST_URL
 * YouTube 일반 재생목록(Playlist)의 영상 목록을 반환합니다.
 * - 인메모리 캐시(3분) + Singleflight + 알려진 채널 ID 병렬 멤버십 조회 적용
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');

  const validation = validateYouTubeUrl(rawUrl);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const url = validation.url;
  const cacheKey = `playlist:${url}`;

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

      const knownChannelId = resolveKnownChannelId(url);
      const preMembersPromise = knownChannelId ? fetchMembersOnlyIds(knownChannelId) : null;

      const info = await ytdl(
        url,
        {
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistEnd: MAX_PLAYLIST_ITEMS,
          noWarnings: true,
          extractorArgs: 'youtube:lang=is',
        },
        { pool: 'meta' }
      );

      rememberChannelIdForUrl(url, info.channel_id);

      const membersOnlyIds = preMembersPromise
        ? await preMembersPromise
        : info.channel_id
          ? await fetchMembersOnlyIds(info.channel_id)
          : new Set();

      const videos =
        Array.isArray(info.entries) && info.entries.length > 0
          ? mapVideoEntries(info.entries, membersOnlyIds)
          : info.id
            ? mapVideoEntries([info], membersOnlyIds)
            : [];

      const result = {
        playlist_title: info.title || 'Untitled Playlist',
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
    console.error('Playlist fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch playlist info. Make sure the URL is a valid YouTube playlist.' },
      { status: 500 }
    );
  }
}
