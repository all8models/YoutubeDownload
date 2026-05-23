"use client";

import { useState } from 'react';
import VideoInfo from '../components/VideoInfo';
import DownloadButton from '../components/DownloadButton';

export default function Home() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadingDownload, setLoadingDownload] = useState(false);
  const [error, setError] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('');

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
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInfo(false);
    }
  };

  const handleDownload = async () => {
    if (!url || !selectedFormat) return;
    
    setLoadingDownload(true);
    setError('');
    
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format_id: selectedFormat })
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
      setLoadingDownload(false);
    }
  };

  return (
    <div className="container">
      <div className="glass-panel">
        <h1>YouTube to MP3</h1>
        
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
              selectedFormat={selectedFormat} 
              onFormatChange={setSelectedFormat} 
            />
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center' }}>
              <DownloadButton onClick={handleDownload} isLoading={loadingDownload} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
