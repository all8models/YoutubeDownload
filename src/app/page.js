"use client";

import { useState, useEffect } from 'react';
import VideoListView from '../components/VideoListView';
import DownloadFolderPicker from '../components/DownloadFolderPicker';
import { chooseDownloadDirectory } from '../lib/fileDownload';

/**
 * URL이 YouTube 플레이리스트인지 확인
 * URL에 'list=' 파라미터가 포함되어 있으면 플레이리스트로 간주합니다.
 */
function isPlaylistUrl(url) {
  return url.includes('list=');
}

/**
 * URL이 YouTube Shorts 페이지인지 확인
 * - @channel/shorts (채널 쇼트 페이지)
 * - /shorts/VIDEO_ID (단일 쇼트)
 */
function isShortsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('/shorts');
  } catch {
    return false;
  }
}

/**
 * URL이 YouTube 채널의 /videos 페이지인지 확인
 * - @channel/videos (채널 업로드 영상 목록 페이지)
 * - /c/channel/videos (레거시 채널 URL)
 */
function isChannelVideosUrl(url) {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    return pathParts.length > 0 && pathParts[pathParts.length - 1] === 'videos';
  } catch {
    return false;
  }
}

/**
 * 유튜브 채널 URL이 핸들(@name) 형식이고 뒤에 /videos가 없는 경우 자동으로 붙여주는 헬퍼
 * 예: https://www.youtube.com/@codingpe -> https://www.youtube.com/@codingpe/videos
 */
