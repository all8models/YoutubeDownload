export default function DownloadButton({ onClick, isLoading }) {
  return (
    <button onClick={onClick} disabled={isLoading}>
      {isLoading ? (
        <>
          <div className="loader"></div>
          Downloading...
        </>
      ) : (
        'Download MP3'
      )}
    </button>
  );
}
