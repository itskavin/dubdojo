/* DubDojo — dub movie scenes with your own voice, plus Story mode: branching stories you voice yourself.
 * Plain JS, no build step, no backend. Story -> localStorage, voice clips -> IndexedDB.
 */
'use strict';

// ---------------------------------------------------------------- helpers
const $view = document.getElementById('view');
const uid = (p = '') => p + Math.random().toString(36).slice(2, 9);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false)
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, onchange: () => res(i.files[0] || null) });
    i.click();
  });
}

const slug = s => (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Could not save to browser storage'); } },
};

// ---------------------------------------------------------------- IndexedDB (voice clips)
const db = (() => {
  let p;
  const open = () => p ||= new Promise((res, rej) => {
    const r = indexedDB.open('dubdojo', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('packs', { keyPath: 'id' });
      r.result.createObjectStore('clips');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (name, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(name, mode); const s = t.objectStore(name);
      let out; const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
    });
  };
  return {
    packs: () => tx('packs', 'readonly', s => s.getAll()),
    putPack: p => tx('packs', 'readwrite', s => s.put(p)),
    delPack: async id => {
      await tx('packs', 'readwrite', s => s.delete(id));
      await tx('clips', 'readwrite', s => s.delete(IDBKeyRange.bound(id + '|', id + '|￿')));
    },
    clip: (pack, line) => tx('clips', 'readonly', s => s.get(pack + '|' + line)),
    putClip: (pack, line, v) => tx('clips', 'readwrite', s => s.put(v, pack + '|' + line)),
    delClip: (pack, line) => tx('clips', 'readwrite', s => s.delete(pack + '|' + line)),
    clipKeys: pack => tx('clips', 'readonly', s => s.getAllKeys(IDBKeyRange.bound(pack + '|', pack + '|￿')))
      .then(keys => new Set((keys || []).map(k => k.slice(pack.length + 1)))),
  };
})();

// ---------------------------------------------------------------- sample story (original)
function sampleStory() {
  return {
    title: 'The Last Signal',
    start: 'dock',
    characters: {
      nar:  { name: 'Narrator', color: '#9aa7b8', voice: { engine: 'kokoro', id: 'bm_george', pitch: 0.9, rate: 0.95, name: '' } },
      mara: { name: 'Mara',     color: '#f2a65a', voice: { engine: 'kokoro', id: 'af_bella', pitch: 1.2, rate: 1.0,  name: '' } },
      oz:   { name: 'Oz',       color: '#6fc3ff', voice: { engine: 'kokoro', id: 'am_puck', pitch: 0.7, rate: 1.05, name: '' } },
    },
    scenes: {
      dock: { title: 'The Dock', bg: 'linear-gradient(160deg,#1b2a3a,#0b1018 70%)',
        lines: [
          { id: 'l1', speaker: 'nar',  text: 'Fog swallows the harbor. Out past the rocks, the old lighthouse blinks. Three short. Three long.' },
          { id: 'l2', speaker: 'mara', text: "That's a distress pattern. Nobody's lived out there in twenty years." },
          { id: 'l3', speaker: 'oz',   text: "Which is exactly why we shouldn't row out there in the dark, Mara." },
        ],
        choices: [ { text: 'Take the rowboat out now', to: 'boat' }, { text: 'Wake the harbor master first', to: 'master' } ] },
      boat: { title: 'Open Water', bg: 'linear-gradient(180deg,#0c1622,#10283a 60%,#0a1a26)',
        lines: [
          { id: 'l4', speaker: 'nar',  text: 'The oars creak. Behind you, the town lights shrink to pinpricks.' },
          { id: 'l5', speaker: 'oz',   text: 'Mara... the light stopped.' },
          { id: 'l6', speaker: 'mara', text: "Then whoever's up there just ran out of time. Row faster." },
        ],
        choices: [ { text: 'Climb the lighthouse stairs', to: 'tower' } ] },
      master: { title: "Harbor Master's Hut", bg: 'linear-gradient(160deg,#3a2a1b,#140e08 70%)',
        lines: [
          { id: 'l7', speaker: 'oz',   text: 'Open up! The lighthouse is signaling!' },
          { id: 'l8', speaker: 'nar',  text: 'The door swings open on its own. The hut is empty. A logbook lies open on the table.' },
          { id: 'l9', speaker: 'mara', text: "Last entry, tonight: 'Gone to fix the lamp. Back by ten.' It's past midnight." },
        ],
        choices: [ { text: 'Take the motorboat and go', to: 'tower' }, { text: 'Call the coast guard and wait', to: 'wait' } ] },
      tower: { title: 'The Lighthouse', bg: 'linear-gradient(0deg,#1a1410,#2b2230 50%,#f2a65a22)',
        lines: [
          { id: 'l10', speaker: 'nar',  text: 'At the top, an old man is wedged under a fallen lens frame, still clutching a signal lamp.' },
          { id: 'l11', speaker: 'mara', text: "We've got you. Oz, grab the other side. On three." },
          { id: 'l12', speaker: 'oz',   text: 'One... two... three!' },
          { id: 'l13', speaker: 'nar',  text: 'The lamp flickers back on, and for the first time in twenty years, the lighthouse shines steady.' },
        ],
        choices: [] },
      wait: { title: 'Morning', bg: 'linear-gradient(180deg,#5b6b7c,#1d2630)',
        lines: [
          { id: 'l14', speaker: 'nar', text: 'The coast guard arrives at dawn. They bring the harbor master back cold, but alive.' },
          { id: 'l15', speaker: 'oz',  text: "See? Sometimes the brave thing is knowing who to call." },
          { id: 'l16', speaker: 'mara', text: "...Next time, we're rowing." },
        ],
        choices: [] },
    },
  };
}

// ---------------------------------------------------------------- state
const S = {
  story: store.get('cv.story', null) || sampleStory(),
  packId: store.get('cv.pack', null),
  settings: Object.assign({ auto: false, tts: true }, store.get('cv.settings', {})),
  tab: 'play',
  editScene: null,
  packs: [],
};
const saveStory = () => store.set('cv.story', S.story);
const saveSettings = () => store.set('cv.settings', S.settings);
const allLines = () => Object.entries(S.story.scenes).flatMap(([sid, sc]) => sc.lines.map(l => ({ ...l, sid })));
const charOf = id => S.story.characters[id] || { name: id || '???', color: '#ccc', voice: {} };

async function refreshPacks() {
  S.packs = await db.packs();
  if (!S.packs.length) {
    const p = { id: uid('p_'), name: 'My Dubs', author: '', license: 'CC-BY-4.0', credits: '', created: Date.now() };
    await db.putPack(p); S.packs = [p];
  }
  if (!S.packs.find(p => p.id === S.packId)) { S.packId = S.packs[0].id; store.set('cv.pack', S.packId); }
}
const activePack = () => S.packs.find(p => p.id === S.packId);

// ---------------------------------------------------------------- audio: playback + TTS
const audio = new Audio();
let audioURL = null;
let voices = [];
const loadVoices = () => { voices = speechSynthesis?.getVoices?.() || []; };
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

let speakToken = 0;
function stopAll() {
  speakToken++;
  audio.pause(); audio.onended = null;
  if (audioURL) { URL.revokeObjectURL(audioURL); audioURL = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
const isAI = v => v && (v.engine === 'kokoro' || v.engine === 'piper');

function playBlob(blob, t, kind) {
  return new Promise(resolve => {
    if (t !== speakToken) return resolve('stopped');
    audioURL = URL.createObjectURL(blob);
    audio.src = audioURL;
    audio.onended = () => resolve(kind);
    audio.onerror = () => resolve('error');
    audio.play().catch(() => resolve('blocked'));
  });
}

/** Speak text with a character voice spec (AI engine or browser robot voice). */
async function speakWith(v = {}, text, t = (stopAll(), speakToken)) {
  if (isAI(v)) {
    try {
      const blob = await Voices.speak(v, text);
      return playBlob(blob, t, 'ai');
    } catch (e) { if (t === speakToken) toast('AI voice failed: ' + e.message); }
  }
  if (t !== speakToken || !('speechSynthesis' in window)) return 'none';
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = v.pitch ?? 1; u.rate = v.rate ?? 1;
    const match = voices.find(x => x.name === v.name);
    if (match) u.voice = match;
    u.onend = u.onerror = () => resolve('tts');
    speechSynthesis.speak(u);
  });
}

/** Plays the dub for a line, else the character's AI/robot voice. Resolves when finished or stopped. */
async function speakLine(line, packId = S.packId) {
  stopAll(); const t = speakToken;
  const clip = packId ? await db.clip(packId, line.id) : null;
  if (t !== speakToken) return 'stopped';
  if (clip) return playBlob(clip.blob, t, 'dub');
  if (!S.settings.tts) return 'none';
  return speakWith(charOf(line.speaker).voice, line.text, t);
}

/** Warm up the AI voice for an upcoming line so it plays instantly. */
async function prefetch(line) {
  if (!line || !S.settings.tts) return;
  const v = charOf(line.speaker).voice;
  if (!isAI(v) || await db.clip(S.packId, line.id)) return;
  Voices.speak(v, line.text).catch(() => {});
}

// download indicator for one-time model downloads
(() => {
  const el = document.getElementById('dl'); let hide;
  Voices.onProgress(m => {
    const pct = m.total ? Math.min(100, Math.round(100 * m.loaded / m.total)) : 0;
    el.hidden = false;
    el.firstChild.textContent = `${m.label} — ${pct}% of ${(m.total / 1048576).toFixed(0)} MB`;
    el.lastChild.style.width = pct + '%';
    clearTimeout(hide); if (pct >= 100) hide = setTimeout(() => { el.hidden = true; }, 1200);
  });
})();

// ---------------------------------------------------------------- recording
const REC_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
let micStream = null;
async function getMic() {
  if (micStream && micStream.active) return micStream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone needs HTTPS (or localhost).');
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  return micStream;
}
function releaseMic() { micStream?.getTracks().forEach(t => t.stop()); micStream = null; }

class Recorder {
  async start() {
    const stream = await getMic();
    const mimeType = REC_TYPES.find(t => window.MediaRecorder?.isTypeSupported?.(t));
    this.chunks = [];
    this.mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.mr.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.done = new Promise(res => { this.mr.onstop = () => res(new Blob(this.chunks, { type: this.mr.mimeType || mimeType || 'audio/webm' })); });
    this.mr.start();
  }
  stop() { if (this.mr?.state === 'recording') this.mr.stop(); return this.done; }
  get active() { return this.mr?.state === 'recording'; }
}

async function saveClip(lineId, blob) {
  await db.putClip(S.packId, lineId, { blob, mime: blob.type, at: Date.now() });
  navigator.storage?.persist?.().catch(() => {});
}

// ---------------------------------------------------------------- PLAY tab
const play = { scene: null, i: 0, started: false, token: 0 };

function renderPlay() {
  const sc = S.story.scenes[play.scene];
  const pack = activePack();
  const bar = h('div', { class: 'toolbar' },
    h('label', {}, h('input', { type: 'checkbox', checked: S.settings.auto, onchange: e => { S.settings.auto = e.target.checked; saveSettings(); } }), 'Auto-advance'),
    h('label', {}, h('input', { type: 'checkbox', checked: S.settings.tts, onchange: e => { S.settings.tts = e.target.checked; saveSettings(); } }), 'AI/robot voices for undubbed lines'),
    h('span', { class: 'muted' }, 'Voice pack: ', h('b', {}, pack?.name || '—')),
    h('button', { onclick: () => { stopAll(); play.started = false; renderPlay(); } }, '⟲ Restart'),
  );

  const stage = h('div', { class: 'stage', style: `background:${sc?.bg || '#111'}` });
  if (!play.started || !sc) {
    stage.style.background = S.story.scenes[S.story.start]?.bg || '#111';
    stage.append(h('div', { class: 'start-card' },
      h('h2', {}, S.story.title || 'Untitled'),
      h('p', { class: 'muted' }, `${Object.keys(S.story.scenes).length} scenes · ${allLines().length} lines`),
      h('button', { class: 'primary', onclick: () => { play.started = true; goScene(S.story.start); } }, '▶ Start'),
    ));
    $view.replaceChildren(bar, stage);
    return;
  }

  stage.append(h('div', { class: 'scene-title' }, sc.title));
  const line = sc.lines[play.i];
  if (line) {
    const c = charOf(line.speaker);
    stage.append(h('div', { class: 'box', onclick: advance },
      h('div', { class: 'speaker', style: `color:${c.color}` }, c.name),
      h('div', { class: 'text' }, line.text),
      h('div', { class: 'hint' }, 'click / space to continue'),
    ));
  } else if (sc.choices.length) {
    stage.append(h('div', { class: 'choices' },
      sc.choices.map((ch, n) => h('button', { onclick: () => goScene(ch.to) }, `${n + 1}. ${ch.text}`))));
  } else {
    stage.append(h('div', { class: 'box' },
      h('div', { class: 'end' }, '— THE END —'),
      h('div', { style: 'text-align:center' }, h('button', { class: 'primary', onclick: () => { play.started = false; renderPlay(); } }, 'Play again'))));
  }
  $view.replaceChildren(bar, stage);
}

function goScene(id) {
  if (!S.story.scenes[id]) { toast(`Scene "${id}" doesn't exist`); return; }
  play.scene = id; play.i = 0; showLine();
}
async function showLine() {
  renderPlay();
  const line = S.story.scenes[play.scene]?.lines[play.i];
  if (!line) { stopAll(); return; }
  const t = ++play.token;
  const sc = S.story.scenes[play.scene];
  const next = sc.lines[play.i + 1] || (sc.choices.length === 1 ? S.story.scenes[sc.choices[0].to]?.lines[0] : null);
  const speaking = speakLine(line);
  prefetch(next);
  const how = await speaking;
  if (how === 'blocked') toast('Click to allow audio');
  if (S.settings.auto && t === play.token && S.tab === 'play' && how !== 'blocked') {
    setTimeout(() => { if (t === play.token) advance(); }, how === 'none' ? 1800 : 400);
  }
}
function advance() {
  const sc = S.story.scenes[play.scene];
  if (!sc || play.i >= sc.lines.length) return;
  play.i++; showLine();
}

document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select')) return;
  if (S.tab === 'play' && play.started) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); }
    const n = parseInt(e.key, 10);
    const sc = S.story.scenes[play.scene];
    if (n && sc && play.i >= sc.lines.length && sc.choices[n - 1]) goScene(sc.choices[n - 1].to);
  }
});

