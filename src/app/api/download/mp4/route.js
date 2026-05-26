import { NextResponse } from 'next/server';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);

/**
 * GET /api/download/mp4?url=VIDEO_URL
 * Returns a merged MP4 file (video + audio) at best quality up to 720p.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
    
    // Define format selector: best video <=720p plus best audio, fallback to best overall <=720p
    const format = 'bestvideo[height<=720]+bestaudio/best[height<=720]';
    const tempPath = path.join(process.cwd(), 'tmp', `${Date.now()}.mp4`);
    
    await youtubedl(url, {
      format,
      output: tempPath,
      noCheckCertificate: true,
      noWarnings: true,
      noPlaylist: true,
      mergeOutputFormat: 'mp4',
      ffmpegLocation: ffmpegPath,
    });

    const stat = await fs.promises.stat(tempPath);
    const fileStream = fs.createReadStream(tempPath);
    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    headers.set('Content-Disposition', `attachment; filename="${path.basename(tempPath)}"`);
    headers.set('Content-Length', stat.size.toString());

    // Stream file to client
    return new NextResponse(fileStream, { headers });
  } catch (error) {
    console.error('MP4 download error:', error);
    return NextResponse.json({ error: 'Failed to download MP4' }, { status: 500 });
  }
}
