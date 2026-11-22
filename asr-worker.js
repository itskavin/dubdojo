/* Whisper speech-to-text in a Web Worker (transformers.js).
 * Turns a clip's audio into timed script lines. task 'translate' = any language -> English (great for anime).
 *
 * After Whisper, two small extra models clean the script up:
 *  - pyannote segmentation-3.0 (~6 MB) marks where people actually talk. Whisper lines over door slams, music or
 *    other noise (no voice there) are dropped, line edges are trimmed to the voice, and a line that holds two
 *    speakers taking turns is split at the sentence boundary closest to the turn.
 *  - WeSpeaker ResNet34 (~26 MB) turns each line's voice into a "voiceprint"; similar voiceprints are grouped
 *    (agglomerative clustering) into Speaker 1, Speaker 2, ...
 */
import { pipeline, AutoProcessor, AutoModel, AutoModelForAudioFrameClassification } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

const SR = 16000;
const MODELS = {
  base:  { id: 'onnx-community/whisper-base',  dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } },
  small: { id: 'onnx-community/whisper-small', dtype: { encoder_model: 'q8',   decoder_model_merged: 'q8' } },
};
const SEG_ID = 'onnx-community/pyannote-segmentation-3.0';
const EMB_ID = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const cache = {};

function progress(label) {
  const files = {};
  return p => {
    if (p.status !== 'progress' || !p.total) return;
    files[p.file] = p; let l = 0, t = 0;
    for (const f of Object.values(files)) { l += f.loaded; t += f.total; }
    postMessage({ op: 'progress', label, loaded: l, total: t });
  };
}
const once = (key, make) => (cache[key] ||= make().catch(e => { delete cache[key]; throw e; }));

function loadWhisper(size) {
  const m = MODELS[size] || MODELS.base;
  return once('asr-' + size, () => pipeline('automatic-speech-recognition', m.id, {
    dtype: m.dtype, device: 'wasm', progress_callback: progress(`Whisper ${size} speech model (one-time download)`) }));
}
const loadPair = (key, id, Model, label) => once(key, async () => {
  const progress_callback = progress(label);
  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(id, { progress_callback }),
    Model.from_pretrained(id, { dtype: 'fp32', device: 'wasm', progress_callback })]);
  return { processor, model };
});
const loadSeg = () => loadPair('seg', SEG_ID, AutoModelForAudioFrameClassification, 'Voice detector (one-time download, 6 MB)');
const loadEmb = () => loadPair('emb', EMB_ID, AutoModel, 'Voice recognizer (one-time download, 26 MB)');

// ---------------------------------------------------------------- text clean-up
// Whisper writes sound effects as "[door closes]", "(sighs)", "*knock knock*" or "♪ music ♪", and invents lines
// like "Thanks for watching!" over silence. Neither is something anyone says.
const SOUND = /\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|（[^）]*）|【[^】]*】|\*[^*]*\*|♪[^♪]*♪|[♪♫🎵🎶]/g;
const HALLUCINATION = /^(thanks? (you )?(so much )?for watching.*|please (like and )?subscribe.*|subtitles? (by|made by|created by).*|.*amara\.org.*|.*transcribed by.*|.*(captions|subtitles) by .*)$/i;
export function cleanText(t) {
  t = String(t || '').replace(SOUND, ' ').replace(/^\s*(>>|-|–|—)\s*/, '').replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(t) || HALLUCINATION.test(t)) return '';
  return t;
}

// ---------------------------------------------------------------- voice activity + local speaker turns
const GRID = 0.02; // seconds per timeline cell
/** Runs pyannote over ≤10 s windows (what it was trained on). Per 20 ms cell: cls = 0 no voice, 1-3 one local
 *  speaker, 4-6 two at once; win = which window the local speaker numbers belong to (they're only comparable
 *  inside one window). */