// ---------------------------------------------------------------- DUB tab
async function renderDub() {
  const done = await db.clipKeys(S.packId);
  const lines = allLines();
  const count = lines.filter(l => done.has(l.id)).length;

  const head = h('div', { class: 'toolbar' },
    h('span', {}, 'Recording into ', h('b', {}, activePack()?.name), ` — ${count}/${lines.length} lines dubbed`),
    h('button', { class: 'primary', onclick: () => dubSession(lines.filter(l => !done.has(l.id))) }, '● Dub missing lines'),
    h('button', { onclick: () => dubSession(lines) }, 'Re-dub everything'),
  );
  const tip = h('p', { class: 'muted' }, 'Tip: in a dub session press R to record/stop, P to play back, → or Enter for the next line. Use headphones so the robot voice preview isn’t recorded.');

  const cards = Object.entries(S.story.scenes).map(([sid, sc]) => h('div', { class: 'card' },
    h('h3', {}, sc.title || sid,
      h('button', { onclick: () => dubSession(sc.lines.map(l => ({ ...l, sid }))) }, '● Dub this scene')),
    sc.lines.map(l => lineRow(l, done.has(l.id)))));

  $view.replaceChildren(head, tip, ...cards);
}

function lineRow(line, has) {
  const c = charOf(line.speaker);
  const fallback = isAI(c.voice) ? 'AI voice' : 'robot';
  const status = h('span', { class: 'status' + (has ? ' done' : isAI(c.voice) ? ' ai' : '') }, has ? '✓ dubbed' : fallback);
  const rec = new Recorder();
  const recBtn = h('button', { class: 'rec', title: 'Record', onclick: async () => {
    if (rec.active) {
      const blob = await rec.stop(); recBtn.classList.remove('recording'); recBtn.textContent = '● Rec';
      await saveClip(line.id, blob); status.textContent = '✓ dubbed'; status.className = 'status done';
    } else {
      try { stopAll(); await rec.start(); recBtn.classList.add('recording'); recBtn.textContent = '■ Stop'; }
      catch (e) { toast(e.message || 'Mic unavailable'); }
    }
  } }, '● Rec');
  return h('div', { class: 'line-row' },
    h('div', { class: 'who', style: `color:${c.color}` }, c.name),
    h('div', {}, line.text),
    h('div', { class: 'btns' }, status, recBtn,
      h('button', { title: 'Play', onclick: () => speakLine(line) }, '▶'),
      h('button', { class: 'danger', title: 'Delete dub', onclick: async () => {
        await db.delClip(S.packId, line.id); status.textContent = fallback; status.className = 'status' + (isAI(c.voice) ? ' ai' : '');
      } }, '✕')));
}

