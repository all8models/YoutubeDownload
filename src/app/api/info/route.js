import { NextResponse } from 'next/server';
import youtubedl from 'youtube-dl-exec';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      callHome: false,
      noCheckCertificate: true,
      youtubeSkipDashManifest: true,
      noPlaylist: true,
    });

    // Audio formats (mp3)
    const audioFormats = info.formats
      .filter((f) => f.vcodec === 'none' && f.acodec !== 'none')
      .map((f) => ({
        quality: `${Math.round(f.abr || 0)}kbps`,
        type: 'audio',
        format_id: f.format_id,
        ext: f.ext,
        abr: f.abr,
      }));

    // Video formats (MP4 up to 720p)
    const videoFormats = info.formats
      .filter((f) => f.vcodec !== 'none' && f.ext === 'mp4' && (f.height || 0) <= 720)
      .map((f) => ({
        quality: `${f.height}p`,
        type: 'video',
        format_id: f.format_id,
        ext: f.ext,
        height: f.height,
      }));

    // Merge and sort (audio first)
    const allFormats = [
      ...audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0)),
      ...videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0)),
    ];

    return NextResponse.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      formats: allFormats,
    });
  } catch (error) {
    console.error('youtube-dl error:', error);
    return NextResponse.json({ error: 'Failed to fetch video info' }, { status: 500 });
  }
}
