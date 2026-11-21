/* Voice library: talks to voice-worker.js and knows every available AI voice.
 * Voice spec stored on a character:  { engine: 'robot'|'kokoro'|'piper', id, url, speaker, label, rate, pitch, name }
 */
'use strict';
const Voices = (() => {
  const PIPER_HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
  const CACHE = 'cv-models';

  const KOKORO = [
    ['af_heart', 'Heart', 'US', 'F', 'A'], ['af_bella', 'Bella', 'US', 'F', 'A-'], ['af_nicole', 'Nicole (whispery)', 'US', 'F', 'B-'],
    ['af_aoede', 'Aoede', 'US', 'F', 'C+'], ['af_kore', 'Kore', 'US', 'F', 'C+'], ['af_sarah', 'Sarah', 'US', 'F', 'C+'],
    ['af_alloy', 'Alloy', 'US', 'F', 'C'], ['af_nova', 'Nova', 'US', 'F', 'C'], ['af_sky', 'Sky', 'US', 'F', 'C-'],
    ['af_jessica', 'Jessica', 'US', 'F', 'D'], ['af_river', 'River', 'US', 'F', 'D'],
    ['am_fenrir', 'Fenrir', 'US', 'M', 'C+'], ['am_michael', 'Michael', 'US', 'M', 'C+'], ['am_puck', 'Puck', 'US', 'M', 'C+'],
    ['am_echo', 'Echo', 'US', 'M', 'D'], ['am_eric', 'Eric', 'US', 'M', 'D'], ['am_liam', 'Liam', 'US', 'M', 'D'],
    ['am_onyx', 'Onyx', 'US', 'M', 'D'], ['am_santa', 'Santa', 'US', 'M', 'D-'], ['am_adam', 'Adam', 'US', 'M', 'F+'],
    ['bf_emma', 'Emma', 'UK', 'F', 'B-'], ['bf_isabella', 'Isabella', 'UK', 'F', 'C'], ['bf_alice', 'Alice', 'UK', 'F', 'D'],
    ['bf_lily', 'Lily', 'UK', 'F', 'D'], ['bm_george', 'George', 'UK', 'M', 'C'], ['bm_fable', 'Fable', 'UK', 'M', 'C'],
    ['bm_lewis', 'Lewis', 'UK', 'M', 'D+'], ['bm_daniel', 'Daniel', 'UK', 'M', 'D'],
  ].map(([id, name, accent, gender, grade]) => ({ id, name, accent, gender, grade }));

  // ---------------------------------------------------------------- worker plumbing
  let worker = null, seq = 0;
  const pending = new Map();
  const listeners = new Set();
  function w() {
    if (worker) return worker;
    worker = new Worker('voice-worker.js', { type: 'module' });
    worker.onmessage = ({ data: m }) => {
      if (m.op === 'progress') { listeners.forEach(f => f(m)); return; }
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.res(new Blob([m.wav], { type: 'audio/wav' })); else p.rej(new Error(m.error));
    };
    worker.onerror = e => {
      const err = new Error(e.message || 'Voice engine failed to start');
      pending.forEach(p => p.rej(err)); pending.clear(); worker = null;
    };
    return worker;
  }

  const memo = new Map();
  function speak(spec, text) {
    const key = JSON.stringify([spec.engine, spec.id, spec.url, spec.speaker | 0, spec.rate || 1, text]);
    if (memo.has(key)) return memo.get(key);
    const p = new Promise((res, rej) => {
      const id = ++seq; pending.set(id, { res, rej });
      w().postMessage({ id, engine: spec.engine, voice: spec.id, url: spec.url, speaker: spec.speaker | 0,
        rate: spec.rate || 1, text, label: `${labelOf(spec)} (one-time download)` });
    });
    memo.set(key, p); p.catch(() => memo.delete(key));
    if (memo.size > 300) memo.delete(memo.keys().next().value);
    return p;
  }

  // ---------------------------------------------------------------- catalogs
  let piperP = null;
  function piperCatalog() {
    return piperP ||= fetch(PIPER_HF + '/voices.json').then(r => { if (!r.ok) throw new Error('Could not load the Piper voice list'); return r.json(); })
      .then(d => Object.values(d).map(v => {
        const files = Object.entries(v.files || {});
        const [path, info] = files.find(([f]) => f.endsWith('.onnx')) || [];
        const names = Object.keys(v.speaker_id_map || {});
        return {
          key: v.key, name: v.name, quality: v.quality, speakers: v.num_speakers || 1,
          speakerNames: names.length > 1 ? names : [],
          lang: v.language?.code, langName: `${v.language?.name_english || v.language?.code} (${v.language?.country_english || ''})`,
          size: info?.size_bytes || 0, url: `${PIPER_HF}/${path}`, card: `${PIPER_HF}/${path.replace(/[^/]+$/, 'MODEL_CARD')}`,
        };
      }).sort((a, b) => a.langName.localeCompare(b.langName) || a.name.localeCompare(b.name)))
      .catch(e => { piperP = null; throw e; });
  }

  // ---------------------------------------------------------------- custom community models
  const customs = () => { try { return JSON.parse(localStorage.getItem('cv.customVoices') || '[]'); } catch { return []; } };
  const saveCustoms = l => { try { localStorage.setItem('cv.customVoices', JSON.stringify(l)); } catch {} };
  function describeConfig(cfg, fallback) {
    const names = Object.keys(cfg.speaker_id_map || {});
    return { name: cfg.dataset || fallback, speakers: cfg.num_speakers || Math.max(1, names.length),
      speakerNames: names.length > 1 ? names : [], lang: cfg.espeak?.voice || cfg.language?.code || '?' };
  }
  async function addCustomFiles(onnx, json) {
    const cfg = JSON.parse(await json.text());
    if (!cfg.audio || !cfg.espeak) throw new Error('That .json does not look like a Piper voice config');
    const key = 'custom-' + Date.now().toString(36);
    const url = `https://local.models/${key}.onnx`;
    const c = await caches.open(CACHE);
    await c.put(url, new Response(onnx)); await c.put(url + '.json', new Response(JSON.stringify(cfg)));
    const entry = { key, url, local: true, size: onnx.size, ...describeConfig(cfg, onnx.name.replace(/\.onnx$/, '')) };
    saveCustoms([...customs(), entry]); return entry;
  }
  async function addCustomUrl(url) {
    url = url.trim().replace(/\.json$/, '').replace('/blob/', '/resolve/');
    if (!/^https:\/\/.+\.onnx(\?.*)?$/.test(url)) throw new Error('Paste a https:// link that ends in .onnx (its .onnx.json must sit next to it)');
    const r = await fetch(url + '.json'); if (!r.ok) throw new Error(`Could not fetch ${url.split('/').pop()}.json (${r.status})`);
    const cfg = await r.json();
    const entry = { key: 'custom-' + Date.now().toString(36), url, local: false, size: 0, ...describeConfig(cfg, url.split('/').pop().replace(/\.onnx.*$/, '')) };
    saveCustoms([...customs(), entry]); return entry;
  }
  async function removeCustom(key) {
    const e = customs().find(c => c.key === key);
    saveCustoms(customs().filter(c => c.key !== key));
    if (e) await forget(e.url);
  }

  // ---------------------------------------------------------------- downloaded model management
  async function downloaded() {
    const out = [];
    try {
      const c = await caches.open(CACHE);
      for (const req of await c.keys()) {
        if (!req.url.endsWith('.onnx')) continue;
        const size = (await (await c.match(req)).blob()).size;
        out.push({ url: req.url, size, name: decodeURIComponent(req.url.split('/').pop()) });
      }
      const k = await caches.has('transformers-cache') && await caches.open('transformers-cache');
      if (k) {
        let size = 0; let any = false;
        for (const req of await k.keys()) if (req.url.includes('Kokoro')) { any = true; size += (await (await k.match(req)).blob()).size; }
        if (any) out.unshift({ url: 'kokoro', size, name: 'Kokoro-82M (all 28 Kokoro voices)' });
      }
    } catch {}
    return out;
  }
  async function forget(url) {
    if (url === 'kokoro') {
      const k = await caches.open('transformers-cache');
      for (const req of await k.keys()) if (req.url.includes('Kokoro')) await k.delete(req);
      await caches.delete('kokoro-voices');
    } else {
      const c = await caches.open(CACHE); await c.delete(url); await c.delete(url + '.json');
    }
    worker?.terminate(); worker = null; memo.clear();
  }

  // ---------------------------------------------------------------- labels + licensing notes
  function labelOf(spec) {
    if (!spec || !spec.engine || spec.engine === 'robot') return 'Robot (browser voice)' + (spec?.name ? ` · ${spec.name}` : '');
    if (spec.engine === 'kokoro') { const k = KOKORO.find(v => v.id === spec.id); return `Kokoro · ${k ? k.name : spec.id}`; }
    return `Piper · ${spec.label || spec.id}${spec.speakers > 1 ? ` · speaker ${spec.speaker | 0}` : ''}`;
  }
  function license(spec) {
    if (spec.engine === 'kokoro') return { tag: 'Apache-2.0', ok: true };
    if (spec.engine !== 'piper') return { tag: 'browser', ok: true };
    if (spec.local || String(spec.id).startsWith('custom-')) return { tag: 'custom: check source', ok: false };
    if (/-(lessac|ryan)-/.test(spec.id)) return { tag: 'non-commercial only', ok: false };
    if (/libritts_r/.test(spec.id)) return { tag: 'unclear (from lessac)', ok: false };
    return { tag: 'see model card', ok: true };
  }

  return { KOKORO, speak, piperCatalog, customs, addCustomFiles, addCustomUrl, removeCustom, downloaded, forget,
    labelOf, license, onProgress: f => listeners.add(f) };
})();