/** Full-screen, keyboard-driven session that walks through a list of lines. */
function dubSession(lines) {
  if (!lines.length) { toast('Nothing to dub here — all done!'); return; }
  let i = 0; const rec = new Recorder();
  const modal = h('div', { class: 'modal' });
  const close = () => { if (rec.active) rec.stop(); stopAll(); releaseMic(); modal.remove(); document.removeEventListener('keydown', keys); renderDub(); };

  async function toggleRec() {
    if (rec.active) { const blob = await rec.stop(); await saveClip(lines[i].id, blob); draw('saved'); speakLine(lines[i]); }
    else { try { stopAll(); await rec.start(); draw('rec'); } catch (e) { toast(e.message || 'Mic unavailable'); } }
  }
  const go = d => { if (rec.active) return; i = Math.max(0, Math.min(lines.length - 1, i + d)); draw(); };

  async function draw(state = '') {
    const l = lines[i]; const c = charOf(l.speaker);
    const has = state === 'saved' || (await db.clip(S.packId, l.id));
    modal.replaceChildren(h('div', { class: 'sheet' },
      h('div', { class: 'row' },
        h('span', { class: 'muted' }, `Line ${i + 1} of ${lines.length} · ${S.story.scenes[l.sid]?.title || ''}`),
        h('button', { onclick: close }, 'Close ✕')),
      h('div', { class: 'speaker', style: `color:${c.color};font-size:18px;margin-top:10px` }, c.name),
      h('div', { class: 'big' }, l.text),
      h('div', { class: 'row' },
        h('button', { onclick: () => go(-1) }, '← Prev'),
        h('div', { style: 'display:flex;gap:8px' },
          h('button', { class: state === 'rec' ? 'recording' : 'rec', onclick: toggleRec }, state === 'rec' ? '■ Stop (R)' : '● Record (R)'),
          h('button', { onclick: () => speakLine(l) }, has ? '▶ Play take (P)' : '▶ Hear robot (P)')),
        h('button', { class: 'primary', onclick: () => (i === lines.length - 1 ? close() : go(1)) }, i === lines.length - 1 ? 'Finish ✓' : 'Next →')),
      h('p', { class: 'muted', style: 'margin:12px 0 0' }, has ? '✓ Saved. Record again to replace it.' : 'Not dubbed yet.')));
  }
  function keys(e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'r') toggleRec();
    else if (k === 'p') speakLine(lines[i]);
    else if (k === 'arrowright' || k === 'enter') { e.preventDefault(); i === lines.length - 1 ? close() : go(1); }
    else if (k === 'arrowleft') go(-1);
    else if (k === 'escape') close();
  }
  document.addEventListener('keydown', keys);
  document.body.append(modal); draw();
}

