export default function DownloadButton({ onClick, isLoading, label = 'Download' }) {
  return (
    <button onClick={onClick} disabled={isLoading} className="download-btn">
      {isLoading ? (
        <>
          <div className="loader" />
          Downloading...
        </>
      ) : (
        label
      )}
    </button>
  );
}
