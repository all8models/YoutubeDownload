import { NextResponse } from 'next/server';
import youtubedl from 'youtube-dl-exec';

export async function POST(request) {
  try {
    const body = await request.json();
    const { url, format_id } = body;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const args = {
      extractAudio: true,
      audioFormat: 'mp3',
      format: format_id || 'bestaudio',
      noCheckCertificate: true,
      noWarnings: true,
      addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0'],
      o: '-' // Output to stdout
    };

    const ytDlpProcess = youtubedl.exec(url, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    
    // Convert Node stream to Web ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        ytDlpProcess.stdout.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        ytDlpProcess.stdout.on('end', () => {
          controller.close();
        });
        ytDlpProcess.stdout.on('error', (err) => {
          controller.error(err);
        });
      },
      cancel() {
        ytDlpProcess.kill();
      }
    });

    const headers = new Headers();
    headers.set('Content-Type', 'audio/mpeg');
    // Using a generic filename since yt-dlp stdout doesn't give us the parsed title easily in this stream
    headers.set('Content-Disposition', 'attachment; filename="download.mp3"');

    return new NextResponse(stream, { headers });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Failed to download' }, { status: 500 });
  }
}