// ---------------------------------------------------------------- EDIT tab
function renderEdit() {
  const st = S.story;
  if (!st.scenes[S.editScene]) S.editScene = st.start;
  const ids = Object.keys(st.scenes);
  const commit = () => { saveStory(); };

  const left = h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'field' }, h('label', {}, 'Story title'),
        h('input', { type: 'text', value: st.title, oninput: e => { st.title = e.target.value; commit(); } })),
      h('div', { class: 'field' }, h('label', {}, 'Starting scene'),
        h('select', { onchange: e => { st.start = e.target.value; commit(); } },
          ids.map(id => h('option', { value: id, selected: id === st.start }, st.scenes[id].title || id)))),
      h('h3', {}, 'Scenes', h('button', { onclick: () => {
        const id = uid('s_'); st.scenes[id] = { title: 'New scene', bg: '#222', lines: [], choices: [] };
        S.editScene = id; commit(); renderEdit();
      } }, '+ Scene')),
      h('div', { class: 'scene-list' }, ids.map(id => h('button', {
        class: id === S.editScene ? 'sel' : '', onclick: () => { S.editScene = id; renderEdit(); } },
        (id === st.start ? '★ ' : '') + (st.scenes[id].title || id)))),
    ),
    charactersCard(),
    h('div', { class: 'card' },
      h('h3', {}, 'Story file'),
      h('div', { class: 'toolbar' },
        h('button', { onclick: () => download(slug(st.title) + '.story.json', JSON.stringify({ format: STORY_FORMAT, version: 1, story: st }, null, 2)) }, '⬇ Export'),
        h('button', { onclick: importStory }, '⬆ Import'),
        h('button', { class: 'danger', onclick: () => { if (confirm('Replace your story with the sample? (Dubs stay saved.)')) { S.story = sampleStory(); commit(); renderEdit(); } } }, 'Load sample'))),
  );

  $view.replaceChildren(h('div', { class: 'edit-grid' }, left, sceneEditor(S.editScene)));
}

function sceneEditor(id) {
  const st = S.story; const sc = st.scenes[id];
  const commit = () => saveStory();
  const charOpts = sel => Object.entries(st.characters).map(([cid, c]) => h('option', { value: cid, selected: cid === sel }, c.name));
  const sceneOpts = sel => Object.keys(st.scenes).map(sid => h('option', { value: sid, selected: sid === sel }, st.scenes[sid].title || sid));

  return h('div', { class: 'card' },
    h('h3', {}, 'Scene', h('button', { class: 'danger', onclick: () => {
      if (Object.keys(st.scenes).length < 2) return toast('A story needs at least one scene');
      if (!confirm('Delete this scene?')) return;
      delete st.scenes[id];
      if (st.start === id) st.start = Object.keys(st.scenes)[0];
      commit(); renderEdit();
    } }, 'Delete scene')),
    h('div', { class: 'field' }, h('label', {}, 'Title'),
      h('input', { type: 'text', value: sc.title, oninput: e => { sc.title = e.target.value; commit(); } })),
    h('div', { class: 'field' }, h('label', {}, 'Background (any CSS colour, gradient, or url(...) to an image)'),
      h('input', { type: 'text', value: sc.bg, oninput: e => { sc.bg = e.target.value; commit(); } })),

    h('h3', {}, 'Lines', h('button', { onclick: () => {
      sc.lines.push({ id: uid('l_'), speaker: Object.keys(st.characters)[0], text: '' }); commit(); renderEdit();
    } }, '+ Line')),
    sc.lines.map((l, n) => h('div', { class: 'edit-line' },
      h('select', { onchange: e => { l.speaker = e.target.value; commit(); } }, charOpts(l.speaker)),
      h('textarea', { value: l.text, oninput: e => { l.text = e.target.value; commit(); } }),
      h('div', { class: 'btns', style: 'display:flex;gap:4px' },
        h('button', { title: 'Move up', onclick: () => { if (n) { [sc.lines[n - 1], sc.lines[n]] = [sc.lines[n], sc.lines[n - 1]]; commit(); renderEdit(); } } }, '↑'),
        h('button', { class: 'danger', title: 'Delete', onclick: () => { sc.lines.splice(n, 1); commit(); renderEdit(); } }, '✕')))),

    h('h3', {}, 'Choices (none = ending)', h('button', { onclick: () => {
      sc.choices.push({ text: 'New choice', to: id }); commit(); renderEdit();
    } }, '+ Choice')),
    sc.choices.map((c, n) => h('div', { class: 'edit-choice' },
      h('input', { type: 'text', value: c.text, oninput: e => { c.text = e.target.value; commit(); } }),
      h('select', { onchange: e => { c.to = e.target.value; commit(); } }, sceneOpts(c.to)),
      h('button', { class: 'danger', onclick: () => { sc.choices.splice(n, 1); commit(); renderEdit(); } }, '✕'))),
  );
}

