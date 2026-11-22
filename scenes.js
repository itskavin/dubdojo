/* DubDojo — Video Dub Studio.
 * Load a clip (your own file, a link, or YouTube), get a timed script, dub each line in sync with the
 * video, get scored on timing, fill the gaps with AI voices, watch/export the result, share "dub packs".
 * Content is bring-your-own: nothing copyrighted is bundled or downloaded. The only sample is the
 * CC-BY Sintel trailer (Blender Foundation).
 *
 * Loaded after app.js + voices.js and reuses their globals: h, toast, download, pickFile, slug, store,
 * db, uid, getMic, releaseMic, REC_TYPES, stopAll, isAI, speakWith, openVoicePicker, $view, S, RENDER.
 */
'use strict';
(() => {

// ---------------------------------------------------------------- constants + scene storage
const SCENES_KEY = 'dd.scenes';
const PALETTE = ['#f2a65a', '#6fc3ff', '#c9a0ff', '#4fd18b', '#ff7a90', '#ffd166', '#5ee6d0', '#ff9ff3', '#a3e635', '#93a8ff'];
const SINTEL_URL = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/0/06/Sintel_trailer-1080p.ogv/Sintel_trailer-1080p.ogv.480p.vp9.webm';
const SINTEL_CREDITS = 'Sintel © Blender Foundation, durian.blender.org (CC-BY 3.0)';
const BIG_FILE = 500 * 1048576;
const LANGS = [['', 'Auto-detect'], ['japanese', 'Japanese'], ['english', 'English'], ['korean', 'Korean'], ['chinese', 'Chinese'],
  ['spanish', 'Spanish'], ['french', 'French'], ['german', 'German']];
const VIDEO_TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

function loadScenes() {
  const l = store.get(SCENES_KEY, []);
  return Array.isArray(l) ? l.filter(s => s && s.id && Array.isArray(s.lines)).map(s => normScene(s).scene) : [];
}
const saveScenes = () => store.set(SCENES_KEY, SC.list);
const takePack = id => 'take_' + id;

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const safeColor = (c, i = 0) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : PALETTE[i % PALETTE.length]);
const byStart = (a, b) => a.start - b.start || a.end - b.end;
const SAFE_ID = /^[\w-]{1,40}$/;

function newScene(over = {}) {
  return { id: uid('sc_'), title: 'Untitled scene', source: { kind: 'file', name: 'video' }, lines: [], chars: {},
    settings: { orig: 0.15, karaoke: false, ai: true }, credits: '', license: '', clipStart: null, clipEnd: null, created: Date.now(), ...over };
}

function normVoice(v) {
  const out = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (['string', 'number', 'boolean'].includes(typeof x)) out[k] = x;
  out.rate = num(out.rate, 1); out.pitch = num(out.pitch, 1);
  return out;
}
function normSource(src) {
  if (src?.kind === 'youtube' && /^[\w-]{11}$/.test(src.videoId)) return { kind: 'youtube', videoId: src.videoId };
  if (src?.kind === 'url' && /^https?:\/\//i.test(src.url || '')) return { kind: 'url', url: String(src.url) };
  return { kind: 'file', name: String(src?.name || 'video').slice(0, 200) };
}
/** Sanitize a scene (from storage or an imported pack). Returns {scene, idMap} where idMap maps old line ids. */
function normScene(s) {
  const chars = {}; let i = 0;
  for (const [cid, c] of Object.entries(s.chars && typeof s.chars === 'object' ? s.chars : {})) {
    if (!c || typeof c !== 'object' || !SAFE_ID.test(cid)) continue;
    chars[cid] = { name: String(c.name || cid).slice(0, 60), color: safeColor(c.color, i++), voice: normVoice(c.voice) };
  }
  const idMap = {}; const seen = new Set();
  const lines = (Array.isArray(s.lines) ? s.lines : []).filter(l => l && typeof l === 'object').map(l => {
    let id = String(l.id ?? '');
    if (!SAFE_ID.test(id) || seen.has(id)) { const n = uid('l_'); idMap[id] = n; id = n; } else idMap[id] = id;
    seen.add(id);
    const start = Math.max(0, num(l.start));
    return { id, start, end: Math.max(start + 0.1, num(l.end, start + 2)), speaker: String(l.speaker || ''), text: String(l.text || '').slice(0, 1000) };
  }).sort(byStart);
  for (const l of lines) if (!chars[l.speaker]) {
    const cid = SAFE_ID.test(l.speaker) ? l.speaker : uid('c_');
    chars[cid] ||= { name: l.speaker || 'Speaker', color: PALETTE[Object.keys(chars).length % PALETTE.length], voice: { engine: 'robot', rate: 1, pitch: 1, name: '' } };
    l.speaker = cid;
  }
  const st = s.settings || {};
  return { idMap, scene: {
    id: String(s.id || uid('sc_')), title: String(s.title || 'Untitled scene').slice(0, 200), source: normSource(s.source), lines, chars,
    settings: { orig: clamp(num(st.orig, 0.15)), karaoke: !!st.karaoke, ai: st.ai !== false },
    credits: String(s.credits || '').slice(0, 2000), license: String(s.license || '').slice(0, 200), created: num(s.created, Date.now()),
    clipStart: Number.isFinite(+s.clipStart) && s.clipStart !== null && s.clipStart !== '' ? Math.max(0, +s.clipStart) : null,
    clipEnd: Number.isFinite(+s.clipEnd) && s.clipEnd !== null && s.clipEnd !== '' ? Math.max(0, +s.clipEnd) : null,
    thumb: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s.thumb || '') && s.thumb.length < 300000 ? s.thumb : '',
  } };
}

// Load saved scenes after all normalization constants are initialized.
const SC = { list: loadScenes(), openId: null, libTok: 0 };

// ---------------------------------------------------------------- sample: Sintel trailer (CC-BY 3.0)
// Lines transcribed by running asr-worker.js (Whisper base) on the clip; timings refined from the
// centre-channel energy; "unknown hunter" corrected to the actual line "a lone hunter".
function sampleScene() {
  return newScene({
    title: 'Sintel trailer (sample)', sample: true,
    source: { kind: 'url', url: SINTEL_URL },
    chars: {
      shaman: { name: 'Shaman', color: '#6fc3ff', voice: { engine: 'kokoro', id: 'bm_george', rate: 1, pitch: 1 } },
      sintel: { name: 'Sintel', color: '#f2a65a', voice: { engine: 'kokoro', id: 'af_bella', rate: 1, pitch: 1 } },
    },
    lines: [
      { id: 'sin1', start: 12.0, end: 14.4, speaker: 'shaman', text: 'What brings you to the land of the gatekeepers?' },
      { id: 'sin2', start: 17.3, end: 19.6, speaker: 'sintel', text: "I'm searching for someone." },
      { id: 'sin3', start: 36.9, end: 38.8, speaker: 'shaman', text: 'A dangerous quest for a lone hunter.' },
      { id: 'sin4', start: 40.3, end: 42.4, speaker: 'sintel', text: "I've been alone for as long as I can remember." },
    ],
    credits: SINTEL_CREDITS, license: 'CC-BY-3.0',
  });
}

// ---------------------------------------------------------------- time formatting
function fmt(t) {
  t = Math.max(0, num(t));
  const m = Math.floor(t / 60); const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
/** Parses "1:02.5", "62.5", "0:01:02,500". */
function parseT(s) {
  const p = String(s).trim().replace(',', '.').split(':');
  if (!p.length || p.length > 3 || p.some(x => !/^\d+(\.\d+)?$/.test(x))) return NaN;
  return p.reduce((acc, x) => acc * 60 + +x, 0);
}
function srtT(t) {
  const ms = Math.round(Math.max(0, t) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

// ---------------------------------------------------------------- subtitle parsing (SRT / VTT / ASS / SSA)
function subTime(s) {
  const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?$/);
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +('0.' + m[4]) : 0);
}
const unent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** SRT and WebVTT. VTT `<v Name>` sets the speaker; a consistent "Name: text" convention does too. */
function parseSRT(text) {
  const out = [];
  for (const block of text.replace(/^﻿/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const ls = block.split('\n');
    const i = ls.findIndex(x => x.includes('-->'));
    if (i < 0) continue;
    const [a, z = ''] = ls[i].split('-->');
    const start = subTime(a), end = subTime(z.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const raw = ls.slice(i + 1).join('\n');
    const v = raw.match(/<v(?:\.[^\s>]*)?\s+([^>]+)>/);
    const txt = unent(raw.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')).replace(/\s*\n\s*/g, ' ').trim();
    if (txt) out.push({ start, end: Math.max(end, start + 0.2), text: txt, speaker: v ? v[1].trim() : null });
  }
  const NAMED = /^([^:]{1,30}):\s+(\S.*)$/;
  const named = out.filter(l => !l.speaker && NAMED.test(l.text)).length;
  if (out.length && named >= out.length * 0.5) for (const l of out) {
    const m = !l.speaker && l.text.match(NAMED);
    if (m && !/^\d+$/.test(m[1])) { l.speaker = m[1].trim(); l.text = m[2]; }
  }
  return out.sort(byStart);
}

const SIGN_STYLE = /sign|song|karaoke|lyric|kfx|romaji|kanji|title|insert|opening|ending|^(op|ed)(\b|[\s_\d-])/i;
function splitN(s, sep, n) {
  const parts = []; let rest = s;
  while (parts.length < n - 1) { const i = rest.indexOf(sep); if (i < 0) break; parts.push(rest.slice(0, i)); rest = rest.slice(i + 1); }
  parts.push(rest); return parts;
}
/** ASS/SSA: field order from the [Events] Format line, Name -> speaker, override tags stripped. */
function parseASS(text) {
  const out = []; let sec = ''; let fields = null;
  for (const raw of text.replace(/^﻿/, '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) { sec = line.toLowerCase(); continue; }
    if (sec !== '[events]') continue;
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    if (kind === 'format') { fields = m[2].split(',').map(s => s.trim().toLowerCase()); continue; }
    if (kind !== 'dialogue') continue;
    const f = fields || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const parts = splitN(m[2], ',', f.length);
    const get = k => (f.indexOf(k) >= 0 ? parts[f.indexOf(k)] ?? '' : '');
    const style = get('style').trim(), body = get('text');
    if (SIGN_STYLE.test(style) || /\\p[1-9]/.test(body) || /banner|scroll/i.test(get('effect'))) continue;
    const txt = body.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, ' ').replace(/\\h/g, ' ').replace(/\s+/g, ' ').trim();
    const start = subTime(get('start')), end = subTime(get('end'));
    if (!txt || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({ start, end: Math.max(end, start + 0.2), text: txt, speaker: get('name').trim() || null });
  }
  const seen = new Set();
  return out.filter(l => { const k = l.start.toFixed(2) + '|' + l.text; if (seen.has(k)) return false; seen.add(k); return true; }).sort(byStart);
}
const parseSubs = text => (/^\s*\[Script Info\]/i.test(text.replace(/^﻿/, '')) || /^\[Events\]/mi.test(text) ? parseASS(text) : parseSRT(text));

function toSRT(sc) {
  return sc.lines.map((l, i) => {
    const name = sc.chars[l.speaker]?.name;
    return `${i + 1}\n${srtT(l.start)} --> ${srtT(l.end)}\n${name ? name + ': ' : ''}${l.text}\n`;
  }).join('\n');
}

// ---------------------------------------------------------------- tiny ZIP (write: store; read: store + deflate)
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
async function crc32Blob(blob) {
  let c = 0xFFFFFFFF; const r = blob.stream().getReader();
  for (;;) {
    const { done, value } = await r.read(); if (done) break;
    for (let i = 0; i < value.length; i++) c = CRC_T[(c ^ value[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosTime(d = new Date()) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
/** files: [{name, data: Blob|string}] -> Blob (application/zip). Big blobs are referenced, not copied. */
async function makeZip(files) {
  const enc = new TextEncoder(); const parts = [], central = []; let off = 0;
  const { time, date } = dosTime();
  for (const f of files) {
    const blob = typeof f.data === 'string' ? new Blob([enc.encode(f.data)]) : f.data;
    const name = enc.encode(f.name); const crc = await crc32Blob(blob); const size = blob.size;
    if (size >= 0xFFFFFFFF || off + size + 30 + name.length >= 0xFFFFFFFF) throw new Error('Pack too large (4 GB limit)');
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    parts.push(lh.buffer, name, blob); central.push(ch.buffer, name);
    off += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, off, true);
  return new Blob([...parts, ...central, eo.buffer], { type: 'application/zip' });
}
/** Reads only the directory up front; entries are sliced lazily from the Blob. */
async function readZip(blob) {
  const tailLen = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let e = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip file');
  const count = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder(); const entries = new Map(); let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip directory');
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    entries.set(dec.decode(new Uint8Array(cd.buffer, p + 46, nl)),
      { method: cd.getUint16(p + 10, true), comp: cd.getUint32(p + 20, true), lo: cd.getUint32(p + 42, true) });
    p += 46 + nl + xl + cl;
  }
  return {
    names: [...entries.keys()],
    async get(name, type = '') {
      const en = entries.get(name); if (!en) return null;
      const lh = new DataView(await blob.slice(en.lo, en.lo + 30).arrayBuffer());
      if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('damaged zip entry ' + name);
      const start = en.lo + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = blob.slice(start, start + en.comp);
      if (en.method === 0) return new Blob([raw], { type });
      if (en.method === 8) {
        if (!window.DecompressionStream) throw new Error('this browser cannot unpack compressed zips; re-zip without compression');
        return new Blob([await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()], { type });
      }
      throw new Error('unsupported zip compression in ' + name);
    },
  };
}
const EXT_MIME = { webm: 'video/webm', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg',
  ogg: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/wav', mp3: 'audio/mpeg', opus: 'audio/ogg' };
function audioExt(mime = '') {
  if (/mp4|m4a|aac/.test(mime)) return 'm4a';
  if (/ogg/.test(mime)) return 'ogg';
  if (/wav/.test(mime)) return 'wav';
  if (/mpeg/.test(mime)) return 'mp3';
  return 'webm';
}
function videoExt(rec) {
  const m = String(rec.name || '').match(/\.([a-z0-9]{2,4})$/i);
  if (m) return m[1].toLowerCase();
  const t = rec.blob?.type || '';
  return /mp4/.test(t) ? 'mp4' : /ogg/.test(t) ? 'ogv' : /quicktime/.test(t) ? 'mov' : /matroska/.test(t) ? 'mkv' : 'webm';
}

// ---------------------------------------------------------------- modal helpers
/** Like replaceChildren, but skips null/false (DOM append would print them as text). */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
const OPEN = new Set();
function sheet({ wide = false, onClose } = {}) {
  const m = h('div', { class: 'modal ds-modal' });
  const s = h('div', { class: 'sheet ds-sheet' + (wide ? ' wide' : '') });
  m.append(s); document.body.append(m);
  const close = () => { if (!m.isConnected) return; m.remove(); OPEN.delete(close); onClose?.(); };
  OPEN.add(close);
  return { m, s, close };
}
const head = (title, close, label = 'Close') => h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, title), h('button', { onclick: close }, label === 'Close' ? icon('x') : null, label));
/** Small choice dialog. buttons: [[value, label, cls]]. Resolves with value or null. */
function choose(title, msg, buttons) {
  return new Promise(res => {
    const { s, close } = sheet({ onClose: () => res(null) });
    fill(s, head(title, close), h('p', {}, msg),
      h('div', { class: 'row' }, h('span'), h('div', { class: 'toolbar', style: 'margin:0' },
        buttons.map(([v, label, cls]) => h('button', { class: cls || '', onclick: () => { res(v); close(); } }, label)))));
  });
}

// ---------------------------------------------------------------- players: {el, kind, audioAccess, time, play, pause, seek, paused, duration, setVolume, destroy}
function htmlPlayer(stage, src, { link }) {
  return new Promise((res, rej) => {
    const make = useCors => {
      const v = h('video', { class: 'ds-video', playsInline: true, preload: 'auto', controls: true });
      if (useCors) v.crossOrigin = 'anonymous';
      const ok = () => { cleanup(); res(wrap(v, !link || useCors)); };
      const bad = () => {
        cleanup(); v.removeAttribute('src'); v.remove();
        if (useCors) make(false);
        else rej(new Error('This video could not be loaded (unsupported format, or the link blocks embedding).'));
      };
      const cleanup = () => { v.removeEventListener('loadedmetadata', ok); v.removeEventListener('error', bad); };
      v.addEventListener('loadedmetadata', ok); v.addEventListener('error', bad);
      v.src = src; stage.prepend(v);
    };
    make(!!link);
  });
  function wrap(v, audioAccess) {
    return {
      el: v, kind: 'html', audioAccess,
      time: () => v.currentTime,
      play: () => v.play().catch(() => { toast('Press play: the browser blocked autoplay'); }),
      pause: () => v.pause(),
      seek: t => { v.currentTime = clamp(t, 0, Number.isFinite(v.duration) ? v.duration : 1e9); },
      paused: () => v.paused,
      duration: () => (Number.isFinite(v.duration) ? v.duration : 0),
      setVolume: x => { v.volume = clamp(x); },
      destroy: () => { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); },
    };
  }
}

let ytP = null;
function loadYT() {
  return ytP ||= new Promise((res, rej) => {
    if (window.YT?.Player) return res(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => { ytP = null; rej(new Error('The YouTube player took too long to load.')); }, 20000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); try { prev?.(); } catch {} res(window.YT); };
    document.head.append(h('script', { src: 'https://www.youtube.com/iframe_api',
      onerror: () => { clearTimeout(timer); ytP = null; rej(new Error('Could not load the YouTube player (offline or blocked).')); } }));
  });
}
const YT_ERR = { 2: 'That YouTube video id is invalid.', 5: 'This video cannot play in the embedded player.', 100: 'Video not found, removed or private.',
  101: 'The owner has disabled embedding for this video, so it can only be watched on youtube.com.', 150: 'The owner has disabled embedding for this video, so it can only be watched on youtube.com.' };
async function ytPlayer(stage, videoId) {
  const YT = await loadYT();
  const box = h('div', { class: 'ds-yt' }); const inner = h('div');
  box.append(inner); stage.prepend(box); // must be in the DOM before new YT.Player
  return new Promise((res, rej) => {
    let p, playing = false, ready = false, lastR = -1, lastAt = 0;
    const api = {
      el: box, kind: 'youtube', audioAccess: false,
      time() { // the iframe reports time coarsely: interpolate between reports
        const r = p?.getCurrentTime?.() || 0; const now = performance.now();
        if (r !== lastR) { lastR = r; lastAt = now; }
        return playing && p?.getPlayerState?.() === 1 ? r + Math.min(0.5, (now - lastAt) / 1000) : r;
      },
      play() { playing = true; p?.playVideo?.(); return Promise.resolve(); },
      pause() { playing = false; p?.pauseVideo?.(); },
      seek(t) { p?.seekTo?.(Math.max(0, t), true); lastR = -1; },
      paused: () => !playing,
      duration: () => p?.getDuration?.() || 0,
      setVolume(x) { p?.setVolume?.(Math.round(clamp(x) * 100)); if (x > 0) p?.unMute?.(); },
      destroy() { try { p?.destroy?.(); } catch {} box.remove(); },
    };
    p = new YT.Player(inner, {
      videoId, width: '100%', height: '100%', playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => { ready = true; res(api); },
        onStateChange: e => {
          if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.BUFFERING) playing = true;
          else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) playing = false;
        },
        onError: e => {
          const msg = YT_ERR[e.data] || `YouTube error ${e.data}.`;
          playing = false;
          if (!ready) { api.destroy(); rej(new Error(msg)); } else { stageMsg(msg); toast(msg); }
        },
      },
    });
  });
}

// ---------------------------------------------------------------- mixer: original audio + scheduled dub clips
class Mixer {
  constructor(player) {
    this.player = player;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC();
    this.out = ctx.createGain(); this.out.connect(ctx.destination);
    this.exportDest = ctx.createMediaStreamDestination(); this.out.connect(this.exportDest);
    this.dub = ctx.createGain(); this.dub.connect(this.out);
    this.beds = new Map(); this.clips = new Map(); this.active = new Map(); this.done = new Set(); this.muted = new Set();
    this.started = 0; this.last = null;
    if (player.kind === 'html' && player.audioAccess) {
      const src = ctx.createMediaElementSource(player.el); // only once per element: each studio makes a new <video>
      this.orig = ctx.createGain(); src.connect(this.orig); this.orig.connect(this.out);
      // "Remove voices": dialogue is usually centred, so L minus R cancels it (and keeps most music/effects).
      const split = ctx.createChannelSplitter(2); src.connect(split);
      const inv = ctx.createGain(); inv.gain.value = -1;
      this.kara = ctx.createGain();
      this.kara.channelCount = 1; this.kara.channelCountMode = 'explicit';
      split.connect(this.kara, 0); split.connect(inv, 1); inv.connect(this.kara);
      this.kara.gain.value = 0;
      this.kara.connect(this.out);
    }
  }
  setLevels(vol, karaoke) {
    if (this.orig) {
      this.orig.gain.value = karaoke ? 0 : vol;
      this.kara.gain.value = karaoke ? vol * 0.8 : 0;
    } else this.player.setVolume(vol);
  }
  resume() { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
  setClip(key, buf, offset) {
    const c = this.clips.get(key);
    if (c && c.buf === buf && c.offset === offset) return;
    this.stopKey(key); this.clips.set(key, { buf, offset });
  }
  delClip(key) { this.stopKey(key); this.clips.delete(key); }
  stopKey(key) {
    const s = this.active.get(key);
    if (s) { try { s.stop(); } catch {} this.active.delete(key); }
    this.done.delete(key);
  }
  stopAll() {
    for (const s of this.active.values()) { try { s.stop(); } catch {} }
    this.active.clear(); this.done.clear(); this.last = null;
  }
  /** Called every animation frame: starts clips whose window contains the playhead; resyncs on pause/jumps. */
  tick() {
    const p = this.player;
    if (p.paused()) { if (this.active.size || this.done.size || this.last) this.stopAll(); return; }
    if (this.ctx.state !== 'running') { this.resume(); return; }
    const t = p.time(), now = this.ctx.currentTime;
    if (this.last && Math.abs(t - (this.last.t + (now - this.last.now))) > 0.5) this.stopAll();
    this.last = { t, now };
    for (const clips of [this.beds, this.clips]) for (const [k, c] of clips) {
      if (this.muted.has(k) || this.active.has(k) || this.done.has(k)) continue;
      if (t >= c.offset && t < c.offset + c.buf.duration) {
        const s = this.ctx.createBufferSource(); s.buffer = c.buf; s.connect(this.dub);
        s.start(0, t - c.offset); this.started++;
        this.active.set(k, s);
        s.onended = () => { if (this.active.get(k) === s) { this.active.delete(k); this.done.add(k); } };
      }
    }
  }
  close() { this.stopAll(); this.ctx.close().catch(() => {}); }
}

/** Backing music/effects stay audible when the original dialogue is muted. */
async function loadBacking(mixer, rec) {
  if (!rec?.backing) return;
  const buf = await mixer.ctx.decodeAudioData(await rec.backing.arrayBuffer());
  mixer.beds.set('bed:backing', { buf, offset: 0 });
}

// ---------------------------------------------------------------- scoring (timing vs the line window)
function scoreTake(buf, offset, line) {
  const d = buf.getChannelData(0); const n = Math.max(1, Math.round(buf.sampleRate * 0.02));
  const rms = [];
  for (let i = 0; i + n <= d.length; i += n) { let s = 0; for (let j = i; j < i + n; j++) s += d[j] * d[j]; rms.push(Math.sqrt(s / n)); }
  if (!rms.length) return { score: 0, note: 'No voice detected' };
  const sorted = [...rms].sort((a, b) => a - b);
  const thr = Math.max(0.015, sorted[Math.floor(sorted.length * 0.15)] * 3);
  let first = -1, last = -1, voiced = 0;
  rms.forEach((r, i) => { if (r > thr) { if (first < 0) first = i; last = i; voiced++; } });
  if (first < 0) return { score: 0, note: 'No voice detected' };
  const vs = offset + first * 0.02, ve = offset + (last + 1) * 0.02;
  const start = line.start, end = line.end; const dur = Math.max(0.3, end - start);
  const overlap = Math.max(0, Math.min(ve, end) - Math.max(vs, start));
  const coverage = overlap / dur;
  const spill = (Math.max(0, start - vs) + Math.max(0, ve - end)) / dur;
  const activity = Math.min(1, voiced * 0.02 / (dur * 0.5));
  const score = Math.round(100 * clamp(0.6 * coverage + 0.25 * activity + 0.15 - 0.4 * spill));
  const issues = [
    [vs - start, `Started ${(vs - start).toFixed(1)}s late`, 0.25],
    [start - vs, 'Started early', 0.25],
    [ve - end, `Ran over by ${(ve - end).toFixed(1)}s`, 0.3],
    [end - ve, 'Finished early', 0.5],
  ].filter(([v, , lim]) => v > lim).sort((a, b) => b[0] - a[0]);
  return { score, note: issues[0]?.[1] || 'Nailed the timing' };
}

// ---------------------------------------------------------------- studio state
const ST = {
  scene: null, player: null, mixer: null, token: 0, raf: 0, blobURL: null,
  takes: new Map(),   // lineId -> {blob, mime, offset, score, note, at, buf}
  ai: new Map(),      // lineId -> {key, buf}
  run: null, busy: null, mark: null, stopAt: null, role: '*', lastSpeaker: null,
  els: {}, rows: new Map(), curId: null,
};
const charOf = id => ST.scene?.chars[id] || { name: id || '?', color: '#ccc', voice: {} };
const saveScene = () => saveScenes();
async function decode(blob) {
  const ab = await blob.arrayBuffer();
  if (ST.mixer) return ST.mixer.ctx.decodeAudioData(ab);
  return new OfflineAudioContext(1, 1, 48000).decodeAudioData(ab);
}
const canAudio = () => ST.player?.kind === 'html' && ST.player.audioAccess;
const noAudioWhy = () => (!ST.player ? 'Load the video first.'
  : ST.player.kind === 'youtube' ? 'YouTube videos play in YouTube’s own player, so the app can’t read their audio. Use a video file for this.'
  : 'This link doesn’t allow other sites to read its audio (no CORS), so the app can only play it. Download the clip you own and load it as a file to use this.');

function stageMsg(msg, ...extra) {
  ST.els.msg?.replaceChildren(h('div', {}, msg, ...extra));
  if (ST.els.msg) ST.els.msg.hidden = !msg;
}

// ---------------------------------------------------------------- studio: open / teardown
async function openStudio(id) {
  teardown();
  const sc = SC.list.find(s => s.id === id);
  if (!sc) { SC.openId = null; return renderLibrary(); }
  SC.openId = id; ST.scene = sc; const tok = ++ST.token;
  renderStudio();
  let player = null, videoRecord = null;
  try {
    if (sc.source.kind === 'file') {
      const rec = videoRecord = await db.clip('video', sc.id);
      if (tok !== ST.token) return;
      if (!rec?.blob) {
        stageMsg(`The video for this scene isn’t stored in this browser${sc.source.name ? ` (“${sc.source.name}”)` : ''}. `,
          h('button', { class: 'primary', onclick: () => locateVideo(sc) }, 'Locate video file'));
      } else {
        ST.blobURL = URL.createObjectURL(rec.blob);
        player = await htmlPlayer(ST.els.stage, ST.blobURL, { link: false });
      }
    } else if (sc.source.kind === 'url') {
      stageMsg('Loading video…');
      player = await htmlPlayer(ST.els.stage, sc.source.url, { link: true });
      stageMsg('');
      if (!player.audioAccess) toast('This link plays, but blocks audio access: Remove voices, export and Auto-script are off.');
    } else {
      stageMsg('Loading YouTube player…');
      player = await ytPlayer(ST.els.stage, sc.source.videoId);
      stageMsg('');
    }
  } catch (e) {
    if (tok === ST.token) stageMsg(e.message || String(e));
    return;
  }
  if (tok !== ST.token) { player?.destroy(); return; }
  if (!player) { renderControls(); return; }
  ST.player = player;
  if (sc.clipStart) player.seek(sc.clipStart);
  ST.mixer = new Mixer(player);
  try { await loadBacking(ST.mixer, videoRecord); }
  catch { toast('The backing track could not be decoded by this browser.'); }
  if (tok !== ST.token) return;
  applyLevels();
  renderControls();
  await loadTakes(sc, tok);
  if (tok !== ST.token) return;
  syncClips(); drawLines();
  loop();
}

async function loadTakes(sc, tok) {
  let keys;
  try { keys = await db.clipKeys(takePack(sc.id)); } catch { keys = new Set(); }
  for (const l of sc.lines) {
    if (!keys.has(l.id)) continue;
    try {
      const r = await db.clip(takePack(sc.id), l.id);
      if (tok !== ST.token) return;
      if (!r?.blob) continue;
      let buf = null; try { buf = await decode(r.blob); } catch {}
      ST.takes.set(l.id, { ...r, buf });
    } catch (e) { console.warn('take load failed', e); }
  }
}

async function locateVideo(sc) {
  const f = await pickFile('video/*'); if (!f) return;
  if (f.size > BIG_FILE && !confirm(`This file is ${(f.size / 1048576).toFixed(0)} MB. Big files can fill browser storage. Continue?`)) return;
  try { await db.putClip('video', sc.id, { blob: f, name: f.name }); } catch (e) { return toast('Could not store the video: ' + e.message); }
  sc.source = { kind: 'file', name: f.name }; saveScene();
  navigator.storage?.persist?.().catch(() => {});
  openStudio(sc.id);
}

function teardown() {
  ST.token++;
  if (ST.run) ST.run.aborted = true;
  if (ST.busy?.cancel) ST.busy.cancel();
  cancelAnimationFrame(ST.raf);
  try { ST.player?.destroy(); } catch {}
  try { ST.mixer?.close(); } catch {}
  if (ST.blobURL) URL.revokeObjectURL(ST.blobURL);
  Object.assign(ST, { player: null, mixer: null, blobURL: null, takes: new Map(), ai: new Map(), run: null, busy: null,
    mark: null, stopAt: null, rows: new Map(), curId: null });
  try { releaseMic(); } catch {}
}

window.onTabLeave = () => { [...OPEN].forEach(c => c()); teardown(); };

// ---------------------------------------------------------------- studio: frame loop (mixer, overlay, highlight)
function loop() {
  cancelAnimationFrame(ST.raf);
  const f = () => { ST.raf = requestAnimationFrame(f); try { frame(); } catch (e) { console.error(e); } };
  ST.raf = requestAnimationFrame(f);
}
function frame() {
  const p = ST.player, sc = ST.scene; if (!p || !sc) return;
  ST.mixer.tick();
  const t = p.time();
  if (ST.stopAt != null && t >= ST.stopAt) { p.pause(); ST.stopAt = null; }
  const run = ST.run;
  const line = run?.cur && (run.phase === 'rec' || t >= run.cur.start - 1.5) ? run.cur : sc.lines.find(l => t >= l.start && t < l.end);
  // subtitle
  const { sub, state, bar, time } = ST.els;
  const key = line ? line.id + '|' + line.text + '|' + line.speaker : '';
  if (sub.dataset.k !== key) {
    sub.dataset.k = key;
    sub.replaceChildren(...(line ? [h('span', {}, h('b', { style: `color:${safeColor(charOf(line.speaker).color)}` }, charOf(line.speaker).name + ': '), line.text)] : []));
  }
  // run states: countdown during pre-roll, REC + "speak now" progress while recording
  let st = '', w = 0, cls = '';
  if (run?.cur) {
    const l = run.cur;
    if (run.phase === 'rec') {
      w = clamp((t - l.start) / Math.max(0.1, l.end - l.start));
      st = t < l.start ? 'REC · get ready…' : t <= l.end ? 'REC · speak now' : 'REC · finishing…'; cls = 'rec';
    } else if (t < l.start) {
      const left = l.start - t; w = clamp(1 - left / 1.5);
      st = left <= 1.5 ? `Next: ${charOf(l.speaker).name} in ${left.toFixed(1)}s` : `Next: ${charOf(l.speaker).name}`; cls = 'cd';
    }
    if (run.lines.length > 1) st += `   (${run.i + 1}/${run.lines.length}, Esc to stop)`;
  } else if (ST.mark != null) { st = `M: line starts at ${fmt(ST.mark)}, press M again at its end`; cls = 'cd'; }
  else if (ST.busy?.label) { st = ST.busy.label; cls = 'cd'; }
  if (state.textContent !== st) state.textContent = st;
  state.className = 'ds-state ' + cls; state.hidden = !st;
  bar.hidden = !run?.cur; bar.className = 'ds-cd ' + cls; bar.firstChild.style.width = (w * 100).toFixed(1) + '%';
  const tl = `${fmt(t)} / ${fmt(p.duration())}`;
  if (time.textContent !== tl) time.textContent = tl;
  // highlight current row
  const cur = sc.lines.find(l => t >= l.start && t < l.end)?.id || null;
  if (cur !== ST.curId) {
    ST.rows.get(ST.curId)?.classList.remove('cur');
    ST.curId = cur;
    const row = ST.rows.get(cur);
    if (row) {
      row.classList.add('cur');
      const list = ST.els.lines;
      if (!list.contains(document.activeElement) && list.scrollHeight > list.clientHeight + 4) {
        const top = row.offsetTop - list.offsetTop;
        if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - 40;
      }
    }
  }
}

// ---------------------------------------------------------------- studio: clips (takes + AI fill)
const aiKey = l => JSON.stringify([l.text, charOf(l.speaker).voice, Math.round((l.end - l.start) * 10)]);
function syncClips() {
  const sc = ST.scene, mx = ST.mixer; if (!sc || !mx) return;
  const ids = new Set(sc.lines.map(l => l.id));
  for (const k of [...mx.clips.keys()]) if (!ids.has(k)) mx.delClip(k);
  for (const l of sc.lines) {
    const tk = ST.takes.get(l.id); const ai = ST.ai.get(l.id);
    if (tk?.buf) mx.setClip(l.id, tk.buf, tk.offset);
    else if (sc.settings.ai && ai && ai.key === aiKey(l) && isAI(charOf(l.speaker).voice)) mx.setClip(l.id, ai.buf, l.start);
    else mx.delClip(l.id);
  }
}
/** Generates AI voices for lines without a take. Resolves true to continue, false if cancelled. */
async function aiFill(lines = ST.scene.lines) {
  const sc = ST.scene;
  if (!sc.settings.ai) { syncClips(); return true; }
  const todo = lines.filter(l => !ST.takes.has(l.id) && l.text.trim() && isAI(charOf(l.speaker).voice) && ST.ai.get(l.id)?.key !== aiKey(l));
  if (!todo.length) { syncClips(); return true; }
  let cancelled = false; const tok = ST.token;
  const msg = h('p', {}, ''); const bar = h('div', { class: 'bar' }, h('i'));
  const { s, close } = sheet({ onClose: () => { cancelled = true; } });
  fill(s, head('AI voices for undubbed lines', close, 'Cancel'), bar, msg,
    h('p', { class: 'muted' }, 'The first line waits for a one-time voice model download. Generated lines are kept until you leave the studio.'));
  let fail = 0;
  for (const [n, l] of todo.entries()) {
    if (cancelled || tok !== ST.token) break;
    msg.textContent = `${n + 1} / ${todo.length}: ${charOf(l.speaker).name}: “${l.text.slice(0, 70)}”`;
    try {
      const v = charOf(l.speaker).voice; const key = aiKey(l);
      const win = Math.max(0.3, l.end - l.start);
      let buf = await decode(await Voices.speak(v, l.text));
      if (buf.duration > 1.15 * win) {
        const rate = Math.min(1.6, (v.rate || 1) * buf.duration / win);
        buf = await decode(await Voices.speak({ ...v, rate }, l.text));
      }
      if (tok === ST.token) ST.ai.set(l.id, { key, buf });
    } catch (e) { fail++; console.warn('AI fill failed', e); }
    bar.firstChild.style.width = `${Math.round(100 * (n + 1) / todo.length)}%`;
  }
  const ok = !cancelled && tok === ST.token;
  close();
  if (fail) toast(`${fail} AI line(s) failed to generate`);
  syncClips();
  return ok;
}

// ---------------------------------------------------------------- studio: playback actions
function resume() { ST.mixer?.resume(); }
async function watch() {
  if (!ST.player || ST.run || ST.busy) return;
  resume();
  if (!await aiFill()) return;
  if (!ST.player) return;
  ST.mixer.muted.clear(); ST.stopAt = null;
  ST.player.seek(0); ST.player.play();
}
async function previewLine(l) {
  if (!ST.player || ST.run || ST.busy) return;
  resume();
  if (!await aiFill([l])) return;
  if (!ST.player) return;
  ST.mixer.muted.clear();
  ST.player.seek(Math.max(0, l.start - 0.5)); ST.stopAt = l.end + 0.6; ST.player.play();
}
function togglePlay() {
  const p = ST.player; if (!p) return;
  resume();
  if (p.paused()) { ST.stopAt = null; p.play(); } else p.pause();
}
function seek(t) { if (ST.player && !ST.run) { ST.player.seek(t); } }

// ---------------------------------------------------------------- studio: recording runs
const waitUntil = (run, cond) => new Promise(res => {
  const chk = () => {
    const p = ST.player;
    if (run.aborted || !p) return res(false);
    if (cond(p.time())) return res(true);
    if (p.paused()) {
      const d = p.duration();
      if (d && p.time() >= d - 0.15) return res(true); // the clip ended: treat as reached
      run.aborted = true; return res(false);
    }
    setTimeout(chk, 15);
  };
  chk();
});

/** Dub one or many lines in one continuous take of the video, like a real dubbing session. */
async function dubRun(lines) {
  const p = ST.player, sc = ST.scene;
  if (!p || ST.run || ST.busy) return;
  lines = [...lines].sort(byStart);
  if (!lines.length) return toast('No lines to dub. Add or import some lines first.');
  if (!window.MediaRecorder) return toast('This browser cannot record audio.');
  let stream;
  try { stream = await getMic(); } catch (e) { return toast(e.message || 'Microphone unavailable'); }
  if (ST.scene !== sc || !ST.player) return;
  resume();
  const run = ST.run = { lines, i: 0, cur: null, phase: 'wait', aborted: false };
  const mx = ST.mixer; const tok = ST.token;
  lines.forEach(l => mx.muted.add(l.id));
  renderControls();
  toast('Tip: use headphones so the video isn’t recorded with your voice.');
  ST.stopAt = null;
  p.seek(Math.max(0, lines[0].start - 1.5)); await p.play();
  const mime = REC_TYPES.find(t => MediaRecorder.isTypeSupported?.(t));
  const saves = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], next = lines[i + 1];
    Object.assign(run, { i, cur: l, phase: 'wait' });
    if (!await waitUntil(run, t => t >= l.start - 0.15)) break;
    const chunks = [];
    let mr;
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch (e) { toast('Recorder failed: ' + e.message); run.aborted = true; break; }
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { mr.onstop = () => r(new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' })); });
    let offset = p.time();
    mr.onstart = () => { if (ST.player === p) offset = p.time(); };
    mr.start(); run.phase = 'rec';
    const stopAt = Math.min(l.end + 0.6, next ? Math.max(l.end, next.start - 0.2) : l.end + 0.6);
    const ok = await waitUntil(run, t => t >= stopAt);
    if (mr.state !== 'inactive') mr.stop();
    const blob = await stopped;
    if (!ok) break; // aborted mid-line: discard the partial take
    saves.push(saveTake(sc, l, blob, offset));
  }
  run.cur = null;
  if (ST.player === p) p.pause();
  const results = await Promise.all(saves);
  lines.forEach(l => mx.muted.delete(l.id));
  try { releaseMic(); } catch {}
  if (tok !== ST.token) return;
  ST.run = null;
  renderControls(); drawLines();
  if (!results.length) { toast('Stopped. Nothing was saved.'); return; }
  showResults(results, run.aborted);
}
function abortRun() { if (ST.run) { ST.run.aborted = true; ST.player?.pause(); } }

async function saveTake(sc, l, blob, offset) {
  let buf = null, res = { score: 0, note: 'Could not read the recording' };
  try { buf = await decode(blob); res = scoreTake(buf, offset, l); } catch (e) { console.warn(e); }
  const rec = { blob, mime: blob.type, offset, score: res.score, note: res.note, at: Date.now() };
  try { await db.putClip(takePack(sc.id), l.id, rec); navigator.storage?.persist?.().catch(() => {}); }
  catch (e) { toast('Could not save a take: ' + (e.message || e)); }
  if (ST.scene === sc && ST.mixer) { ST.takes.set(l.id, { ...rec, buf }); syncClips(); }
  return { line: l, ...res };
}

function showResults(results, aborted) {
  const avg = Math.round(results.reduce((n, r) => n + r.score, 0) / results.length);
  const low = results.filter(r => r.score < 60).map(r => r.line);
  const { s, close } = sheet();
  fill(s, head(`Your dub: ${avg} / 100`, close),
    aborted ? h('p', { class: 'muted' }, 'Stopped early. These lines were saved:') : null,
    h('div', { class: 'ds-results' }, results.map(r => h('div', { class: 'ds-res' },
      h('span', { class: 'ds-who', style: `color:${safeColor(charOf(r.line.speaker).color)}` }, charOf(r.line.speaker).name),
      h('span', { class: 'ds-rtext' }, r.line.text || '(no text)'),
      scoreBadge(r.score), h('span', { class: 'muted ds-note' }, r.note)))),
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('span', { class: 'muted' }, (avg >= 80 ? 'Great timing!' : avg >= 60 ? 'Solid timing.' : 'Keep at it: watch the countdown bar.') + (low.length ? ' Retry the red ones?' : '')),
      h('div', { class: 'toolbar', style: 'margin:0' },
        low.length ? h('button', { onclick: () => { close(); dubRun(low); } }, `Retry low scores (${low.length})`) : null,
        h('button', { class: 'primary', onclick: () => { close(); watch(); } }, icon('play'), 'Watch my dub'))));
}
const scoreBadge = sc => h('span', { class: 'ds-score ' + (sc == null ? '' : sc >= 80 ? 'good' : sc >= 60 ? 'ok' : 'low'), title: sc == null ? 'Not dubbed yet' : 'Timing score' }, sc == null ? '—' : String(sc));

// ---------------------------------------------------------------- studio: lines editing
function defaultSpeaker() {
  const sc = ST.scene;
  if (ST.lastSpeaker && sc.chars[ST.lastSpeaker]) return ST.lastSpeaker;
  return Object.keys(sc.chars)[0] || charByName('Speaker 1');
}
function charByName(name) {
  const sc = ST.scene; const key = String(name).trim().toLowerCase();
  const hit = Object.entries(sc.chars).find(([, c]) => c.name.trim().toLowerCase() === key);
  if (hit) return hit[0];
  const id = uid('c_');
  sc.chars[id] = { name: String(name).trim().slice(0, 60) || 'Speaker', color: PALETTE[Object.keys(sc.chars).length % PALETTE.length], voice: { engine: 'robot', rate: 1, pitch: 1, name: '' } };
  return id;
}
function addLine(start, end) {
  const sc = ST.scene;
  const l = { id: uid('l_'), start: Math.max(0, start), end: Math.max(start + 0.3, end), speaker: defaultSpeaker(), text: '' };
  sc.lines.push(l); sc.lines.sort(byStart); saveScene(); drawLines(); renderControls();
  setTimeout(() => ST.rows.get(l.id)?.querySelector('.ds-text')?.focus(), 0);
}
function mark() {
  const p = ST.player; if (!p || ST.run) return;
  const t = p.time();
  if (ST.mark == null) { ST.mark = t; toast(`Line start marked at ${fmt(t)}. Press M again where it ends.`); return; }
  const a = Math.min(ST.mark, t), b = Math.max(ST.mark, t); ST.mark = null;
  if (b - a < 0.2) return toast('That line is too short. Press M at the start, then again at the end.');
  addLine(a, b);
}
async function deleteLine(l) {
  const sc = ST.scene;
  if (ST.takes.has(l.id) && !confirm('Delete this line and your take for it?')) return;
  sc.lines = sc.lines.filter(x => x !== l); saveScene();
  ST.takes.delete(l.id); ST.ai.delete(l.id);
  try { await db.delClip(takePack(sc.id), l.id); } catch {}
  syncClips(); drawLines(); renderControls();
}

/** Merge parsed lines [{start,end,text,speaker:name|null}] into the scene, asking replace/append. */
async function addLines(items, what) {
  const sc = ST.scene;
  if (!items.length) return toast(`No lines found in ${what}.`);
  let mode = 'append';
  if (sc.lines.length) {
    mode = await choose('Lines already exist', `This scene has ${sc.lines.length} lines. ${what} has ${items.length}. Replace them (your takes for the old lines are deleted) or add the new lines?`,
      [[null, 'Cancel'], ['append', 'Append'], ['replace', 'Replace', 'danger']]);
    if (!mode) return;
  }
  if (mode === 'replace') {
    sc.lines = []; ST.takes.clear(); ST.ai.clear();
    try { await db.delPack(takePack(sc.id)); } catch {}
  }
  const fallback = items.some(x => !x.speaker) ? defaultSpeaker() : null;
  for (const x of items) {
    sc.lines.push({ id: uid('l_'), start: Math.max(0, x.start), end: Math.max(x.start + 0.2, x.end), text: String(x.text).slice(0, 1000),
      speaker: x.speaker ? charByName(x.speaker) : fallback });
  }
  sc.lines.sort(byStart); saveScene(); syncClips(); drawLines(); renderControls();
  toast(`Added ${items.length} lines` + (mode === 'replace' ? ' (replaced)' : ''));
  return true;
}

async function importSubs() {
  const f = await pickFile('.srt,.vtt,.ass,.ssa,text/plain,text/vtt'); if (!f) return;
  try {
    if (f.size > 20 * 1048576) throw new Error('file too big for a subtitle file');
    await addLines(parseSubs(await f.text()), `“${f.name}”`);
  } catch (e) { toast('Could not read subtitles: ' + e.message); }
}

function drawLines() {
  const sc = ST.scene, list = ST.els.lines; if (!sc || !list) return;
  ST.rows = new Map(); ST.curId = null;
  if (!sc.lines.length) {
    list.replaceChildren(h('p', { class: 'muted ds-empty' }, 'No lines yet. Import subtitles, try Auto-script, or press M at the start and end of a line while the video plays.'));
    return;
  }
  list.replaceChildren(...sc.lines.map(lineRow));
}
function lineRow(l) {
  const sc = ST.scene; const c = charOf(l.speaker); const tk = ST.takes.get(l.id);
  const timeIn = k => h('input', { type: 'text', class: 'ds-t', value: fmt(l[k]), inputMode: 'decimal', title: `${k === 'start' ? 'Start' : 'End'} (m:ss.s). Click to jump there.`,
    onclick: () => seek(l[k]),
    onchange: e => {
      const v = parseT(e.target.value);
      if (!Number.isFinite(v)) { e.target.value = fmt(l[k]); return toast('Use m:ss.s, e.g. 1:02.5'); }
      setTime(l, k, v);
    } });
  const atHead = k => h('button', { class: 'ds-ico', title: `Set ${k} to the playhead`, 'aria-label': `Set ${k} to the playhead`, onclick: () => ST.player && setTime(l, k, ST.player.time()) }, icon('target'));
  const row = h('div', { class: 'ds-line', style: `border-left-color:${safeColor(c.color)}` },
    h('div', { class: 'ds-l1' },
      h('select', { class: 'ds-spk', title: 'Speaker', onchange: e => { l.speaker = e.target.value; ST.lastSpeaker = l.speaker; saveScene(); syncClips(); drawLines(); } },
        Object.entries(sc.chars).map(([id, ch]) => h('option', { value: id, selected: id === l.speaker }, ch.name))),
      h('input', { type: 'text', class: 'ds-text', value: l.text, placeholder: 'What is said…', oninput: e => { l.text = e.target.value; saveScene(); } })),
    h('div', { class: 'ds-l2' },
      timeIn('start'), atHead('start'), h('span', { class: 'muted' }, '–'), timeIn('end'), atHead('end'),
      h('span', { class: 'ds-sp' }),
      h('span', { title: tk?.note || '' }, scoreBadge(tk ? tk.score : null)),
      h('button', { class: 'rec ds-ico', title: 'Record this line', 'aria-label': 'Record this line', disabled: !!ST.run, onclick: () => dubRun([l]) }, icon('mic')),
      h('button', { class: 'ds-ico', title: 'Preview this line', 'aria-label': 'Preview this line', onclick: () => previewLine(l) }, icon('play')),
      h('button', { class: 'danger ds-ico', title: 'Delete line', 'aria-label': 'Delete line', onclick: () => deleteLine(l) }, icon('trash'))));
  ST.rows.set(l.id, row);
  return row;
}
function setTime(l, k, v) {
  v = Math.max(0, v);
  l[k] = v;
  if (k === 'start' && l.end <= v + 0.1) l.end = v + 1;
  if (k === 'end' && v <= l.start + 0.1) l.start = Math.max(0, v - 1);
  ST.scene.lines.sort(byStart); saveScene(); syncClips(); drawLines();
}

// ---------------------------------------------------------------- characters + details modals
function charactersModal() {
  const sc = ST.scene;
  const { s, close } = sheet({ wide: true });
  const changed = () => { saveScene(); syncClips(); drawLines(); renderControls(); };
  function draw() {
    fill(s, head('Characters', close),
      h('p', { class: 'muted' }, 'Pick an AI voice to have it fill the lines nobody has dubbed yet. Characters on the browser robot voice are skipped by AI fill.'),
      h('div', { class: 'ds-chars' }, Object.entries(sc.chars).map(([id, c]) => h('div', { class: 'ds-char' },
        h('input', { type: 'color', value: safeColor(c.color), oninput: e => { c.color = e.target.value; saveScene(); }, onchange: changed }),
        h('input', { type: 'text', value: c.name, oninput: e => { c.name = e.target.value.slice(0, 60); saveScene(); }, onchange: changed }),
        h('span', { class: 'ds-voice' }, Voices.labelOf(c.voice), isAI(c.voice) ? null : h('span', { class: 'tag' }, 'no AI fill')),
        h('span', { class: 'muted' }, `${sc.lines.filter(l => l.speaker === id).length} lines`),
        h('button', { onclick: () => openVoicePicker(c, () => { changed(); draw(); }) }, icon('mic'), 'Voice'),
        h('button', { title: 'Hear it', 'aria-label': 'Hear it', onclick: () => speakWith(c.voice, `Hi, I'm ${c.name}.`) }, icon('play')),
        h('button', { class: 'danger', title: 'Delete character', 'aria-label': 'Delete character', onclick: () => {
          if (sc.lines.some(l => l.speaker === id)) return toast('This character still has lines. Move them to someone else first.');
          delete sc.chars[id]; changed(); draw();
        } }, icon('trash'))))),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('span'),
        h('button', { onclick: () => { charByName(`Character ${Object.keys(sc.chars).length + 1}`); changed(); draw(); } }, icon('plus'), 'Character')));
  }
  draw();
}
function detailsModal() {
  const sc = ST.scene; const f = { title: sc.title, credits: sc.credits, license: sc.license };
  const { s, close } = sheet();
  const inp = (k, label, ta) => h('div', { class: 'field' }, h('label', {}, label),
    h(ta ? 'textarea' : 'input', { type: 'text', value: f[k], oninput: e => { f[k] = e.target.value; } }));
  fill(s, head('Scene details', close), inp('title', 'Title'),
    inp('credits', 'Credits (source of the clip, who voiced what)', true), inp('license', 'License of the clip (e.g. CC-BY-3.0, or “own clip, private”)'),
    h('div', { class: 'row' }, h('span'), h('button', { class: 'primary', onclick: () => {
      sc.title = f.title.slice(0, 200) || 'Untitled scene'; sc.credits = f.credits.slice(0, 2000); sc.license = f.license.slice(0, 200);
      saveScene(); close(); ST.els.title.textContent = sc.title; ST.els.credits.textContent = sc.credits;
    } }, 'Save')));
}

// ---------------------------------------------------------------- Whisper auto-script
let asrWorker = null;
async function sourceBlob(sc) {
  if (sc.source.kind === 'file') { const r = await db.clip('video', sc.id); if (!r?.blob) throw new Error('video not stored'); return r.blob; }
  const res = await fetch(sc.source.url); if (!res.ok) throw new Error(`download failed (${res.status})`);
  return res.blob();
}
function autoScript() {
  if (!canAudio()) return toast(noAudioWhy());
  if (ST.run || ST.busy) return;
  const sc = ST.scene; const o = { language: '', task: 'translate', size: 'base', speakers: '0' };
  const { s, close } = sheet({ onClose: () => { if (job.running) { asrWorker?.terminate(); asrWorker = null; ST.busy = null; } } });
  const job = { running: false };
  const sel = (k, opts) => h('select', { onchange: e => { o[k] = e.target.value; } }, opts.map(([v, label]) => h('option', { value: v, selected: v === o[k] }, label)));
  const status = h('p', { class: 'muted' }); const bar = h('div', { class: 'bar', hidden: true }, h('i'));
  const go = h('button', { class: 'primary', onclick: start }, 'Start');
  fill(s, head('Auto-script with Whisper', close),
    h('p', { class: 'muted' }, 'Whisper listens to the clip and writes timed lines, right in your browser (nothing is uploaded). A voice detector skips sound effects, music and noise, and a voice recognizer groups the lines by who is speaking (Speaker 1, Speaker 2, …). Check the result and rename the speakers in Characters.'),
    h('div', { class: 'field' }, h('label', {}, 'Language spoken'), sel('language', LANGS)),
    h('div', { class: 'field' }, h('label', {}, 'Output'), sel('task', [['translate', 'English translation'], ['transcribe', 'Same language as spoken']])),
    h('div', { class: 'field' }, h('label', {}, 'Model'), sel('size', [['base', 'Base (about 136 MB, faster)'], ['small', 'Small (about 250 MB, better)']])),
    h('div', { class: 'field' }, h('label', {}, 'Speakers'), sel('speakers', [['0', 'Detect automatically'], ['1', 'Just one (don’t separate voices)'],
      ...[2, 3, 4, 5, 6].map(n => [String(n), `Exactly ${n}`])])),
    bar, status, h('div', { class: 'row' }, h('span'), go));
  async function start() {
    go.disabled = true; job.running = true; ST.busy = { label: 'Auto-script running…', cancel: close };
    const setStatus = t => { status.textContent = t; };
    try {
      setStatus('Reading the audio…');
      const blob = await sourceBlob(sc);
      const ab = await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(await blob.arrayBuffer());
      const audio = new Float32Array(ab.length);
      for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) audio[i] += d[i] / ab.numberOfChannels; }
      setStatus('Loading the speech model…');
      const { lines, notes } = await new Promise((res, rej) => {
        asrWorker ||= new Worker('asr-worker.js', { type: 'module' });
        asrWorker.onmessage = ({ data: m }) => {
          if (m.op === 'progress') {
            const pct = m.total ? Math.round(100 * m.loaded / m.total) : 0;
            bar.hidden = false; bar.firstChild.style.width = pct + '%';
            setStatus(`${m.label}: ${pct}% of ${(m.total / 1048576).toFixed(0)} MB`);
          } else if (m.op === 'status') { bar.hidden = true; setStatus(m.text); }
          else if (m.op === 'done') res({ lines: m.lines || [], notes: m.notes || [] });
          else if (m.op === 'error') rej(new Error(m.error));
        };
        asrWorker.onerror = e => { asrWorker = null; rej(new Error(e.message || 'speech engine failed to start')); };
        asrWorker.postMessage({ size: o.size, audio, task: o.task, language: o.language || null, speakers: +o.speakers }, [audio.buffer]);
      });
      job.running = false; ST.busy = null;
      if (!s.isConnected) return;
      close();
      const items = lines.map(l => ({ start: num(l.start), end: num(l.end, num(l.start) + 2), text: String(l.text || '').trim(),
        speaker: l.speaker ? String(l.speaker).slice(0, 60) : null })).filter(l => l.text);
      const added = await addLines(items, 'Whisper’s script');
      const found = new Set(items.map(l => l.speaker).filter(Boolean)).size;
      const msg = [...notes, found > 1 ? `Found ${found} different voices. Rename them in Characters.` : ''].filter(Boolean).join(' ');
      if (msg && added) setTimeout(() => toast(msg), 2500);
    } catch (e) {
      job.running = false; ST.busy = null;
      setStatus('Failed: ' + (e.message || e)); go.disabled = false;
    }
  }
}

// ---------------------------------------------------------------- export video (canvas + mixer audio)
function exportVideoModal() {
  if (!canAudio()) return toast(noAudioWhy());
  if (ST.run || ST.busy) return;
  const mime = window.MediaRecorder && VIDEO_TYPES.find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) return toast('This browser cannot record video.');
  const o = { burn: true };
  const { s, close } = sheet();
  fill(s, head('Export dubbed video', close),
    h('p', { class: 'muted' }, `The clip plays once from start to end in real time (${fmt(ST.player.duration())}) while it records your dub, the AI voices and the original at your mix settings. Keep this tab in front.`),
    h('label', {}, h('input', { type: 'checkbox', checked: o.burn, onchange: e => { o.burn = e.target.checked; } }), ' Burn in subtitles'),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('span', { class: 'muted' }, `Format: ${mime.split(';')[0]}`),
      h('button', { class: 'primary', onclick: () => { close(); exportVideo(mime, o.burn); } }, 'Start export')));
}
async function exportVideo(mime, burn) {
  const p = ST.player, mx = ST.mixer, sc = ST.scene;
  if (!await aiFill()) return;
  if (ST.player !== p) return;
  const v = p.el; const W = v.videoWidth || 1280, H = v.videoHeight || 720;
  const canvas = h('canvas', { width: W, height: H }); const g = canvas.getContext('2d');
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...mx.exportDest.stream.getAudioTracks()]);
  const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4e6 });
  const chunks = []; mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { mr.onstop = r; });
  let cancelled = false, raf = 0;
  const bar = h('div', { class: 'bar' }, h('i')); const msg = h('p', { class: 'muted' }, 'Starting…');
  const { s, close } = sheet({ onClose: () => { cancelled = true; } });
  s.append(head('Exporting…', close, 'Cancel'), bar, msg);
  ST.busy = { label: 'Exporting video…', cancel: close };
  mx.muted.clear(); ST.stopAt = null; resume();
  p.pause(); p.seek(0);
  await new Promise(r => { if (!v.seeking) return r(); v.addEventListener('seeked', r, { once: true }); setTimeout(r, 3000); });
  const drawFrame = () => {
    raf = requestAnimationFrame(drawFrame);
    g.drawImage(v, 0, 0, W, H);
    const t = v.currentTime;
    if (burn) {
      const l = sc.lines.find(x => t >= x.start && t < x.end);
      if (l) drawSub(g, W, H, `${charOf(l.speaker).name}: ${l.text}`);
    }
    const d = p.duration() || 1;
    bar.firstChild.style.width = (100 * clamp(t / d)).toFixed(1) + '%';
    msg.textContent = `${fmt(t)} / ${fmt(d)}`;
  };
  drawFrame();
  mr.start(1000);
  await p.play();
  await new Promise(r => {
    const chk = () => {
      if (cancelled || ST.player !== p) return r();
      if (v.ended || (p.paused() && v.currentTime >= p.duration() - 0.2)) return r();
      if (p.paused()) { cancelled = true; return r(); } // paused by the user
      setTimeout(chk, 100);
    };
    chk();
  });
  cancelAnimationFrame(raf);
  if (mr.state !== 'inactive') mr.stop();
  await stopped;
  p.pause?.();
  if (ST.busy?.cancel === close) ST.busy = null;
  const wasCancelled = cancelled; // close() below fires onClose, which sets `cancelled`
  close();
  if (wasCancelled) return toast('Export cancelled');
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  download(`${slug(sc.title)}.dub.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`, blob, blob.type);
  toast(`Exported ${(blob.size / 1048576).toFixed(1)} MB`);
}
function drawSub(g, W, H, text) {
  const fs = Math.max(14, Math.round(H * 0.05));
  g.font = `600 ${fs}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  const words = text.split(/\s+/); const rows = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > W * 0.9 && cur) { rows.push(cur); cur = w; } else cur = t; }
  if (cur) rows.push(cur);
  g.lineWidth = Math.max(3, fs / 6); g.strokeStyle = 'rgba(0,0,0,.85)'; g.fillStyle = '#fff'; g.lineJoin = 'round';
  rows.slice(-3).reverse().forEach((r, i) => { const y = H - fs * 0.8 - i * fs * 1.2; g.strokeText(r, W / 2, y); g.fillText(r, W / 2, y); });
}

// ---------------------------------------------------------------- dub packs (.dubpack.zip)
async function exportPackModal(sc) {
  let vrec = null;
  if (sc.source.kind === 'file') { try { vrec = await db.clip('video', sc.id); } catch {} }
  let nTakes = 0; try { nTakes = (await db.clipKeys(takePack(sc.id))).size; } catch {}
  const o = { video: !!vrec?.blob, takes: nTakes > 0 };
  const { s, close } = sheet();
  fill(s, head('Export dub pack', close),
    h('p', { class: 'muted' }, 'A dub pack holds the script, characters and voices, and optionally your takes and the video. Only include a video you have the right to share.'),
    vrec?.blob ? h('label', { class: 'ds-check' }, h('input', { type: 'checkbox', checked: o.video, onchange: e => { o.video = e.target.checked; } }),
      ` Include video (${(vrec.blob.size / 1048576).toFixed(1)} MB)`) : h('p', { class: 'muted' }, sc.source.kind === 'file' ? 'No video stored for this scene.' : 'The video is linked, not included.'),
    h('label', { class: 'ds-check' }, h('input', { type: 'checkbox', checked: o.takes, disabled: !nTakes, onchange: e => { o.takes = e.target.checked; } }), ` Include my takes (${nTakes})`),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('span'),
      h('button', { class: 'primary', onclick: async e => {
        e.target.disabled = true; e.target.textContent = 'Packing…';
        try { await exportPack(sc, o); close(); } catch (err) { toast('Export failed: ' + err.message); e.target.disabled = false; e.target.textContent = 'Export'; }
      } }, 'Export')));
}
async function exportPack(sc, o) {
  const files = []; const takes = {};
  if (o.takes) for (const l of sc.lines) {
    const r = await db.clip(takePack(sc.id), l.id);
    if (!r?.blob) continue;
    const mime = r.mime || r.blob.type || 'audio/webm';
    const file = `takes/${l.id}.${audioExt(mime)}`;
    files.push({ name: file, data: r.blob });
    takes[l.id] = { file, offset: r.offset, mime, score: r.score };
  }
  let backing = null;
  if (o.video) {
    const v = await db.clip('video', sc.id);
    if (v?.blob) files.push({ name: 'video.' + videoExt(v), data: v.blob });
    if (v?.backing) { backing = 'backing.' + audioExt(v.backing.type); files.push({ name: backing, data: v.backing }); }
  }
  const json = { format: 'dubdojo-pack', version: 1,
    scene: { title: sc.title, source: sc.source, lines: sc.lines, chars: sc.chars, credits: sc.credits, license: sc.license, clipStart: sc.clipStart, clipEnd: sc.clipEnd, thumb: sc.thumb }, takes, backing };
  files.unshift({ name: 'dubpack.json', data: JSON.stringify(json, null, 1) });
  const zip = await makeZip(files);
  download(`${slug(sc.title)}.dubpack.zip`, zip, 'application/zip');
}
async function importPack(after = renderLibrary) {
  const f = await pickFile('.zip,application/zip'); if (!f) return null;
  return importPackFile(f, after);
}
async function importPackFile(f, after = renderLibrary) {
  try {
    const z = await readZip(f);
    const jb = await z.get('dubpack.json');
    if (!jb) {
      const sc = await importChoicerPack(z);
      if (sc) after?.(sc);
      return sc;
    }
    const data = JSON.parse(await jb.text());
    if (data?.format !== 'dubdojo-pack') throw new Error('not a DubDojo pack');
    const { scene: sc, idMap } = normScene({ ...(data.scene || {}), id: uid('sc_'), created: Date.now(), settings: undefined });
    let hasVideo = false, n = 0;
    const vname = z.names.find(nm => /^video\.[a-z0-9]{2,4}$/i.test(nm));
    if (vname && sc.source.kind === 'file') {
      const ext = vname.split('.').pop().toLowerCase();
      const blob = await z.get(vname, EXT_MIME[ext] || 'video/' + ext);
      const backing = typeof data.backing === 'string' ? await z.get(data.backing, EXT_MIME[data.backing.split('.').pop().toLowerCase()] || 'audio/ogg') : null;
      await db.putClip('video', sc.id, { blob, name: sc.source.name, backing }); hasVideo = true;
    }
    for (const [oldId, t] of Object.entries(data.takes && typeof data.takes === 'object' ? data.takes : {})) {
      const lid = idMap[oldId];
      if (!lid || typeof t?.file !== 'string') continue;
      const mime = String(t.mime || '').slice(0, 100);
      const blob = await z.get(t.file, mime || EXT_MIME[t.file.split('.').pop()] || 'audio/webm');
      if (!blob) continue;
      await db.putClip(takePack(sc.id), lid, { blob, mime: mime || blob.type, offset: num(t.offset),
        score: Number.isFinite(+t.score) ? clamp(Math.round(+t.score), 0, 100) : null, note: 'Imported take', at: Date.now() });
      n++;
    }
    SC.list.unshift(sc); saveScenes();
    navigator.storage?.persist?.().catch(() => {});
    toast(`Imported “${sc.title}”: ${sc.lines.length} lines, ${n} takes${hasVideo ? ', video included' : ''}`);
    after?.(sc);
    return sc;
  } catch (e) { toast('Import failed: ' + (e.message || e)); return null; }
}

/** Convert the source assets once, then use the same player/editor/export as native packs. */
async function importChoicerPack(z) {
  const controller = new AbortController();
  const { s, close } = sheet({ onClose: () => controller.abort() });
  const status = h('p', { role: 'status', 'aria-live': 'polite' }, 'Reading pack…');
  fill(s, head('Import The Choicer Voicer pack', close, 'Cancel'), status,
    h('p', { class: 'muted' }, 'The first import downloads a video converter. Conversion can take a few minutes. Keep this tab open; your media stays on this device.'));
  let savedId = null;
  try {
    const pack = await ChoicerPack.read(z);
    if (controller.signal.aborted) return null;
    const result = await ChoicerPack.convert(pack, { signal: controller.signal, onProgress: text => { status.textContent = text; } });
    const chars = {}, roles = new Map();
    const lines = pack.refs.map((r, i) => {
      if (!roles.has(r.speaker)) {
        const id = 'role_' + roles.size;
        roles.set(r.speaker, id); chars[id] = { name: r.speaker, color: PALETTE[(roles.size - 1) % PALETTE.length], voice: {} };
      }
      return { id: 'cv_' + (i + 1), start: r.start, end: Math.min(result.duration, r.start + result.lengths[r.file]), speaker: roles.get(r.speaker), text: r.text };
    });
    let thumb = '';
    if (pack.icon && pack.icon.size < 220000) thumb = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(pack.icon);
    });
    const { scene: sc } = normScene(newScene({ title: pack.title, source: { kind: 'file', name: 'scene.mp4' }, lines, chars,
      credits: `The Choicer Voicer pack${pack.authors ? ' by ' + pack.authors : ''}`, clipStart: 0, clipEnd: result.duration, thumb }));
    if (controller.signal.aborted) return null;
    savedId = sc.id;
    await db.putClip('video', sc.id, { blob: result.video, name: 'scene.mp4', backing: pack.backing });
    if (controller.signal.aborted) { await db.delClip('video', sc.id); return null; }
    SC.list.unshift(sc); saveScenes(); savedId = null;
    navigator.storage?.persist?.().catch(() => {});
    toast(`Imported “${sc.title}”: ${sc.lines.length} lines, ${Object.keys(sc.chars).length} characters`);
    return sc;
  } catch (e) {
    if (savedId) await db.delClip('video', savedId).catch(() => {});
    if (e.name === 'AbortError') return null;
    throw e;
  } finally { close(); }
}

// ---------------------------------------------------------------- library view
function sourceLabel(src) {
  if (src.kind === 'youtube') return 'YouTube · ' + src.videoId;
  if (src.kind === 'url') { try { return 'Link · ' + new URL(src.url).hostname; } catch { return 'Link'; } }
  return 'File · ' + src.name;
}
function ytId(s) {
  s = String(s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u; try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/) || [])[1];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}
function createScene(over) {
  const sc = newScene(over);
  SC.list.unshift(sc); saveScenes();
  return sc;
}
async function addFile() {
  const f = await pickFile('video/*'); if (!f) return;
  if (f.size > BIG_FILE && !confirm(`This file is ${(f.size / 1048576).toFixed(0)} MB. Files over 500 MB can fill browser storage and be slow. Continue?`)) return;
  const sc = newScene({ title: f.name.replace(/\.[^.]+$/, '') || 'My clip', source: { kind: 'file', name: f.name } });
  try { await db.putClip('video', sc.id, { blob: f, name: f.name }); }
  catch (e) { return toast('Could not store the video (storage full?): ' + (e.message || e)); }
  SC.list.unshift(sc); saveScenes();
  navigator.storage?.persist?.().catch(() => {});
  openStudio(sc.id);
}
function addLink() {
  const url = (prompt('Link to a video file (.mp4 / .webm) that you are allowed to use:') || '').trim(); if (!url) return;
  if (ytId(url) && /youtu/.test(url)) return addYouTube(url);
  if (!/^https?:\/\//i.test(url)) return toast('Paste a link that starts with https://');
  let title = 'Linked clip'; try { title = decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/\.[^.]+$/, '') || title; } catch {}
  openStudio(createScene({ title, source: { kind: 'url', url } }).id);
}
function addYouTube(pre) {
  const s = typeof pre === 'string' ? pre : prompt('YouTube link (watch, youtu.be or shorts):'); if (!s) return;
  const id = ytId(s); if (!id) return toast('That doesn’t look like a YouTube link.');
  openStudio(createScene({ title: 'YouTube clip ' + id, source: { kind: 'youtube', videoId: id } }).id);
}
function trySample() {
  const ex = SC.list.find(s => s.sample);
  openStudio((ex || createScene(sampleScene())).id);
}
async function deleteScene(sc) {
  if (!confirm(`Delete “${sc.title}”, its stored video and all your takes?`)) return;
  try { await db.delPack(takePack(sc.id)); await db.delClip('video', sc.id); } catch (e) { console.warn(e); }
  SC.list = SC.list.filter(s => s !== sc); saveScenes(); renderLibrary();
}

function renderLibrary() {
  const tok = ++SC.libTok;
  const tiles = [
    ['clapper', 'Video file', 'MP4 or WebM from your device', addFile],
    ['link', 'Video link', 'A direct .mp4 or .webm URL', addLink],
    ['tv', 'YouTube', 'Dub over a YouTube video', () => addYouTube()],
    ['upload', 'Import pack', 'DubDojo or The Choicer Voicer ZIP', () => importPack()],
  ];
  const list = h('div', { class: 'mk-list' });
  if (!SC.list.length) {
    list.append(h('div', { class: 'empty' }, icon('package', 'empty-ic'), h('p', { class: 'empty-t' }, 'No packs yet'),
      h('p', { class: 'muted' }, 'Start from a video above, or open any starter pack and choose “Edit a copy”.')));
  }
  for (const sc of SC.list) {
    const stats = h('span', { class: 'muted' }, `${sc.lines.length} lines`);
    const th = sc.thumb ? h('img', { src: sc.thumb, alt: '' }) : icon('film');
    list.append(h('div', { class: 'mk-card' },
      h('div', { class: 'mk-thumb' }, th),
      h('div', { class: 'mk-body' },
        h('div', { class: 'mk-title' }, sc.title),
        h('div', { class: 'muted mk-src' }, sourceLabel(sc.source)),
        stats),
      h('div', { class: 'mk-actions' },
        h('button', { class: 'primary', onclick: () => openStudio(sc.id) }, icon('pencil'), 'Edit'),
        h('button', { disabled: !sc.lines.length, title: sc.lines.length ? '' : 'Add lines first', onclick: () => navigate('#/pack/my:' + sc.id) }, icon('play'), 'Play'),
        h('button', { onclick: () => exportPackModal(sc) }, icon('download'), 'Export'),
        h('button', { class: 'danger icon-only', 'aria-label': `Delete ${sc.title}`, title: 'Delete', onclick: () => deleteScene(sc) }, icon('trash')))));
    (async () => {
      try {
        const keys = await db.clipKeys(takePack(sc.id));
        const n = sc.lines.filter(l => keys.has(l.id)).length;
        if (tok !== SC.libTok) return;
        const range = sc.clipStart != null || sc.clipEnd != null ? ` · clip ${fmt(sc.clipStart || 0)}–${sc.clipEnd != null ? fmt(sc.clipEnd) : 'end'}` : '';
        stats.textContent = `${sc.lines.length} lines${n ? ` · ${n} recorded in the editor` : ''}${range}`;
      } catch {}
    })();
  }
  $view.replaceChildren(h('div', { class: 'page mk-page' },
    h('div', { class: 'page-head' }, h('div', {},
      h('p', { class: 'eyebrow' }, 'Creator'),
      h('h1', { class: 'page-title' }, 'Make a pack'),
      h('p', { class: 'muted lead' }, 'Turn a clip you have the rights to into a dub pack: load the video, import subtitles or let Whisper write the script, trim the clip range, then play it like any other pack. Everything stays in your browser.'))),
    h('h2', { class: 'sec-title' }, 'Start from'),
    h('div', { class: 'src-tiles' }, tiles.map(([ic, t, sub, fn]) => h('button', { class: 'src-tile', onclick: fn },
      h('span', { class: 'src-ic' }, icon(ic)), h('span', { class: 'src-t' }, t), h('span', { class: 'src-s' }, sub)))),
    h('h2', { class: 'sec-title' }, 'Your packs'),
    list));
}

// ---------------------------------------------------------------- studio view
function renderStudio() {
  const sc = ST.scene;
  const stage = h('div', { class: 'ds-stage' },
    h('div', { class: 'ds-cd', hidden: true }, h('i')),
    h('div', { class: 'ds-state', hidden: true }),
    h('div', { class: 'ds-sub' }),
    h('div', { class: 'ds-msg', hidden: true }));
  ST.els = {
    stage, bar: stage.children[0], state: stage.children[1], sub: stage.children[2], msg: stage.children[3],
    time: h('span', { class: 'ds-time' }, '0:00.0'),
    controls: h('div', { class: 'ds-controls' }),
    lines: h('div', { class: 'ds-lines' }),
    title: h('b', {}, sc.title),
    credits: h('span', { class: 'muted ds-small' }, sc.credits),
  };
  const top = h('div', { class: 'ds-top' },
    h('button', { class: 'ghost', onclick: () => { SC.openId = null; teardown(); renderLibrary(); } }, icon('arrowLeft'), 'My packs'),
    h('div', { class: 'ds-ttl' }, ST.els.title, h('span', { class: 'tag' }, sourceLabel(sc.source))),
    h('button', { onclick: detailsModal }, icon('info'), 'Details'),
    h('button', { class: 'primary', onclick: playThisPack }, icon('play'), 'Play this pack'));
  $view.replaceChildren(h('div', { class: 'page ds-studio' }, top,
    h('div', { class: 'ds-grid' },
      h('div', { class: 'ds-left' }, stage, h('div', { class: 'ds-under' }, ST.els.time, ST.els.credits), ST.els.controls),
      h('div', { class: 'ds-right card' }, h('h3', {}, 'Script', h('span', { class: 'muted ds-small' }, 'M = mark start/end · Space = play/pause')), ST.els.lines))));
  renderControls(); drawLines();
}
function playThisPack() {
  const sc = ST.scene; if (!sc) return;
  const inClip = sc.lines.filter(l => (sc.clipStart == null || l.start >= sc.clipStart - 0.05) && (sc.clipEnd == null || l.end <= sc.clipEnd + 0.05));
  if (!inClip.length) return toast(sc.lines.length ? 'No lines fall inside the clip range.' : 'Add some lines first: import subtitles or use Auto-script.');
  navigate('#/pack/my:' + sc.id);
}
function setClip(k, v) {
  const sc = ST.scene;
  if (v == null) sc[k] = null;
  else {
    v = Math.max(0, v);
    if (k === 'clipStart' && sc.clipEnd != null && v >= sc.clipEnd - 0.5) return toast('The clip must start before it ends.');
    if (k === 'clipEnd' && sc.clipStart != null && v <= sc.clipStart + 0.5) return toast('The clip must end after it starts.');
    sc[k] = Math.round(v * 10) / 10;
  }
  saveScene(); renderControls();
}

function applyLevels() { const s = ST.scene.settings; ST.mixer?.setLevels(s.orig, s.karaoke && canAudio()); }

function renderControls() {
  const sc = ST.scene, el = ST.els.controls; if (!sc || !el) return;
  const ready = !!ST.player, audioOK = canAudio(), running = !!ST.run;
  const roles = Object.entries(sc.chars);
  if (ST.role !== '*' && !sc.chars[ST.role]) ST.role = '*';
  const roleLines = () => sc.lines.filter(l => ST.role === '*' || l.speaker === ST.role);
  const set = (k, v) => { sc.settings[k] = v; saveScene(); applyLevels(); if (k === 'ai') syncClips(); };
  const clipIn = k => h('input', { type: 'text', class: 'ds-t', inputMode: 'decimal', value: sc[k] != null ? fmt(sc[k]) : '',
    placeholder: k === 'clipStart' ? 'start' : 'end', 'aria-label': k === 'clipStart' ? 'Clip start (m:ss.s)' : 'Clip end (m:ss.s)',
    onchange: e => {
      if (!e.target.value.trim()) return setClip(k, null);
      const v = parseT(e.target.value);
      if (!Number.isFinite(v)) { e.target.value = sc[k] != null ? fmt(sc[k]) : ''; return toast('Use m:ss.s, e.g. 1:02.5'); }
      setClip(k, v);
    } });
  const atHead = k => h('button', { class: 'ds-ico', disabled: !ready, title: 'Set to the playhead', 'aria-label': `Set clip ${k === 'clipStart' ? 'start' : 'end'} to the playhead`,
    onclick: () => setClip(k, ST.player.time()) }, icon('target'));
  const group = (label, ic, ...kids) => h('div', { class: 'ds-group' }, h('div', { class: 'ds-glabel' }, icon(ic), label), h('div', { class: 'toolbar' }, ...kids));
  fill(el,
    group('Test it', 'mic',
      h('button', { class: 'primary', disabled: !ready || running, onclick: watch }, icon('play'), 'Watch my dub'),
      running ? h('button', { class: 'recording', onclick: abortRun }, icon('square'), 'Stop (Esc)')
        : h('button', { class: 'rec', disabled: !ready || !sc.lines.length, onclick: () => dubRun(roleLines()) }, icon('mic'), 'Dub all'),
      h('label', {}, 'only',
        h('select', { disabled: running, onchange: e => { ST.role = e.target.value; } },
          h('option', { value: '*', selected: ST.role === '*' }, 'All characters'),
          roles.map(([id, c]) => h('option', { value: id, selected: ST.role === id }, c.name))))),
    group('Mix', 'volume',
      h('label', { title: 'Volume of the original soundtrack' }, 'Original',
        h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: sc.settings.orig, oninput: e => set('orig', +e.target.value) })),
      h('label', { title: audioOK ? 'Cancels centre-panned dialogue (works best on stereo mixes)' : noAudioWhy() },
        h('input', { type: 'checkbox', checked: sc.settings.karaoke, disabled: !audioOK, onchange: e => set('karaoke', e.target.checked) }), 'Remove voices'),
      h('label', { title: 'Characters with an AI voice speak the lines you haven’t dubbed' },
        h('input', { type: 'checkbox', checked: sc.settings.ai, onchange: e => set('ai', e.target.checked) }), 'AI fill')),
    group('Clip range', 'scissors',
      clipIn('clipStart'), atHead('clipStart'), h('span', { class: 'muted' }, '–'), clipIn('clipEnd'), atHead('clipEnd'),
      h('button', { disabled: sc.clipStart == null && sc.clipEnd == null, onclick: () => { sc.clipStart = sc.clipEnd = null; saveScene(); renderControls(); } }, 'Whole video')),
    group('Script', 'captions',
      h('button', { disabled: running, onclick: importSubs }, icon('upload'), 'Import subtitles'),
      h('button', { disabled: !audioOK || running, title: audioOK ? '' : noAudioWhy(), onclick: autoScript }, icon('sparkles'), 'Auto-script'),
      h('button', { disabled: !ready || running, onclick: () => { const t = ST.player.time(); addLine(t, t + 2); } }, icon('plus'), 'Line at playhead'),
      h('button', { onclick: charactersModal }, icon('users'), 'Characters'),
      h('button', { disabled: !sc.lines.length, onclick: () => download(slug(sc.title) + '.srt', toSRT(sc), 'text/plain') }, icon('download'), '.srt')),
    group('Share', 'share',
      h('button', { disabled: !audioOK || running, title: audioOK ? '' : noAudioWhy(), onclick: exportVideoModal }, icon('film'), 'Export video'),
      h('button', { disabled: running, onclick: () => exportPackModal(sc) }, icon('package'), 'Export .dubpack.zip')),
    h('p', { class: 'muted ds-small' }, 'Editor test runs play the original quietly (Original slider), so use headphones here. The game mutes the original automatically while you record.'),
    ready && !audioOK ? h('p', { class: 'ds-warn ds-small' }, noAudioWhy(), ' Remove voices, Auto-script and video export are off; dubbing, scoring and watching still work.') : null);
}

// ---------------------------------------------------------------- keys + gestures
document.addEventListener('keydown', e => {
  if (S.tab !== 'scenes' || !ST.player) return;
  if (e.key === 'Escape' && ST.run) { e.preventDefault(); abortRun(); return; }
  if (e.target.matches?.('input,textarea,select,video,[contenteditable]') || document.querySelector('.modal')) return;
  if (e.key === ' ') { e.preventDefault(); e.target.blur?.(); togglePlay(); } // also stops a focused button re-clicking
  else if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); mark(); }
});
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => ST.mixer?.resume(), true));

// ---------------------------------------------------------------- route: #/make
function renderScenes() {
  if (SC.openId && SC.list.some(s => s.id === SC.openId)) openStudio(SC.openId);
  else { SC.openId = null; renderLibrary(); }
}
ROUTES.make = { nav: 'make', tab: 'scenes', render: renderScenes };

/** Creates an editable copy of a pack (e.g. a starter pack) and opens it in the editor. */
function editCopy(data) {
  const { scene } = normScene({ ...data, id: uid('sc_'), created: Date.now() });
  SC.list.unshift(scene); saveScenes();
  SC.openId = scene.id;
  navigate('#/make');
  return scene;
}

// shared with game.js, and handles for tests / debugging
window.DubStudio = { SC, ST, parseSRT, parseASS, parseSubs, toSRT, makeZip, readZip, scoreTake, ytId, openStudio, dubRun, watch, sampleScene,
  Mixer, loadBacking, htmlPlayer, ytPlayer, drawSub, normScene, saveScenes, takePack, fmt, parseT, sourceLabel, importPack, importPackFile, exportPackModal,
  exportPack, editCopy, safeColor, renderLibrary, VIDEO_TYPES, clamp, num };
})();
