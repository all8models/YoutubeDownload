const youtubedl = require('youtube-dl-exec');

async function test() {
  try {
    const info = await youtubedl('https://www.youtube.com/watch?v=P0LWn8WFB4o', {
      dumpSingleJson: true,
      noWarnings: true,
      callHome: false,
      noCheckCertificate: true,
      youtubeSkipDashManifest: true,
    });
    console.log('Success:', info.title);
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
