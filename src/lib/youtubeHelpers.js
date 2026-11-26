import ytdl from './ytdl';
import {
  createLruTtlCache,
  withSingleflight,
  channelHandleCache,
} from './cache';

// 허용된 YouTube 공식 호스트네임 화이트리스트 (SSRF 및 임의 도메인 요청 차단)
const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

// 멤버십 전용 영상 ID 캐시
// - 멤버십 영상이 있는 채널: 15분 캐시
// - 멤버십 미운영(빈 결과/404) 채널: 6시간 네거티브 캐시로 불필요한 UUMO 재조회 원천 제거
const MEMBERS_POSITIVE_TTL = 15 * 60 * 1000;
const MEMBERS_NEGATIVE_TTL = 6 * 60 * 60 * 1000;
const membersCache = createLruTtlCache({
  maxSize: 300,
  ttlMs: MEMBERS_POSITIVE_TTL,
});

/**
 * 입력된 URL이 안전한 YouTube 도메인 URL인지 검증하고 정규화합니다.
 * - SSRF(내부망/메타데이터 접근), 로컬 파일 스킴(file://), CLI 옵션 인젝션(-로 시작)을 원천 차단합니다.
 *
 * @param {string} rawUrl - 클라이언트가 전달한 원본 URL 문자열
 * @returns {{ valid: boolean, url?: string, error?: string }}
 */
export function validateYouTubeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) {
    return { valid: false, error: 'Invalid URL length' };
  }

  // 제어문자 및 CLI 플래그 인젝션 방지
  if (trimmed.startsWith('-') || /[\r\n\0]/.test(trimmed)) {
    return { valid: false, error: 'Invalid characters in URL' };
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Only HTTP/HTTPS URLs are supported' };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!ALLOWED_YOUTUBE_HOSTS.has(hostname)) {
      return {
        valid: false,
        error: 'Only valid YouTube URLs (youtube.com, youtu.be) are allowed',
      };
    }

    // URL 내 자격 증명(username/password) 포함 차단
    if (parsed.username || parsed.password) {
      return { valid: false, error: 'Credentials in URL are not allowed' };
    }

    return { valid: true, url: parsed.toString() };
  } catch {
    return { valid: false, error: 'Malformed YouTube URL' };
  }
}

/**
 * 다운로드 포맷 ID(format_id)의 유효성을 검증합니다.
 * - Path Traversal (../) 및 비정상 포맷 문자열 주입을 차단합니다.
 *
 * @param {string} [rawFormatId]
 * @param {string} [defaultFormat='bestaudio']
 * @returns {{ valid: boolean, formatId?: string, error?: string }}
 */
export function validateFormatId(rawFormatId, defaultFormat = 'bestaudio') {
  if (rawFormatId === undefined || rawFormatId === null || rawFormatId === '') {
    return { valid: true, formatId: defaultFormat };
  }

  if (typeof rawFormatId !== 'string') {
    return { valid: false, error: 'Invalid format_id type' };
  }

  const trimmed = rawFormatId.trim();
  if (
    trimmed.startsWith('-') ||
    trimmed.includes('..') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    !/^[a-zA-Z0-9+_-]{1,64}$/.test(trimmed)
  ) {
    return { valid: false, error: 'Invalid format_id parameter' };
  }

  return { valid: true, formatId: trimmed };
}

/**
 * URL 경로에서 채널 식별 키(@handle 또는 /channel/UC...)를 추출합니다.
 *
 * @param {string} url
 * @returns {{ handleKey: string|null, directChannelId: string|null }}
 */
export function parseChannelIdentityFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return { handleKey: null, directChannelId: null };

    if (parts[0] === 'channel' && parts[1] && /^UC[a-zA-Z0-9_-]{10,40}$/.test(parts[1])) {
      return { handleKey: `channel:${parts[1]}`, directChannelId: parts[1] };
    }

    if (parts[0].startsWith('@')) {
      return {
        handleKey: `handle:${decodeURIComponent(parts[0]).toLowerCase()}`,
        directChannelId: null,
      };
    }

    if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) {
      return {
        handleKey: `${parts[0]}:${decodeURIComponent(parts[1]).toLowerCase()}`,
        directChannelId: null,
      };
    }
  } catch {}
  return { handleKey: null, directChannelId: null };
}

/**
 * URL로부터 이미 알려진 채널 ID(UC...)가 있으면 즉시 반환합니다. (병렬 멤버십 조회용)
 *
 * @param {string} url
 * @returns {string|null}
 */
