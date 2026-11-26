import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';
import { validateYouTubeUrl } from '../../../lib/youtubeHelpers';
import { classifyDownloadError } from '../../../lib/cleanup';
import {
  videoInfoCache,
  rawInfoJsonCache,
  withSingleflight,
  extractVideoId,
  compactInfoDictForReuse,
} from '../../../lib/cache';

/**
 * GET /api/info?url=YOUTUBE_URL
 * YouTube 영상의 메타데이터(제목, 썸네일, 길이, 사용 가능한 포맷 목록)를 반환합니다.
 * - LRU+TTL 캐시 및 Singleflight 중복 요청 병합 적용
 * - 추출된 원본 info_dict를 단기 캐싱하여 직후 다운로드(/api/download, /api/download/mp4) 시 재추출 생략
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');

  const validation = validateYouTubeUrl(rawUrl);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const url = validation.url;
  const videoId = extractVideoId(url);
  const cacheKey = videoId ? `video:${videoId}` : `url:${url}`;

  const cachedPayload = videoInfoCache.get(cacheKey);
  if (cachedPayload) {
    return NextResponse.json(cachedPayload, {
      headers: {
        'X-Cache': 'HIT',
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
      },
    });
  }

  try {
    const payload = await withSingleflight(`info:${cacheKey}`, async () => {
      const doubleCheck = videoInfoCache.get(cacheKey);
      if (doubleCheck) return doubleCheck;

      const info = await ytdl(
        url,
        {
          dumpSingleJson: true,
          noWarnings: true,
          noPlaylist: true,
          extractorArgs: 'youtube:lang=is',
        },
        { pool: 'meta' }
      );

      // 다운로드 시 --load-info-json으로 재추출(2.5~3.5초)을 건너뛰기 위해 경량 info_dict 캐싱
      const compacted = compactInfoDictForReuse(info);
      if (compacted) {
        rawInfoJsonCache.set(info.id, compacted);
        if (videoId && videoId !== info.id) {
          rawInfoJsonCache.set(videoId, compacted);
        }
      }

      const rawFormats = Array.isArray(info.formats) ? info.formats : [];

      const audioFormats = rawFormats
        .filter((f) => f.vcodec === 'none' && f.acodec !== 'none')
        .map((f) => ({
          quality: `${Math.round(f.abr || 0)}kbps`,
          type: 'audio',
          format_id: f.format_id,
          ext: f.ext,
          abr: f.abr,
        }));

      const videoFormats = rawFormats
        .filter((f) => f.vcodec !== 'none' && f.ext === 'mp4' && (f.height || 0) <= 1080)
        .map((f) => ({
          quality: `${f.height}p`,
          type: 'video',
          format_id: f.format_id,
          ext: f.ext,
          height: f.height,
        }));

      const allFormats = [
        ...audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0)),
        ...videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0)),
      ];

      const resolvedId = info.id || videoId;
      const result = {
        id: resolvedId,
        url: info.webpage_url || info.original_url || url,
        title: info.title,
        thumbnail: resolvedId
          ? `https://i.ytimg.com/vi_webp/${resolvedId}/mqdefault.webp`
          : info.thumbnail,
        thumbnailFallback: resolvedId
          ? `https://i.ytimg.com/vi/${resolvedId}/mqdefault.jpg`
          : info.thumbnail,
        duration: info.duration,
        formats: allFormats,
      };

      videoInfoCache.set(cacheKey, result);
      if (info.id && `video:${info.id}` !== cacheKey) {
        videoInfoCache.set(`video:${info.id}`, result);
      }

      return result;
    });

    return NextResponse.json(payload, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    console.error('youtube-dl error:', error);
    const { errorMessage, statusCode } = classifyDownloadError(
      error,
      'Failed to fetch video info'
    );
    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
