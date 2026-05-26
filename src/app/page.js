"use client";

import { useState } from 'react';
import VideoInfo from '../components/VideoInfo';
import DownloadButton from '../components/DownloadButton';

export default function Home() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [error, setError] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('');
  // New states for audio and video format selection
  const [selectedAudio, setSelectedAudio] = useState('');
  const [selectedVideo, setSelectedVideo] = useState('');

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
        
        // Also set defaults for the split selectors
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
      
      // Blob download
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

  const handleDownloadVideo = async () => {
    if (!url) return;
    
    setLoadingVideo(true);
    setError('');
    
    try {
      // The mp4 route uses a GET request and handles format internally
      const res = await fetch(`/api/download/mp4?url=${encodeURIComponent(url)}`, {
        method: 'GET',
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(data.error || 'Download failed');
      }
      
      // Blob download
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

  return (
    <div className="container">
      <div className="glass-panel">
        <h1>YouTube to MP3 / MP4</h1>
        
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
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <DownloadButton onClick={handleDownloadAudio} isLoading={loadingAudio} label="Download MP3" />
              <DownloadButton onClick={handleDownloadVideo} isLoading={loadingVideo} label="Download MP4" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
