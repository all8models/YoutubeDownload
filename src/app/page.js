"use client";

import { useState } from 'react';
import VideoInfo from '../components/VideoInfo';
import DownloadButton from '../components/DownloadButton';

/**
 * 메인 페이지 컴포넌트
 * - YouTube URL 입력 → 영상 정보 조회 → 포맷 선택 → 다운로드
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
  const [error, setError] = useState('');                 // 에러 메시지
  const [selectedFormat, setSelectedFormat] = useState(''); // 통합 선택 포맷 ID
  const [selectedAudio, setSelectedAudio] = useState('');  // 선택된 오디오 포맷 ID
  const [selectedVideo, setSelectedVideo] = useState('');  // 선택된 비디오 포맷 ID

  // ─── 영상 정보 조회 ────────────────────────────────────────────
  const fetchInfo = async () => {
    if (!url) {
      setError('Please enter a YouTube URL');
      return;
    }
    
    setError('');
    setLoadingInfo(true);
    setInfo(null);
    
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
      
      // Blob 형태로 응답을 받아 브라우저 다운로드 트리거
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const safeTitle = info?.title ? info.title.replace(/[/\\?%*:|"<>]/g, '-') : 'audio';
      a.download = `${safeTitle}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      
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
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const safeTitle = info?.title ? info.title.replace(/[/\\?%*:|"<>]/g, '-') : 'video';
      a.download = `${safeTitle}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      
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
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const safeTitle = info?.title ? info.title.replace(/[/\\?%*:|"<>]/g, '-') : 'video';
      a.download = `${safeTitle}_1080p.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingVideo1080p(false);
    }
  };

  // ─── UI 렌더링 ─────────────────────────────────────────────────
  return (
    <div className="container">
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
        
        {/* 영상 정보 + 포맷 선택 + 다운로드 버튼 */}
        {info && (
          <>
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
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <DownloadButton onClick={handleDownloadAudio} isLoading={loadingAudio} label="Download MP3" />
              <DownloadButton onClick={handleDownloadVideo} isLoading={loadingVideo} label="MP4 (720p)" />
              <DownloadButton onClick={handleDownloadVideo1080p} isLoading={loadingVideo1080p} label="MP4 (1080p)" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
