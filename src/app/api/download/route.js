import { NextResponse } from 'next/server';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';

export async function POST(request) {
  try {
    const { url, format_id } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const tempDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
    const tempPath = path.join(tempDir, `${Date.now()}.${format_id}.mp3`);
    
    await youtubedl(url, {
      format: format_id,
      output: tempPath,
      noCheckCertificate: true,
      noWarnings: true,
      noPlaylist: true,
      extractAudio: true,
      audioFormat: 'mp3',
      ffmpegLocation: ffmpegPath,
    });

    if (!fs.existsSync(tempPath)) {
      throw new Error('File was not created');
    }

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
    
    await youtubedl(url, {
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
