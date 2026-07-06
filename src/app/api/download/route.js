import { NextResponse } from 'next/server';
import ytdl from '../../../lib/ytdl';
import fs from 'fs';
import path from 'path';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { cleanupOldTempFiles } from '../../../lib/cleanup';

const tracer = trace.getTracer('youtube-downloader-download-api');
const meter = metrics.getMeter('youtube-downloader-download-api');

const downloadCounter = meter.createCounter('download_requests_total', {
  description: 'Total number of download requests',
});
const downloadDuration = meter.createHistogram('download_duration_seconds', {
  description: 'Download duration in seconds',
});

/**
 * POST /api/download
 * MP3 오디오 다운로드 (JSON body: { url, format_id })
 */
export async function POST(request) {
  const startTime = process.hrtime();
  let tempPath;
  return tracer.startActiveSpan('api-download-mp3-post', async (span) => {
    let url, format_id;
    try {
      // 오래된 임시 파일 비동기 정리 실행 (비동기 병렬 실행)
      cleanupOldTempFiles().catch(err => console.error('Failed to cleanup old temp files:', err));

      const body = await request.json();
      url = body.url;
      format_id = body.format_id;

      span.setAttribute('download.format', 'mp3');
      span.setAttribute('download.format_id', format_id || '');
      span.setAttribute('download.url', url || '');
      downloadCounter.add(1, { format: 'mp3', method: 'POST' });

      if (!url) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'URL is required' });
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
      }

      // 임시 저장 디렉토리 확인/생성
      const tempDir = path.join(process.cwd(), 'tmp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
      tempPath = path.join(tempDir, `${Date.now()}.${format_id}.mp3`);
      
      // yt-dlp로 오디오 추출 및 MP3 변환
      await ytdl(url, {
        format: format_id,               // 클라이언트가 선택한 포맷 ID
        output: tempPath,                // 다운로드 경로
        noCheckCertificate: true,
        noWarnings: true,
        noPlaylist: true,
        extractAudio: true,              // 오디오만 추출
        audioFormat: 'mp3',              // MP3 형식으로 변환
        ffmpegLocation: ffmpegPath,      // ffmpeg 경로 (스트림 병합/변환용)
      });

      if (!fs.existsSync(tempPath)) {
        throw new Error('File was not created');
      }

      // 생성된 파일을 스트리밍 응답으로 전송
      const stat = await fs.promises.stat(tempPath);
      const fileStream = fs.createReadStream(tempPath);
      
      // 스트림이 끝나거나 에러 등으로 닫히면 임시 파일 삭제
      fileStream.on('close', () => {
        fs.promises.unlink(tempPath).catch((err) => {
          if (err.code !== 'ENOENT') {
            console.error(`Failed to delete temp file ${tempPath} on stream close:`, err);
          }
        });
      });

      const headers = new Headers();
      headers.set('Content-Type', 'audio/mpeg');
      headers.set('Content-Disposition', `attachment; filename="download.mp3"`);
      headers.set('Content-Length', stat.size.toString());

      span.setAttribute('download.file_size', stat.size);
      span.setStatus({ code: SpanStatusCode.OK });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp3', method: 'POST', status: 'success' });

      return new NextResponse(fileStream, { headers });
    } catch (error) {
      console.error('Download error:', error);
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp3', method: 'POST', status: 'failed' });

      // 실패 시 임시 파일(존재한다면) 클린업 시도
      if (tempPath) {
        fs.promises.unlink(tempPath).catch(() => {});
        fs.promises.unlink(`${tempPath}.part`).catch(() => {});
      }

      // 유튜브 동영상 차단/제한 에러 파싱 및 친화적인 응답 변환
      let errorMessage = 'Failed to download';
      let statusCode = 500;

      const errStr = error.message || '';
      if (errStr.includes('blocked due to the claimed content')) {
        errorMessage = '이 영상은 저작권 침해 주장(Netflix 등)으로 인해 차단되어 다운로드할 수 없습니다.';
        statusCode = 403;
      } else if (errStr.includes('Video unavailable') || errStr.includes('not available in your country')) {
        errorMessage = '이 영상은 지역 제한(국가 제한)으로 인해 다운로드할 수 없습니다.';
        statusCode = 403;
      } else if (errStr.includes('Private video')) {
        errorMessage = '이 영상은 비공개 동영상이라 다운로드할 수 없습니다.';
        statusCode = 403;
      } else if (errStr.includes('Join this channel to get access')) {
        errorMessage = '이 영상은 멤버십 전용 동영상이라 다운로드할 수 없습니다.';
        statusCode = 403;
      }

      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    } finally {
      span.end();
    }
  });
}

