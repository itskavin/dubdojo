/* Single-thread FFmpeg WASM: works on static hosting without cross-origin isolation. */
'use strict';
const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core';
const progress = text => postMessage({ op: 'progress', text });
async function fetchBytes(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the video converter (${response.status}). Try importing again when connected.`);
  const total = response.headers.get('content-encoding') ? 0 : Number(response.headers.get('content-length')), chunks = []; let size = 0, last = -1;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); size += value.length;
    const percent = total ? Math.min(100, Math.floor(size / total * 100)) : Math.floor(size / 1048576);
    if (percent !== last) { progress(`${label}… ${percent}${total ? '%' : ' MB'}`); last = percent; }
  }
  const out = new Uint8Array(size); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
onmessage = async ({ data }) => {
  let script;
  try {
    progress('Loading video converter (about 31 MB on first import)…');
    script = URL.createObjectURL(new Blob([await fetchBytes(CORE + '.js', 'Loading converter')], { type: 'text/javascript' }));
    importScripts(script);
    const core = await createFFmpegCore({ wasmBinary: await fetchBytes(CORE + '.wasm', 'Loading converter') });
    let lastLog = '';
    core.setLogger(({ message }) => { lastLog = message; });
    const run = args => { core.reset(); if (core.exec(...args) !== 0) throw new Error('Could not convert this pack’s video: ' + lastLog.slice(0, 200)); };
    const duration = name => {
      core.reset();
      // This core's ffprobe returns -1 even on success; validate its output instead.
      try { core.FS.unlink('duration.txt'); } catch {}
      core.ffprobe('-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', '-o', 'duration.txt', name);
      if (!core.FS.analyzePath('duration.txt').exists) throw new Error('Could not read the duration of ' + name);
      const value = Number(core.FS.readFile('duration.txt', { encoding: 'utf8' }).trim());
      if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid media duration in ' + name);
      return value;
    };
    progress('Reading video and voice clips…');
    core.FS.writeFile(data.video.name, new Uint8Array(await data.video.blob.arrayBuffer()));
    const videoDuration = duration(data.video.name), lengths = {};
    for (const clip of data.clips) {
      core.FS.writeFile(clip.name, new Uint8Array(await clip.blob.arrayBuffer()));
      lengths[clip.name] = duration(clip.name);
    }
    for (const ref of data.refs) if (ref.start >= videoDuration) throw new Error('A dialogue timestamp falls outside the video.');
    progress('Converting video and syncing dialogue… 0%');
    let lastPercent = -1;
    core.setProgress(({ time }) => {
      const percent = Math.min(99, Math.floor(time / 1000000 / videoDuration * 100));
      if (percent !== lastPercent) { progress(`Converting video and syncing dialogue… ${Math.max(0, percent)}%`); lastPercent = percent; }
    });
    const args = ['-i', data.video.name];
    for (const ref of data.refs) args.push('-i', ref.file);
    const filters = data.refs.map((r, i) => `[${i + 1}:a]adelay=${Math.round(r.start * 1000)}:all=1[v${i}]`);
    filters.push(data.refs.map((_, i) => `[v${i}]`).join('') + `amix=inputs=${data.refs.length}:normalize=0,apad[dialogue]`);
    run([...args, '-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[dialogue]',
      '-vf', 'scale=min(960\\,iw):-2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '1',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-t', String(videoDuration), '-movflags', '+faststart', 'scene.mp4']);
    const bytes = core.FS.readFile('scene.mp4');
    postMessage({ op: 'done', video: new Blob([bytes], { type: 'video/mp4' }), duration: videoDuration, lengths });
  } catch (e) { postMessage({ op: 'error', error: e.message || String(e) }); }
  finally { if (script) URL.revokeObjectURL(script); }
};