function charactersCard() {
  const st = S.story; const commit = () => saveStory();
  const voiceSel = c => {
    const lic = Voices.license(c.voice);
    return h('div', { class: 'r' },
      h('span', { style: 'flex:1;min-width:0' }, Voices.labelOf(c.voice), ' ',
        isAI(c.voice) ? h('span', { class: 'tag' + (lic.ok ? '' : ' warn') }, lic.tag) : null),
      h('button', { onclick: () => openVoicePicker(c) }, '🎙 Choose voice'));
  };
  return h('div', { class: 'card' },
    h('h3', {}, 'Characters', h('button', { onclick: () => {
      st.characters[uid('c_')] = { name: 'New character', color: '#c9a0ff', voice: { pitch: 1, rate: 1, name: '' } }; commit(); renderEdit();
    } }, '+ Character')),
    Object.entries(st.characters).map(([cid, c]) => {
      c.voice ||= { pitch: 1, rate: 1, name: '' };
      return h('div', { class: 'char-row' },
        h('div', { class: 'r' },
          h('input', { type: 'color', value: c.color, oninput: e => { c.color = e.target.value; commit(); } }),
          h('input', { type: 'text', value: c.name, oninput: e => { c.name = e.target.value; commit(); } }),
          h('button', { class: 'danger', onclick: () => {
            if (allLines().some(l => l.speaker === cid)) return toast('This character still has lines');
            delete st.characters[cid]; commit(); renderEdit();
          } }, '✕')),
        voiceSel(c),
        h('div', { class: 'r muted' }, 'pitch',
          h('input', { type: 'range', min: 0.1, max: 2, step: 0.1, value: c.voice.pitch, oninput: e => { c.voice.pitch = +e.target.value; commit(); } }),
          'speed',
          h('input', { type: 'range', min: 0.5, max: 1.6, step: 0.05, value: c.voice.rate, oninput: e => { c.voice.rate = +e.target.value; commit(); } }),
          h('button', { onclick: () => speakWith(c.voice, `Hi, I'm ${c.name}.`) }, '▶')));
    }));
}

