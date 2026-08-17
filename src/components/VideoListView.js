'use client';

import { useState } from 'react';
import DownloadButton from './DownloadButton';
import { saveResponseStream } from '../lib/fileDownload';

/**
 * 범용 비디오 목록 뷰 컴포넌트 (VideoListView)
 * - 기존의 PlaylistView, ShortsView, ChannelVideosView의 중복 코드를 완벽히 통합한 컴포넌트입니다.
 * - 리스트의 제목, 개수, 영상 배열을 받아서 페이지네이션 및 개별 다운로드 버튼 UI를 렌더링합니다.
 * 
 * @param {Object} props
 * @param {string} props.title - 목록의 상단에 표시될 제목 (예: 채널명, 재생목록명)
 * @param {number} props.count - 목록에 포함된 전체 영상 개수
 * @param {Array} props.videos - 화면에 표시할 영상 객체들의 배열
 * @param {string} props.listType - 컴포넌트의 타입 라벨 (예: 'video', 'short'). 단수형으로 입력합니다.
 * @param {FileSystemDirectoryHandle} [props.downloadDirHandle] - 사용자가 선택한 로컬 폴더 핸들 (없으면 브라우저 기본 다운로드 수행)
 */
export default function VideoListView({ title, count, videos, listType = 'video', downloadDirHandle }) {
  // 개별 영상별 다운로드 진행 상태를 추적하기 위한 Map 객체
  // 키 구조: `${videoUrl}-${type}-${quality}`
  const [loadingMap, setLoadingMap] = useState({});
  const [completedMap, setCompletedMap] = useState({});
  
  // 에러 메시지 상태 관리
  const [error, setError] = useState('');
  
  // 현재 페이지 번호 상태 관리 (기본 1페이지)
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 20;

  /**
   * 개별 영상 다운로드를 처리하는 비동기 함수입니다.
   * 
   * @param {string} videoUrl - 다운로드할 YouTube 영상 원본 URL
   * @param {string} videoTitle - 파일명으로 사용될 원본 영상 제목
   * @param {'mp3'|'mp4'} type - 다운로드 확장자 타입
   * @param {number} [quality=720] - MP4 다운로드 시 적용될 화질 (720 또는 1080)
   */
  const downloadVideo = async (videoUrl, videoTitle, type, quality = 720) => {
    // 다운로드 버튼의 로딩 상태를 독립적으로 제어하기 위해 고유 키 생성
    const loadKey = `${videoUrl}-${type}-${quality}`;
    setLoadingMap((prev) => ({ ...prev, [loadKey]: true }));
    setError('');

    try {
      let endpoint;
      // 다운로드 타입에 따라 API 엔드포인트를 동적으로 분기합니다.
      if (type === 'mp3') {
        // bestaudio: yt-dlp가 최적의 오디오 스트림을 자동 선택합니다.
        endpoint = `/api/download?url=${encodeURIComponent(videoUrl)}&format_id=bestaudio`;
      } else {
        endpoint = `/api/download/mp4?url=${encodeURIComponent(videoUrl)}&quality=${quality}`;
      }

      const res = await fetch(endpoint, { method: 'GET' });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(data.error || 'Download failed');
      }

      // 파일 시스템 저장 시 문제를 일으킬 수 있는 특수문자를 하이픈(-)으로 치환합니다.
      const safeTitle = (videoTitle || listType).replace(/[/\\?%*:|"<>]/g, '-');
      const ext = type === 'mp3' ? '.mp3' : '.mp4';
      
      // 제로 버퍼 다이렉트 스트리밍 저장 실행 (RAM 적재 없이 즉시 디스크 파이핑)
      await saveResponseStream(res, `${safeTitle}${ext}`, downloadDirHandle);
      
      // 성공적으로 저장되면 해당 버튼을 완료(V) 상태로 변경
      setCompletedMap((prev) => ({ ...prev, [loadKey]: true }));
    } catch (err) {
      setError(err.message);
    } finally {
      // 통신 완료 후 로딩 상태 해제
      setLoadingMap((prev) => ({ ...prev, [loadKey]: false }));
    }
  };

  /**
   * 초(seconds) 단위의 재생 시간을 "M:SS" 또는 "H:MM:SS" 형식으로 변환하는 유틸리티 함수입니다.
   */
  const formatDuration = (seconds) => {
    if (!seconds) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = String(seconds % 60).padStart(2, '0');
    
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${s}`;
    }
    return `${m}:${s}`;
  };

  // 영상 목록이 유효하지 않은 경우 렌더링을 중단합니다.
  if (!videos || !Array.isArray(videos) || videos.length === 0) return null;

  // 페이지네이션 처리 계산 로직
  const totalVideos = videos.length;
  const totalPages = Math.ceil(totalVideos / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  // 전체 배열에서 현재 페이지에 해당하는 부분 배열만 잘라내어 렌더링합니다.
  const currentVideos = videos.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  /**
   * 페이지 번호를 변경하고 리스트 뷰 상단으로 스무스 스크롤을 수행합니다.
   */
  const handlePageChange = (page) => {
    setCurrentPage(page);
    const viewElement = document.querySelector('.video-list-view');
    if (viewElement) {
      viewElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="video-list-view playlist-view">
      {/* 뷰 최상단: 제목과 총 영상 갯수 표시 */}
      <div className="playlist-header">
        <h2 className="playlist-title">{title}</h2>
        <span className="playlist-count">
          {count} {listType}{count !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <p className="error-message">{error}</p>}

      {/* 리스트 본문: 영상 카드 목록 렌더링 */}
      <div className="playlist-videos">
        {currentVideos.map((video) => {
          // 멤버십 전용 또는 비공개 영상인 경우 UI 비활성화를 위한 플래그
          const isRestricted = video.accessible === false;
          
          return (
            <div key={video.id} className={`playlist-video-item glass-panel ${isRestricted ? 'restricted-item' : ''}`}>
              <div className="playlist-thumbnail-wrapper">
                <img
                   className="playlist-thumbnail"
                   src={video.thumbnail}
                   alt={video.title}
                   loading="lazy" // 브라우저 네이티브 지연 로딩을 통한 성능 최적화
                />
                
                {/* 비접근성 영상의 경우 반투명 오버레이와 자물쇠 아이콘 노출 */}
                {isRestricted && (
                  <div className="thumbnail-restricted-overlay" title="멤버십 전용 또는 비공개 콘텐츠">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
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
                
                {/* 개별 영상 다운로드 버튼 묶음 */}
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

      {/* 페이지네이션 렌더링 구역 (영상이 21개 이상인 경우에만 표시) */}
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
