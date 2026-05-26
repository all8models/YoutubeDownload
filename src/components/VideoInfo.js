import React from 'react';

export default function VideoInfo({
  info,
  selectedAudio,
  selectedVideo,
  onAudioChange,
  onVideoChange,
}) {
  if (!info) return null;

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
        {/* Video selector (MP4 up to 720p) */}
        <select
          className="format-select"
          value={selectedVideo}
          onChange={(e) => onVideoChange(e.target.value)}
        >
          {info.formats
            .filter((f) => f.type === 'video')
            .map((f) => (
              <option key={f.format_id} value={f.format_id}>
                MP4 - {f.quality}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}
