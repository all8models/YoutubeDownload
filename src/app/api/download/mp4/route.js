import { NextResponse } from 'next/server';
import ytdl, { ffmpegBinary } from '../../../../lib/ytdl';
import fs from 'fs';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import {
  cleanupOldTempFiles,
  createUniqueTempPath,
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
 */
async function handleMp4Download(request, rawUrl, rawQuality, method) {
  const startTime = process.hrtime();
  let tempPath;
  const spanName = `api-download-mp4-${method.toLowerCase()}`;

  return tracer.startActiveSpan(spanName, async (span) => {
    try {
      // 오래된 임시 파일 비동기 정리 실행 (10분 쓰로틀링)
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
      // 지원하는 화질만 허용, 그 외는 720p로 기본 설정
      const supportedQualities = [720, 1080];
      const targetQuality = supportedQualities.includes(parsedQuality) ? parsedQuality : 720;

      span.setAttribute('download.format', 'mp4');
      span.setAttribute('download.quality', targetQuality);
      span.setAttribute('download.url', url);

      // yt-dlp format 지정: MP4 호환 스트림(avc1+m4a)을 우선 매칭하여 ffmpeg 재인코딩 없이 초고속 Muxing
      const format = `bestvideo[ext=mp4][height<=${targetQuality}]+bestaudio[ext=m4a]/bestvideo[height<=${targetQuality}]+bestaudio/best[height<=${targetQuality}]`;

      // UUID 기반 고유 임시 파일 경로 생성 (동시 다운로드 충돌 원천 차단)
      tempPath = createUniqueTempPath('mp4');

      const ytdlFlags = {
        format,
        output: tempPath,
        noWarnings: true,
        noPlaylist: true,
        mergeOutputFormat: 'mp4', // 결과물을 MP4로 병합
      };
      if (ffmpegBinary) {
        ytdlFlags.ffmpegLocation = ffmpegBinary;
      }

      await ytdl(url, ytdlFlags);

      if (!fs.existsSync(tempPath)) {
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
      console.error('MP4 download error:', error);
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp4', method, status: 'failed' });

      // 실패 시 임시 파일(존재한다면) 클린업 시도
      await removeTempFileArtifacts(tempPath);

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
  return handleMp4Download(
    request,
    searchParams.get('url'),
    searchParams.get('quality'),
    'GET'
  );
}

/**
 * POST /api/download/mp4
 * JSON body: { url, quality }
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  return handleMp4Download(request, body.url, body.quality, 'POST');
}


