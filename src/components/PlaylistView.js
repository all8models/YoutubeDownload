'use client';

import { useState } from 'react';
import DownloadButton from './DownloadButton';
import { saveFile } from '../lib/fileDownload';

/**
 * 플레이리스트 뷰 컴포넌트
 * - playlistData: API에서 받은 플레이리스트 정보 (제목, 영상 목록)
 * - 각 영상마다 MP3 / MP4 720p / MP4 1080p 다운로드 버튼 제공
 * - 개별 다운로드 상태를 video ID 기준으로 추적
 */
export default function PlaylistView({ playlistData, downloadDirHandle }) {
  const [loadingMap, setLoadingMap] = useState({});   // { "videoUrl-mp3-720": true, ... }
  const [completedMap, setCompletedMap] = useState({}); // { "videoUrl-mp3-720": true, ... }
  const [error, setError] = useState('');

  /**
   * 플레이리스트 내 개별 영상 다운로드
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
        // bestaudio: yt-dlp가 최적의 오디오 스트림을 자동 선택
        endpoint = `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=bestaudio`;
      } else {
        endpoint = `/api/download/mp4?url=${encodeURIComponent(videoUrl)}&quality=${quality}`;
      }

      const res = await fetch(endpoint, { method: 'GET' });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(data.error || 'Download failed');
      }

      // Blob → 자동 저장 (폴더 선택 시) 또는 브라우저 다운로드
      const blob = await res.blob();
      const safeTitle = (videoTitle || 'video').replace(/[/\\?%*:|"<>]/g, '-');
      const ext = type === 'mp3' ? '.mp3' : '.mp4';
      await saveFile(blob, `${safeTitle}${ext}`, downloadDirHandle);
      // 다운로드 완료 표시
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

  // ─── 데이터가 없으면 아무것도 렌더링하지 않음 ──────────────────
  if (!playlistData || !playlistData.videos) return null;

  return (
    <div className="playlist-view">
      {/* 플레이리스트 헤더 */}
      <div className="playlist-header">
        <h2 className="playlist-title">{playlistData.playlist_title}</h2>
        <span className="playlist-count">
          {playlistData.video_count} video{playlistData.video_count !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <p className="error-message">{error}</p>}

      {/* 영상 목록 */}
      <div className="playlist-videos">
        {playlistData.videos.map((video) => {
          const isRestricted = video.accessible === false;

          return (
          <div key={video.id} className={`playlist-video-item glass-panel${isRestricted ? ' video-restricted' : ''}`}>
            <div className="playlist-thumbnail-wrapper">
              <img
                className="playlist-thumbnail"
                src={video.thumbnail}
                alt={video.title || 'Restricted video'}
                loading="lazy"
              />
              {isRestricted && (
                <div className="restricted-overlay" title="멤버십 한정 콘텐츠">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    <circle cx="12" cy="16" r="1"/>
                  </svg>
                </div>
              )}
            </div>
            <div className="playlist-video-info">
              <h3 className={`playlist-video-title${isRestricted ? ' text-muted' : ''}`}>
                {video.title || '멤버십 한정 콘텐츠'}
              </h3>
              {isRestricted && (
                <p className="restricted-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    <circle cx="12" cy="16" r="1"/>
                  </svg>
                  멤버십 한정 · 다운로드 불가
                </p>
              )}
              {!isRestricted && video.duration && (
                <p className="playlist-video-duration">{formatDuration(video.duration)}</p>
              )}
              <div className="playlist-download-buttons">
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