// ---------------------------------------------------------------- voice picker (robot / Kokoro / Piper / custom)
function openVoicePicker(c, onSave) {
  const cur = { ...(c.voice || {}) }; cur.engine ||= 'robot';
  let sel = { ...cur };
  let tab = cur.engine === 'piper' && String(cur.id).startsWith('custom-') ? 'custom' : cur.engine;
  const f = { lang: cur.engine === 'piper' && cur.lang ? cur.lang : 'en_US', q: '' };
  let sample = `Hi, I'm ${c.name}. This is how I sound in the story.`;
  const keep = () => ({ rate: cur.rate ?? 1, pitch: cur.pitch ?? 1 });
  const modal = h('div', { class: 'modal' });
  const sheet = h('div', { class: 'sheet wide' });
  modal.append(sheet); document.body.append(modal);
  const close = () => { stopAll(); modal.remove(); };
  const preview = spec => speakWith({ ...spec, ...keep() }, sample);
  const pick = spec => { sel = spec; draw(); };
  const isSel = (engine, id, url) => sel.engine === engine && sel.id === id && (!url || sel.url === url);

  async function body() {
    if (tab === 'robot') {
      return h('div', {},
        h('p', { class: 'muted' }, 'Built into your browser. Instant, no download, but sounds robotic. Voices differ per device.'),
        h('div', { class: 'vp-row' + (sel.engine === 'robot' && !sel.name ? ' sel' : '') },
          h('span', { class: 'nm' }, 'Default browser voice'),
          h('button', { onclick: () => preview({ engine: 'robot' }) }, '▶'),
          h('button', { onclick: () => pick({ engine: 'robot', name: '' }) }, 'Select')),
        voices.map(v => h('div', { class: 'vp-row' + (sel.engine === 'robot' && sel.name === v.name ? ' sel' : '') },
          h('span', { class: 'nm' }, v.name, ' ', h('span', { class: 'meta' }, v.lang)),
          h('button', { onclick: () => preview({ engine: 'robot', name: v.name }) }, '▶'),
          h('button', { onclick: () => pick({ engine: 'robot', name: v.name }) }, 'Select'))));
    }
    if (tab === 'kokoro') {
      return h('div', {},
        h('p', { class: 'muted' }, '28 natural-sounding English voices (US + UK). One ~92 MB download the first time, then works offline. Runs on your device; first line can take a few seconds. License: Apache-2.0.'),
        Voices.KOKORO.map(v => h('div', { class: 'vp-row' + (isSel('kokoro', v.id) ? ' sel' : '') },
          h('span', { class: 'nm' }, v.name, ' ', h('span', { class: 'meta' }, `${v.gender === 'F' ? 'female' : 'male'} · ${v.accent} English`)),
          h('span', { class: 'tag' + (/^[AB]/.test(v.grade) ? ' good' : '') }, 'quality ' + v.grade),
          h('button', { onclick: () => preview({ engine: 'kokoro', id: v.id }) }, '▶'),
          h('button', { onclick: () => pick({ engine: 'kokoro', id: v.id }) }, 'Select'))));
    }
    if (tab === 'piper') {
      let cat;
      try { cat = await Voices.piperCatalog(); } catch (e) { return h('p', {}, e.message, ' (needs internet the first time)'); }
      const langs = [...new Map(cat.map(v => [v.lang, v.langName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
      const q = f.q.toLowerCase();
      const list = cat.filter(v => (f.lang === '*' || v.lang === f.lang) && (!q || (v.key + v.langName).toLowerCase().includes(q)));
      const totalSpk = cat.reduce((n, v) => n + v.speakers, 0);
      return h('div', {},
        h('p', { class: 'muted' }, `${cat.length} voice models, ${totalSpk.toLocaleString()} speakers, ${langs.length} languages. Each model downloads once (20–130 MB) when first used. Multi-speaker models hold many different voices: pick a speaker number.`),
        h('div', { class: 'toolbar' },
          h('select', { onchange: e => { f.lang = e.target.value; draw(); } },
            h('option', { value: '*', selected: f.lang === '*' }, 'All languages'),
            langs.map(([code, name]) => h('option', { value: code, selected: code === f.lang }, name))),
          h('input', { type: 'text', placeholder: 'Search…', value: f.q, oninput: e => { f.q = e.target.value; clearTimeout(f.t); f.t = setTimeout(draw, 250); } })),
        list.map(v => {
          const on = isSel('piper', v.key);
          const lic = Voices.license({ engine: 'piper', id: v.key });
          const spec = (speaker = on ? sel.speaker | 0 : 0) => ({ engine: 'piper', id: v.key, url: v.url, label: `${v.name} (${v.quality})`,
            speakers: v.speakers, speaker, lang: v.lang });
          return h('div', { class: 'vp-row' + (on ? ' sel' : '') },
            h('span', { class: 'nm' }, v.name, ' ', h('span', { class: 'meta' }, `${v.langName} · ${v.quality} · ${(v.size / 1048576).toFixed(0)} MB`)),
            v.speakers > 1 ? h('span', { class: 'tag good' }, `${v.speakers} speakers`) : null,
            h('a', { class: 'tag' + (lic.ok ? '' : ' warn'), href: v.card, target: '_blank', rel: 'noopener' }, lic.tag),
            on && v.speakers > 1 ? h('span', { class: 'meta' }, 'speaker ',
              h('input', { type: 'number', min: 0, max: v.speakers - 1, value: sel.speaker | 0, style: 'width:72px',
                onchange: e => { sel.speaker = Math.max(0, Math.min(v.speakers - 1, e.target.value | 0)); draw(); } }),
              v.speakerNames[sel.speaker | 0] ? ` (${v.speakerNames[sel.speaker | 0]})` : '',
              h('button', { title: 'Random speaker', onclick: () => { sel.speaker = Math.floor(Math.random() * v.speakers); draw(); preview(sel); } }, '🎲')) : null,
            h('button', { onclick: () => preview(spec()) }, '▶'),
            on ? null : h('button', { onclick: () => pick(spec(0)) }, 'Select'));
        }));
    }
    // custom
    const files = { onnx: null, json: null };
    const url = h('input', { type: 'text', placeholder: 'https://huggingface.co/…/voice.onnx' });
    return h('div', {},
      h('p', { class: 'muted' }, 'Load any Piper-format voice model: community character voices, fine-tunes, or a voice you trained yourself. You need two files: the model (.onnx) and its config (.onnx.json). They stay in this browser.'),
      h('div', { class: 'toolbar' },
        h('label', {}, 'Model ', h('input', { type: 'file', accept: '.onnx', onchange: e => { files.onnx = e.target.files[0]; } })),
        h('label', {}, 'Config ', h('input', { type: 'file', accept: '.json', onchange: e => { files.json = e.target.files[0]; } })),
        h('button', { class: 'primary', onclick: async () => {
          if (!files.onnx || !files.json) return toast('Choose both the .onnx and the .onnx.json file');
          try { const e = await Voices.addCustomFiles(files.onnx, files.json); pick(customSpec(e)); toast('Voice added'); } catch (err) { toast(err.message); }
        } }, 'Add files')),
      h('div', { class: 'toolbar' }, url,
        h('button', { onclick: async () => {
          try { const e = await Voices.addCustomUrl(url.value); pick(customSpec(e)); toast('Voice added'); } catch (err) { toast(err.message); }
        } }, 'Add from link')),
      Voices.customs().map(e => {
        const on = isSel('piper', e.key);
        return h('div', { class: 'vp-row' + (on ? ' sel' : '') },
          h('span', { class: 'nm' }, e.name, ' ', h('span', { class: 'meta' }, `${e.lang} · ${e.local ? 'file' : 'link'}${e.size ? ` · ${(e.size / 1048576).toFixed(0)} MB` : ''}`)),
          e.speakers > 1 ? h('span', { class: 'tag good' }, `${e.speakers} speakers`) : null,
          on && e.speakers > 1 ? h('input', { type: 'number', min: 0, max: e.speakers - 1, value: sel.speaker | 0, style: 'width:72px',
            onchange: ev => { sel.speaker = Math.max(0, Math.min(e.speakers - 1, ev.target.value | 0)); } }) : null,
          h('button', { onclick: () => preview(on ? sel : customSpec(e)) }, '▶'),
          on ? null : h('button', { onclick: () => pick(customSpec(e)) }, 'Select'),
          h('button', { class: 'danger', onclick: async () => { await Voices.removeCustom(e.key); draw(); } }, '✕'));
      }));
  }
  const customSpec = e => ({ engine: 'piper', id: e.key, url: e.url, label: e.name, speakers: e.speakers, speaker: 0, lang: e.lang, local: true });

  async function draw() {
    const scroll = sheet.querySelector('.vp-body')?.scrollTop || 0;
    const content = await body();
    sheet.replaceChildren(
      h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, `Voice for ${c.name}`), h('button', { onclick: close }, 'Close ✕')),
      h('div', { class: 'vp-tabs' }, [['robot', 'Browser robot'], ['kokoro', 'Kokoro AI (28)'], ['piper', 'Piper AI (2,700+)'], ['custom', 'Custom models']]
        .map(([k, label]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; draw(); } }, label))),
      h('div', { class: 'vp-body' }, content),
      h('div', { class: 'vp-foot' },
        h('span', {}, 'Selected: ', h('b', {}, Voices.labelOf(sel))),
        h('input', { type: 'text', value: sample, oninput: e => { sample = e.target.value; } }),
        h('button', { onclick: () => preview(sel) }, '▶ Preview'),
        h('button', { class: 'primary', onclick: () => {
          c.voice = { ...sel, ...keep() }; close();
          if (onSave) onSave(); else { saveStory(); renderEdit(); }
        } }, 'Use this voice')));
    const b = sheet.querySelector('.vp-body'); if (b) b.scrollTop = scroll;
  }
  draw();
}

// Export format ids. Import also accepts the pre-rename ids.
const STORY_FORMAT = 'dubdojo-story', STORY_FORMATS = [STORY_FORMAT, 'choicer-voicer-story'];
const PACK_FORMAT = 'dubdojo-pack-audio', PACK_FORMATS = [PACK_FORMAT, 'choicer-voicer-pack'];

async function importStory() {
  const f = await pickFile('.json,application/json'); if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.format && !STORY_FORMATS.includes(data.format)) throw new Error('not a story file');
    const st = data.story || data;
    if (!st.scenes || !st.characters || !st.start) throw new Error('not a story file');
    for (const sc of Object.values(st.scenes)) { sc.lines ||= []; sc.choices ||= []; sc.lines.forEach(l => { l.id ||= uid('l_'); }); }
    S.story = st; saveStory(); S.editScene = null; renderEdit(); toast('Story imported');
  } catch (e) { toast('Import failed: ' + e.message); }
}

// ---------------------------------------------------------------- PACKS tab
const LICENSES = ['CC-BY-4.0', 'CC0-1.0', 'CC-BY-SA-4.0', 'Personal / research use only', 'Mixed: see credits', 'All rights reserved (private)'];

