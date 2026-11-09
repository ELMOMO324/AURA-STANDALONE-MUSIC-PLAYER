const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const runtime = require('./server-runtime').getRuntime();
const { port: PORT, downloader, ffmpegDir, tempDir, cloud } = runtime;
fs.mkdirSync(tempDir, { recursive: true });
const miniRoute = cloud ? null : require('./mini-bridge')(PORT);
const onlineRoute = require('./online-bridge')({downloader, port: PORT, publicBase: runtime.publicBase});
const rateWindows = new Map();
let activeDownloads = 0;
let activePlaylistQueries = 0;
const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const originAllowed = !cloud || !origin || runtime.origins.has(origin);
  res.setHeader('Vary', 'Origin');
  if (!cloud) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && originAllowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Cache-Control', 'no-store');
  const json = (status, data) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  if (!originAllowed) return json(403, { error: 'Este sitio no esta autorizado. Configura ALLOWED_ORIGINS con el dominio de Netlify.' });
  if (cloud && req.url !== '/status' && req.method !== 'OPTIONS') {
    const now = Date.now();
    // Limite global de consultas; la concurrencia pesada tiene limites adicionales.
    const key = 'requests'; const window = rateWindows.get(key);
    if (!window || now - window.start > 60000) rateWindows.set(key, { start: now, count: 1 });
    else if (++window.count > 120) return json(429, { error: 'El servidor esta ocupado. Espera un minuto.' });
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/online/')) { onlineRoute(req, res, url, json); return; }
  if (url.pathname.startsWith('/mini/')) { if (cloud) return json(404, { error: 'El flotante de Windows solo esta disponible en escritorio.' }); miniRoute(req, res, url, json); return; }
  if (req.method !== 'GET') return json(405, { error: 'Metodo no permitido.' });
  if (url.pathname === '/status') return json(200, {
    status: 'ready', version: '7.0', cloud, onlineAvailable: true, miniAvailable: !cloud, pid: process.pid,
    ytDlpAvailable: fs.existsSync(downloader),
    mp3Available: fs.existsSync(path.join(ffmpegDir, runtime.ffmpegName)),
    activeDownloads, ...onlineRoute.status()
  });
  if (!['/download', '/playlist'].includes(url.pathname)) return json(404, { error: 'Ruta no encontrada.' });
  let target;
  try {
    target = new URL(url.searchParams.get('url'));
    if (target.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(target.hostname)) throw Error();
  } catch { return json(400, { error: 'Introduce un enlace HTTPS de YouTube valido.' }); }
  if (url.pathname === '/playlist') {
    const listId = target.searchParams.get('list');
    if (!listId || !/^[\w-]{10,128}$/.test(listId) || listId.startsWith('RD')) {
      return json(400, { error: 'Usa una playlist publica o no listada de YouTube. Los mixes automaticos no son compatibles.' });
    }
    if (activePlaylistQueries >= 2) return json(429, { error: 'Ya se estan leyendo dos playlists. Espera un momento.' });
    activePlaylistQueries++;
    const child = spawn(downloader, [
      '--ignore-config', '--flat-playlist', '--dump-single-json', '--yes-playlist',
      '--ignore-errors', '--no-warnings', '--socket-timeout', '30', '--retries', '2',
      '--', 'https://www.youtube.com/playlist?list=' + listId
    ], { windowsHide: true });
    let output = '', errors = '', failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); json(504, { error: 'Se agoto el tiempo para leer la playlist.' }); }, 5 * 60 * 1000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 32 * 1024 * 1024) {
        failed = true; child.kill(); json(413, { error: 'La playlist es demasiado grande para importarla de una vez.' });
      }
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-4000); });
    child.on('error', error => { failed = true; json(503, { error: 'No se pudo leer la playlist (' + error.code + ').' }); });
    res.on('close', () => { if (!res.writableFinished) child.kill(); });
    child.on('close', code => {
      clearTimeout(timer); activePlaylistQueries--;
      if (failed || res.destroyed) return;
      try {
        const info = JSON.parse(output);
        if (!Array.isArray(info.entries)) throw Error();
        const entries = info.entries.map(entry => entry && ({
          id: entry.id, title: entry.title || 'Cancion de YouTube',
          artist: entry.uploader || entry.channel || 'YouTube', duration: entry.duration || 0,
          thumbnailUrl: entry.thumbnails?.slice(-1)[0]?.url || (entry.id ? 'https://img.youtube.com/vi/' + entry.id + '/hqdefault.jpg' : null)
        }));
        json(200, { id: listId, title: info.title || 'Playlist de YouTube', entries });
      } catch {
        json(502, { error: errors.trim().slice(-1000) || 'No se pudo leer la playlist. Comprueba que sea publica o no listada.' });
      }
    });
    return;
  }

  if (!fs.existsSync(path.join(ffmpegDir, 'ffmpeg.exe'))) return json(503, { error: 'Falta el conversor MP3 en la carpeta tools de Aura.' });
  if (activeDownloads >= 2) return json(429, { error: 'Ya hay dos descargas en curso. Espera a que terminen.' });
  const id = 'audio_' + randomUUID();
  const output = path.join(tempDir, id + '.mp3');
  const cleanup = () => {
    for (const file of fs.readdirSync(tempDir)) {
      if (file.startsWith(id + '.')) { try { fs.unlinkSync(path.join(tempDir, file)); } catch {} }
    }
  };
  activeDownloads++;
  let stderr = '', failed = false, timedOut = false;
  const child = spawn(downloader, [
    '--ignore-config', '--no-playlist', '--no-progress', '--windows-filenames',
    '--socket-timeout', '30', '--retries', '2',
    '--js-runtimes', 'node:' + process.execPath,
    '-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3',
    '--audio-quality', '0', '--ffmpeg-location', ffmpegDir,
    ...(cloud ? ['--max-filesize', '100M', '--match-filters', '!is_live & duration <= 1800'] : []),
    '-o', path.join(tempDir, id + '.%(ext)s'), '--', target.href
  ], { windowsHide: true });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10 * 60 * 1000);
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-8000); });
  child.stdout.resume();
  child.on('error', error => {
    failed = true;
    json(503, { error: 'No se pudo ejecutar el descargador de Aura (' + error.code + '). ' + (cloud ? 'Revisa los registros del servicio en Render.' : 'Revisa inicio-motor.log.'), code: error.code });
  });
  res.on('close', () => { if (!res.writableFinished) child.kill(); });
  child.on('close', code => {
    clearTimeout(timer);
    activeDownloads--;
    if (failed || res.destroyed) { cleanup(); return; }
    if (code !== 0 || !fs.existsSync(output)) {
      console.error('[AURA descarga]', stderr);
      json(502, { error: timedOut ? 'La descarga supero el tiempo maximo.' : (stderr.trim().slice(-1200) || 'No se pudo convertir el video a MP3.') });
      cleanup(); return;
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': fs.statSync(output).size });
    const stream = fs.createReadStream(output);
    stream.on('error', () => res.destroy());
    stream.on('close', cleanup);
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
});
server.on('error', error => { console.error('[AURA Bridge]', error.message); process.exitCode = 1; });
server.listen(PORT, runtime.host, () => console.log('[AURA Bridge] Motor activo en ' + runtime.host + ':' + PORT));
