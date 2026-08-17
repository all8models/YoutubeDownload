import { NextResponse } from 'next/server';
import ytdl from '../../../../lib/ytdl';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { cleanupOldTempFiles } from '../../../../lib/cleanup';

const pipe = promisify(pipeline);

const tracer = trace.getTracer('youtube-downloader-download-mp4-api');
const meter = metrics.getMeter('youtube-downloader-download-mp4-api');

const downloadCounter = meter.createCounter('download_requests_total', {
  description: 'Total number of download requests',
});
const downloadDuration = meter.createHistogram('download_duration_seconds', {
  description: 'Download duration in seconds',
});

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
  const startTime = process.hrtime();
  let tempPath;
  return tracer.startActiveSpan('api-download-mp4-get', async (span) => {
    let url, quality;
    try {
      // 오래된 임시 파일 비동기 정리 실행 (비동기 병렬 실행)
      cleanupOldTempFiles().catch(err => console.error('Failed to cleanup old temp files:', err));

      const { searchParams } = new URL(request.url);
      url = searchParams.get('url');
      quality = parseInt(searchParams.get('quality') || '720', 10);

      span.setAttribute('download.format', 'mp4');
      span.setAttribute('download.quality', quality);
      span.setAttribute('download.url', url || '');
      downloadCounter.add(1, { format: 'mp4', method: 'GET' });

      if (!url) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'URL is required' });
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
      }

      // 지원하는 화질만 허용, 그 외는 720p로 기본 설정
      const supportedQualities = [720, 1080];
      const targetQuality = supportedQualities.includes(quality) ? quality : 720;

      const ffmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
      
      // yt-dlp format 지정: MP4 호환 스트림(avc1+m4a)을 우선 매칭하여 ffmpeg 재인코딩 없이 초고속 Muxing
      const format = `bestvideo[ext=mp4][height<=${targetQuality}]+bestaudio[ext=m4a]/bestvideo[height<=${targetQuality}]+bestaudio/best[height<=${targetQuality}]`;
      
      const tempDir = path.join(process.cwd(), 'tmp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      tempPath = path.join(tempDir, `${Date.now()}.mp4`);
      
      await ytdl(url, {
        format,
        output: tempPath,
        noCheckCertificate: true,
        noWarnings: true,
        noPlaylist: true,
        mergeOutputFormat: 'mp4',          // 결과물을 MP4로 병합
        ffmpegLocation: ffmpegPath,        // ffmpeg 경로 (스트림 병합용)
      });

      // 생성된 MP4 파일을 스트리밍 응답으로 전송
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
      headers.set('Content-Type', 'video/mp4');
      headers.set('Content-Disposition', `attachment; filename="${path.basename(tempPath)}"`);
      headers.set('Content-Length', stat.size.toString());

      span.setAttribute('download.file_size', stat.size);
      span.setStatus({ code: SpanStatusCode.OK });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp4', method: 'GET', status: 'success' });

      return new NextResponse(fileStream, { headers });
    } catch (error) {
      console.error('MP4 download error:', error);
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

      const diff = process.hrtime(startTime);
      const duration = diff[0] + diff[1] / 1e9;
      downloadDuration.record(duration, { format: 'mp4', method: 'GET', status: 'failed' });

      // 실패 시 임시 파일(존재한다면) 클린업 시도
      if (tempPath) {
        fs.promises.unlink(tempPath).catch(() => {});
        fs.promises.unlink(`${tempPath}.part`).catch(() => {});
      }

      // 유튜브 동영상 차단/제한 에러 파싱 및 친화적인 응답 변환
      let errorMessage = 'Failed to download MP4';
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
      } else if (errStr.includes('HTTP Error 403') || errStr.includes('403: Forbidden')) {
        errorMessage = '유튜브 스트림 접근이 일시적으로 제한되었습니다 (HTTP 403). 잠시 후 다시 시도해주세요.';
        statusCode = 403;
      }

      return NextResponse.json({ error: errorMessage }, { status: statusCode });
    } finally {
      span.end();
    }
  });
}

