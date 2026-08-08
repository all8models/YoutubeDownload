import ytdl from './ytdl';

/**
 * 유튜브 멤버십 전용(Members-only) 영상들의 ID 목록을 수집하는 함수입니다.
 * 채널 ID가 'UC'로 시작할 경우, 'UUMO' 접두사로 변환하면 멤버십 전용 플레이리스트에 접근할 수 있습니다.
 * 이를 활용하여 멤버십 전용 영상인지 아닌지를 판별하기 위한 ID Set을 반환합니다.
 * 
 * @param {string} channelId - 유튜브 채널의 고유 ID (예: 'UC1234567890abcdef')
 * @returns {Promise<Set<string>>} - 멤버십 전용 영상들의 ID가 담긴 Set 객체
 */
export async function fetchMembersOnlyIds(channelId) {
  const membersOnlyIds = new Set();
  
  // 채널 ID가 UC로 시작하는 정상적인 ID인지 확인합니다.
  if (channelId && channelId.startsWith('UC')) {
    // 멤버십 전용 플레이리스트 ID는 'UC' 대신 'UUMO'를 사용합니다.
    const membersPlaylistId = 'UUMO' + channelId.substring(2);
    
    try {
      // yt-dlp를 사용하여 멤버십 플레이리스트의 메타데이터(최대 100개)를 빠르게 가져옵니다.
      const membersInfo = await ytdl(`https://www.youtube.com/playlist?list=${membersPlaylistId}`, {
        dumpSingleJson: true,
        flatPlaylist: true,
        playlistEnd: 100, // 최대 100개까지만 검사하여 API 요청 시간을 절약합니다.
        noWarnings: true,
        callHome: false,
        noCheckCertificate: true,
        youtubeSkipDashManifest: true,
      });
      
      // 가져온 영상 목록에서 ID만 추출하여 Set에 저장합니다.
      if (membersInfo && membersInfo.entries) {
        membersInfo.entries.forEach(entry => {
          if (entry && entry.id) {
            membersOnlyIds.add(entry.id);
          }
        });
      }
    } catch (err) {
      // 해당 채널이 멤버십을 운영하지 않거나 권한이 없는 경우 오류가 발생할 수 있습니다.
      // 이 경우 프로그램이 중단되지 않도록 조용히 넘깁니다.
      console.log('No membership playlist found or error:', err.message);
    }
  }
  
  return membersOnlyIds;
}

/**
 * 영상의 제목 및 상태 정보를 기반으로 다운로드가 불가능한(비공개, 삭제됨, 멤버십 전용 등) 영상인지 판별합니다.
 * 
 * @param {string} title - 영상의 제목
 * @param {string} [availability] - 영상의 접근 가능 여부 (예: 'subscriber_only', 'premium_only', 'private' 등)
 * @returns {boolean} - 접근 불가능한(제한된) 영상이면 true, 그렇지 않으면 false
 */
export function isRestrictedTitle(title, availability) {
  // 1. yt-dlp에서 제공하는 availability 플래그를 통한 1차 검사
  if (availability && ['subscriber_only', 'premium_only', 'needs_auth', 'private'].includes(availability)) {
    return true;
  }
  
  // 제목이 존재하지 않으면 접근 불가능한 영상으로 간주합니다.
  if (!title) return true;
  
  // 2. 제목의 키워드를 기반으로 한 2차 휴리스틱(Heuristic) 검사
  const lower = title.toLowerCase();
  return (
    lower.includes('members-only') ||
    lower.includes('private video') ||
    lower.includes('deleted video') ||
    title.includes('멤버 전용') ||
    title.includes('비공개') ||
    title.includes('삭제된')
  );
}

/**
 * yt-dlp에서 반환된 원본 영상 항목(entry)들을 프론트엔드에서 사용하기 좋은 형태로 정제(Mapping)합니다.
 * 
 * @param {Array} entries - yt-dlp의 추출 결과 중 영상 목록 배열
 * @param {Set<string>} membersOnlyIds - 멤버십 전용 영상들의 ID Set
 * @returns {Array} - 썸네일, URL, 접근 여부(accessible) 등 필수 데이터만 담긴 정제된 배열
 */
export function mapVideoEntries(entries, membersOnlyIds) {
  if (!entries || !Array.isArray(entries)) return [];
  
  return entries
    .filter(Boolean) // null이나 undefined인 잘못된 항목을 제거합니다.
    .map((entry) => {
      // 현재 영상이 멤버십 전용 영상 ID 목록에 포함되어 있는지 확인합니다.
      const isMembersOnly = membersOnlyIds.has(entry.id);
      
      // 멤버십 전용도 아니고, 제목/권한상 제한된 영상도 아니어야 다운로드 접근이 가능합니다.
      const accessible = !isMembersOnly && !isRestrictedTitle(entry.title, entry.availability);
      
      return {
        id: entry.id,
        // 접근 불가능한 영상은 기본 제목을 제공하여 레이아웃 깨짐을 방지합니다.
        title: entry.title || (accessible ? 'Untitled Video' : '멤버십 전용 또는 비공개 동영상'),
        url: entry.url || `https://youtube.com/watch?v=${entry.id}`,
        // YouTube 기본 중간 해상도(mqdefault) 썸네일을 사용합니다.
        thumbnail: `https://img.youtube.com/vi/${entry.id}/mqdefault.jpg`,
        duration: entry.duration,
        accessible, // 이 값이 false면 프론트엔드에서 다운로드 버튼이 비활성화됩니다.
      };
    });
}
