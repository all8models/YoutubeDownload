/**
 * 다운로드 버튼 컴포넌트
 * - onClick: 클릭 핸들러
 * - isLoading: 다운로드 중이면 버튼 비활성화 + 로딩 스피너 표시
 * - label: 버튼에 표시할 텍스트 (기본값 "Download")
 */
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
