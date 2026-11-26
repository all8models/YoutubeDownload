import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { args as buildYtdlArgs } from 'youtube-dl-exec';
import fs from 'fs';
import ytdl, {
  ytdlBinary,
  ffmpegBinary,
  acquireDownloadSlot,
  getYtdlCacheDir,
} from '../../../lib/ytdl';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import {
  cleanupOldTempFiles,
  createUniqueTempPath,
  prepareCachedInfoJsonFile,
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

const MAX_STDERR_BYTES = 16 * 1024;

function appendCappedStderr(chunks, totalRef, chunk) {
  if (totalRef.bytes >= MAX_STDERR_BYTES) return;
  chunks.push(chunk);
  totalRef.bytes += chunk.length;
}

/**
 * 무디스크(Zero-Disk) 실시간 파이프 스트리밍:
 * yt-dlp (stdout) ──▶ ffmpeg (libmp3lame 멀티스레드 인코딩, stdout) ──▶ HTTP ReadableStream
 *
 * - 첫 번째 MP3 오디오 청크가 생성되는 즉시(~1~1.5초) HTTP 200 응답을 시작하여 TTFB를 극적으로 단축
 * - 만약 첫 청크 생성 전에 403/비공개/저작권 차단 에러가 발생하면 JSON 에러 응답을 그대로 유지
 */
function openZeroDiskMp3Stream({ url, formatId, infoJsonPath, signal, onFinalize }) {
  return new Promise((resolve, reject) => {
    const cacheDir = getYtdlCacheDir();
    const resolvedFormat = formatId === 'bestaudio' ? 'bestaudio/best' : formatId;

    const flags = {
      format: resolvedFormat,
      noWarnings: true,
      noPlaylist: true,
      noPart: true,
      retries: 5,
      fragmentRetries: 5,
      output: '-',
      ...(cacheDir ? { cacheDir } : {}),
      ...(ffmpegBinary ? { ffmpegLocation: ffmpegBinary } : {}),
    };

    if (process.env.YTDL_NO_CHECK_CERTIFICATE === 'true') {
      flags.noCheckCertificate = true;
    }

    const ytArgs = infoJsonPath
      ? ['--load-info-json', infoJsonPath, ...buildYtdlArgs(flags)]
      : [url, ...buildYtdlArgs(flags)];

    const ffArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-threads',
      '0',
      '-i',
      'pipe:0',
      '-vn',
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '2',
      '-f',
      'mp3',
      'pipe:1',
    ];

    const ytProc = spawn(ytdlBinary, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const ffProc = spawn(ffmpegBinary, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

    const ytStderr = [];
    const ytStderrLen = { bytes: 0 };
    const ffStderr = [];
    const ffStderrLen = { bytes: 0 };

    ytProc.stderr.on('data', (c) => appendCappedStderr(ytStderr, ytStderrLen, c));
    ffProc.stderr.on('data', (c) => appendCappedStderr(ffStderr, ffStderrLen, c));

    ffProc.stdin.on('error', () => { });
    ytProc.stdout.on('error', () => { });
    ytProc.stdout.pipe(ffProc.stdin);

    let ytExitCode = null;
    let firstChunkReceived = false;
    let finalized = false;
    let totalBytes = 0;

    const terminateChildren = () => {
      if (ytProc.exitCode === null && !ytProc.killed) {
        try {
          ytProc.kill('SIGTERM');
        } catch { }
      }
      if (ffProc.exitCode === null && !ffProc.killed) {
        try {
          ffProc.kill('SIGTERM');
        } catch { }
      }
    };

    const finalizeOnce = (status, err) => {
      if (finalized) return;
      finalized = true;
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
      terminateChildren();
      onFinalize?.({ status, totalBytes, error: err });
    };

    const handleAbort = () => {
      terminateChildren();
      if (!firstChunkReceived) {
        const abortErr = new Error('Request aborted');
        abortErr.name = 'AbortError';
        finalizeOnce('aborted', abortErr);
        reject(abortErr);
      } else {
        finalizeOnce('aborted');
      }
    };

    if (signal) {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    ytProc.on('close', (code) => {
      ytExitCode = code;
      if (code !== 0 && !ffProc.stdin.destroyed) {
        try {
          ffProc.stdin.end();
        } catch { }
      }
    });

    const bufferedChunks = [];
    let streamEnded = false;
    let streamError = null;
    let pendingPullResolve = null;

    const flushPull = () => {
      if (!pendingPullResolve) return;
      const notify = pendingPullResolve;
      pendingPullResolve = null;
      notify();
    };

    ffProc.stdout.on('data', (chunk) => {
      totalBytes += chunk.length;

      if (!firstChunkReceived) {
        firstChunkReceived = true;
        bufferedChunks.push(chunk);
        ffProc.stdout.pause();

        const webStream = new ReadableStream({
          async pull(controller) {
            while (bufferedChunks.length === 0 && !streamEnded && !streamError) {
              ffProc.stdout.resume();
              await new Promise((r) => {
                pendingPullResolve = r;
              });
            }

            if (bufferedChunks.length > 0) {
              const nextChunk = bufferedChunks.shift();
              controller.enqueue(
                new Uint8Array(nextChunk.buffer, nextChunk.byteOffset, nextChunk.byteLength)
              );
              if (bufferedChunks.length === 0 && !streamEnded && !streamError) {
                ffProc.stdout.resume();
              }
              return;
            }

            if (streamError) {
              finalizeOnce('failed', streamError);
              controller.error(streamError);
              return;
            }

            if (streamEnded) {
              finalizeOnce('success');
              controller.close();
            }
          },
          cancel() {
            finalizeOnce('aborted');
          },
        });

        resolve(webStream);
        return;
      }

      bufferedChunks.push(chunk);
      // 백프레셔 적용: 대기 버퍼가 4개 청크 이상 쌓이면 소비될 때까지 일시 정지
      if (bufferedChunks.length >= 4) {
        ffProc.stdout.pause();
      }
      flushPull();
    });

    const collectErrorText = () => {
      const ytMsg = Buffer.concat(ytStderr).toString('utf8').trim();
      const ffMsg = Buffer.concat(ffStderr).toString('utf8').trim();
      return [ytMsg, ffMsg].filter(Boolean).join('\n') || 'MP3 conversion pipeline failed';
    };

    ytProc.on('error', (err) => {
      if (!firstChunkReceived) {
        finalizeOnce('failed', err);
        reject(err);
      } else {
        streamError = err;
        flushPull();
      }
    });

    ffProc.on('error', (err) => {
      if (!firstChunkReceived) {
        finalizeOnce('failed', err);
        reject(err);
      } else {
        streamError = err;
        flushPull();
      }
    });

    ffProc.on('close', (ffCode) => {
      if (!firstChunkReceived) {
        const err = new Error(collectErrorText());
        finalizeOnce('failed', err);
        reject(err);
        return;
      }

      if ((ffCode !== 0 || (ytExitCode !== null && ytExitCode !== 0)) && !finalized) {
        streamError = new Error(collectErrorText());
      } else {
        streamEnded = true;
      }
      flushPull();
    });
  });
}

/**
 * MP3 다운로드 공통 처리 핸들러 (GET / POST 공용)
 */
async function handleMp3Download(request, rawUrl, rawFormatId, method) {
  const startTime = process.hrtime();
  const spanName = `api-download-mp3-${method.toLowerCase()}`;

  cleanupOldTempFiles().catch((err) =>
    console.error('Failed to cleanup old temp files:', err)
  );
  downloadCounter.add(1, { format: 'mp3', method });

  const urlValidation = validateYouTubeUrl(rawUrl);
  if (!urlValidation.valid) {
    return NextResponse.json({ error: urlValidation.error }, { status: 400 });
  }

  const formatValidation = validateFormatId(rawFormatId, 'bestaudio');
  if (!formatValidation.valid) {
    return NextResponse.json({ error: formatValidation.error }, { status: 400 });
  }

  const url = urlValidation.url;
  const formatId = formatValidation.formatId;

  // 1. 기본 경로: Zero-Disk 실시간 파이프 스트리밍 (ytdlBinary + ffmpegBinary 모두 존재할 때)
  if (ytdlBinary && ffmpegBinary) {
    const span = tracer.startSpan(spanName);
    span.setAttribute('download.format', 'mp3');
    span.setAttribute('download.format_id', formatId);
    span.setAttribute('download.url', url);
    span.setAttribute('download.mode', 'zero-disk-pipe');

    let releaseSlot = null;
    let infoJsonPath = null;
    let spanClosed = false;

    const closeSpanAndSlot = ({ status, totalBytes = 0, error } = {}) => {
      if (spanClosed) return;
      spanClosed = true;

      if (releaseSlot) {
        const rel = releaseSlot;
        releaseSlot = null;
        rel();
      }
      if (infoJsonPath) {
        const pathToRemove = infoJsonPath;
        infoJsonPath = null;
        removeTempFileArtifacts(pathToRemove).catch(() => { });
      }

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, {
        format: 'mp3',
        method,
        status: status || 'success',
      });

      if (totalBytes > 0) {
        span.setAttribute('download.file_size', totalBytes);
      }
      if (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
    };

    try {
      releaseSlot = await acquireDownloadSlot(request.signal);
      infoJsonPath = await prepareCachedInfoJsonFile(url);

      let webStream;
      if (infoJsonPath) {
        try {
          span.setAttribute('yt-dlp.reused_info_json', true);
          webStream = await openZeroDiskMp3Stream({
            url,
            formatId,
            infoJsonPath,
            signal: request.signal,
            onFinalize: closeSpanAndSlot,
          });
        } catch (cachedErr) {
          await removeTempFileArtifacts(infoJsonPath);
          infoJsonPath = null;
          if (cachedErr.name === 'AbortError' || request.signal?.aborted) {
            throw cachedErr;
          }
          // 캐싱된 스트림 URL 만료 시 실시간 추출로 자동 폴백 (closeSpanAndSlot 재초기화 방지 위해 새 파이프 오픈)
          span.setAttribute('yt-dlp.reused_info_json_fallback', true);
          webStream = await openZeroDiskMp3Stream({
            url,
            formatId,
            infoJsonPath: null,
            signal: request.signal,
            onFinalize: closeSpanAndSlot,
          });
        }
      } else {
        webStream = await openZeroDiskMp3Stream({
          url,
          formatId,
          infoJsonPath: null,
          signal: request.signal,
          onFinalize: closeSpanAndSlot,
        });
      }

      const headers = new Headers();
      headers.set('Content-Type', 'audio/mpeg');
      headers.set('Content-Disposition', 'attachment; filename="download.mp3"');
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Stream-Mode', 'zero-disk-pipe');

      return new NextResponse(webStream, { headers });
    } catch (error) {
      closeSpanAndSlot({ status: 'failed', error });
      if (error.name !== 'AbortError') {
        console.error('Download error:', error);
      }
      const { errorMessage, statusCode } = classifyDownloadError(
        error,
        'Failed to download'
      );
      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    }
  }

  // 2. 폴백 경로: 임시 파일 경유 다운로드 (ffmpeg 단독 스폰이 불가한 특수 환경용)
  let tempPath;
  return tracer.startActiveSpan(spanName, async (span) => {
    try {
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

      await ytdl(url, ytdlFlags, { pool: 'download', signal: request.signal });

      if (!fs.existsSync(/*turbopackIgnore: true*/ tempPath)) {
        throw new Error('File was not created');
      }

      const { response, size } = await createStreamingFileResponse(tempPath, {
        contentType: 'audio/mpeg',
        filename: 'download.mp3',
        signal: request.signal,
      });

      span.setAttribute('download.file_size', size);
      span.setStatus({ code: SpanStatusCode.OK });
      return response;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
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

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  return handleMp3Download(request, body.url, body.format_id, 'POST');
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  return handleMp3Download(
    request,
    searchParams.get('url'),
    searchParams.get('format_id'),
    'GET'
  );
}
