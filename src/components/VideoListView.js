'use client';

import { useState, useCallback, memo } from 'react';
import DownloadButton from './DownloadButton';
import {
  saveResponseStream,
  prepareDirectoryTarget,
  triggerNativeBrowserDownload,
  enqueueClientDownload,
} from '../lib/fileDownload';

/**
 * 일시적 네트워크/Keep-Alive 소켓 끊김(TypeError: Failed to fetch) 시 자동 재시도하는 fetch 래퍼
 */
async function fetchWithRetry(url, options = {}, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, { cache: 'no-store', ...options });
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  throw lastError;
}

/**
 * 초(seconds) 단위의 재생 시간을 "M:SS" 또는 "H:MM:SS" 형식으로 변환합니다.
 */
function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${s}`;
  }
  return `${m}:${s}`;
}

/**
 * 개별 영상 카드 컴포넌트 (React.memo 적용)
 * - 다른 영상의 다운로드 진행률(%)이 갱신될 때 나머지 19개 카드의 불필요한 리렌더링을 원천 차단합니다.
 */
const VideoCardItem = memo(function VideoCardItem({
  video,
  isShortsList,
  mp3Task,
  mp4720Task,
  mp41080Task,
  onDownload,
}) {
  const isRestricted = video.accessible === false;

  const handleThumbError = (e) => {
    if (video.thumbnailFallback && e.currentTarget.src !== video.thumbnailFallback) {
      e.currentTarget.src = video.thumbnailFallback;
    }
  };

  return (
    <div
      className={`playlist-video-item video-card-surface ${
        isShortsList ? 'shorts-card-surface' : ''
      } ${isRestricted ? 'restricted-item' : ''}`}
    >
      <div className={isShortsList ? 'shorts-thumbnail-wrapper' : 'playlist-thumbnail-wrapper'}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={isShortsList ? 'shorts-thumbnail' : 'playlist-thumbnail'}
          src={video.thumbnail}
          alt={video.title}
          loading="lazy"
          decoding="async"
          onError={handleThumbError}
        />

        {isRestricted && (
          <div className="thumbnail-restricted-overlay" title="멤버십 전용 또는 비공개 콘텐츠">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        )}
      </div>

      <div className="playlist-video-info">
        <h3 className="playlist-video-title">
          {video.title}
          {isRestricted && <span className="restricted-badge">다운로드 불가</span>}
        </h3>

        {video.duration && !isRestricted && (
          <p className="playlist-video-duration">{formatDuration(video.duration)}</p>
        )}

        <div className="playlist-download-buttons">
          <DownloadButton
            onClick={() => onDownload(video.url, video.title, 'mp3', 720)}
            isQueued={mp3Task?.phase === 'queued'}
            isLoading={mp3Task?.phase === 'loading'}
            isCompleted={mp3Task?.phase === 'done'}
            statusText={mp3Task?.text}
            disabled={isRestricted}
            label="MP3"
          />
          <DownloadButton
            onClick={() => onDownload(video.url, video.title, 'mp4', 720)}
            isQueued={mp4720Task?.phase === 'queued'}
            isLoading={mp4720Task?.phase === 'loading'}
            isCompleted={mp4720Task?.phase === 'done'}
            statusText={mp4720Task?.text}
            disabled={isRestricted}
            label="720p"
          />
          <DownloadButton
            onClick={() => onDownload(video.url, video.title, 'mp4', 1080)}
            isQueued={mp41080Task?.phase === 'queued'}
            isLoading={mp41080Task?.phase === 'loading'}
            isCompleted={mp41080Task?.phase === 'done'}
            statusText={mp41080Task?.text}
            disabled={isRestricted}
            label="1080p"
          />
        </div>
      </div>
    </div>
  );
});

/**
 * 범용 비디오 목록 뷰 컴포넌트 (VideoListView)
 */
export default function VideoListView({
  title,
  count,
  videos,
  listType = 'video',
  downloadDirHandle,
}) {
  // 단일 상태 맵으로 대기/진행률/완료 상태를 통합 관리하여 상태 업데이트 횟수 최소화
  // 값 구조: { phase: 'queued' | 'loading' | 'done', text?: string }
  const [taskMap, setTaskMap] = useState({});
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  const updateTask = useCallback((key, nextValue) => {
    setTaskMap((prev) => {
      const curr = prev[key];
      if (
        curr &&
        nextValue &&
        curr.phase === nextValue.phase &&
        curr.text === nextValue.text
      ) {
        return prev;
      }
      if (!nextValue) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: nextValue };
    });
  }, []);

  const downloadVideo = useCallback(
    async (videoUrl, videoTitle, type, quality = 720) => {
      const loadKey = `${videoUrl}-${type}-${quality}`;
      setError('');

      const endpoint =
        type === 'mp3'
          ? `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=bestaudio`
          : `/api/download/mp4?url=${encodeURIComponent(videoUrl)}&quality=${quality}`;

      const safeTitle = (videoTitle || listType).replace(/[/\\?%*:|"<>]/g, '-');
      const ext = type === 'mp3' ? '.mp3' : '.mp4';
      const targetFilename = `${safeTitle}${ext}`;

      try {
        // 1. 사용자 클릭 제스처 활성 시점에 폴더 권한 및 중복 파일명 선행 확정
        const { validDirHandle, finalName } = await prepareDirectoryTarget(
          targetFilename,
          downloadDirHandle
        );

        // 2. 클라이언트 동시성 제한 큐(최대 3개 병렬)에 작업 등록
        const { queued, promise } = enqueueClientDownload(
          async () => {
            updateTask(loadKey, {
              phase: 'loading',
              text: type === 'mp3' ? '스트림 연결...' : '병합중...',
            });

            let res;
            try {
              res = await fetchWithRetry(endpoint, { method: 'GET' }, 1);
            } catch (fetchErr) {
              console.warn('Fetch stream failed, triggering native browser download:', fetchErr);
              triggerNativeBrowserDownload(endpoint, targetFilename);
              updateTask(loadKey, { phase: 'done' });
              return;
            }

            if (!res.ok) {
              const data = await res.json().catch(() => ({ error: 'Download failed' }));
              throw new Error(data.error || 'Download failed');
            }

            await saveResponseStream(res, targetFilename, validDirHandle, {
              preResolvedName: finalName,
              fallbackUrl: endpoint,
              onProgress: (progressText) => {
                updateTask(loadKey, { phase: 'loading', text: progressText });
              },
            });

            updateTask(loadKey, { phase: 'done' });
          },
          () => {
            updateTask(loadKey, {
              phase: 'loading',
              text: type === 'mp3' ? '스트림 연결...' : '병합중...',
            });
          }
        );

        if (queued) {
          updateTask(loadKey, { phase: 'queued' });
        }

        await promise;
      } catch (err) {
        updateTask(loadKey, null);
        setError(err.message);
      }
    },
    [downloadDirHandle, listType, updateTask]
  );

  if (!videos || !Array.isArray(videos) || videos.length === 0) return null;

  const totalVideos = videos.length;
  const totalPages = Math.max(1, Math.ceil(totalVideos / ITEMS_PER_PAGE));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const currentVideos = videos.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  const isShortsList = listType === 'short';

  const handlePageChange = (page) => {
    setCurrentPage(page);
    const viewElement = document.querySelector('.video-list-view');
    if (viewElement) {
      viewElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="video-list-view playlist-view">
      <div className="playlist-header">
        <h2 className="playlist-title">{title}</h2>
        <span className="playlist-count">
          {count} {listType}
          {count !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="playlist-videos">
        {currentVideos.map((video) => (
          <VideoCardItem
            key={video.id}
            video={video}
            isShortsList={isShortsList}
            mp3Task={taskMap[`${video.url}-mp3-720`]}
            mp4720Task={taskMap[`${video.url}-mp4-720`]}
            mp41080Task={taskMap[`${video.url}-mp4-1080`]}
            onDownload={downloadVideo}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="pagination-container">
          <button
            className="pagination-btn"
            onClick={() => handlePageChange(1)}
            disabled={safeCurrentPage === 1}
            title="처음 페이지로"
          >
            처음으로
          </button>
          <button
            className="pagination-btn"
            onClick={() => handlePageChange(safeCurrentPage - 1)}
            disabled={safeCurrentPage === 1}
            title="이전 페이지"
          >
            이전
          </button>

          <span className="pagination-info">
            {safeCurrentPage} / {totalPages} 페이지
          </span>

          <button
            className="pagination-btn"
            onClick={() => handlePageChange(safeCurrentPage + 1)}
            disabled={safeCurrentPage === totalPages}
            title="다음 페이지"
          >
            다음
          </button>
          <button
            className="pagination-btn"
            onClick={() => handlePageChange(totalPages)}
            disabled={safeCurrentPage === totalPages}
            title="마지막 페이지로"
          >
            마지막으로
          </button>
        </div>
      )}
    </div>
  );
}
