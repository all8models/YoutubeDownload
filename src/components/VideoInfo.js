import React from 'react';

/**
 * 비디오 정보 및 포맷 선택 UI 컴포넌트
 * - info: 영상 메타데이터 (제목, 썸네일, 길이, 포맷 목록)
 * - selectedAudio / selectedVideo: 현재 선택된 오디오/비디오 포맷 ID
 * - onAudioChange / onVideoChange: 포맷 변경 시 상위 컴포넌트로 전달하는 콜백
 */
export default function VideoInfo({
  info,
  selectedAudio,
  selectedVideo,
  onAudioChange,
  onVideoChange,
}) {
  if (!info) return null;

  // 비디오 포맷을 720p / 1080p 그룹으로 분리
  const videoFormats = info.formats.filter((f) => f.type === 'video');
  const video720p = videoFormats.filter((f) => f.height <= 720);
  const video1080p = videoFormats.filter((f) => f.height > 720 && f.height <= 1080);

  return (
    <div className="glass-panel video-info">
      {/* 썸네일 이미지 */}
      <div className="thumbnail-container">
        <img src={info.thumbnail} alt={info.title} />
      </div>
      <div className="video-details">
        {/* 영상 제목 및 재생 시간 */}
        <h2>{info.title}</h2>
        <p>
          Duration: {Math.floor(info.duration / 60)}:{String(info.duration % 60).padStart(2, '0')}
        </p>

        {/* 오디오(MP3) 포맷 선택 */}
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

        {/* 비디오 720p 포맷 선택 */}
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

        {/* 비디오 1080p 포맷 선택 (1080p 포맷이 있을 경우에만 표시) */}
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
