"use client";

import { useState } from 'react';
import VideoInfo from '../components/VideoInfo';
import DownloadButton from '../components/DownloadButton';
import PlaylistView from '../components/PlaylistView';
import ShortsView from '../components/ShortsView';
import DownloadFolderPicker from '../components/DownloadFolderPicker';
import { chooseDownloadDirectory, saveFile } from '../lib/fileDownload';

/**
 * URL이 YouTube 플레이리스트인지 확인
 * URL에 'list=' 파라미터가 포함되어 있으면 플레이리스트로 간주
 */
function isPlaylistUrl(url) {
  return url.includes('list=');
}

/**
 * URL이 YouTube Shorts 페이지인지 확인
 * - @channel/shorts (채널 쇼트 페이지)
 * - /shorts/VIDEO_ID (단일 쇼트)
 */
function isShortsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('/shorts');
  } catch {
    return false;
  }
}

/**
 * 메인 페이지 컴포넌트
 * - YouTube URL 입력 → 영상 정보 조회 → 포맷 선택 → 다운로드
 * - 플레이리스트 URL이면 → 영상 목록 표시 → 개별 다운로드
 * - MP3(오디오), MP4 720p, MP4 1080p 세 가지 다운로드 지원
 */
export default function Home() {
  // ─── 상태(state) 관리 ──────────────────────────────────────────
  const [url, setUrl] = useState('');                    // 사용자가 입력한 YouTube URL
  const [info, setInfo] = useState(null);                 // 영상 메타데이터 (제목, 포맷 등)
  const [loadingInfo, setLoadingInfo] = useState(false);  // 정보 조회 중 여부
  const [loadingAudio, setLoadingAudio] = useState(false); // MP3 다운로드 중 여부
  const [loadingVideo, setLoadingVideo] = useState(false); // MP4 720p 다운로드 중 여부
  const [loadingVideo1080p, setLoadingVideo1080p] = useState(false); // MP4 1080p 다운로드 중 여부
  const [completedAudio, setCompletedAudio] = useState(false);   // MP3 완료
  const [completedVideo, setCompletedVideo] = useState(false);   // MP4 720p 완료
  const [completedVideo1080p, setCompletedVideo1080p] = useState(false); // MP4 1080p 완료
  const [error, setError] = useState('');                 // 에러 메시지
  const [selectedFormat, setSelectedFormat] = useState(''); // 통합 선택 포맷 ID
  const [selectedAudio, setSelectedAudio] = useState('');  // 선택된 오디오 포맷 ID
  const [selectedVideo, setSelectedVideo] = useState('');  // 선택된 비디오 포맷 ID
  const [playlistData, setPlaylistData] = useState(null);  // 플레이리스트 정보
  const [shortsData, setShortsData] = useState(null);      // 쇼트 정보
  const [downloadDirHandle, setDownloadDirHandle] = useState(null); // 자동 저장 폴더 핸들

  // ─── 다운로드 폴더 선택 (File System Access API) ──────────────────
  const handleChooseFolder = async () => {
    const handle = await chooseDownloadDirectory();
    if (handle) setDownloadDirHandle(handle);
  };

  // ─── 분석 버튼 클릭: URL 타입에 따라 단일 영상 / 플레이리스트 분기 ──
  const fetchInfo = async () => {
    if (!url) {
      setError('Please enter a YouTube URL');
      return;
    }

    setError('');
    setLoadingInfo(true);
    setInfo(null);
    setPlaylistData(null);
    setShortsData(null);
    setCompletedAudio(false);
    setCompletedVideo(false);
    setCompletedVideo1080p(false);

    // 쇼트 페이지 URL이면 쇼트 API 호출
    if (isShortsUrl(url)) {
      try {
        const res = await fetch(`/api/shorts?url=${encodeURIComponent(url)}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to fetch shorts');

        setShortsData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingInfo(false);
      }
      return;
    }

    // 플레이리스트 URL이면 플레이리스트 API 호출
    if (isPlaylistUrl(url)) {
      try {
        const res = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to fetch playlist info');

        setPlaylistData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingInfo(false);
      }
      return;
    }

    // ─── 단일 영상: 기존 info API 호출 ──────────────────────────
    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to fetch video info');

      setInfo(data);
      if (data.formats && data.formats.length > 0) {
        setSelectedFormat(data.formats[0].format_id);

        // 오디오/비디오 각각 첫 번째 포맷을 기본 선택
        const audio = data.formats.find(f => f.type === 'audio');
        const video = data.formats.find(f => f.type === 'video');
        if (audio) setSelectedAudio(audio.format_id);
        if (video) setSelectedVideo(video.format_id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInfo(false);
    }
  };

  // ─── MP3 다운로드 ──────────────────────────────────────────────
  const handleDownloadAudio = async () => {
    if (!url || !selectedAudio) return;
    
    setLoadingAudio(true);
    setError('');
    
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format_id: selectedAudio })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Download failed');
      }
      
      // Blob → 자동 저장 (폴더 선택 시) 또는 브라우저 다운로드
      const blob = await res.blob();
      const safeTitle = info?.title ? info.title.replace(/[/\\?%*:|"<>]/g, '-') : 'audio';
      await saveFile(blob, `${safeTitle}.mp3`, downloadDirHandle);
      setCompletedAudio(true);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAudio(false);
    }
  };

  // ─── MP4 720p 다운로드 ─────────────────────────────────────────
  const handleDownloadVideo = async () => {
    if (!url) return;
    
    setLoadingVideo(true);
    setError('');
    
    try {
      const res = await fetch(`/api/download/mp4?url=${encodeURIComponent(url)}&quality=720`, {
        method: 'GET',
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(data.error || 'Download failed');
      }
      
      const blob = await res.blob();
      const safeTitle = info?.title ? info.title.replace(/[/\\?%*:|"<>]/g, '-') : 'video';
      await saveFile(blob, `${safeTitle}.mp4`, downloadDirHandle);
      setCompletedVideo(true);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingVideo(false);
    }
  };

  // ─── MP4 1080p 다운로드 ────────────────────────────────────────
  const handleDownloadVideo1080p = async () => {
    if (!url) return;
    
    setLoadingVideo1080p(true);
    setError('');
    
    try {
      const res = await fetch(`/api/download/mp4?url=${encodeURIComponent(url)}&quality=1080`, {
        method: 'GET',
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(data.error || 'Download failed');
      }
      
      const blob = await res.blob();
      const safeTitle = info?.title ? info.title.replace(/[/\\?%*:|"<>]/g, '-') : 'video';
      await saveFile(blob, `${safeTitle}_1080p.mp4`, downloadDirHandle);
      setCompletedVideo1080p(true);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingVideo1080p(false);
    }
  };

  // ─── UI 렌더링 ─────────────────────────────────────────────────
  return (
    <div className={`container ${playlistData || shortsData ? 'container-wide' : ''}`}>
      <div className="glass-panel">
        <h1>YouTube to MP3 / MP4</h1>
        
        {/* URL 입력 + 분석 버튼 */}
        <div className="input-group">
          <input 
            type="text" 
            placeholder="Paste YouTube Link Here..." 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchInfo()}
          />
          <button onClick={fetchInfo} disabled={loadingInfo}>
            {loadingInfo ? <div className="loader"></div> : 'Analyze'}
          </button>
        </div>
        
        {error && <p className="error-message">{error}</p>}
        
        {/* 다운로드 폴더 선택 버튼 */}
        <DownloadFolderPicker 
          onSelect={handleChooseFolder} 
          selected={!!downloadDirHandle} 
        />
        
        {/* 플레이리스트 모드: 영상 목록 + 개별 다운로드 버튼 */}
        {playlistData && (
          <PlaylistView playlistData={playlistData} downloadDirHandle={downloadDirHandle} />
        )}
        
        {/* 쇼트 모드: 쇼트 목록 + 개별 다운로드 버튼 */}
        {shortsData && (
          <ShortsView shortsData={shortsData} downloadDirHandle={downloadDirHandle} />
        )}
        
        {/* 단일 영상 모드: 영상 정보 + 포맷 선택 + 다운로드 버튼 */}
        {info && !playlistData && !shortsData && (
          <>
            <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <DownloadButton onClick={handleDownloadAudio} isLoading={loadingAudio} isCompleted={completedAudio} label="Download MP3" />
              <DownloadButton onClick={handleDownloadVideo} isLoading={loadingVideo} isCompleted={completedVideo} label="MP4 (720p)" />
              <DownloadButton onClick={handleDownloadVideo1080p} isLoading={loadingVideo1080p} isCompleted={completedVideo1080p} label="MP4 (1080p)" />
            </div>
            <VideoInfo 
              info={info} 
              selectedAudio={selectedAudio} 
              selectedVideo={selectedVideo} 
              onAudioChange={(val) => {
                setSelectedAudio(val);
                setSelectedFormat(val);
              }} 
              onVideoChange={(val) => {
                setSelectedVideo(val);
                setSelectedFormat(val);
              }} 
            />
          </>
        )}
      </div>
    </div>
  );
}
