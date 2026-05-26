const youtubedl = require('youtube-dl-exec');
const ffmpeg = require('ffmpeg-static');

console.log('ffmpeg path:', ffmpeg);

async function test() {
  try {
    const tempPath = './tmp/test_merge.mp4';
    await youtubedl('https://www.youtube.com/watch?v=P0LWn8WFB4o', {
      format: 'bestvideo[height<=720]+bestaudio/best[height<=720]',
      output: tempPath,
      noCheckCertificate: true,
      noWarnings: true,
      mergeOutputFormat: 'mp4',
      ffmpegLocation: ffmpeg
    });
    console.log('Success merging to', tempPath);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
