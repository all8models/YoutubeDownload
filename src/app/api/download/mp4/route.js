import { NextResponse } from 'next/server';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);

/**
 * GET /api/download/mp4?url=VIDEO_URL&quality=720
 * 
 * YouTube 영상을 MP4 포맷으로 다운로드합니다.
 * yt-dlp가 영상 스트림 + 오디오 스트림을 자동으로 병합(muxing)하여
 * 하나의 MP4 파일로 제공합니다.
 * 
 * quality 파라미터: 720 (기본값) 또는 1080
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const quality = parseInt(searchParams.get('quality') || '720', 10);

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  // 지원하는 화질만 허용, 그 외는 720p로 기본 설정
  const supportedQualities = [720, 1080];
  const targetQuality = supportedQualities.includes(quality) ? quality : 720;

  try {
    const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
    
    // yt-dlp format 지정: 지정된 해상도 이하의 최고 영상 + 최고 음성 병합
    // 예: targetQuality=720 → bestvideo[height<=720]+bestaudio/best[height<=720]
    const format = `bestvideo[height<=${targetQuality}]+bestaudio/best[height<=${targetQuality}]`;
    const tempPath = path.join(process.cwd(), 'tmp', `${Date.now()}.mp4`);
    
    await youtubedl(url, {
      format,
      output: tempPath,
      noCheckCertificate: true,
      noWarnings: true,
      noPlaylist: true,
      mergeOutputFormat: 'mp4',          // 결과물을 MP4로 병합
      ffmpegLocation: ffmpegPath,        // ffmpeg 경로 (스트림 병합용)
    });

    // 생성된 MP4 파일을 스트리밍 응답으로 전송
    const stat = await fs.promises.stat(tempPath);
    const fileStream = fs.createReadStream(tempPath);
    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    headers.set('Content-Disposition', `attachment; filename="${path.basename(tempPath)}"`);
    headers.set('Content-Length', stat.size.toString());

    return new NextResponse(fileStream, { headers });
  } catch (error) {
    console.error('MP4 download error:', error);
    return NextResponse.json({ error: 'Failed to download MP4' }, { status: 500 });
  }
}
