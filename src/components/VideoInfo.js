import React from 'react';

export default function VideoInfo({
  info,
  selectedAudio,
  selectedVideo,
  onAudioChange,
  onVideoChange,
}) {
  if (!info) return null;

  const videoFormats = info.formats.filter((f) => f.type === 'video');
  const video720p = videoFormats.filter((f) => f.height <= 720);
  const video1080p = videoFormats.filter((f) => f.height > 720 && f.height <= 1080);

  return (
    <div className="glass-panel video-info">
      <div className="thumbnail-container">
        <img src={info.thumbnail} alt={info.title} />
      </div>
      <div className="video-details">
        <h2>{info.title}</h2>
        <p>
          Duration: {Math.floor(info.duration / 60)}:{String(info.duration % 60).padStart(2, '0')}
        </p>
        {/* Audio selector */}
        <div className="format-group">
          <label>Audio</label>
          <select
            className="format-select"
            value={selectedAudio}
            onChange={(e) => onAudioChange(e.target.value)}
          >
            {info.formats
              .filter((f) => f.type === 'audio')
              .map((f) => (
                <option key={f.format_id} value={f.format_id}>
                  MP3 - {f.quality}
                </option>
              ))}
          </select>
        </div>
        {/* Video selector (720p) */}
        <div className="format-group">
          <label>Video 720p</label>
          <select
            className="format-select"
            value={selectedVideo}
            onChange={(e) => onVideoChange(e.target.value)}
          >
            {video720p.map((f) => (
              <option key={f.format_id} value={f.format_id}>
                MP4 - {f.quality}
              </option>
            ))}
          </select>
        </div>
        {/* Video selector (1080p) */}
        {video1080p.length > 0 && (
          <div className="format-group">
            <label>Video 1080p</label>
            <select
              className="format-select"
              value={selectedVideo}
              onChange={(e) => onVideoChange(e.target.value)}
            >
              {video1080p.map((f) => (
                <option key={f.format_id} value={f.format_id}>
                  MP4 - {f.quality}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