function formatChannelUrl(inputUrl) {
  if (!inputUrl) return inputUrl;
  
  try {
    const trimmed = inputUrl.trim();
    // URL을 디코딩하여 한글(@무드킹) 패턴으로 가독성 및 비교 연산 단순화
    const decoded = decodeURIComponent(trimmed);
    
    let testUrl = decoded;
    if (!/^https?:\/\//i.test(decoded)) {
      testUrl = 'https://' + decoded;
    }
    
    const parsed = new URL(testUrl);
    if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      
      // 경로가 정확히 1개이고 @로 시작하는 경우 (예: /@무드킹)
      if (pathParts.length === 1 && pathParts[0].startsWith('@')) {
        parsed.pathname = `/${pathParts[0]}/videos`;
        
        // URL.toString()은 pathname을 퍼센트 인코딩하므로, 다시 decodeURIComponent로 복원
        const result = decodeURIComponent(parsed.toString());
        if (!/^https?:\/\//i.test(decoded)) {
          return result.replace(/^https?:\/\//i, '');
        }
        return result;
      }
    }
  } catch {
    // 정규식 대체 패턴 매칭 (한글 및 인코딩 글자 대응을 위해 [^/?#]+ 사용)
    const handleRegex = /^(https?:\/\/)?(www\.)?youtube\.com\/(@[^/?#]+)\/?(\?.*)?$/i;
    try {
      const decodedInput = decodeURIComponent(inputUrl.trim());
      const match = decodedInput.match(handleRegex);
      if (match) {
        const proto = match[1] || 'https://';
        const www = match[2] || 'www.';
        const handle = match[3];
        const query = match[4] || '';
        return `${proto}${www}youtube.com/${handle}/videos${query}`;
      }
    } catch (_) {}
  }
  return inputUrl;
}

/**
 * 메인 어플리케이션(Home) 페이지 컴포넌트
 * - YouTube URL 입력에 따라 단일 영상, 플레이리스트, 채널 영상, 쇼츠를 지능적으로 분석
 * - 상태 관리를 단순화하여 하나의 통합된 listData 상태만 사용
 * - 통합된 VideoListView 컴포넌트를 통해 모든 목록 유형을 렌더링
 */
export default function Home() {
  // ─── 기본 입력 상태 (State) ──────────────────────────────────
  const [url, setUrl] = useState('');                   // 사용자가 입력한 YouTube URL
  const [theme, setTheme] = useState('system');         // 테마 모드 ('light' | 'dark' | 'system')

  // ─── API 통신 및 목록 데이터 상태 (State) ──────────────────────
  const [loadingInfo, setLoadingInfo] = useState(false); // 정보 조회 로딩 여부
  const [error, setError] = useState('');                // 조회 실패 시 에러 메시지
  // 기존의 playlistData, shortsData, channelData를 통합한 단일 상태 변수
  // 구조: { title, count, videos, type }
  const [listData, setListData] = useState(null);
  
  const [downloadDirHandle, setDownloadDirHandle] = useState(null); // 자동 저장할 폴더의 권한 핸들

  // ─── 테마 제어 및 초기화 로직 ──────────────────────────────────
  useEffect(() => {
    // 로컬 스토리지에서 테마 불러오기
    const savedTheme = localStorage.getItem('theme') || 'system';
    setTheme(savedTheme);
    applyTheme(savedTheme);

    // OS 시스템 설정 변경 감지 리스너
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      const currentTheme = localStorage.getItem('theme') || 'system';
      if (currentTheme === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, []);

  const applyTheme = (targetTheme) => {
    const root = document.documentElement;
    root.classList.remove('dark-theme', 'light-theme');
    
    if (targetTheme === 'system') {
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(isSystemDark ? 'dark-theme' : 'light-theme');
    } else if (targetTheme === 'dark') {
      root.classList.add('dark-theme');
    } else {
      root.classList.add('light-theme');
    }
  };

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
  };

  // ─── 브라우저 파일 시스템 팝업 ─────────────────────────────────
  const handleChooseFolder = async () => {
    const handle = await chooseDownloadDirectory();
    if (handle) setDownloadDirHandle(handle);
  };

  // ─── 정보 분석(fetch) 로직 ────────────────────────────────────
  const fetchInfo = async () => {
    let targetUrl = url.trim();
    if (!targetUrl) {
      setError('Please enter a YouTube URL');
      return;
    }

    // 인코딩된 URL 문제를 방지하기 위한 디코딩
    try {
      targetUrl = decodeURIComponent(targetUrl);
    } catch (_) {}

    // 짧은 핸들 URL인 경우 자동 완성
    const formattedUrl = formatChannelUrl(targetUrl);
    targetUrl = formattedUrl;
    setUrl(formattedUrl);

    setError('');
    setLoadingInfo(true);
    setListData(null); // 기존 결과 리셋

    try {
      // 1. 쇼트 페이지 분석
      if (isShortsUrl(targetUrl)) {
        const res = await fetch(`/api/shorts?url=${encodeURIComponent(targetUrl)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch shorts');
        
        setListData({
          title: data.channel_title,
          count: data.video_count,
          videos: data.videos,
          type: 'short',
        });
        return;
      }

      // 2. 채널 비디오 목록 분석
      if (isChannelVideosUrl(targetUrl)) {
        const res = await fetch(`/api/channel-videos?url=${encodeURIComponent(targetUrl)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch channel videos');
        
        setListData({
          title: data.channel_title,
          count: data.video_count,
          videos: data.videos,
          type: 'video',
        });
        return;
      }

      // 3. 플레이리스트 분석
      if (isPlaylistUrl(targetUrl)) {
        const res = await fetch(`/api/playlist?url=${encodeURIComponent(targetUrl)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch playlist info');
        
        setListData({
          title: data.playlist_title,
          count: data.video_count,
          videos: data.videos,
          type: 'video',
        });
        return;
      }

      // 4. 일반 단일 영상 분석 (Fallback)
      const res = await fetch(`/api/info?url=${encodeURIComponent(targetUrl)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch video info');

      // 단일 영상도 목록 형태로 구조화하여 VideoListView에 던져줍니다.
      setListData({
        title: "단일 영상 분석 결과 (Single Video)",
        count: 1,
        videos: [
          {
            id: data.id || data.url || targetUrl,
            title: data.title,
            url: data.url || targetUrl,
            thumbnail: data.thumbnail,
            duration: data.duration,
            accessible: true,
          },
        ],
        type: 'video',
      });

    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInfo(false); // 로딩 스피너 종료
    }
  };

  // ─── 렌더링 파트 ─────────────────────────────────────────────
  return (
    <div className={`container ${listData ? 'container-wide' : ''}`}>
      <div className="glass-panel">
        {/* 테마 스위처 */}
        <div className="theme-header">
          <div className="theme-selector-container">
            <button 
              className={`theme-btn ${theme === 'light' ? 'active' : ''}`} 
              onClick={() => handleThemeChange('light')}
              title="라이트 모드"
            >
              <span>☀️</span> 라이트
            </button>
            <button 
              className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} 
              onClick={() => handleThemeChange('dark')}
              title="다크 모드"
            >
              <span>🌙</span> 다크
            </button>
            <button 
              className={`theme-btn ${theme === 'system' ? 'active' : ''}`} 
              onClick={() => handleThemeChange('system')}
              title="시스템 설정 동기화"
            >
              <span>🖥️</span> 시스템
            </button>
          </div>
        </div>

        <h1>YouTube to MP3 / MP4</h1>
        
        {/* URL 입력 필드 및 분석 버튼 */}
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
        
        {/* 에러 발생 시 빨간색 경고 문구 출력 */}
        {error && <p className="error-message">{error}</p>}
        
        {/* 다량 다운로드 시 편의를 위한 폴더 지정 컴포넌트 */}
        <DownloadFolderPicker 
          onSelect={handleChooseFolder} 
          selected={!!downloadDirHandle} 
        />
        
        {/* 데이터 페칭 완료 시 통합된 VideoListView 렌더링 */}
        {listData && (
          <VideoListView 
            title={listData.title}
            count={listData.count}
            videos={listData.videos}
            listType={listData.type}
            downloadDirHandle={downloadDirHandle}
          />
        )}
      </div>
    </div>
  );
}