/**
 * GET /api/download?url=...&format_id=...
 * POST와 동일한 기능을 GET 방식으로 제공
 */
export async function GET(request) {
  const startTime = process.hrtime();
  let tempPath;
  return tracer.startActiveSpan('api-download-mp3-get', async (span) => {
    let url, format_id;
    try {
      // 오래된 임시 파일 비동기 정리 실행 (비동기 병렬 실행)
      cleanupOldTempFiles().catch(err => console.error('Failed to cleanup old temp files:', err));

      const { searchParams } = new URL(request.url);
      url = searchParams.get('url');
      format_id = searchParams.get('format_id');

      span.setAttribute('download.format', 'mp3');
      span.setAttribute('download.format_id', format_id || '');
      span.setAttribute('download.url', url || '');
      downloadCounter.add(1, { format: 'mp3', method: 'GET' });

      if (!url || !format_id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'URL and format_id are required' });
        return NextResponse.json({ error: 'URL and format_id are required' }, { status: 400 });
      }

      const tempDir = path.join(process.cwd(), 'tmp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
      tempPath = path.join(tempDir, `${Date.now()}.${format_id}.mp3`);
      
      await ytdl(url, {
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
      
      // 스트림이 끝나거나 에러 등으로 닫히면 임시 파일 삭제
      fileStream.on('close', () => {
        fs.promises.unlink(tempPath).catch((err) => {
          if (err.code !== 'ENOENT') {
            console.error(`Failed to delete temp file ${tempPath} on stream close:`, err);
          }
        });
      });

      const headers = new Headers();
      headers.set('Content-Type', 'audio/mpeg');
      headers.set('Content-Disposition', `attachment; filename="download.mp3"`);
      headers.set('Content-Length', stat.size.toString());

      span.setAttribute('download.file_size', stat.size);
      span.setStatus({ code: SpanStatusCode.OK });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp3', method: 'GET', status: 'success' });

      return new NextResponse(fileStream, { headers });
    } catch (error) {
      console.error('Download error:', error);
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp3', method: 'GET', status: 'failed' });

      // 실패 시 임시 파일(존재한다면) 클린업 시도
      if (tempPath) {
        fs.promises.unlink(tempPath).catch(() => {});
        fs.promises.unlink(`${tempPath}.part`).catch(() => {});
      }

      // 유튜브 동영상 차단/제한 에러 파싱 및 친화적인 응답 변환
      let errorMessage = 'Failed to download';
      let statusCode = 500;

      const errStr = error.message || '';
      if (errStr.includes('blocked due to the claimed content')) {
        errorMessage = '이 영상은 저작권 침해 주장(Netflix 등)으로 인해 차단되어 다운로드할 수 없습니다.';
        statusCode = 403;
      } else if (errStr.includes('Video unavailable') || errStr.includes('not available in your country')) {
        errorMessage = '이 영상은 지역 제한(국가 제한)으로 인해 다운로드할 수 없습니다.';
        statusCode = 403;
      } else if (errStr.includes('Private video')) {
        errorMessage = '이 영상은 비공개 동영상이라 다운로드할 수 없습니다.';
        statusCode = 403;
      } else if (errStr.includes('Join this channel to get access')) {
        errorMessage = '이 영상은 멤버십 전용 동영상이라 다운로드할 수 없습니다.';
        statusCode = 403;
      }

      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    } finally {
      span.end();
    }
  });
}

