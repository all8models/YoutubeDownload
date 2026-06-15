import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';
import fs from 'fs';
import path from 'path';

/**
 * POST /api/download
 * MP3 오디오 다운로드 (JSON body: { url, format_id })
 * 
 * POST 대신 GET 방식으로도 호출 가능:
 *   GET /api/download?url=...&format_id=...
 */
export async function POST(request) {
  try {
    const { url, format_id } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // 임시 저장 디렉토리 확인/생성
    const tempDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
    const tempPath = path.join(tempDir, `${Date.now()}.${format_id}.mp3`);
    
    // yt-dlp로 오디오 추출 및 MP3 변환
    await ytdl(url, {
      format: format_id,               // 클라이언트가 선택한 포맷 ID
      output: tempPath,                // 다운로드 경로
      noCheckCertificate: true,
      noWarnings: true,
      noPlaylist: true,
      extractAudio: true,              // 오디오만 추출
      audioFormat: 'mp3',              // MP3 형식으로 변환
      ffmpegLocation: ffmpegPath,      // ffmpeg 경로 (스트림 병합/변환용)
    });

    if (!fs.existsSync(tempPath)) {
      throw new Error('File was not created');
    }

    // 생성된 파일을 스트리밍 응답으로 전송
    const stat = await fs.promises.stat(tempPath);
    const fileStream = fs.createReadStream(tempPath);
    
    const headers = new Headers();
    headers.set('Content-Type', 'audio/mpeg');
    headers.set('Content-Disposition', `attachment; filename="download.mp3"`);
    headers.set('Content-Length', stat.size.toString());

    return new NextResponse(fileStream, { headers });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Failed to download' }, { status: 500 });
  }
}

/**
 * GET /api/download?url=...&format_id=...
 * POST와 동일한 기능을 GET 방식으로 제공
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const format_id = searchParams.get('format_id');

  if (!url || !format_id) {
    return NextResponse.json({ error: 'URL and format_id are required' }, { status: 400 });
  }

  try {
    const tempDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
    const tempPath = path.join(tempDir, `${Date.now()}.${format_id}.mp3`);
    
    await ytdl(url, {
      format: format_id,
      output: tempPath,
      noCheckCertificate: true,
      noWarnings: true,
      noPlaylist: true,
      extractAudio: true,
      audioFormat: 'mp3',
      ffmpegLocation: ffmpegPath,
    });

    const stat = await fs.promises.stat(tempPath);
    const fileStream = fs.createReadStream(tempPath);
    
    const headers = new Headers();
    headers.set('Content-Type', 'audio/mpeg');
    headers.set('Content-Disposition', `attachment; filename="download.mp3"`);
    headers.set('Content-Length', stat.size.toString());

    return new NextResponse(fileStream, { headers });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Failed to download' }, { status: 500 });
  }
}
