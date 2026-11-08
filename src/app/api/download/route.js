import { NextResponse } from 'next/server';
import ytdl, { ffmpegBinary } from '../../../lib/ytdl';
import fs from 'fs';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import {
  cleanupOldTempFiles,
  createUniqueTempPath,
  removeTempFileArtifacts,
  createStreamingFileResponse,
  classifyDownloadError,
} from '../../../lib/cleanup';
import { validateYouTubeUrl, validateFormatId } from '../../../lib/youtubeHelpers';

const tracer = trace.getTracer('youtube-downloader-download-api');
const meter = metrics.getMeter('youtube-downloader-download-api');

const downloadCounter = meter.createCounter('download_requests_total', {
  description: 'Total number of download requests',
});
const downloadDuration = meter.createHistogram('download_duration_seconds', {
  description: 'Download duration in seconds',
});

/**
 * MP3 다운로드 공통 처리 핸들러 (GET / POST 공용)
 */
async function handleMp3Download(request, rawUrl, rawFormatId, method) {
  const startTime = process.hrtime();
  let tempPath;
  const spanName = `api-download-mp3-${method.toLowerCase()}`;

  return tracer.startActiveSpan(spanName, async (span) => {
    try {
      // 오래된 임시 파일 비동기 정리 실행 (10분 쓰로틀링)
      cleanupOldTempFiles().catch((err) =>
        console.error('Failed to cleanup old temp files:', err)
      );

      downloadCounter.add(1, { format: 'mp3', method });

      const urlValidation = validateYouTubeUrl(rawUrl);
      if (!urlValidation.valid) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: urlValidation.error });
        return NextResponse.json({ error: urlValidation.error }, { status: 400 });
      }

      const formatValidation = validateFormatId(rawFormatId, 'bestaudio');
      if (!formatValidation.valid) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: formatValidation.error });
        return NextResponse.json({ error: formatValidation.error }, { status: 400 });
      }

      const url = urlValidation.url;
      const formatId = formatValidation.formatId;

      span.setAttribute('download.format', 'mp3');
      span.setAttribute('download.format_id', formatId);
      span.setAttribute('download.url', url);

      // UUID 기반 고유 임시 파일 경로 생성 (동시 다운로드 충돌 및 Path Traversal 원천 차단)
      tempPath = createUniqueTempPath('mp3');

      const ytdlFlags = {
        format: formatId,
        output: tempPath,
        noWarnings: true,
        noPlaylist: true,
        extractAudio: true,
        audioFormat: 'mp3',
      };
      if (ffmpegBinary) {
        ytdlFlags.ffmpegLocation = ffmpegBinary;
      }

      // yt-dlp로 오디오 추출 및 MP3 변환
      await ytdl(url, ytdlFlags);

      if (!fs.existsSync(tempPath)) {
        throw new Error('File was not created');
      }

      const { response, size } = await createStreamingFileResponse(tempPath, {
        contentType: 'audio/mpeg',
        filename: 'download.mp3',
        signal: request.signal,
      });

      span.setAttribute('download.file_size', size);
      span.setStatus({ code: SpanStatusCode.OK });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp3', method, status: 'success' });

      return response;
    } catch (error) {
      console.error('Download error:', error);
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp3', method, status: 'failed' });

      // 실패 시 임시 파일(존재한다면) 클린업 시도
      await removeTempFileArtifacts(tempPath);

      const { errorMessage, statusCode } = classifyDownloadError(
        error,
        'Failed to download'
      );
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    } finally {
      span.end();
    }
  });
}

/**
 * POST /api/download
 * MP3 오디오 다운로드 (JSON body: { url, format_id })
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  return handleMp3Download(request, body.url, body.format_id, 'POST');
}

/**
 * GET /api/download?url=...&format_id=...
 * POST와 동일한 기능을 GET 방식으로 제공
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  return handleMp3Download(
    request,
    searchParams.get('url'),
    searchParams.get('format_id'),
    'GET'
  );
}