async function voiceLibraryCard() {
  const list = await Voices.downloaded();
  const total = list.reduce((n, d) => n + d.size, 0);
  return h('div', { class: 'card' },
    h('h3', {}, 'Downloaded AI voices', list.length ? h('button', { class: 'danger', onclick: async () => {
      if (!confirm('Delete all downloaded voice models? They re-download when needed.')) return;
      for (const d of list) await Voices.forget(d.url);
      renderPacks();
    } }, 'Delete all') : null),
    h('p', { class: 'muted' }, list.length
      ? `${list.length} model(s), ${(total / 1048576).toFixed(0)} MB on this device. They work offline once downloaded.`
      : 'None yet. Pick an AI voice for a character in Edit → Characters; it downloads the first time it speaks.'),
    list.map(d => h('div', { class: 'pack-row' },
      h('span', {}, d.name, ' ', h('span', { class: 'muted' }, `${(d.size / 1048576).toFixed(0)} MB`)),
      h('button', { class: 'danger', onclick: async () => { await Voices.forget(d.url); renderPacks(); } }, '✕'))));
}

/** Bake every line into a voice pack using each character's AI voice. */
function generateAIPack() {
  const chars = Object.entries(S.story.characters);
  const aiChars = chars.filter(([, c]) => isAI(c.voice));
  const modal = h('div', { class: 'modal' });
  const sheet = h('div', { class: 'sheet' }); modal.append(sheet); document.body.append(modal);
  let mode = 'fill', name = `${S.story.title} (AI cast)`, cancelled = false, running = false;
  const close = () => { cancelled = true; modal.remove(); renderPacks(); };

  function draw() {
    sheet.replaceChildren(
      h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, '✨ Generate AI voice pack'), h('button', { onclick: close }, running ? 'Stop' : 'Close ✕')),
      h('p', { class: 'muted' }, 'Every line is spoken by its character’s AI voice and saved as a clip, so playback is instant and the pack can be exported as a mod.'),
      chars.map(([, c]) => h('div', { class: 'pack-row' },
        h('span', { style: `color:${c.color};font-weight:600` }, c.name),
        h('span', { class: isAI(c.voice) ? '' : 'muted' }, isAI(c.voice) ? Voices.labelOf(c.voice) : 'robot voice: will be skipped'))),
      aiChars.length ? null : h('p', {}, '⚠ No character has an AI voice yet. Go to Edit → Characters → 🎙 Choose voice.'),
      h('div', { class: 'field', style: 'margin-top:10px' },
        h('label', {}, h('input', { type: 'radio', name: 'm', checked: mode === 'fill', onchange: () => { mode = 'fill'; } }), ` Fill lines not yet dubbed in “${activePack()?.name}” (keeps your recordings)`),
        h('label', {}, h('input', { type: 'radio', name: 'm', checked: mode === 'new', onchange: () => { mode = 'new'; } }), ' Create a new pack: ',
          h('input', { type: 'text', value: name, oninput: e => { name = e.target.value; } }))),
      h('div', { class: 'row' }, h('span', {}),
        h('button', { class: 'primary', disabled: !aiChars.length, onclick: run }, 'Generate')));
  }

  async function run() {
    running = true;
    let pack = activePack();
    if (mode === 'new') {
      const lic = aiChars.every(([, c]) => Voices.license(c.voice).ok) ? 'CC-BY-4.0' : 'Personal / research use only';
      pack = { id: uid('p_'), name: name || 'AI cast', author: 'AI voices', license: lic, created: Date.now(),
        credits: aiChars.map(([, c]) => `${c.name}: ${Voices.labelOf(c.voice)} (${Voices.license(c.voice).tag})`).join('\n') };
      await db.putPack(pack); S.packId = pack.id; store.set('cv.pack', pack.id); await refreshPacks();
    }
    const done = await db.clipKeys(pack.id);
    const todo = allLines().filter(l => isAI(charOf(l.speaker).voice) && !(mode === 'fill' && done.has(l.id)));
    const msg = h('p', {}, `0 / ${todo.length}`); const bar = h('div', { class: 'bar' }, h('i'));
    sheet.replaceChildren(h('div', { class: 'row' }, h('h3', { style: 'margin:0' }, `Generating into “${pack.name}”`), h('button', { onclick: close }, 'Stop')),
      bar, msg, h('p', { class: 'muted' }, 'The first line waits for the model download. Keep this tab open.'));
    let ok = 0, fail = 0;
    for (const [n, l] of todo.entries()) {
      if (cancelled) return;
      msg.textContent = `${n + 1} / ${todo.length}: ${charOf(l.speaker).name}: “${l.text.slice(0, 60)}${l.text.length > 60 ? '…' : ''}”`;
      try {
        const blob = await Voices.speak(charOf(l.speaker).voice, l.text);
        await db.putClip(pack.id, l.id, { blob, mime: 'audio/wav', ai: true, at: Date.now() }); ok++;
      } catch (e) { fail++; console.warn(e); }
      bar.firstChild.style.width = `${Math.round(100 * (n + 1) / todo.length)}%`;
    }
    running = false;
    navigator.storage?.persist?.().catch(() => {});
    sheet.replaceChildren(h('h3', {}, '✓ Done'),
      h('p', {}, `${ok} lines voiced${fail ? `, ${fail} failed` : ''}. “${pack.name}” is now the active pack.`),
      h('div', { class: 'row' }, h('button', { onclick: close }, 'Close'),
        h('button', { class: 'primary', onclick: () => { modal.remove(); setTab('play'); } }, '▶ Play it')));
  }
  draw();
}