export function resolveKnownChannelId(url) {
  const { handleKey, directChannelId } = parseChannelIdentityFromUrl(url);
  if (directChannelId) return directChannelId;
  if (handleKey) {
    return channelHandleCache.get(handleKey) || null;
  }
  return null;
}

/**
 * 조회 결과에서 확인된 채널 ID를 핸들 캐시에 기록합니다.
 *
 * @param {string} url
 * @param {string} [channelId]
 */
export function rememberChannelIdForUrl(url, channelId) {
  if (!channelId || !/^UC[a-zA-Z0-9_-]{10,40}$/.test(channelId)) return;
  const { handleKey } = parseChannelIdentityFromUrl(url);
  if (handleKey) {
    channelHandleCache.set(handleKey, channelId);
  }
}

/**
 * 유튜브 멤버십 전용(Members-only) 영상들의 ID 목록을 수집하는 함수입니다.
 * - Singleflight로 동시 중복 조회를 병합하고, 미운영 채널은 6시간 네거티브 캐싱합니다.
 *
 * @param {string} channelId - 유튜브 채널의 고유 ID (예: 'UC1234567890abcdef')
 * @param {AbortSignal} [signal]
 * @returns {Promise<Set<string>>}
 */
export async function fetchMembersOnlyIds(channelId, signal) {
  if (!channelId || typeof channelId !== 'string' || !/^UC[a-zA-Z0-9_-]{10,40}$/.test(channelId)) {
    return new Set();
  }

  const cached = membersCache.get(channelId);
  if (cached) {
    return cached;
  }

  return withSingleflight(`members:${channelId}`, async () => {
    const doubleCheck = membersCache.get(channelId);
    if (doubleCheck) return doubleCheck;

    const membersOnlyIds = new Set();
    const membersPlaylistId = 'UUMO' + channelId.substring(2);
    let hasMembersPlaylist = false;

    try {
      const membersInfo = await ytdl(
        `https://www.youtube.com/playlist?list=${membersPlaylistId}`,
        {
          dumpSingleJson: true,
          flatPlaylist: true,
          playlistEnd: 100,
          noWarnings: true,
        },
        { pool: 'meta', signal }
      );

      if (membersInfo && Array.isArray(membersInfo.entries)) {
        hasMembersPlaylist = membersInfo.entries.length > 0;
        for (const entry of membersInfo.entries) {
          if (entry && entry.id) {
            membersOnlyIds.add(entry.id);
          }
        }
      }
    } catch {
      // 멤버십 미운영 채널(404 등)은 정상 케이스이므로 네거티브 캐시에 보관하여 재호출 차단
      hasMembersPlaylist = false;
    }

    membersCache.set(
      channelId,
      membersOnlyIds,
      hasMembersPlaylist ? MEMBERS_POSITIVE_TTL : MEMBERS_NEGATIVE_TTL
    );

    return membersOnlyIds;
  });
}

/**
 * 영상의 제목 및 상태 정보를 기반으로 다운로드가 불가능한(비공개, 삭제됨, 멤버십 전용 등) 영상인지 판별합니다.
 */
export function isRestrictedTitle(title, availability) {
  if (
    availability &&
    ['subscriber_only', 'premium_only', 'needs_auth', 'private'].includes(availability)
  ) {
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
}

/**
 * yt-dlp에서 반환된 원본 영상 항목(entry)들을 프론트엔드에서 사용하기 좋은 형태로 정제(Mapping)합니다.
 * - 직결 CDN WebP 썸네일(i.ytimg.com/vi_webp)과 JPG 폴백을 함께 제공하여 리다이렉트 제거 및 이미지 용량 35~45% 절감
 */
export function mapVideoEntries(entries, membersOnlyIds) {
  if (!entries || !Array.isArray(entries)) return [];

  return entries.filter(Boolean).map((entry) => {
    const isMembersOnly = membersOnlyIds.has(entry.id);
    const accessible = !isMembersOnly && !isRestrictedTitle(entry.title, entry.availability);

    return {
      id: entry.id,
      title: entry.title || (accessible ? 'Untitled Video' : '멤버십 전용 또는 비공개 동영상'),
      url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
      thumbnail: `https://i.ytimg.com/vi_webp/${entry.id}/mqdefault.webp`,
      thumbnailFallback: `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`,
      duration: entry.duration,
      accessible,
    };
  });
}
