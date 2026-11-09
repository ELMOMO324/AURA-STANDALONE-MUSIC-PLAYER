'use strict';
const path=require('path'),os=require('os');
function getRuntime(env=process.env,platform=process.platform){
  const cloud=env.AURA_CLOUD==='1';
  const port=Number(env.PORT||env.AURA_PORT||48123);if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT no valido.');
  let publicBase=(env.PUBLIC_BASE_URL||env.RENDER_EXTERNAL_URL||'').replace(/\/+$/,'');
  if(publicBase){const u=new URL(publicBase);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('PUBLIC_BASE_URL no valido.');if(cloud&&u.protocol!=='https:')throw Error('El servidor publico debe usar HTTPS.');}
  if(cloud&&!publicBase)throw Error('Configura PUBLIC_BASE_URL con la URL HTTPS del servidor (Render proporciona RENDER_EXTERNAL_URL automaticamente).');
  const origins=new Set((env.ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean).map(value=>new URL(value).origin));
  return {cloud,port,host:env.HOST||(cloud?'0.0.0.0':'127.0.0.1'),publicBase:publicBase||`http://127.0.0.1:${port}`,origins,
    downloader:env.YT_DLP_PATH||(platform==='win32'?path.join(__dirname,'yt-dlp.exe'):'/opt/venv/bin/yt-dlp'),
    ffmpegDir:env.FFMPEG_DIR||(platform==='win32'?path.join(__dirname,'tools'):'/usr/bin'),
    ffmpegName:platform==='win32'?'ffmpeg.exe':'ffmpeg',
    tempDir:env.AURA_TEMP_DIR||(cloud?path.join(os.tmpdir(),'aura-audio'):path.join(__dirname,'temp_audio'))};
}
module.exports={getRuntime};
