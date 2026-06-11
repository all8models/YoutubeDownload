/**
 * 다운로드 버튼 컴포넌트
 * - onClick: 클릭 핸들러
 * - isLoading: 다운로드 중이면 버튼 비활성화 + 로딩 스피너 표시
 * - isCompleted: 다운로드 완료 시 체크 아이콘 + 비활성화
 * - label: 버튼에 표시할 텍스트 (기본값 "Download")
 */
export default function DownloadButton({ onClick, isLoading, isCompleted, label = 'Download' }) {
  if (isCompleted) {
    return (
      <button className="download-btn completed" disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        {label}
      </button>
    );
  }

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
