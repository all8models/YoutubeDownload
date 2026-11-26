/**
 * 고성능 인메모리 LRU + TTL 캐시 및 Singleflight(중복 요청 병합) 유틸리티
 *
 * - Bounded LRU + TTL: 메모리 상한을 보장하면서 자주 조회되는 메타데이터를 즉시 반환
 * - Singleflight: 동일 리소스에 대한 동시 다발적 요청을 단 1회의 yt-dlp 실행으로 병합
 * - Raw Info-JSON 캐시: /api/info 추출 결과를 다운로드(/api/download, /api/download/mp4)에서 재사용
 */

/**
 * O(1) Map 기반 Bounded LRU + TTL 캐시 생성기
 *
 * @param {{ maxSize?: number, ttlMs?: number }} options
 */
export function createLruTtlCache({ maxSize = 200, ttlMs = 5 * 60 * 1000 } = {}) {
  const store = new Map();

  function get(key) {
    if (!key) return undefined;
    const entry = store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return undefined;
    }

    // LRU 갱신: 가장 최근 접근 항목을 Map 끝으로 이동
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  }

  function set(key, value, customTtlMs) {
    if (!key) return;
    const now = Date.now();
    const effectiveTtl = typeof customTtlMs === 'number' ? customTtlMs : ttlMs;

    if (store.has(key)) {
      store.delete(key);
    } else if (store.size >= maxSize) {
      // 1차: 만료된 항목 정리
      for (const [k, v] of store.entries()) {
        if (now > v.expiresAt) {
          store.delete(k);
        }
      }
      // 2차: 여전히 꽉 차 있으면 가장 오래 미사용된(LRU) 항목 제거
      if (store.size >= maxSize) {
        const lruKey = store.keys().next().value;
        if (lruKey !== undefined) {
          store.delete(lruKey);
        }
      }
    }

    store.set(key, {
      value,
      expiresAt: now + effectiveTtl,
    });
  }

  function del(key) {
    store.delete(key);
  }

  function clear() {
    store.clear();
  }

  return {
    get,
    set,
    delete: del,
    clear,
    get size() {
      return store.size;
    },
  };
}

/**
 * 진행 중인 비동기 요청 맵 (Singleflight Request Coalescing)
 */
const inFlightRequests = new Map();

/**
 * 동일한 key로 동시에 들어온 요청들을 단일 비동기 작업으로 병합합니다.
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} taskFn
 * @returns {Promise<T>}
 */
export async function withSingleflight(key, taskFn) {
  if (!key) return taskFn();

  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing;
  }

  const promise = Promise.resolve()
    .then(taskFn)
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * YouTube URL에서 11자리 고유 영상 ID를 추출합니다.
 * (watch?v=ID, youtu.be/ID, /shorts/ID, /live/ID 지원)
 *
 * @param {string} url
 * @returns {string|null}
 */
export function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    const vParam = parsed.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return vParam;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (
      parts.length >= 2 &&
      ['shorts', 'live', 'embed', 'v'].includes(parts[0]) &&
      /^[a-zA-Z0-9_-]{11}$/.test(parts[1])
    ) {
      return parts[1];
    }
  } catch {}
  return null;
}

/**
 * yt-dlp 원본 info 객체에서 --load-info-json 재사용에 필요한 핵심 필드만 경량 추출합니다.
 * (수백 KB에 달하는 automatic_captions, subtitles, heatmap 등을 제거하여 RAM 절약)
 *
 * @param {Object} rawInfo
 * @returns {Object|null}
 */
export function compactInfoDictForReuse(rawInfo) {
  if (!rawInfo || typeof rawInfo !== 'object' || !rawInfo.id || !Array.isArray(rawInfo.formats)) {
    return null;
  }

  return {
    id: rawInfo.id,
    title: rawInfo.title,
    ext: rawInfo.ext || 'mp4',
    duration: rawInfo.duration,
    webpage_url: rawInfo.webpage_url,
    original_url: rawInfo.original_url,
    extractor: rawInfo.extractor || 'youtube',
    extractor_key: rawInfo.extractor_key || 'Youtube',
    live_status: rawInfo.live_status,
    _type: rawInfo._type || 'video',
    http_headers: rawInfo.http_headers,
    formats: rawInfo.formats,
  };
}

// 단일 영상 API 응답 캐시 (TTL: 5분, 최대 200개)
export const videoInfoCache = createLruTtlCache({
  maxSize: 200,
  ttlMs: 5 * 60 * 1000,
});

// 다운로드 시 --load-info-json 재사용을 위한 경량 info_dict 캐시 (TTL: 4분, 최대 60개)
export const rawInfoJsonCache = createLruTtlCache({
  maxSize: 60,
  ttlMs: 4 * 60 * 1000,
});

// 목록(플레이리스트, 쇼츠, 채널 비디오) API 응답 캐시 (TTL: 3분, 최대 100개)
export const listResponseCache = createLruTtlCache({
  maxSize: 100,
  ttlMs: 3 * 60 * 1000,
});

// 채널 핸들(@name 등) → 채널 ID(UC...) 매핑 캐시 (TTL: 24시간, 최대 500개)
export const channelHandleCache = createLruTtlCache({
  maxSize: 500,
  ttlMs: 24 * 60 * 60 * 1000,
});
