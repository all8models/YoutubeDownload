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

const DEFAULT_CHANNEL_RESULTS = 100;
const MAX_CHANNEL_RESULTS = 200;

/**
 * GET /api/channel-videos?url=CHANNEL_VIDEOS_URL
 * YouTube 채널의 /videos 페이지에서 업로드한 영상 목록을 반환합니다.
 * - 무조건적인 sleepRequests(0.5초) 대기를 제거하고, 429 레이트 리밋 발생 시에만 백오프 재시도
 * - 알려진 채널 핸들(@name) 캐싱으로 멤버십 조회 병렬화 + 응답 캐싱(3분) 적용
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');

  const validation = validateYouTubeUrl(rawUrl);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const url = validation.url;

  const maxResultsParam = searchParams.get('max_results');
  const parsedLimit = maxResultsParam ? parseInt(maxResultsParam, 10) : DEFAULT_CHANNEL_RESULTS;
  const limit =
    !isNaN(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_CHANNEL_RESULTS)
      : DEFAULT_CHANNEL_RESULTS;

  const cacheKey = `channel-videos:${url}:limit=${limit}`;
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

      const baseOptions = {
        dumpSingleJson: true,
        flatPlaylist: true,
        playlistEnd: limit,
        noWarnings: true,
        extractorArgs: 'youtube:player_client=android;lang=is',
        ignoreErrors: true,
      };

      let info;
      try {
        info = await ytdl(url, baseOptions, { pool: 'meta' });
      } catch (firstErr) {
        const msg = firstErr?.message || '';
        if (msg.includes('429') || msg.includes('Too Many Requests')) {
          info = await ytdl(url, { ...baseOptions, sleepRequests: 0.5 }, { pool: 'meta' });
        } else {
          throw firstErr;
        }
      }

      rememberChannelIdForUrl(url, info.channel_id);

      const membersOnlyIds = preMembersPromise
        ? await preMembersPromise
        : await fetchMembersOnlyIds(info.channel_id);

      const videos = mapVideoEntries(info.entries, membersOnlyIds);
      const totalAvailable = info.playlist_count || videos.length;

      const result = {
        channel_title: info.title || info.channel || info.uploader || 'Unknown Channel',
        channel_url: info.channel_url || info.uploader_url || url,
        video_count: videos.length,
        total_available: totalAvailable,
        limited: totalAvailable > videos.length,
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
    console.error('Channel videos fetch error:', error);
    return NextResponse.json(
      {
        error:
          'Failed to fetch channel videos. Make sure the URL is a valid YouTube channel videos page (e.g. https://www.youtube.com/@channel/videos).',
      },
      { status: 500 }
    );
  }
}
