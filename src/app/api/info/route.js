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
    });

    // Extract audio formats (no video)
    const formats = info.formats
      .filter((f) => f.vcodec === 'none' && f.acodec !== 'none')
      .map((f) => ({
        quality: `${Math.round(f.abr || 0)}kbps`,
        type: 'audio',
        format_id: f.format_id,
        ext: f.ext,
        abr: f.abr
      }));

    // Sort by best audio bitrate
    const audioFormats = formats.sort((a, b) => (b.abr || 0) - (a.abr || 0));

    // Deduplicate similar bitrates to keep it clean
    const uniqueFormats = [];
    const seenBitrates = new Set();
    for (const f of audioFormats) {
      if (f.abr && !seenBitrates.has(f.abr)) {
        seenBitrates.add(f.abr);
        uniqueFormats.push(f);
      }
    }

    return NextResponse.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      formats: uniqueFormats.length > 0 ? uniqueFormats : audioFormats,
    });
  } catch (error) {
    console.error('youtube-dl error:', error);
    return NextResponse.json({ error: 'Failed to fetch video info' }, { status: 500 });
  }
}
