import { NextResponse } from 'next/server';
import ytdl, { ffmpegBinary } from '../../../../lib/ytdl';
import fs from 'fs';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import {
  cleanupOldTempFiles,
  createUniqueTempPath,
  prepareCachedInfoJsonFile,
  removeTempFileArtifacts,
  createStreamingFileResponse,
  classifyDownloadError,
} from '../../../../lib/cleanup';
import { validateYouTubeUrl } from '../../../../lib/youtubeHelpers';

const tracer = trace.getTracer('youtube-downloader-download-mp4-api');
const meter = metrics.getMeter('youtube-downloader-download-mp4-api');

const downloadCounter = meter.createCounter('download_requests_total', {
  description: 'Total number of download requests',
});
const downloadDuration = meter.createHistogram('download_duration_seconds', {
  description: 'Download duration in seconds',
});

/**
 * MP4 다운로드 공통 처리 핸들러 (GET / POST 공용)
 * - /api/info 캐시(rawInfoJsonCache) 적중 시 --load-info-json으로 YouTube 재추출(2.5~3.5초) 생략
 * - Docker tmpfs(/app/tmp) 메모리 디스크 위에서 8-스레드 병렬 조각 수신 및 초고속 무손실 Muxing(+faststart)
 * - 클라이언트 연결 취소(request.signal) 시 실행 중인 yt-dlp/ffmpeg 즉시 회수
 */
async function handleMp4Download(request, rawUrl, rawQuality, method) {
  const startTime = process.hrtime();
  let tempPath;
  let infoJsonPath;
  const spanName = `api-download-mp4-${method.toLowerCase()}`;

  return tracer.startActiveSpan(spanName, async (span) => {
    try {
      cleanupOldTempFiles().catch((err) =>
        console.error('Failed to cleanup old temp files:', err)
      );

      downloadCounter.add(1, { format: 'mp4', method });

      const urlValidation = validateYouTubeUrl(rawUrl);
      if (!urlValidation.valid) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: urlValidation.error });
        return NextResponse.json({ error: urlValidation.error }, { status: 400 });
      }
      const url = urlValidation.url;

      const parsedQuality = parseInt(String(rawQuality || '720'), 10);
      const supportedQualities = [720, 1080];
      const targetQuality = supportedQualities.includes(parsedQuality) ? parsedQuality : 720;

      span.setAttribute('download.format', 'mp4');
      span.setAttribute('download.quality', targetQuality);
      span.setAttribute('download.url', url);

      // MP4 호환 스트림(avc1+m4a) 우선 매칭으로 재인코딩 없이 초고속 컨테이너 병합(Muxing)
      const format = `bestvideo[ext=mp4][height<=${targetQuality}]+bestaudio[ext=m4a]/bestvideo[height<=${targetQuality}]+bestaudio/best[height<=${targetQuality}]`;

      tempPath = createUniqueTempPath('mp4');
      infoJsonPath = await prepareCachedInfoJsonFile(url);

      const ytdlFlags = {
        format,
        output: tempPath,
        noWarnings: true,
        noPlaylist: true,
        noPart: true,
        concurrentFragments: 8,
        mergeOutputFormat: 'mp4',
        postprocessorArgs: 'ffmpeg:-threads 0 -movflags +faststart',
      };
      if (ffmpegBinary) {
        ytdlFlags.ffmpegLocation = ffmpegBinary;
      }

      try {
        await ytdl(url, ytdlFlags, {
          pool: 'download',
          signal: request.signal,
          infoJsonPath: infoJsonPath || undefined,
        });
      } finally {
        if (infoJsonPath) {
          await removeTempFileArtifacts(infoJsonPath);
          infoJsonPath = null;
        }
      }

      if (!fs.existsSync(/*turbopackIgnore: true*/ tempPath)) {
        throw new Error('File was not created');
      }

      const { response, size } = await createStreamingFileResponse(tempPath, {
        contentType: 'video/mp4',
        filename: `download_${targetQuality}p.mp4`,
        signal: request.signal,
      });

      span.setAttribute('download.file_size', size);
      span.setStatus({ code: SpanStatusCode.OK });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp4', method, status: 'success' });

      return response;
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('MP4 download error:', error);
      }
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp4', method, status: 'failed' });

      await Promise.allSettled([
        removeTempFileArtifacts(tempPath),
        removeTempFileArtifacts(infoJsonPath),
      ]);

      const { errorMessage, statusCode } = classifyDownloadError(
        error,
        'Failed to download MP4'
      );
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    } finally {
      span.end();
    }
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  return handleMp4Download(
    request,
    searchParams.get('url'),
    searchParams.get('quality'),
    'GET'
  );
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  return handleMp4Download(request, body.url, body.quality, 'POST');
}
