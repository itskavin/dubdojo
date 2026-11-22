/* The Choicer Voicer video dub packs. All media stays on this device. */
'use strict';
window.ChoicerPack = (() => {
  const AUDIO = /\.(ogg|mp3|wav|opus|m4a|flac)$/i;
  const VIDEO = /\/dub_video\.(ogv|webm|mp4|mkv|mov)$/i;
  const base = path => path.replace(/\\/g, '/').split('/').pop();
  function parseINI(text) {
    const out = Object.create(null); let data = false;
    for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const s = line.trim();
      if (!s || /^[;#]/.test(s)) continue;
      if (/^\[.*\]$/.test(s)) { data = s.toLowerCase() === '[data]'; continue; }
      if (!data) continue;
      const m = s.match(/^([\w]+)\s*=\s*(.*)$/); if (!m) continue;
      try { out[m[1].toLowerCase()] = JSON.parse(m[2]); }
      catch { throw new Error(`Invalid ${m[1]} in the pack's INI file`); }
    }
    return out;
  }
  async function read(z) {
    const files = z.names.filter(n => !n.replace(/\\/g, '/').startsWith('__MACOSX/'));
    const infos = files.filter(n => /^_pack_info\.ini$/i.test(base(n)));
    if (infos.length !== 1) throw new Error(infos.length ? 'This ZIP contains several packs. Import one pack ZIP at a time.' : 'No DubDojo pack or The Choicer Voicer _pack_info.ini found in this ZIP.');
    const infoName = infos[0], root = infoName.slice(0, -base(infoName).length);
    const local = files.filter(n => n.startsWith(root) && !/[\/\\]/.test(n.slice(root.length)));
    const find = name => local.find(n => base(n).toLowerCase() === name.toLowerCase());
    const info = parseINI(await (await z.get(infoName)).text());
    const video = local.find(n => VIDEO.test('/' + base(n)));
    if (!video) throw new Error('This pack has no dub_video file. Import a The Choicer Voicer video dub pack.');
    const refs = [], clips = new Map();
    const inis = local.filter(n => /\.ini$/i.test(n) && !base(n).startsWith('_')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const name of inis) {
      const data = parseINI(await (await z.get(name)).text());
      if (data.dub_timestamps == null) continue;
      const starts = data.dub_timestamps, roles = data.dub_characters;
      if (!Array.isArray(starts) || !starts.length || starts.some(t => typeof t !== 'number' || !Number.isFinite(t) || t < 0) ||
          !Array.isArray(roles) || (roles.length !== 1 && roles.length !== starts.length) || roles.some(r => typeof r !== 'string' || !r.trim()))
        throw new Error(`Invalid timestamps or characters in ${base(name)}`);
      if (typeof data.caption !== 'string' || !data.caption.trim()) throw new Error(`Missing caption in ${base(name)}`);
      const stem = base(name).slice(0, -4).toLowerCase();
      const audio = local.find(n => AUDIO.test(n) && base(n).replace(AUDIO, '').toLowerCase() === stem);
      if (!audio) throw new Error(`Missing voice clip for ${base(name)}`);
      if (!clips.has(audio)) clips.set(audio, { name: `voice_${clips.size}.${audio.split('.').pop().toLowerCase()}`, blob: await z.get(audio) });
      starts.forEach((start, i) => refs.push({ file: clips.get(audio).name, start, speaker: roles[roles.length === 1 ? 0 : i].trim(), text: data.caption.trim() }));
      if (refs.length > 500) throw new Error('This pack has too many lines (maximum 500 per import).');
    }
    if (!refs.length) throw new Error('No timed dialogue found in this video dub pack.');
    refs.sort((a, b) => a.start - b.start);
    const backing = local.find(n => /^_backing_track\./i.test(base(n)) && AUDIO.test(n));
    const mime = n => /\.mp3$/i.test(n) ? 'audio/mpeg' : /\.wav$/i.test(n) ? 'audio/wav' : /\.m4a$/i.test(n) ? 'audio/mp4' : /\.flac$/i.test(n) ? 'audio/flac' : 'audio/ogg';
    const icon = typeof info.icon === 'string' && !/[\/\\]/.test(info.icon) && /\.(png|jpe?g|webp)$/i.test(info.icon) ? find(info.icon) : null;
    return { title: typeof info.title === 'string' && info.title.trim() ? info.title : root.replace(/[\/\\]$/, '').split(/[\/\\]/).pop() || 'Imported scene',
      authors: Array.isArray(info.authors) ? info.authors.filter(a => typeof a === 'string').join(', ') : '',
      video: { name: 'input.' + video.split('.').pop().toLowerCase(), blob: await z.get(video) }, clips: [...clips.values()], refs,
      backing: backing ? await z.get(backing, mime(backing)) : null,
      icon: icon ? await z.get(icon, /\.png$/i.test(icon) ? 'image/png' : /\.webp$/i.test(icon) ? 'image/webp' : 'image/jpeg') : null };
  }
  function convert(pack, { signal, onProgress = () => {} } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException('Import cancelled', 'AbortError'));
      const worker = new Worker('pack-worker.js');
      const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(new DOMException('Import cancelled', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      worker.onerror = e => { cleanup(); reject(new Error(e.message || 'The video converter could not start.')); };
      worker.onmessage = ({ data }) => {
        if (data.op === 'progress') onProgress(data.text);
        else if (data.op === 'done') { cleanup(); resolve(data); }
        else if (data.op === 'error') { cleanup(); reject(new Error(data.error)); }
      };
      worker.postMessage({ video: pack.video, clips: pack.clips, refs: pack.refs.map(({ file, start }) => ({ file, start })) });
    });
  }
  return { parseINI, read, convert };
})();