async function renderPacks() {
  await refreshPacks();
  const total = allLines().length;
  const rows = await Promise.all(S.packs.map(async p => {
    const n = (await db.clipKeys(p.id)).size;
    return h('div', { class: 'pack-row' },
      h('div', {}, h('b', {}, p.name), p.id === S.packId ? h('span', { class: 'badge' }, 'active') : null,
        h('div', { class: 'muted' }, `${n} clips · ${total ? Math.round(100 * Math.min(n, total) / total) : 0}% of this story · ${p.license || 'no license'}${p.author ? ' · by ' + p.author : ''}`)),
      h('div', { class: 'btns' },
        p.id !== S.packId ? h('button', { onclick: () => { S.packId = p.id; store.set('cv.pack', p.id); renderPacks(); } }, 'Use') : null,
        h('button', { onclick: () => editPackMeta(p) }, 'Details'),
        h('button', { onclick: () => exportPack(p) }, '⬇ Export'),
        h('button', { class: 'danger', onclick: async () => {
          if (!confirm(`Delete "${p.name}" and all its recordings?`)) return;
          await db.delPack(p.id); renderPacks();
        } }, '✕')));
  }));

  const est = await navigator.storage?.estimate?.().catch(() => null);
  $view.replaceChildren(
    h('div', { class: 'card' },
      h('h3', {}, 'Voice packs',
        h('div', { class: 'toolbar', style: 'margin:0' },
          h('button', { onclick: async () => {
            const name = prompt('Name for the new voice pack:', 'New pack'); if (!name) return;
            const p = { id: uid('p_'), name, author: '', license: 'CC-BY-4.0', credits: '', created: Date.now() };
            await db.putPack(p); S.packId = p.id; store.set('cv.pack', p.id); renderPacks();
          } }, '+ New pack'),
          h('button', { onclick: generateAIPack }, '✨ Generate AI voice pack'),
          h('button', { class: 'primary', onclick: importPack }, '⬆ Import pack'))),
      h('p', { class: 'muted' }, 'A voice pack is a set of recordings for one story. Switch packs to hear different casts. Export packs to back them up or share them as mods. AI packs are made from the voices you pick for each character in Edit → Characters.'),
      rows),
    await voiceLibraryCard(),
    h('div', { class: 'card muted' },
      h('h3', {}, 'Good to know'),
      h('p', {}, 'Recordings are stored only in this browser. Safari may delete them after about a week without a visit, so export packs you want to keep.'),
      h('p', {}, 'Only share packs that use your own voice, voices of people who agreed, or clips licensed CC0 or CC-BY (credit them under Details). Don’t share voice clones of real people.'),
      est ? h('p', {}, `Storage used: ${(est.usage / 1048576).toFixed(1)} MB of about ${(est.quota / 1073741824).toFixed(1)} GB available.`) : null),
  );
}

function editPackMeta(p) {
  const f = { name: p.name, author: p.author || '', license: p.license || LICENSES[0], credits: p.credits || '' };
  const modal = h('div', { class: 'modal' });
  const inp = (k, label) => h('div', { class: 'field' }, h('label', {}, label), h('input', { type: 'text', value: f[k], oninput: e => { f[k] = e.target.value; } }));
  modal.append(h('div', { class: 'sheet' },
    h('h3', {}, 'Pack details'),
    inp('name', 'Name'), inp('author', 'Author / cast'),
    h('div', { class: 'field' }, h('label', {}, 'License'),
      h('select', { onchange: e => { f.license = e.target.value; } }, LICENSES.map(l => h('option', { selected: l === f.license }, l)))),
    h('div', { class: 'field' }, h('label', {}, 'Credits (who voiced what, sources of any CC clips)'),
      h('textarea', { value: f.credits, oninput: e => { f.credits = e.target.value; } })),
    h('div', { class: 'row' },
      h('button', { onclick: () => modal.remove() }, 'Cancel'),
      h('button', { class: 'primary', onclick: async () => { Object.assign(p, f); await db.putPack(p); modal.remove(); renderPacks(); } }, 'Save'))));
  document.body.append(modal);
}

const blobToB64 = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); });
function b64ToBlob(b64, type) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
}

async function exportPack(p) {
  toast('Packing…');
  const keys = await db.clipKeys(p.id); const clips = {};
  for (const lineId of keys) {
    const c = await db.clip(p.id, lineId);
    if (c) clips[lineId] = { mime: c.mime || c.blob.type, data: await blobToB64(c.blob) };
  }
  const out = {
    format: PACK_FORMAT, version: 1,
    pack: { name: p.name, author: p.author, license: p.license, credits: p.credits },
    story: { title: S.story.title, lineIds: allLines().map(l => l.id) },
    clips,
  };
  download(`${slug(p.name)}.voicepack.json`, JSON.stringify(out));
}

async function importPack() {
  const f = await pickFile('.json,application/json'); if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!PACK_FORMATS.includes(data.format)) throw new Error('not a voice pack file');
    const p = { id: uid('p_'), name: String(data.pack?.name || 'Imported pack'), author: String(data.pack?.author || ''),
      license: String(data.pack?.license || ''), credits: String(data.pack?.credits || ''), created: Date.now() };
    await db.putPack(p);
    let n = 0, unplayable = 0;
    for (const [lineId, c] of Object.entries(data.clips || {})) {
      if (typeof c?.data !== 'string') continue;
      const mime = String(c.mime || 'audio/webm');
      if (!audio.canPlayType(mime.split(';')[0])) unplayable++;
      await db.putClip(p.id, lineId, { blob: b64ToBlob(c.data, mime), mime, at: Date.now() }); n++;
    }
    const known = new Set(allLines().map(l => l.id));
    const matched = Object.keys(data.clips || {}).filter(k => known.has(k)).length;
    S.packId = p.id; store.set('cv.pack', p.id);
    toast(`Imported ${n} clips (${matched} match this story)` + (unplayable ? ` — ${unplayable} may not play in this browser` : ''));
    if (data.story?.title && data.story.title !== S.story.title) toast(`Note: pack was made for "${data.story.title}"`);
    renderPacks();
  } catch (e) { toast('Import failed: ' + e.message); }
}

// ---------------------------------------------------------------- tabs + boot
const RENDER = { play: renderPlay, dub: renderDub, edit: renderEdit, packs: renderPacks };
function setTab(tab) {
  if (!RENDER[tab]) { toast('That section isn\'t available (it failed to load).'); return; }
  try { window.onTabLeave?.(); } catch (e) { console.error('onTabLeave failed', e); }
  S.tab = tab; stopAll();
  if (tab !== 'dub') releaseMic();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  RENDER[tab]();
}
document.getElementById('tabs').addEventListener('click', e => { const t = e.target.closest('button')?.dataset.tab; if (t) setTab(t); });

refreshPacks().then(() => setTab(RENDER.scenes ? 'scenes' : 'play')).catch(err => {
  $view.replaceChildren(h('p', {}, 'Could not open browser storage (private mode?). ', String(err)));
});
