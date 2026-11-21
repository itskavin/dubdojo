/* AI voice engine (runs in a module Web Worker so the page never freezes).
 *  - Kokoro-82M via kokoro-js  (28 English voices, Apache-2.0 weights)
 *  - Piper VITS via onnxruntime-web + piper_phonemize (eSpeak NG)  — any Piper .onnx model,
 *    official catalog (183 models / 2,700+ speakers / 58 languages) or custom community models.
 * Models are downloaded once and kept in the Cache API ("cv-models" + transformers' own cache).
 */
import { createPiperPhonemize } from './vendor/piper_phonemize.js';

const KOKORO_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.wasm.min.js';
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
const PHON = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const CACHE = 'cv-models';

const progress = (label, loaded, total) => postMessage({ op: 'progress', label, loaded, total });

async function fetchCached(url, label, { cache = true } = {}) {
  const c = await caches.open(CACHE).catch(() => null);
  const hit = await c?.match(url);
  if (hit) return hit.arrayBuffer();
  if (url.startsWith('https://local.models/')) throw new Error('Custom voice file is missing. Add it again in the voice picker.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url.split('/').pop()}`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader(); const parts = []; let loaded = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    parts.push(value); loaded += value.length;
    if (label && loaded - last > 256 * 1024) { last = loaded; progress(label, loaded, total); }
  }
  if (label) progress(label, total || loaded, total || loaded);
  const buf = await new Blob(parts).arrayBuffer();
  if (cache) try { await c?.put(url, new Response(buf)); } catch { /* quota: just don't cache */ }
  return buf;
}

// ------------------------------------------------------------------ Kokoro
let kokoroP = null;
function kokoro() {
  return kokoroP ||= (async () => {
    const { KokoroTTS } = await import(KOKORO_URL);
    const files = {};
    return KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype: 'q8', device: 'wasm',
      progress_callback: p => {
        if (p.status !== 'progress' || !p.total) return;
        files[p.file] = p; let l = 0, t = 0;
        for (const f of Object.values(files)) { l += f.loaded; t += f.total; }
        progress('Kokoro AI voices (one-time download)', l, t);
      },
    });
  })().catch(e => { kokoroP = null; throw e; });
}

// ------------------------------------------------------------------ Piper
let ortP = null;
const ort = () => ortP ||= import(ORT_URL).then(m => {
  const o = m.default || m;
  o.env.wasm.wasmPaths = ORT_WASM;
  o.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  return o;
});

const sessions = new Map(); // onnx url -> Promise<{session, config, o}>
function piperModel(url, label) {
  if (!sessions.has(url)) {
    if (sessions.size >= 2) { // keep memory in check: hold at most 2 models
      const [oldUrl, oldP] = sessions.entries().next().value;
      sessions.delete(oldUrl); oldP.then(s => s.session.release?.()).catch(() => {});
    }
    const p = (async () => {
      const o = await ort();
      const config = JSON.parse(new TextDecoder().decode(await fetchCached(url + '.json')));
      const session = await o.InferenceSession.create(await fetchCached(url, label), { executionProviders: ['wasm'] });
      return { session, config, o };
    })();
    p.catch(() => sessions.delete(url));
    sessions.set(url, p);
  }
  return sessions.get(url);
}

let phonAssets = null;
const phonemizerAssets = () => phonAssets ||= Promise.all([
  fetchCached(PHON + '.wasm', 'Piper phonemizer'),
  fetchCached(PHON + '.data', 'Piper phonemizer'),
]).catch(e => { phonAssets = null; throw e; });

async function phonemeIds(text, espeakVoice) {
  const [wasmBinary, data] = await phonemizerAssets();
  return new Promise((resolve, reject) => {
    let out = null;
    createPiperPhonemize({
      wasmBinary,
      getPreloadedPackage: () => data.slice(0),
      print: d => { try { out = JSON.parse(d).phoneme_ids; resolve(out); } catch (e) { reject(e); } },
      printErr: () => {},
      locateFile: u => (u.endsWith('.wasm') ? PHON + '.wasm' : u.endsWith('.data') ? PHON + '.data' : u),
    }).then(m => {
      m.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
      if (!out) reject(new Error('Phonemizer returned nothing'));
    }, reject);
  });
}

function splitText(text, max = 400) {
  const t = text.trim(); if (t.length <= max) return t ? [t] : [];
  const out = []; let cur = '';
  for (const s of t.match(/[^.!?…\n]+[.!?…]*\s*/g) || [t]) {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function piperSpeak({ url, speaker = 0, rate = 1, text, label }) {
  const { session, config, o } = await piperModel(url, label);
  const inf = config.inference || {};
  const multi = (config.num_speakers || 0) > 1 || Object.keys(config.speaker_id_map || {}).length > 1;
  const pcms = [];
  for (const chunk of splitText(text)) {
    const ids = await phonemeIds(chunk, config.espeak?.voice || 'en-us');
    const feeds = {
      input: new o.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new o.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new o.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / (rate || 1), inf.noise_w ?? 0.8]), [3]),
    };
    if (multi) feeds.sid = new o.Tensor('int64', BigInt64Array.from([BigInt(speaker | 0)]), [1]);
    const res = await session.run(feeds);
    pcms.push((res.output || Object.values(res)[0]).data);
  }
  if (!pcms.length) throw new Error('Nothing to say');
  return wav(concat(pcms), config.audio?.sample_rate || 22050);
}

function concat(arrs) {
  const out = new Float32Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function wav(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2); const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return buf;
}

// ------------------------------------------------------------------ message loop (serialised)
let queue = Promise.resolve();
onmessage = ({ data: m }) => {
  queue = queue.then(async () => {
    try {
      if (!m.text || !m.text.trim()) throw new Error('Nothing to say');
      let out;
      if (m.engine === 'kokoro') {
        const tts = await kokoro();
        out = (await tts.generate(m.text, { voice: m.voice, speed: m.rate || 1 })).toWav();
      } else if (m.engine === 'piper') {
        out = await piperSpeak(m);
      } else throw new Error('Unknown voice engine: ' + m.engine);
      postMessage({ id: m.id, ok: true, wav: out }, [out]);
    } catch (e) {
      postMessage({ id: m.id, ok: false, error: String(e?.message || e) });
    }
  });
};
