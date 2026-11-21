/* Whisper speech-to-text in a Web Worker (transformers.js).
 * Turns a clip's audio into timed script lines. task 'translate' = any language -> English (great for anime).
 */
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

const MODELS = {
  base:  { id: 'onnx-community/whisper-base',  dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } },
  small: { id: 'onnx-community/whisper-small', dtype: { encoder_model: 'q8',   decoder_model_merged: 'q8' } },
};
const pipes = {};

function load(size) {
  const m = MODELS[size] || MODELS.base;
  const files = {};
  return pipes[size] ||= pipeline('automatic-speech-recognition', m.id, {
    dtype: m.dtype, device: 'wasm',
    progress_callback: p => {
      if (p.status !== 'progress' || !p.total) return;
      files[p.file] = p; let l = 0, t = 0;
      for (const f of Object.values(files)) { l += f.loaded; t += f.total; }
      postMessage({ op: 'progress', label: `Whisper ${size} speech model (one-time download)`, loaded: l, total: t });
    },
  }).catch(e => { delete pipes[size]; throw e; });
}

onmessage = async ({ data: m }) => {
  try {
    const asr = await load(m.size);
    postMessage({ op: 'status', text: 'Listening to the clip… (this can take a while)' });
    const out = await asr(m.audio, {
      return_timestamps: true, chunk_length_s: 30, stride_length_s: 5,
      task: m.task || 'transcribe', language: m.language || null,
    });
    const lines = (out.chunks || [])
      .map(c => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 2, text: c.text.trim() }))
      .filter(l => l.text && !/^\[.*\]$|^\(.*\)$/.test(l.text));
    postMessage({ op: 'done', lines });
  } catch (e) {
    postMessage({ op: 'error', error: String(e?.message || e) });
  }
};
