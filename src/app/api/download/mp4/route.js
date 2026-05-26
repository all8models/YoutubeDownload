import { NextResponse } from 'next/server';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipe = promisify(pipeline);

/**
 * GET /api/download/mp4?url=VIDEO_URL&quality=720
 * Returns a merged MP4 file (video + audio) at the specified quality (720 or 1080).
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const quality = parseInt(searchParams.get('quality') || '720', 10);
  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  const supportedQualities = [720, 1080];
  const targetQuality = supportedQualities.includes(quality) ? quality : 720;

  try {
    const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
    
    // Define format selector based on quality
    const format = `bestvideo[height<=${targetQuality}]+bestaudio/best[height<=${targetQuality}]`;
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