async function voiceMap(audio, status) {
  const { processor, model } = await loadSeg();
  const { offset = 990, step = 270 } = processor.feature_extractor.config;
  const cells = Math.ceil(audio.length / SR / GRID) + 1;
  const cls = new Int8Array(cells), win = new Int32Array(cells).fill(-1);
  const n = Math.max(1, Math.ceil(audio.length / (10 * SR))), size = Math.ceil(audio.length / n);
  for (let w = 0; w < n; w++) {
    status(`Finding where people talk… ${Math.round(100 * w / n)}%`);
    const a = w * size, chunk = audio.subarray(a, Math.min(audio.length, a + size));
    if (chunk.length < offset + step) continue;
    const { logits } = await model(await processor(chunk));
    const [, F, C] = logits.dims; const d = logits.data;
    for (let f = 0; f < F; f++) {
      let best = 0;
      for (let c = 1; c < C; c++) if (d[f * C + c] > d[f * C + best]) best = c;
      const t0 = (a + f * step + offset / 2 - step / 2) / SR, t1 = t0 + step / SR;
      for (let g = Math.max(0, Math.round(t0 / GRID)); g < Math.min(cells, Math.round(t1 / GRID)); g++) { cls[g] = best; win[g] = w; }
    }
  }
  return { cls, win, cells };
}
const cellOf = (vm, t) => Math.max(0, Math.min(vm.cells, Math.round(t / GRID)));

/** Seconds of voice between a and b. */
function voiced(vm, a, b) {
  let n = 0; for (let g = cellOf(vm, a); g < cellOf(vm, b); g++) if (vm.cls[g]) n++;
  return n * GRID;
}

/** Shrink [start,end] to the voice inside it (Whisper's edges often include silence or noise). */
function trim(vm, l) {
  const a = cellOf(vm, l.start - 0.25), b = cellOf(vm, l.end + 0.25);
  let s = a; while (s < b && !vm.cls[s]) s++;
  let e = b - 1; while (e > s && !vm.cls[e]) e--;
  if (s >= e) return l;
  return { ...l, start: Math.max(0, s * GRID - 0.08), end: (e + 1) * GRID + 0.12 };
}

/** Runs of one local speaker inside [a,b): [{k: 'window:speaker', s, e, n}] (gaps of no voice are skipped). */
function turns(vm, a, b) {
  const out = [];
  for (let g = cellOf(vm, a); g < cellOf(vm, b); g++) {
    const c = vm.cls[g]; if (c < 1 || c > 3) continue;
    const k = vm.win[g] + ':' + c, last = out.at(-1);
    if (last && last.k === k && g - last.e < 25) { last.e = g + 1; last.n++; }
    else out.push({ k, s: g, e: g + 1, n: 1 });
  }
  return out;
}

/** Times inside the line where the voice clearly changes to another speaker (each side ≥ 0.6 s). */
function turnTimes(vm, l) {
  const runs = turns(vm, l.start, l.end).filter(r => r.n * GRID >= 0.3);
  const merged = [];
  for (const r of runs) { const p = merged.at(-1); if (p && p.k === r.k) { p.e = r.e; p.n += r.n; } else merged.push({ ...r }); }
  const out = [];
  for (let i = 1; i < merged.length; i++) {
    const p = merged[i - 1], r = merged[i];
    if (p.k.split(':')[0] !== r.k.split(':')[0]) continue; // different windows: numbers not comparable
    if (p.n * GRID < 0.6 || r.n * GRID < 0.6) continue;
    out.push(((p.e + r.s) / 2) * GRID);
  }
  return out;
}

