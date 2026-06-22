'use client';

import { useState } from 'react';
import DownloadButton from './DownloadButton';
import { saveFile } from '../lib/fileDownload';

/**
 * 쇼트(Shorts) 목록 뷰 컴포넌트
 * - shortsData: API에서 받은 쇼트 정보 (채널명, 영상 목록)
 * - 각 쇼트마다 MP3 / MP4 720p / MP4 1080p 다운로드 버튼 제공
 * - 개별 다운로드 상태를 video ID 기준으로 추적
 *
 * 플레이리스트와 동일한 UI 패턴을 따르며, 소스는 완전히 분리되어 있습니다.
 */
export default function ShortsView({ shortsData, downloadDirHandle }) {
  const [loadingMap, setLoadingMap] = useState({});    // { "videoUrl-mp3-720": true, ... }
  const [completedMap, setCompletedMap] = useState({}); // { "videoUrl-mp3-720": true, ... }
  const [error, setError] = useState('');

  /**
   * 쇼트 개별 영상 다운로드
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
      const safeTitle = (videoTitle || 'short').replace(/[/\\?%*:|"<>]/g, '-');
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
  if (!shortsData || !shortsData.videos) return null;

  return (
    <div className="shorts-view">
      {/* 쇼트 헤더 */}
      <div className="shorts-header">
        <h2 className="shorts-title">{shortsData.channel_title}</h2>
        <span className="shorts-count">
          {shortsData.video_count} short{shortsData.video_count !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <p className="error-message">{error}</p>}

      {/* 쇼트 목록 */}
      <div className="shorts-videos">
        {shortsData.videos.map((video) => {
          const isRestricted = video.accessible === false;
          return (
            <div key={video.id} className={`shorts-video-item glass-panel ${isRestricted ? 'restricted-item' : ''}`}>
              <div className="shorts-thumbnail-wrapper">
                <img
                  className="shorts-thumbnail"
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
              <div className="shorts-video-info">
                <h3 className="shorts-video-title">
                  {video.title}
                  {isRestricted && <span className="restricted-badge">다운로드 불가</span>}
                </h3>
                {video.duration && !isRestricted && (
                  <p className="shorts-video-duration">{formatDuration(video.duration)}</p>
                )}
                <div className="shorts-download-buttons">
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
    </div>
  );
}
