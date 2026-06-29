'use client';

import { useState } from 'react';
import DownloadButton from './DownloadButton';
import { saveFile } from '../lib/fileDownload';

/**
 * 채널 영상 목록 뷰 컴포넌트
 * - channelData: API에서 받은 채널 영상 정보 (채널명, 영상 목록)
 * - 각 영상마다 MP3 / MP4 720p / MP4 1080p 다운로드 버튼 제공
 * - 개별 다운로드 상태를 video ID 기준으로 추적
 *
 * PlaylistView, ShortsView와 동일한 UI 패턴을 따릅니다.
 */
export default function ChannelVideosView({ channelData, downloadDirHandle }) {
  const [loadingMap, setLoadingMap] = useState({});    // { "videoUrl-mp3-720": true, ... }
  const [completedMap, setCompletedMap] = useState({}); // { "videoUrl-mp3-720": true, ... }
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const ITEMS_PER_PAGE = 20;

  /**
   * 채널 영상 개별 다운로드
   * @param {string} videoUrl  - 개별 영상의 YouTube URL
   * @param {string} videoTitle - 영상 제목 (파일명 생성용)
   * @param {'mp3'|'mp4'} type  - 다운로드 타입
   * @param {number} quality    - MP4 화질 (720 또는 1080)
   */
  const downloadVideo = async (videoUrl, videoTitle, type, quality = 720) => {
    const loadKey = `${videoUrl}-${type}-${quality}`;
    setLoadingMap((prev) => ({ ...prev, [loadKey]: true }));
    setError('');

    try {
      let endpoint;
      if (type === 'mp3') {
        endpoint = `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=bestaudio`;
      } else {
        endpoint = `/api/download/mp4?url=${encodeURIComponent(videoUrl)}&quality=${quality}`;
      }

      const res = await fetch(endpoint, { method: 'GET' });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(data.error || 'Download failed');
      }

      const blob = await res.blob();
      const safeTitle = (videoTitle || 'video').replace(/[/\\?%*:|"<>]/g, '-');
      const ext = type === 'mp3' ? '.mp3' : '.mp4';
      await saveFile(blob, `${safeTitle}${ext}`, downloadDirHandle);
      setCompletedMap((prev) => ({ ...prev, [loadKey]: true }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMap((prev) => ({ ...prev, [loadKey]: false }));
    }
  };

  /**
   * 초(seconds)를 "M:SS" 형식으로 변환
   */
  const formatDuration = (seconds) => {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  // 데이터가 없으면 아무것도 렌더링하지 않음
  if (!channelData || !channelData.videos) return null;

  const videos = channelData.videos;
  const totalVideos = videos.length;
  const totalPages = Math.ceil(totalVideos / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const currentVideos = videos.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    const viewElement = document.querySelector('.channel-view');
    if (viewElement) {
      viewElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="channel-view">
      {/* 채널 헤더 */}
      <div className="channel-header">
        <h2 className="channel-title">{channelData.channel_title}</h2>
        <span className="channel-count">
          {channelData.video_count} video{channelData.video_count !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <p className="error-message">{error}</p>}

      {/* 영상 목록 */}
      <div className="channel-videos">
        {currentVideos.map((video) => {
          const isRestricted = video.accessible === false;
          return (
            <div key={video.id} className={`channel-video-item glass-panel ${isRestricted ? 'restricted-item' : ''}`}>
              <div className="playlist-thumbnail-wrapper">
                <img
                  className="channel-thumbnail"
                  src={video.thumbnail}
                  alt={video.title}
                  loading="lazy"
                />
                {isRestricted && (
                  <div className="thumbnail-restricted-overlay" title="멤버십 전용 또는 비공개 콘텐츠">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </div>
                )}
              </div>
              <div className="channel-video-info">
                <h3 className="channel-video-title">
                  {video.title}
                  {isRestricted && <span className="restricted-badge">다운로드 불가</span>}
                </h3>
                {video.duration && !isRestricted && (
                  <p className="channel-video-duration">{formatDuration(video.duration)}</p>
                )}
                <div className="channel-download-buttons">
                  <DownloadButton
                    onClick={() => downloadVideo(video.url, video.title, 'mp3')}
                    isLoading={loadingMap[`${video.url}-mp3-720`]}
                    isCompleted={completedMap[`${video.url}-mp3-720`]}
                    disabled={isRestricted}
                    label="MP3"
                  />
                  <DownloadButton
                    onClick={() => downloadVideo(video.url, video.title, 'mp4', 720)}
                    isLoading={loadingMap[`${video.url}-mp4-720`]}
                    isCompleted={completedMap[`${video.url}-mp4-720`]}
                    disabled={isRestricted}
                    label="720p"
                  />
                  <DownloadButton
                    onClick={() => downloadVideo(video.url, video.title, 'mp4', 1080)}
                    isLoading={loadingMap[`${video.url}-mp4-1080`]}
                    isCompleted={completedMap[`${video.url}-mp4-1080`]}
                    disabled={isRestricted}
                    label="1080p"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 페이지네이션 네비게이션 */}
      {totalPages > 1 && (
        <div className="pagination-container">
          <button
            className="pagination-btn"
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
            title="처음 페이지로"
          >
            처음으로
          </button>
          <button
            className="pagination-btn"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            title="이전 페이지"
          >
            이전
          </button>
          <span className="pagination-info">
            {currentPage} / {totalPages} 페이지
          </span>
          <button
            className="pagination-btn"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            title="다음 페이지"
          >
            다음
          </button>
          <button
            className="pagination-btn"
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages}
            title="마지막 페이지로"
          >
            마지막으로
          </button>
        </div>
      )}
    </div>
  );
}
