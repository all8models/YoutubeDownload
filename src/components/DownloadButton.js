/**
 * 다운로드 버튼 컴포넌트
 * - onClick: 클릭 핸들러
 * - isLoading: 다운로드 중이면 버튼 비활성화 + 로딩 스피너 표시
 * - isCompleted: 다운로드 완료 시 체크 아이콘 + 비활성화
 * - disabled: 멤버십 한정 등 접근 불가 영상일 때 비활성화 + 자물쇠 아이콘
 * - label: 버튼에 표시할 텍스트 (기본값 "Download")
 */
export default function DownloadButton({ onClick, isLoading, isCompleted, disabled, label = 'Download' }) {
  // 멤버십 한정 등 접근 불가 상태
  if (disabled) {
    return (
      <button className="download-btn restricted" disabled title="멤버십 한정 콘텐츠 - 다운로드 불가">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          <circle cx="12" cy="16" r="1"/>
        </svg>
        {label}
      </button>
    );
  }

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
