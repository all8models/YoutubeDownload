export default function VideoInfo({ info, selectedFormat, onFormatChange }) {
  if (!info) return null;

  return (
    <div className="glass-panel video-info">
      <div className="thumbnail-container">
        <img src={info.thumbnail} alt={info.title} />
      </div>
      <div className="video-details">
        <h2>{info.title}</h2>
        <p>Duration: {Math.floor(info.duration / 60)}:{String(info.duration % 60).padStart(2, '0')}</p>
        
        <select 
          className="format-select"
          value={selectedFormat} 
          onChange={(e) => onFormatChange(e.target.value)}
        >
          {info.formats.map((f) => (
            <option key={f.format_id} value={f.format_id}>
              MP3 - {f.quality}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