/** Split text near each fraction, at a sentence end. Returns [{text, at}] or null when no good boundary exists. */
export function splitText(text, fracs) {
  const bounds = []; const re = /[.?!。？！…]+["”’»)]*\s+|\s+[-–—]\s+/g; let m;
  while ((m = re.exec(text))) if (m.index + m[0].length < text.length) bounds.push(m.index + m[0].length);
  const pieces = []; let from = 0, used = -1;
  fracs.forEach((f, fi) => {
    const target = f * text.length; let best = -1;
    for (let i = used + 1; i < bounds.length; i++) if (Math.abs(bounds[i] - target) <= 0.3 * text.length && (best < 0 || Math.abs(bounds[i] - target) < Math.abs(bounds[best] - target))) best = i;
    if (best < 0) return;
    pieces.push({ text: text.slice(from, bounds[best]).trim(), cut: fi }); from = bounds[best]; used = best;
  });
  if (!pieces.length) return null;
  pieces.push({ text: text.slice(from).trim(), cut: -1 });
  return pieces;
}

function splitTurns(vm, l) {
  const ts = turnTimes(vm, l); if (!ts.length) return [l];
  const total = voiced(vm, l.start, l.end) || 1;
  const parts = splitText(l.text, ts.map(t => voiced(vm, l.start, t) / total));
  if (!parts || parts.some(p => !p.text)) return [l];
  const out = []; let s = l.start;
  for (const p of parts) {
    const e = p.cut < 0 ? l.end : ts[p.cut];
    out.push({ start: s, end: e, text: p.text }); s = e;
  }
  return out;
}

// ---------------------------------------------------------------- voiceprints + clustering
/** The audio to fingerprint a line with: the cells of its main local speaker (so a short interjection by
 *  someone else doesn't blur it), else all voiced cells, else the whole line. */
function lineVoice(audio, vm, l) {
  const runs = turns(vm, l.start, l.end); const by = {};
  for (const r of runs) by[r.k] = (by[r.k] || 0) + r.n;
  const main = Object.entries(by).sort((x, y) => y[1] - x[1])[0];
  const pick = (ok) => {
    const idx = []; for (let g = cellOf(vm, l.start); g < cellOf(vm, l.end); g++) if (ok(g)) idx.push(g);
    const out = new Float32Array(idx.length * GRID * SR); let o = 0;
    for (const g of idx) { const a = Math.round(g * GRID * SR); const seg = audio.subarray(a, a + GRID * SR); out.set(seg, o); o += seg.length; }
    return out.subarray(0, Math.min(o, 15 * SR));
  };
  if (main && main[1] * GRID >= 0.5) { const [w, c] = main[0].split(':').map(Number); return pick(g => vm.win[g] === w && vm.cls[g] === c); }
  const v = pick(g => vm.cls[g] > 0); if (v.length >= 0.5 * SR) return v;
  return audio.subarray(Math.round(l.start * SR), Math.min(audio.length, Math.round(l.end * SR)));
}

async function voiceprint(emb, wave) {
  if (wave.length < 0.25 * SR) return null;
  const out = await emb.model(await emb.processor(wave));
  const t = out.embeddings || out.last_hidden_state || Object.values(out)[0];
  const v = Float32Array.from(t.data); let n = 0;
  for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Average-linkage clustering on cosine similarity. want = number of speakers, or 0 = stop at `threshold`. */
export function cluster(vecs, want, threshold = 0.3) {
  let groups = vecs.map((v, i) => ({ m: [i] }));
  const S = vecs.map(a => vecs.map(b => cos(a, b)));
  const sim = groups.map((_, i) => groups.map((_, j) => S[i][j]));
  const alive = groups.map(() => true);
  let count = groups.length;
  while (count > 1) {
    let bi = -1, bj = -1, best = -Infinity;
    for (let i = 0; i < groups.length; i++) if (alive[i]) for (let j = i + 1; j < groups.length; j++) if (alive[j] && sim[i][j] > best) { best = sim[i][j]; bi = i; bj = j; }
    if (want ? count <= want : best < threshold) break;
    const ni = groups[bi].m.length, nj = groups[bj].m.length;
    for (let k = 0; k < groups.length; k++) if (alive[k] && k !== bi && k !== bj) sim[bi][k] = sim[k][bi] = (ni * sim[bi][k] + nj * sim[bj][k]) / (ni + nj);
    groups[bi].m.push(...groups[bj].m); alive[bj] = false; count--;
  }
  const label = new Array(vecs.length);
  groups.filter((_, i) => alive[i]).forEach((g, gi) => g.m.forEach(i => { label[i] = gi; }));
  return label;
}

async function diarize(audio, vm, lines, want, status) {
  const emb = await loadEmb();
  const vecs = [], weight = [];
  for (let i = 0; i < lines.length; i++) {
    status(`Telling voices apart… ${i + 1} / ${lines.length}`);
    const wave = lineVoice(audio, vm, lines[i]);
    vecs.push(await voiceprint(emb, wave)); weight.push(wave.length / SR);
  }
  // Cluster the lines with enough voice to trust; short ones ("Hey!") join the closest group afterwards.
  let core = lines.map((_, i) => i).filter(i => vecs[i] && weight[i] >= 1);
  if (core.length < 2) core = lines.map((_, i) => i).filter(i => vecs[i]);
  const lab = cluster(core.map(i => vecs[i]), want);
  const label = new Array(lines.length).fill(-1);
  core.forEach((i, k) => { label[i] = lab[k]; });
  const groups = [...new Set(lab)];
  for (let i = 0; i < lines.length; i++) {
    if (label[i] >= 0) continue;
    if (vecs[i] && groups.length) {
      let best = -Infinity;
      for (const g of groups) {
        const ms = core.filter((_, k) => lab[k] === g);
        const s = ms.reduce((a, j) => a + cos(vecs[i], vecs[j]), 0) / ms.length;
        if (s > best) { best = s; label[i] = g; }
      }
    } else label[i] = label[i - 1] ?? 0; // no usable voice: assume the previous speaker continues
  }
  // Name speakers in order of first appearance.
  const names = new Map();
  return lines.map((l, i) => {
    const g = label[i] < 0 ? 0 : label[i];
    if (!names.has(g)) names.set(g, `Speaker ${names.size + 1}`);
    return { ...l, speaker: names.get(g) };
  });
}

// ---------------------------------------------------------------- main
onmessage = async ({ data: m }) => {
  const status = text => postMessage({ op: 'status', text });
  try {
    const audio = m.audio;
    const asr = await loadWhisper(m.size);
    status('Listening to the clip… (this can take a while)');
    const out = await asr(audio, {
      return_timestamps: true, chunk_length_s: 30, stride_length_s: 5,
      task: m.task || 'transcribe', language: m.language || null,
    });
    let lines = (out.chunks || [])
      .map(c => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 2, text: cleanText(c.text) }))
      .filter(l => l.text && l.end > l.start);
    const raw = lines.length; let notes = [];

    if (m.voiceFilter !== false && lines.length) {
      let vm = null;
      try { vm = await voiceMap(audio, status); }
      catch (e) { notes.push('Voice detector unavailable (' + (e?.message || e) + '), kept every line.'); }
      if (vm) {
        lines = lines.filter(l => {
          const v = voiced(vm, l.start - 0.2, l.end + 0.2), dur = l.end - l.start + 0.4;
          return v >= 0.4 || (v >= 0.2 && v / dur >= 0.3);
        }).map(l => trim(vm, l));
        const dropped = raw - lines.length;
        if (dropped) notes.push(`Skipped ${dropped} line${dropped > 1 ? 's' : ''} with no voice (sound effects, music or noise).`);
        if (m.speakers !== 1 && lines.length) {
          lines = lines.flatMap(l => splitTurns(vm, l));
          try { lines = await diarize(audio, vm, lines, m.speakers || 0, status); }
          catch (e) { notes.push('Could not tell voices apart (' + (e?.message || e) + '). Assign speakers yourself.'); }
        }
      }
    }
    postMessage({ op: 'done', lines, notes });
  } catch (e) {
    postMessage({ op: 'error', error: String(e?.message || e) });
  }
};
