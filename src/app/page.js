"use client";

import { useState, useEffect } from 'react';
import PlaylistView from '../components/PlaylistView';
import ShortsView from '../components/ShortsView';
import ChannelVideosView from '../components/ChannelVideosView';
import DownloadFolderPicker from '../components/DownloadFolderPicker';
import { chooseDownloadDirectory, saveFile } from '../lib/fileDownload';

/**
 * URL이 YouTube 플레이리스트인지 확인
 * URL에 'list=' 파라미터가 포함되어 있으면 플레이리스트로 간주
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
    // /videos 로 끝나거나 /videos/ 로 시작하는 경로 확인
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
        
        // URL.toString()은 pathname을 퍼센트 인코딩하므로, 다시 decodeURIComponent로 한글을 복원하여 반환
        const result = decodeURIComponent(parsed.toString());
        if (!/^https?:\/\//i.test(decoded)) {
          return result.replace(/^https?:\/\//i, '');
        }
        return result;
      }
    }
  } catch {
    // URL 파싱 실패 시 정규식 대체 패턴 매칭 (한글 및 퍼센트 인코딩 글자 대응을 위해 [^/?#]+ 사용)
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
 * 메인 페이지 컴포넌트
 * - YouTube URL 입력 → 영상 정보 조회 → 포맷 선택 → 다운로드
 * - 플레이리스트 URL이면 → 영상 목록 표시 → 개별 다운로드
 * - MP3(오디오), MP4 720p, MP4 1080p 세 가지 다운로드 지원
 */
export default function Home() {
  // ─── 상태(state) 관리 ──────────────────────────────────────────
  const [url, setUrl] = useState('');                    // 사용자가 입력한 YouTube URL
  const [theme, setTheme] = useState('system');           // 테마 모드 ('light' | 'dark' | 'system')

  // ─── 테마 제어 및 초기화 로직 ──────────────────────────────────────
  useEffect(() => {
    // 1. 로컬 스토리지에서 저장된 테마 불러오기
    const savedTheme = localStorage.getItem('theme') || 'system';
    setTheme(savedTheme);
    applyTheme(savedTheme);

    // 2. 시스템 테마 변경 감지 리스너
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
  const [loadingInfo, setLoadingInfo] = useState(false);  // 정보 조회 중 여부
  const [error, setError] = useState('');                 // 에러 메시지
  const [playlistData, setPlaylistData] = useState(null);  // 플레이리스트 정보
  const [shortsData, setShortsData] = useState(null);      // 쇼트 정보
  const [channelData, setChannelData] = useState(null);    // 채널 영상 목록 정보
  const [downloadDirHandle, setDownloadDirHandle] = useState(null); // 자동 저장 폴더 핸들

  // ─── 다운로드 폴더 선택 (File System Access API) ──────────────────
  const handleChooseFolder = async () => {
    const handle = await chooseDownloadDirectory();
    if (handle) setDownloadDirHandle(handle);
  };

  // ─── 분석 버튼 클릭: URL 타입에 따라 단일 영상 / 플레이리스트 분기 ──
  const fetchInfo = async () => {
    let targetUrl = url.trim();
    if (!targetUrl) {
      setError('Please enter a YouTube URL');
      return;
    }

    // 투바이트(한글 등) 퍼센트 인코딩 깨짐 및 처리 오류 방지를 위해 디코딩 우선 적용
    try {
      targetUrl = decodeURIComponent(targetUrl);
    } catch (_) {}

    // 채널 핸들 URL 자동 포맷팅 (@name -> @name/videos)
    const formattedUrl = formatChannelUrl(targetUrl);
    targetUrl = formattedUrl;
    setUrl(formattedUrl); // 입력창 텍스트 업데이트 (디코딩된 한국어 주소로 노출)

    setError('');
    setLoadingInfo(true);
    setPlaylistData(null);
    setShortsData(null);
    setChannelData(null);

    // 쇼트 페이지 URL이면 쇼트 API 호출
    if (isShortsUrl(targetUrl)) {
      try {
        const res = await fetch(`/api/shorts?url=${encodeURIComponent(targetUrl)}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to fetch shorts');

        setShortsData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingInfo(false);
      }
      return;
    }

    // 채널 /videos 페이지 URL이면 채널 영상 API 호출
    if (isChannelVideosUrl(targetUrl)) {
      try {
        const res = await fetch(`/api/channel-videos?url=${encodeURIComponent(targetUrl)}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to fetch channel videos');

        setChannelData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingInfo(false);
      }
      return;
    }

    // 플레이리스트 URL이면 플레이리스트 API 호출
    if (isPlaylistUrl(targetUrl)) {
      try {
        const res = await fetch(`/api/playlist?url=${encodeURIComponent(targetUrl)}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to fetch playlist info');

        setPlaylistData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingInfo(false);
      }
      return;
    }

    // ─── 단일 영상: 기존 info API 호출 ──────────────────────────
    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(targetUrl)}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to fetch video info');

      // 단일 영상을 플레이리스트 구조로 통일하여 PlaylistView를 통해 렌더링
      setPlaylistData({
        playlist_title: "단일 영상 분석 결과 (Single Video)",
        video_count: 1,
        videos: [
          {
            id: data.id || data.url || targetUrl,
            title: data.title,
            url: data.url || targetUrl,
            thumbnail: data.thumbnail,
            duration: data.duration,
            accessible: true // 단일 영상 정보 로드 성공 시 접근 가능한 것으로 간주
          }
        ]
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInfo(false);
    }
  };

  // ─── UI 렌더링 ─────────────────────────────────────────────────
  return (
    <div className={`container ${playlistData || shortsData || channelData ? 'container-wide' : ''}`}>
      <div className="glass-panel">
        {/* 테마 스위처 (Segmented Control) */}
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
        
        {/* URL 입력 + 분석 버튼 */}
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
        
        {error && <p className="error-message">{error}</p>}
        
        {/* 다운로드 폴더 선택 버튼 */}
        <DownloadFolderPicker 
          onSelect={handleChooseFolder} 
          selected={!!downloadDirHandle} 
        />
        
        {/* 플레이리스트 모드 (단일 영상 포함): 영상 목록 + 개별 다운로드 버튼 */}
        {playlistData && (
          <PlaylistView playlistData={playlistData} downloadDirHandle={downloadDirHandle} />
        )}
        
        {/* 쇼트 모드: 쇼트 목록 + 개별 다운로드 버튼 */}
        {shortsData && (
          <ShortsView shortsData={shortsData} downloadDirHandle={downloadDirHandle} />
        )}
        
        {/* 채널 영상 목록 모드: 영상 목록 + 개별 다운로드 버튼 */}
        {channelData && (
          <ChannelVideosView channelData={channelData} downloadDirHandle={downloadDirHandle} />
        )}
      </div>
    </div>
  );
}
