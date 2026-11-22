/* DubDojo — the game: Home, Pack intro, Booth (one line at a time) and Results.
 * Loaded last. Reuses app.js helpers (h, toast, store, db, getMic, releaseMic, REC_TYPES, download, slug, navigate, ROUTES)
 * and the studio internals exposed by scenes.js as window.DubStudio (Mixer, players, scoring, drawSub, packs).
 * All pack and user text goes through h()/textContent; nothing is inserted as HTML.
 */
'use strict';
(() => {
const D = window.DubStudio;
const { fmt, clamp } = D;

// ---------------------------------------------------------------- constants
const STYLE_LABEL = { anime: 'Anime-style', animation: 'Animation', live: 'Live action', mine: 'My pack' };
const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const FEATURED = 's:morevna-government-agent';
const BEST_KEY = 'dd.best';
const PREROLL = 1.4;      // seconds of scene before the line when recording
const REC_LEAD = 0.25;    // recording starts this long before line.start
const REC_TAIL = 0.5;     // ...and stops this long after line.end
const MUTE_LEAD = 0.3;    // the original is muted from this long before line.start
const BELTS = [
  { min: 90, name: 'Black belt', color: '#14161c', edge: '#ffc857', tag: 'Dub master' },
  { min: 78, name: 'Brown belt', color: '#8b5a33', edge: '#5e3a1f', tag: 'Voice samurai' },
  { min: 65, name: 'Blue belt', color: '#3b82f6', edge: '#1d4ed8', tag: 'Sync specialist' },
  { min: 50, name: 'Green belt', color: '#22c55e', edge: '#15803d', tag: 'Rising star' },
  { min: 35, name: 'Yellow belt', color: '#facc15', edge: '#ca8a04', tag: 'Apprentice' },
  { min: 0, name: 'White belt', color: '#eef1f8', edge: '#aeb7cf', tag: 'First steps' },
];
const beltOf = s => BELTS.find(b => s >= b.min);
const cheer = s => (s >= 90 ? 'Perfect sync!' : s >= 75 ? 'Great take!' : s >= 60 ? 'Nice one' : s >= 40 ? 'Getting there' : s > 0 ? 'Keep practising' : 'We couldn’t hear you');
const scoreCls = s => (s == null ? '' : s >= 75 ? 'good' : s >= 50 ? 'ok' : 'low');
const wait = ms => new Promise(r => setTimeout(r, ms));
const fmtDur = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let routeTok = 0;

// ---------------------------------------------------------------- packs: starter catalogue + user packs
const CAT = { starter: [], p: null, error: null };
function loadStarter() {
  return CAT.p ||= fetch('packs/starter.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { CAT.error = null; CAT.starter = (Array.isArray(j.packs) ? j.packs : []).map(fromStarter); return CAT.starter; })
    .catch(e => { CAT.p = null; CAT.error = e; throw e; });
}
function fromStarter(p) {
  return {
    key: 's:' + p.id, kind: 'starter', title: String(p.title), film: String(p.film), style: p.style, difficulty: p.difficulty,
    license: String(p.license || ''), shareAlike: !!p.shareAlike, attribution: String(p.attribution || ''), sourcePage: String(p.sourcePage || ''),
    thumb: /^https:\/\/upload\.wikimedia\.org\//.test(p.thumb || '') ? p.thumb : '',
    src: { kind: 'url', url: p.videoUrl }, clipStart: +p.clipStart, clipEnd: +p.clipEnd,
    chars: p.characters.map((c, i) => ({ id: String(c.id), name: String(c.name), color: D.safeColor(c.color, i), voice: c.voice || {} })),
    lines: p.lines.map(l => ({ id: String(l.id), start: +l.start, end: +l.end, speaker: String(l.speaker), text: String(l.text) })),
  };
}
function fromScene(sc) {
  const inClip = l => (sc.clipStart == null || l.start >= sc.clipStart - 0.05) && (sc.clipEnd == null || l.end <= sc.clipEnd + 0.05);
  const lines = sc.lines.filter(l => inClip(l) && l.text.trim()).map(l => ({ ...l }));
  const clipStart = sc.clipStart ?? Math.max(0, (lines[0]?.start ?? 0) - 1.5);
  const clipEnd = sc.clipEnd ?? ((lines[lines.length - 1]?.end ?? clipStart + 5) + 1.5);
  const perMin = lines.length / Math.max(0.2, (clipEnd - clipStart) / 60);
  return {
    key: 'my:' + sc.id, kind: 'user', sceneId: sc.id, title: sc.title, film: D.sourceLabel(sc.source), style: 'mine',
    difficulty: perMin > 20 ? 'hard' : perMin > 11 ? 'medium' : 'easy',
    license: sc.license, shareAlike: /SA/i.test(sc.license || ''), attribution: sc.credits, sourcePage: '', thumb: sc.thumb || '',
    src: { ...sc.source, sceneId: sc.id }, clipStart, clipEnd,
    chars: Object.entries(sc.chars).map(([id, c], i) => ({ id, name: c.name, color: D.safeColor(c.color, i), voice: c.voice || {} }))
      .filter(c => lines.some(l => l.speaker === c.id)),
    lines,
  };
}
const userPacks = () => D.SC.list.map(fromScene).filter(p => p.lines.length);
async function getPack(key) {
  if (String(key).startsWith('s:')) { await loadStarter(); return CAT.starter.find(p => p.key === key) || null; }
  if (String(key).startsWith('my:')) { const sc = D.SC.list.find(s => 'my:' + s.id === key); return sc ? fromScene(sc) : null; }
  return null;
}
const takeKey = pack => 'game_' + pack.key;
const charOf = (pack, id) => pack.chars.find(c => c.id === id) || { name: id || '?', color: '#9aa4c7', voice: {} };
const splitTitle = t => { const i = t.indexOf(': '); return i > 0 ? [t.slice(0, i), t.slice(i + 2)] : ['', t]; };
const bests = () => store.get(BEST_KEY, {}) || {};
const prefs = key => Object.assign({ role: '*', ai: false }, store.get('dd.role.' + key, {}));

// ---------------------------------------------------------------- small UI pieces
const SVG = 'http://www.w3.org/2000/svg';
function sv(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids); return e;
}
/** A karate belt drawn in SVG (colour from the fixed BELTS table). */
function beltSvg(b, w = 120) {
  const stroke = b.min === 0 ? '#aeb7cf' : 'rgba(0,0,0,.25)';
  return sv('svg', { viewBox: '0 0 120 64', width: w, height: Math.round(w * 64 / 120), class: 'belt', 'aria-hidden': 'true' },
    sv('path', { d: 'M50 30 L34 60 L44 62 L56 36 Z', fill: b.color, stroke, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
    sv('path', { d: 'M70 30 L86 60 L76 62 L64 36 Z', fill: b.color, stroke, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
    sv('rect', { x: 2, y: 16, width: 116, height: 16, rx: 4, fill: b.color, stroke, 'stroke-width': 1.5 }),
    b.min === 90 ? sv('rect', { x: 96, y: 16, width: 10, height: 16, fill: b.edge }) : sv('g'),
    sv('rect', { x: 48, y: 10, width: 24, height: 28, rx: 6, fill: b.color, stroke, 'stroke-width': 1.5 }),
    sv('path', { d: 'M52 18 h16 M52 24 h16 M52 30 h16', stroke: b.edge, 'stroke-width': 1.4, opacity: 0.55 }));
}
function beltChip(score) {
  const b = beltOf(score);
  return h('span', { class: 'belt-chip', title: `Best: ${score} (${b.name})` }, h('i', { style: `background:${b.color};border-color:${b.edge}` }), String(score));
}
function speakerChip(c) { return h('span', { class: 'who' }, h('i', { style: `background:${c.color}` }), c.name); }
function btn(cls, ic, label, onclick, extra = {}) {
  return h('button', { type: 'button', class: 'btn ' + cls, onclick, ...extra }, ic ? icon(ic) : null, h('span', { class: 'btn-l' }, label));
}

// ---------------------------------------------------------------- HOME + PACKS
const HOME = { filter: 'all' };
function packCard(p) {
  const b = bests()[p.key];
  const [kicker, main] = splitTitle(p.title);
  const thumb = h('div', { class: 'pc-thumb' + (p.thumb ? '' : ' noimg') });
  if (p.thumb) {
    const img = h('img', { src: p.thumb, alt: '', decoding: 'async' });
    img.addEventListener('error', () => { img.remove(); thumb.classList.add('noimg'); thumb.prepend(icon('film', 'pc-ph')); });
    thumb.append(img);
  } else thumb.append(icon('film', 'pc-ph'));
  thumb.append(h('span', { class: 'pc-style s-' + p.style }, STYLE_LABEL[p.style] || ''), h('span', { class: 'pc-dur' }, fmtDur(p.clipEnd - p.clipStart)));
  if (b) thumb.append(beltChip(b.score));
  thumb.append(h('span', { class: 'pc-play', 'aria-hidden': 'true' }, icon('play')));
  return h('a', { class: 'pcard', href: '#/pack/' + p.key },
    thumb,
    h('div', { class: 'pc-body' },
      kicker ? h('p', { class: 'pc-kicker' }, kicker) : h('p', { class: 'pc-kicker' }, p.film),
      h('h3', { class: 'pc-title' }, main),
      h('div', { class: 'pc-meta' },
        h('span', { class: 'diff d-' + p.difficulty }, DIFF_LABEL[p.difficulty] || ''),
        h('span', {}, icon('mic'), `${p.lines.length} lines`)),
      h('p', { class: 'pc-cast' }, icon('users'), p.chars.map(c => c.name).join(', '))));
}

function renderHome(withHero) {
  const tok = ++routeTok;
  const grid = h('div', { class: 'pgrid', 'aria-live': 'polite' }, Array.from({ length: 6 }, () => h('div', { class: 'pcard skel' }, h('div', { class: 'pc-thumb' }), h('div', { class: 'pc-body' }, h('i'), h('i'), h('i')))));
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by style' });
  const drawChips = () => fill(chips, [['all', 'All'], ['anime', 'Anime-style'], ['animation', 'Animation'], ['live', 'Live action']].map(([k, label]) =>
    h('button', { type: 'button', class: 'chip' + (HOME.filter === k ? ' on' : ''), 'aria-pressed': String(HOME.filter === k), onclick: () => { HOME.filter = k; drawChips(); drawGrid(); } }, label)));
  const drawGrid = () => {
    if (CAT.error && !CAT.starter.length) {
      fill(grid, h('div', { class: 'empty wide' }, icon('alert', 'empty-ic'), h('p', { class: 'empty-t' }, 'Couldn’t load the packs'),
        h('p', { class: 'muted' }, 'Check your connection and try again.'), btn('primary', 'replay', 'Try again', () => route())));
      return;
    }
    const list = CAT.starter.filter(p => HOME.filter === 'all' || p.style === HOME.filter);
    fill(grid, list.map(packCard));
  };
  drawChips();

  const mine = userPacks();
  const myGrid = h('div', { class: 'pgrid' }, mine.map(packCard),
    h('a', { class: 'pcard make-card', href: '#/make' },
      h('div', { class: 'make-in' }, h('span', { class: 'make-ic' }, icon('plus')), h('h3', {}, 'Make your own pack'),
        h('p', { class: 'muted' }, 'Bring a clip, import subtitles or let Whisper write the script.'))));

  const page = h('div', { class: 'page home' },
    withHero ? hero() : h('div', { class: 'page-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Packs'), h('h1', { class: 'page-title' }, 'Pick a scene to dub'),
      h('p', { class: 'muted lead' }, 'Short scenes from open-licensed films. Each pack is a minute or less, with 4 to 20 lines.'))),
    h('section', { class: 'psec', id: 'packs', 'aria-labelledby': 'h-starter' },
      h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title', id: 'h-starter' }, 'Starter packs'), chips),
      grid),
    h('section', { class: 'psec', 'aria-labelledby': 'h-mine' },
      h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title', id: 'h-mine' }, 'My packs'),
        btn('ghost sm', 'upload', 'Import pack (.zip)', () => D.importPack(() => route()))),
      myGrid),
    footer());
  $main.replaceChildren(page);
  loadStarter().then(() => { if (tok === routeTok) { drawGrid(); fillFeatured(); } }).catch(() => { if (tok === routeTok) drawGrid(); });

  function fillFeatured() {
    const slot = page.querySelector('.hero-art'); if (!slot) return;
    const p = CAT.starter.find(x => x.key === FEATURED) || CAT.starter[0]; if (!p) return;
    const [kicker, main] = splitTitle(p.title);
    const img = h('img', { src: p.thumb, alt: '' });
    img.addEventListener('error', () => img.remove());
    fill(slot, h('a', { class: 'feat', href: '#/pack/' + p.key, 'aria-label': `Featured pack: ${p.title}` },
      img,
      h('span', { class: 'feat-rec' }, h('i'), 'REC'),
      h('div', { class: 'feat-tele' }, h('b', { style: `color:${p.chars[0].color}` }, p.chars[0].name + ':'), ' ', p.lines[0].text),
      h('div', { class: 'feat-cap' }, h('span', { class: 'eyebrow' }, 'Play now starts with'),
        h('strong', {}, main), h('span', { class: 'muted' }, `${kicker} · ${p.lines.length} lines · ${DIFF_LABEL[p.difficulty]}`))));
  }
}
function hero() {
  return h('section', { class: 'hero' },
    h('div', { class: 'hero-copy' },
      h('p', { class: 'eyebrow' }, icon('sparkles'), 'Free dubbing game · in your browser'),
      h('h1', { class: 'hero-title' }, 'Dub anime & movie scenes with ', h('span', { class: 'hl' }, 'your own voice')),
      h('p', { class: 'hero-sub' }, 'Watch the line, hit record, speak in sync. Every take gets a score, your best run earns a belt, and you can download the finished dub.'),
      h('div', { class: 'hero-cta' },
        h('a', { class: 'btn primary xl', href: `#/play/${FEATURED}/1/new` }, icon('play'), h('span', { class: 'btn-l' }, 'Play now')),
        h('a', { class: 'btn ghost xl', href: '#/packs' }, icon('grid'), h('span', { class: 'btn-l' }, 'Browse packs'))),
      h('ul', { class: 'steps' },
        h('li', {}, h('span', { class: 'st-ic' }, icon('headphones')), h('b', {}, 'Watch'), h('span', {}, 'Hear the original line')),
        h('li', {}, h('span', { class: 'st-ic rec' }, icon('mic')), h('b', {}, 'Record'), h('span', {}, 'The voice mutes. You speak.')),
        h('li', {}, h('span', { class: 'st-ic gold' }, icon('trophy')), h('b', {}, 'Score'), h('span', {}, 'Earn your belt, share the dub')))),
    h('div', { class: 'hero-art' }, h('div', { class: 'feat skel' })));
}
function footer() {
  return h('footer', { class: 'foot' },
    h('p', {}, icon('shield'), 'Everything runs in your browser. Your recordings never leave this device.'),
    h('p', { class: 'muted' }, 'Starter packs use open-licensed films (CC BY / CC BY-SA) from Wikimedia Commons; credits are on each pack. ',
      h('a', { href: 'https://github.com/itskavin/dubdojo/blob/main/CREDITS.md', target: '_blank', rel: 'noopener' }, 'Credits & licenses')));
}
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));

// ---------------------------------------------------------------- session: one video + mixer per pack, kept across intro/booth/results
let G = null;
let B = null; // booth state while the booth is mounted
let R = null; // results state while results are mounted
function endSession() {
  if (!G) return;
  const g = G; G = null;
  g.dead = true; cancelAnimationFrame(g.raf);
  try { g.player?.destroy(); } catch {}
  try { g.mixer?.close(); } catch {}
  if (g.blobURL) URL.revokeObjectURL(g.blobURL);
  releaseWake();
  try { releaseMic(); } catch {}
}
function session(pack) {
  if (G && G.pack.key === pack.key) { G.pack = pack; return G; }
  endSession();
  const pr = prefs(pack.key);
  const g = G = { pack, role: pr.role, aiOthers: !!pr.ai, takes: new Map(), skipped: new Set(), aiBufs: new Map(),
    mode: 'idle', origGain: 1, stopAt: null, onStop: null, onFrame: null, windows: [], raf: 0, dead: false };
  if (g.role !== '*' && !pack.chars.some(c => c.id === g.role)) g.role = '*';
  g.stage = buildStage(g);
  g.ready = loadVideo(g);
  g.takesLoaded = loadTakes(g);
  return g;
}
function savePrefs(g) { store.set('dd.role.' + g.pack.key, { role: g.role, ai: g.aiOthers }); }
const boothLines = g => g.pack.lines.filter(l => g.role === '*' || l.speaker === g.role);

function buildStage(g) {
  const els = g.els = {
    tele: h('div', { class: 'tele', 'aria-live': 'off' }),
    badge: h('div', { class: 'vbadge', hidden: true }),
    cd: h('div', { class: 'cd', hidden: true, 'aria-live': 'assertive' }),
    sweep: h('div', { class: 'sweep', hidden: true }, h('i')),
    load: h('div', { class: 'vload' }, h('span', { class: 'spin' }, icon('loader')), h('span', { class: 'vload-t' }, 'Loading video…')),
    msg: h('div', { class: 'vmsg', hidden: true }),
    big: h('button', { type: 'button', class: 'bigplay', hidden: true, 'aria-label': 'Play' }, icon('play')),
  };
  return h('div', { class: 'vstage' }, els.tele, els.sweep, els.badge, els.cd, els.big, els.load, els.msg);
}
function setLoading(g, text) {
  g.els.load.hidden = !text;
  if (text) g.els.load.querySelector('.vload-t').textContent = text;
}
function showVideoError(g, text) {
  setLoading(g, '');
  fill(g.els.msg, h('div', { class: 'vmsg-in' }, icon('alert', 'vmsg-ic'), h('strong', {}, 'The video didn’t load'), h('p', {}, text),
    btn('primary', 'replay', 'Try again', () => { endSession(); route(); })));
  g.els.msg.hidden = false;
}
function setBadge(g, kind, text) {
  const b = g.els.badge;
  b.hidden = !kind; b.className = 'vbadge ' + (kind || '');
  if (kind) fill(b, kind === 'rec' ? h('i', { class: 'dot' }) : icon(kind === 'orig' ? 'volume' : kind === 'take' ? 'mic' : 'play'), text);
}

async function loadVideo(g) {
  const p = g.pack;
  setLoading(g, 'Loading video…');
  const slow = setTimeout(() => { if (!g.dead && !g.els.load.hidden) setLoading(g, 'Still loading… the first frames can take a moment on slow connections.'); }, 9000);
  try {
    let player, videoRecord;
    if (p.src.kind === 'url') player = await D.htmlPlayer(g.stage, p.src.url, { link: true });
    else if (p.src.kind === 'file') {
      const rec = videoRecord = await db.clip('video', p.src.sceneId);
      if (!rec?.blob) throw new Error('This pack’s video isn’t stored in this browser. Open the pack in Make a pack and locate the file.');
      g.blobURL = URL.createObjectURL(rec.blob);
      player = await D.htmlPlayer(g.stage, g.blobURL, { link: false });
    } else if (p.src.kind === 'youtube') player = await D.ytPlayer(g.stage, p.src.videoId);
    else throw new Error('Unknown video source.');
    if (g.dead) { player.destroy(); return false; }
    g.player = player;
    if (player.kind === 'html') {
      const v = player.el; v.controls = false; v.removeAttribute('controls'); v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
      v.addEventListener('waiting', () => { if (!g.dead && !v.paused) setLoading(g, 'Buffering…'); });
      v.addEventListener('playing', () => { if (!g.dead) setLoading(g, ''); });
      v.addEventListener('error', () => { if (!g.dead && v.error) showVideoError(g, 'The video stopped loading. Check your connection.'); });
    }
    g.mixer = new D.Mixer(player);
    await D.loadBacking(g.mixer, videoRecord);
    if (g.dead) return false;
    g.mixer.setLevels(1, false);
    g.canMix = !!g.mixer.orig;
    await seekTo(g, p.clipStart + 0.05);
    await canPlay(g);
    if (g.dead) return false;
    clearTimeout(slow); setLoading(g, '');
    startLoop(g);
    return true;
  } catch (e) {
    clearTimeout(slow);
    if (!g.dead) showVideoError(g, e.message || String(e));
    return false;
  }
}
async function loadTakes(g) {
  let keys; try { keys = await db.clipKeys(takeKey(g.pack)); } catch { return; }
  for (const l of g.pack.lines) {
    if (!keys.has(l.id) || g.dead) continue;
    try {
      const r = await db.clip(takeKey(g.pack), l.id);
      if (r?.skipped) { g.skipped.add(l.id); continue; }
      if (!r?.blob) continue;
      const buf = await decodeBlob(r.blob).catch(() => null);
      g.takes.set(l.id, { ...r, buf, env: buf && envelope(buf) });
    } catch (e) { console.warn('take load failed', e); }
  }
}
async function clearTakes(g) {
  g.takes.clear(); g.skipped.clear();
  try { await db.delPack(takeKey(g.pack)); } catch {}
}
async function decodeBlob(blob) { return new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer()); }
function envelope(buf) {
  const d = buf.getChannelData(0), n = Math.max(1, Math.round(buf.sampleRate / 100));
  const out = new Float32Array(Math.ceil(d.length / n)); let mx = 0.02;
  for (let i = 0, k = 0; i < d.length; i += n, k++) { let s = 0; const e = Math.min(d.length, i + n); for (let j = i; j < e; j++) s += d[j] * d[j]; out[k] = Math.sqrt(s / (e - i)); mx = Math.max(mx, out[k]); }
  for (let k = 0; k < out.length; k++) out[k] /= mx;
  return out;
}

function seekTo(g, t) {
  const p = g.player; if (!p) return Promise.resolve();
  p.seek(t);
  if (p.kind !== 'html') return wait(350);
  const v = p.el;
  return new Promise(r => {
    if (!v.seeking) return r();
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); r(); };
    const to = setTimeout(done, 20000);
    v.addEventListener('seeked', done);
  });
}
function canPlay(g) {
  const p = g.player; if (!p || p.kind !== 'html') return Promise.resolve();
  const v = p.el;
  return new Promise(r => {
    if (v.readyState >= 3) return r();
    const done = () => { v.removeEventListener('canplay', done); clearTimeout(to); r(); };
    const to = setTimeout(done, 25000);
    v.addEventListener('canplay', done);
  });
}
async function playV(g) {
  const p = g.player; if (!p) return false;
  g.mixer?.resume();
  if (p.kind === 'html') { try { await p.el.play(); return true; } catch { return false; } }
  await p.play(); return true;
}

// frame loop: mixer scheduling, original-audio muting, screen updates
function startLoop(g) {
  cancelAnimationFrame(g.raf);
  const f = () => { if (g.dead) return; g.raf = requestAnimationFrame(f); try { frame(g); } catch (e) { console.error(e); } };
  g.raf = requestAnimationFrame(f);
}
function frame(g) {
  const p = g.player; if (!p) return;
  g.mixer.tick();
  const t = p.time();
  if (g.stopAt != null && t >= g.stopAt) { p.pause(); g.stopAt = null; const cb = g.onStop; g.onStop = null; g.mode = 'idle'; cb?.(); }
  setOrig(g, origTarget(g, t));
  g.onFrame?.(t);
}
function origTarget(g, t) {
  if (g.mode === 'rec') return t >= g.recLine.start - MUTE_LEAD ? 0 : 1;
  if (g.mode === 'take' || g.mode === 'dub') return g.windows.some(([a, b]) => t >= a && t <= b) ? 0 : 1;
  return 1;
}
function setOrig(g, v) {
  if (g.origGain === v) return;
  g.origGain = v;
  if (g.mixer?.orig) {
    const gn = g.mixer.orig.gain, now = g.mixer.ctx.currentTime;
    gn.cancelScheduledValues(now); gn.setValueAtTime(gn.value, now); gn.setTargetAtTime(v, now, 0.015);
  } else g.player?.setVolume(v);
}
/** Loads the given takes (and AI lines) into the mixer and mutes the original in their windows. */
function armClips(g, lineIds, withAI) {
  const mx = g.mixer; mx.stopAll(); mx.clips.clear(); mx.muted.clear();
  g.windows = [];
  for (const id of lineIds) {
    const l = g.pack.lines.find(x => x.id === id); const tk = g.takes.get(id);
    if (!l || !tk?.buf) continue;
    mx.clips.set(id, { buf: tk.buf, offset: tk.offset });
    g.windows.push([Math.min(l.start, tk.offset + 0.05) - 0.1, l.end + 0.3]);
  }
  if (withAI) for (const [id, buf] of g.aiBufs) {
    const l = g.pack.lines.find(x => x.id === id); if (!l) continue;
    mx.clips.set('ai_' + id, { buf, offset: l.start });
    g.windows.push([l.start - 0.1, Math.max(l.end, l.start + buf.duration) + 0.2]);
  }
}
async function playRange(g, from, to, mode, onStop) {
  stopPlayback(g);
  g.mode = mode;
  await seekTo(g, from);
  if (g.dead) return false;
  g.stopAt = to; g.onStop = onStop || null;
  const ok = await playV(g);
  if (!ok) { g.mode = 'idle'; g.stopAt = null; g.onStop = null; return false; }
  return true;
}
function stopPlayback(g) {
  g.player?.pause(); g.stopAt = null; g.onStop = null; g.mode = 'idle';
  g.mixer?.stopAll();
}

// teleprompter overlay
function setTele(g, line, { prog = -1, you = false, faded = false } = {}) {
  const el = g.els.tele;
  if (!line) { if (el.dataset.k) { el.dataset.k = ''; el.replaceChildren(); } return; }
  const k = line.id + (you ? 'y' : '') + (faded ? 'f' : '');
  if (el.dataset.k !== k) {
    el.dataset.k = k;
    const c = charOf(g.pack, line.speaker);
    const words = line.text.split(/\s+/).filter(Boolean);
    fill(el, h('div', { class: 'tele-box' + (faded ? ' faded' : '') },
      h('span', { class: 'tele-who', style: `--c:${c.color}` }, you ? h('span', { class: 'you' }, 'You') : null, c.name),
      h('span', { class: 'tele-text' }, words.map(w => h('span', { class: 'w' }, w + ' ')))));
    el._words = [...el.querySelectorAll('.w')];
    el._len = words.reduce((n, w) => n + w.length + 1, 0);
  }
  const ws = el._words || [];
  let acc = 0; const lim = prog < 0 ? -1 : prog * el._len;
  for (const w of ws) { acc += w.textContent.length; w.classList.toggle('on', lim >= acc - w.textContent.length * 0.5); }
}

// keep the screen awake while dubbing
let wake = null;
async function keepAwake() { try { if (!wake) { wake = await navigator.wakeLock?.request('screen'); wake?.addEventListener?.('release', () => { wake = null; }); } } catch {} }
function releaseWake() { try { wake?.release(); } catch {} wake = null; }

// ---------------------------------------------------------------- shared route plumbing
const GAME_ROUTES = new Set(['pack', 'play', 'results']);
function gameLeave(next, args) {
  if (B) { B.abort = true; B = null; }
  if (R) { R.cancel = true; R = null; }
  if (G) { G.onFrame = null; stopPlayback(G); G.els.cd.hidden = true; G.els.sweep.hidden = true; setBadge(G, null); }
  if (!(GAME_ROUTES.has(next) && G && args[0] === G.pack.key)) endSession();
}
function notFound(text = 'That pack doesn’t exist (or was deleted).') {
  $main.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'empty wide' }, icon('package', 'empty-ic'), h('p', { class: 'empty-t' }, 'Pack not found'),
    h('p', { class: 'muted' }, text), h('a', { class: 'btn primary', href: '#/packs' }, icon('grid'), h('span', { class: 'btn-l' }, 'Browse packs')))));
}
function loadingPage(text = 'Loading…') {
  $main.replaceChildren(h('div', { class: 'page center-load' }, h('span', { class: 'spin' }, icon('loader')), h('p', { class: 'muted' }, text)));
}
async function resolvePack(key) {
  try { return await getPack(key); } catch { return undefined; }
}
function attributionBox(p) {
  if (!p.license && !p.attribution) return null;
  return h('div', { class: 'attrib' },
    h('div', { class: 'attrib-h' }, icon('info'), h('b', {}, 'Credits'), p.license ? h('span', { class: 'lic' }, p.license) : null),
    p.attribution ? h('p', {}, p.attribution) : null,
    p.shareAlike ? h('p', { class: 'muted' }, 'ShareAlike: if you share your dub, share it under the same license (', p.license, ') and keep this credit.') : null,
    p.sourcePage ? h('a', { href: p.sourcePage, target: '_blank', rel: 'noopener' }, 'Source on Wikimedia Commons', icon('external')) : null);
}

// ---------------------------------------------------------------- PACK INTRO
async function renderIntro(key) {
  const tok = ++routeTok;
  loadingPage('Loading pack…');
  const pack = await resolvePack(key);
  if (tok !== routeTok) return;
  if (pack === undefined) return notFound('The pack list couldn’t be loaded. Check your connection.');
  if (!pack) return notFound();
  const g = session(pack);
  const [kicker, main] = splitTitle(pack.title);
  const b = bests()[pack.key];
  const counts = id => pack.lines.filter(l => l.speaker === id).length;
  const rolesEl = h('div', { class: 'roles', role: 'radiogroup', 'aria-label': 'Choose your role' });
  const aiRow = h('div', { class: 'ai-row' });
  const drawRoles = () => {
    const opt = (id, label, sub, color) => h('label', { class: 'role' + (g.role === id ? ' on' : '') },
      h('input', { type: 'radio', name: 'role', value: id, checked: g.role === id, onchange: () => { g.role = id; savePrefs(g); drawRoles(); } }),
      color ? h('i', { class: 'dot', style: `background:${color}` }) : h('span', { class: 'role-ic' }, icon('users')),
      h('span', { class: 'role-n' }, label), h('span', { class: 'role-s' }, sub));
    fill(rolesEl, opt('*', 'Dub all roles', `${pack.lines.length} lines`, null),
      pack.chars.map(c => opt(c.id, c.name, `${counts(c.id)} line${counts(c.id) === 1 ? '' : 's'}`, c.color)));
    const one = g.role !== '*';
    fill(aiRow, one ? h('div', { class: 'ai-in' },
      h('span', { class: 'ai-l' }, 'Other characters'),
      h('div', { class: 'seg sm', role: 'group', 'aria-label': 'Voice for the other characters' },
        h('button', { type: 'button', class: 'seg-btn' + (!g.aiOthers ? ' active' : ''), 'aria-pressed': String(!g.aiOthers), onclick: () => { g.aiOthers = false; savePrefs(g); drawRoles(); } }, icon('volume'), 'Original voice'),
        h('button', { type: 'button', class: 'seg-btn' + (g.aiOthers ? ' active' : ''), 'aria-pressed': String(g.aiOthers), onclick: () => { g.aiOthers = true; savePrefs(g); drawRoles(); } }, icon('bot'), 'AI voice')),
      g.aiOthers ? h('p', { class: 'muted small' }, 'AI voices run on your device (a one-time download of about 90 MB) and play in your final dub.') : null) : null);
  };
  drawRoles();
  const watchBtn = btn('ghost sm', 'replay', 'Watch scene again', () => preview());
  const page = h('div', { class: 'page intro' },
    h('a', { class: 'back', href: '#/packs' }, icon('arrowLeft'), 'All packs'),
    h('div', { class: 'intro-grid' },
      h('div', { class: 'intro-media' }, h('div', { class: 'vwrap' }, g.stage),
        h('div', { class: 'under-v' }, h('span', { class: 'muted small' }, 'Scene preview with the original voices'), watchBtn)),
      h('div', { class: 'script' }, h('h2', { class: 'panel-h' }, 'The script'),
          h('ol', { class: 'script-l' }, pack.lines.map(l => { const c = charOf(pack, l.speaker);
            return h('li', {}, h('span', { class: 'sc-t' }, fmtDur(l.start - pack.clipStart)), speakerChip(c), h('span', { class: 'sc-x' }, l.text)); }))),
      h('div', { class: 'intro-panel' },
        h('div', { class: 'tags' }, h('span', { class: 'pc-style s-' + pack.style }, STYLE_LABEL[pack.style]),
          h('span', { class: 'diff d-' + pack.difficulty }, DIFF_LABEL[pack.difficulty]), b ? beltChip(b.score) : null),
        h('h1', { class: 'intro-title' }, main),
        h('p', { class: 'intro-film' }, kicker && !pack.film.startsWith(kicker) ? kicker + ' · ' : '', pack.film),
        h('div', { class: 'facts' },
          h('span', {}, icon('mic'), h('b', {}, String(pack.lines.length)), ' lines'),
          h('span', {}, icon('clock'), h('b', {}, fmtDur(pack.clipEnd - pack.clipStart))),
          h('span', {}, icon('users'), h('b', {}, String(pack.chars.length)), ' characters')),
        h('h2', { class: 'panel-h' }, 'Choose your role'),
        rolesEl, aiRow,
        btn('primary xl block', 'mic', 'Start dubbing', () => navigate(`#/play/${pack.key}/1/new`)),
        h('p', { class: 'muted small center' }, 'You’ll be asked for your microphone at the first Record. Nothing is uploaded.'),
        attributionBox(pack),
        h('button', { type: 'button', class: 'linkish', onclick: () => editCopy(pack) }, icon('pencil'), pack.kind === 'user' ? 'Edit in Make a pack' : 'Edit a copy in Make a pack'))));
  $main.replaceChildren(page);

  const big = g.els.big;
  big.onclick = () => preview();
  let thumbDone = !(pack.kind === 'user' && !pack.thumb);
  g.onFrame = t => {
    const l = pack.lines.find(x => t >= x.start - 0.1 && t < x.end + 0.2);
    setTele(g, l, {});
    if (!thumbDone && g.canMix && t >= pack.lines[0].start) { thumbDone = true; captureThumb(g); }
  };
  async function preview() {
    if (!(await g.ready) || g.dead) return;
    big.hidden = true; setBadge(g, 'orig', 'Original');
    const ok = await playRange(g, pack.clipStart, pack.clipEnd, 'preview', () => { setBadge(g, null); big.hidden = false; });
    if (!ok && !g.dead) { setBadge(g, null); big.hidden = false; }
  }
  preview();
}
function captureThumb(g) {
  try {
    const v = g.player.el, c = h('canvas', { width: 320, height: 180 });
    c.getContext('2d').drawImage(v, 0, 0, 320, 180);
    const url = c.toDataURL('image/jpeg', 0.72);
    const sc = D.SC.list.find(s => s.id === g.pack.sceneId);
    if (sc && url.length < 300000) { sc.thumb = url; D.saveScenes(); }
  } catch (e) { console.warn('thumbnail capture failed', e); }
}
function editCopy(pack) {
  if (pack.kind === 'user') { D.SC.openId = pack.sceneId; navigate('#/make'); return; }
  const chars = {}; pack.chars.forEach(c => { chars[c.id] = { name: c.name, color: c.color, voice: c.voice }; });
  D.editCopy({ title: pack.title + ' (copy)', source: { kind: 'url', url: pack.src.url }, lines: pack.lines, chars,
    credits: pack.attribution, license: pack.license, clipStart: pack.clipStart, clipEnd: pack.clipEnd, thumb: '' });
  toast('Copied into Make a pack');
}

// ---------------------------------------------------------------- BOOTH
async function renderBooth(key, n, flag) {
  const tok = ++routeTok;
  loadingPage('Getting the booth ready…');
  const pack = await resolvePack(key);
  if (tok !== routeTok) return;
  if (pack === undefined) return notFound('The pack list couldn’t be loaded. Check your connection.');
  if (!pack) return notFound();
  const g = session(pack);
  if (flag === 'new') { await g.takesLoaded; await clearTakes(g); history.replaceState(null, '', `#/play/${key}/1`); }
  await g.takesLoaded;
  if (tok !== routeTok || g.dead) return;
  const lines = boothLines(g);
  if (!lines.length) return notFound('This pack has no lines for the chosen role.');
  const i = clamp((parseInt(n, 10) || 1) - 1, 0, lines.length - 1);
  B = { g, lines, i, redo: flag === 'redo', busy: null, abort: false, els: {} };
  const [kicker, main] = splitTitle(pack.title);
  const e = B.els;
  e.dots = h('div', { class: 'dots' });
  e.count = h('span', { class: 'lcount' });
  e.canvas = h('canvas', { class: 'strip-c', 'aria-hidden': 'true' });
  e.stripLab = h('div', { class: 'strip-lab' });
  e.verdict = h('div', { class: 'verdict', 'aria-live': 'polite' });
  e.replay = btn('sec', 'replay', 'Replay', () => doReplay(), { 'aria-keyshortcuts': 'O' });
  e.rec = btn('rec big', 'mic', 'Record', () => doRecord(), { 'aria-keyshortcuts': 'R' });
  e.take = btn('sec', 'play', 'My take', () => doTake(), { 'aria-keyshortcuts': 'Space' });
  e.next = btn('next', 'arrowRight', 'Next', () => doNext(), { 'aria-keyshortcuts': 'Enter' });
  e.replay.append(h('span', { class: 'btn-sub' }, 'Hear the original'));
  e.take.append(h('span', { class: 'btn-sub' }, 'Hear yourself'));
  e.overlay = h('div', { class: 'booth-over', hidden: true });
  const page = h('div', { class: 'booth' },
    h('header', { class: 'booth-bar' },
      h('a', { class: 'icon-btn', href: '#/pack/' + key, 'aria-label': 'Leave the booth' }, icon('x')),
      h('div', { class: 'bb-title' }, h('span', { class: 'bb-k' }, kicker || pack.film), h('strong', {}, main)),
      h('div', { class: 'bb-prog' }, e.count, e.dots)),
    h('div', { class: 'booth-main' },
      h('div', { class: 'vwrap booth-v' }, g.stage),
      h('div', { class: 'strip' }, e.stripLab, e.canvas),
      e.verdict,
      h('div', { class: 'controls' }, e.replay, e.rec, e.take, e.next),
      h('p', { class: 'kbd-hints', 'aria-hidden': 'true' }, h('kbd', {}, 'R'), ' record · ', h('kbd', {}, 'Space'), ' play · ', h('kbd', {}, 'O'), ' original · ', h('kbd', {}, 'Enter'), ' next')),
    e.overlay);
  $main.replaceChildren(page);
  g.els.big.hidden = true;
  g.els.big.onclick = null;
  g.onFrame = boothFrame;
  showLine(true);
  g.ready.then(ok => { if (ok && B?.g === g) showLine(true); });
}
const curLine = () => B.lines[B.i];
const usable = id => { const tk = B.g.takes.get(id); return (tk && tk.score > 0) || B.g.skipped.has(id); };
function reachable() { let k = 0; while (k < B.lines.length - 1 && usable(B.lines[k].id)) k++; return k; }
async function showLine(seek) {
  if (!B) return;
  const g = B.g, l = curLine();
  history.replaceState(null, '', `#/play/${g.pack.key}/${B.i + 1}${B.redo ? '/redo' : ''}`);
  drawBooth();
  if (seek && g.player && !B.busy) { stopPlayback(g); await seekTo(g, Math.max(g.pack.clipStart, l.start - 0.6)); }
  setTele(g, l, {});
}
function drawBooth() {
  if (!B) return;
  const { g, lines, i, busy, els: e } = B; const l = curLine(); const tk = g.takes.get(l.id);
  e.count.textContent = `Line ${i + 1} / ${lines.length}`;
  const reach = reachable();
  fill(e.dots, lines.map((x, k) => {
    const t = g.takes.get(x.id); const st = g.skipped.has(x.id) ? 'skip' : t ? scoreCls(t.score) : '';
    return h('button', { type: 'button', class: 'dot-b ' + st + (k === i ? ' cur' : ''), disabled: !!busy || (k > reach && !B.redo),
      'aria-label': `Line ${k + 1}${t ? `, score ${t.score}` : g.skipped.has(x.id) ? ', skipped' : ''}`, 'aria-current': k === i ? 'step' : null,
      onclick: () => { if (B.busy) return; B.i = k; showLine(true); } });
  }));
  const recBusy = busy === 'count' || busy === 'rec';
  e.rec.className = 'btn rec big' + (recBusy ? ' recording' : '');
  fill(e.rec, icon(recBusy ? 'square' : 'mic'), h('span', { class: 'btn-l' }, recBusy ? 'Stop' : tk ? 'Record again' : 'Record'));
  e.replay.disabled = recBusy;
  e.replay.querySelector('.btn-l').textContent = busy === 'replay' ? 'Stop' : 'Replay';
  e.take.disabled = recBusy || !tk;
  e.take.querySelector('.btn-l').textContent = busy === 'take' ? 'Stop' : 'My take';
  const last = i === lines.length - 1;
  e.next.disabled = !!busy || !usable(l.id);
  fill(e.next, h('span', { class: 'btn-l' }, B.redo ? 'Back to results' : last ? 'Finish' : 'Next'), icon(B.redo || last ? 'trophy' : 'arrowRight'));
  e.next.title = e.next.disabled && !busy ? 'Record this line to continue' : '';
  // verdict
  if (busy === 'count' || busy === 'rec') {
    fill(e.verdict, h('div', { class: 'hint rec' }, h('i', { class: 'dot' }), busy === 'count' ? 'Get ready…' : 'Speak now, while the red bar runs'));
  } else if (tk) {
    const ok = tk.score > 0;
    fill(e.verdict, h('div', { class: 'score-row' + (ok ? '' : ' bad') },
      h('span', { class: 'score-big ' + scoreCls(tk.score) }, String(tk.score)),
      h('div', { class: 'score-txt' }, h('strong', {}, cheer(tk.score)),
        h('span', { class: 'muted' }, ok ? tk.note : 'Check that your microphone works and is not muted, then record again.')),
      !ok && !g.skipped.has(l.id) ? h('button', { type: 'button', class: 'linkish', onclick: () => skipLine() }, icon('skip'), 'Skip this line') : null));
  } else if (g.skipped.has(l.id)) {
    fill(e.verdict, h('div', { class: 'hint' }, icon('skip'), 'Skipped: the original voice plays for this line.'));
  } else {
    fill(e.verdict, h('div', { class: 'hint' }, icon('info'), i === 0 && !g.takes.size
      ? 'Press Record. After 3-2-1 the scene plays with the voice muted: say the line while the red bar runs.'
      : 'Press Record when you’re ready. Replay plays the original line.'));
  }
  const c = charOf(g.pack, l.speaker);
  fill(e.stripLab, h('span', { class: 'who' }, h('i', { style: `background:${c.color}` }), c.name), h('span', { class: 'muted' }, `${(l.end - l.start).toFixed(1)} s line`));
  drawStrip();
}
function drawStrip() {
  if (!B) return;
  const { g, els: { canvas } } = B; const l = curLine(); const tk = g.takes.get(l.id);
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600, H = canvas.clientHeight || 56;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const x = canvas.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  const a = l.start - 1.2, b = l.end + 1.0; const X = t => ((t - a) / (b - a)) * W;
  // track
  x.fillStyle = 'rgba(255,255,255,.04)'; x.fillRect(0, 0, W, H);
  // target window
  x.fillStyle = 'rgba(255,138,76,.16)'; x.fillRect(X(l.start), 0, X(l.end) - X(l.start), H);
  x.fillStyle = '#ff8a4c'; x.fillRect(X(l.start) - 1, 0, 2, H); x.fillRect(X(l.end) - 1, 0, 2, H);
  // take waveform
  if (tk?.env) {
    x.fillStyle = tk.score >= 75 ? '#3ddc97' : tk.score >= 50 ? '#ffc857' : '#ff6b81';
    const bw = 3;
    for (let px = 0; px < W; px += bw + 1) {
      const t = a + (px / W) * (b - a); const k = Math.floor((t - tk.offset) * 100);
      if (k < 0 || k >= tk.env.length) continue;
      const v = Math.max(tk.env[k] || 0, tk.env[k + 1] || 0); const hh = Math.max(1.5, v * (H - 10));
      x.fillRect(px, (H - hh) / 2, bw, hh);
    }
  } else {
    x.fillStyle = 'rgba(255,255,255,.14)'; x.fillRect(0, H / 2 - 1, W, 2);
  }
  // playhead / sweep
  const t = g.player?.time?.() ?? 0;
  if (B.busy && t >= a && t <= b) {
    if (B.busy === 'rec' || B.busy === 'count') { x.fillStyle = 'rgba(255,61,90,.28)'; x.fillRect(X(Math.max(a, l.start - REC_LEAD)), 0, Math.max(0, X(t) - X(Math.max(a, l.start - REC_LEAD))), H); }
    x.fillStyle = B.busy === 'rec' ? '#ff3d5a' : '#ffffff'; x.fillRect(X(t) - 1, 0, 2, H);
  }
}
function boothFrame(t) {
  if (!B) return;
  const g = B.g, l = curLine();
  const prog = (B.busy === 'rec' || B.busy === 'replay' || B.busy === 'take') ? clamp((t - l.start) / Math.max(0.2, l.end - l.start), -1, 1) : -1;
  setTele(g, l, { prog: prog < 0 ? -1 : prog });
  const sw = g.els.sweep;
  if (B.busy === 'rec') {
    sw.hidden = false;
    const pre = t < l.start;
    sw.className = 'sweep ' + (pre ? 'pre' : 'on');
    sw.firstChild.style.width = (pre ? clamp(1 - (l.start - t) / PREROLL) : clamp((t - l.start) / Math.max(0.2, l.end - l.start))) * 100 + '%';
  } else sw.hidden = true;
  if (B.busy) drawStrip();
}

function untilT(g, cond) {
  return new Promise(res => {
    const chk = () => {
      if (g.dead || !B || B.abort) return res(false);
      const p = g.player; const t = p.time();
      if (cond(t)) return res(true);
      if (p.paused()) { const d = p.duration(); return res(!!d && t >= d - 0.25); }
      setTimeout(chk, 12);
    };
    chk();
  });
}
async function doReplay() {
  if (!B || B.busy === 'count' || B.busy === 'rec') return;
  const g = B.g;
  if (B.busy) { stopPlayback(g); B.busy = null; setBadge(g, null); drawBooth(); return; }
  if (!(await g.ready)) return;
  const l = curLine(); const me = B;
  B.busy = 'replay'; setBadge(g, 'orig', 'Original voice'); drawBooth();
  const done = () => { if (B !== me) return; B.busy = null; setBadge(g, null); drawBooth(); };
  g.mixer.stopAll(); g.mixer.clips.clear(); g.windows = [];
  if (!await playRange(g, Math.max(g.pack.clipStart, l.start - 0.8), l.end + 0.3, 'preview', done)) { done(); toast('Tap Replay again to start playback'); }
}
async function doTake() {
  if (!B || B.busy === 'count' || B.busy === 'rec') return;
  const g = B.g; const l = curLine(); const tk = g.takes.get(l.id);
  if (B.busy) { stopPlayback(g); B.busy = null; setBadge(g, null); drawBooth(); return; }
  if (!tk?.buf) return;
  const me = B;
  B.busy = 'take'; setBadge(g, 'take', 'Your take'); drawBooth();
  const done = () => { if (B !== me) return; B.busy = null; setBadge(g, null); drawBooth(); };
  const from = Math.max(g.pack.clipStart, Math.min(l.start, tk.offset) - 0.6);
  await seekTo(g, from);
  armClips(g, [l.id], false);
  if (!await playRange(g, from, l.end + 0.7, 'take', done)) done();
}
async function doRecord() {
  if (!B) return;
  const me = B, g = B.g;
  if (B.busy === 'count' || B.busy === 'rec') { B.abort = true; return; }
  if (B.busy) { stopPlayback(g); B.busy = null; setBadge(g, null); }
  if (!window.MediaRecorder) return toast('This browser can’t record audio. Try Chrome, Edge, Firefox or Safari 14.1+.');
  if (!(await g.ready)) return;
  let stream;
  try { stream = await getMic(); } catch (err) { return showMicHelp(err); }
  if (B !== me) return;
  const l = curLine();
  B.busy = 'count'; B.abort = false; stopPlayback(g); drawBooth();
  g.mixer.clips.clear(); g.windows = [];
  keepAwake();
  const pre = Math.max(g.pack.clipStart, l.start - PREROLL);
  const seeking = seekTo(g, pre).then(() => canPlay(g));
  const cd = g.els.cd;
  for (const k of [3, 2, 1]) {
    if (B !== me || B.abort) break;
    cd.hidden = false; fill(cd, h('span', { class: 'cd-n' }, String(k)), h('span', { class: 'cd-t' }, k === 3 ? 'Get ready' : k === 2 ? `${charOf(g.pack, l.speaker).name}’s line` : 'Speak at the red bar'));
    await wait(700);
  }
  cd.hidden = true;
  await seeking;
  if (B !== me || me.abort || g.dead) return finishRec(me, null);
  g.recLine = l; g.mode = 'rec';
  setBadge(g, 'rec', 'REC');
  if (!await playV(g)) { g.mode = 'idle'; toast('Playback was blocked. Press Record again.'); return finishRec(me, null); }
  B.busy = 'rec'; drawBooth();
  if (!await untilT(g, t => t >= l.start - REC_LEAD)) return finishRec(me, null);
  const mime = REC_TYPES.find(t => MediaRecorder.isTypeSupported?.(t));
  let mr;
  try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch (err) { toast('Recorder failed: ' + err.message); return finishRec(me, null); }
  const chunks = []; mr.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
  const stopped = new Promise(r => { mr.onstop = () => r(new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' })); });
  let offset = g.player.time();
  mr.onstart = () => { if (!g.dead) offset = g.player.time(); };
  mr.start();
  const ok = await untilT(g, t => t >= Math.min(l.end + REC_TAIL, g.pack.clipEnd + 0.4));
  if (mr.state !== 'inactive') mr.stop();
  g.player?.pause(); g.mode = 'idle';
  const blob = await stopped;
  if (!ok || me.abort || B !== me) return finishRec(me, null);
  await finishRec(me, { l, blob, offset });
}
async function finishRec(me, res) {
  const g = me.g;
  g.player?.pause(); g.mode = 'idle'; setBadge(g, null); g.els.cd.hidden = true; g.els.sweep.hidden = true;
  if (res) {
    const { l, blob, offset } = res;
    let buf = null, sc = { score: 0, note: 'Could not read the recording' };
    try { buf = await decodeBlob(blob); sc = D.scoreTake(buf, offset, l); } catch (err) { console.warn(err); }
    const rec = { blob, mime: blob.type, offset, score: sc.score, note: sc.note, at: Date.now() };
    g.takes.set(l.id, { ...rec, buf, env: buf && envelope(buf) });
    g.skipped.delete(l.id);
    try { await db.putClip(takeKey(g.pack), l.id, rec); navigator.storage?.persist?.().catch(() => {}); } catch (err) { toast('Could not save the take: ' + (err.message || err)); }
  }
  if (B !== me) return;
  me.busy = null; me.abort = false;
  drawBooth();
  if (res) { await seekTo(g, Math.max(g.pack.clipStart, curLine().start - 0.6)); drawStrip(); }
}
async function skipLine() {
  const g = B.g, l = curLine();
  g.skipped.add(l.id); g.takes.delete(l.id);
  try { await db.putClip(takeKey(g.pack), l.id, { skipped: true, at: Date.now() }); } catch {}
  drawBooth();
}
function doNext() {
  if (!B || B.busy || !usable(curLine().id)) return;
  const key = B.g.pack.key;
  if (B.redo || B.i === B.lines.length - 1) { navigate('#/results/' + key); return; }
  B.i++; showLine(true);
}
function showMicHelp(err) {
  if (!B) return;
  const name = err?.name || '';
  const [title, text] = name === 'NotFoundError' || name === 'OverconstrainedError'
    ? ['No microphone found', 'Plug in a microphone or headset, then try again.']
    : /HTTPS/.test(err?.message || '') ? ['Microphone needs a secure page', 'Open DubDojo over https:// to record.']
    : ['Microphone blocked', 'DubDojo needs your microphone to record your lines. Your recordings stay on this device; nothing is uploaded.'];
  const o = B.els.overlay;
  fill(o, h('div', { class: 'mic-help', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mic-h' },
    h('span', { class: 'mic-ic' }, icon('micOff')),
    h('h2', { id: 'mic-h' }, title), h('p', {}, text),
    name === 'NotAllowedError' || !name ? h('ol', { class: 'mic-steps' },
      h('li', {}, 'Click the lock or microphone icon next to the address bar.'),
      h('li', {}, 'Set Microphone to Allow for this site.'),
      h('li', {}, 'Come back and press Try again.')) : null,
    h('div', { class: 'row-btns' },
      btn('ghost', null, 'Not now', () => { o.hidden = true; }),
      btn('primary', 'mic', 'Try again', () => { o.hidden = true; doRecord(); }))));
  o.hidden = false;
  o.querySelector('.btn.primary')?.focus();
}

document.addEventListener('keydown', ev => {
  if (S.tab !== 'game' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.target.matches?.('input,textarea,select,[contenteditable]')) return;
  if (B && B.els.overlay.hidden) {
    const k = ev.key.toLowerCase();
    if (ev.repeat) return;
    if (k === 'r') { ev.preventDefault(); doRecord(); }
    else if (k === ' ') { ev.preventDefault(); if (B.g.takes.get(curLine().id) && B.busy !== 'replay') doTake(); else doReplay(); }
    else if (k === 'o') { ev.preventDefault(); doReplay(); }
    else if (k === 'enter' && !ev.target.matches?.('button,a')) { ev.preventDefault(); doNext(); }
    else if (k === 'escape' && B.busy) { ev.preventDefault(); if (B.busy === 'count' || B.busy === 'rec') B.abort = true; else { stopPlayback(B.g); B.busy = null; setBadge(B.g, null); drawBooth(); } }
  } else if (R && ev.key === ' ' && !ev.target.matches?.('button,a')) { ev.preventDefault(); R.toggle?.(); }
});
['pointerdown', 'keydown'].forEach(evt => document.addEventListener(evt, () => G?.mixer?.resume(), true));
window.addEventListener('resize', () => { if (B) drawStrip(); });

// ---------------------------------------------------------------- RESULTS
async function renderResults(key) {
  const tok = ++routeTok;
  loadingPage('Adding up your score…');
  const pack = await resolvePack(key);
  if (tok !== routeTok) return;
  if (pack === undefined) return notFound('The pack list couldn’t be loaded. Check your connection.');
  if (!pack) return notFound();
  const g = session(pack);
  await g.takesLoaded;
  if (tok !== routeTok || g.dead) return;
  const lines = boothLines(g);
  const rows = lines.map(l => ({ l, tk: g.takes.get(l.id), skip: g.skipped.has(l.id) }));
  const recorded = rows.filter(r => r.tk);
  if (!recorded.length) {
    $main.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'empty wide' }, icon('mic', 'empty-ic'), h('p', { class: 'empty-t' }, 'Nothing recorded yet'),
      h('p', { class: 'muted' }, 'Record at least one line to see your score and your dub.'),
      h('a', { class: 'btn primary', href: `#/play/${key}/1` }, icon('mic'), h('span', { class: 'btn-l' }, 'Go to the booth')))));
    return;
  }
  const total = Math.round(rows.reduce((n, r) => n + (r.tk?.score || 0), 0) / rows.length);
  const belt = beltOf(total);
  const all = bests(); const prev = all[pack.key];
  const complete = rows.every(r => r.tk || r.skip);
  const isBest = complete && (!prev || total > prev.score);
  if (isBest) { all[pack.key] = { score: total, at: Date.now() }; store.set(BEST_KEY, all); }
  const [kicker, main] = splitTitle(pack.title);
  const me = R = { g, total, blob: null, name: `${slug(pack.title)}-dubdojo`, cancel: false, opts: { tag: true, subs: true } };

  const scoreEl = h('span', { class: 'res-num' }, '0');
  const playBtn = h('button', { type: 'button', class: 'pb-play', 'aria-label': 'Play my dub' }, icon('play'));
  const seek = h('input', { type: 'range', class: 'pb-seek', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Position in the dub' });
  const time = h('span', { class: 'pb-time' }, '0:00 / ' + fmtDur(pack.clipEnd - pack.clipStart));
  const prog = h('div', { class: 'xprog', hidden: true }, h('div', { class: 'bar' }, h('i')), h('p', { class: 'muted small' }));
  const dlBtn = btn('primary', 'download', 'Download video', () => doDownload());
  const shareBtn = btn('sec', 'share', 'Share', () => doShare());
  const noExport = !g.canMix || pack.src.kind === 'youtube';
  if (noExport) { dlBtn.disabled = shareBtn.disabled = true; dlBtn.title = 'This video’s audio can’t be captured (YouTube or a link without CORS).'; }
  const nextKey = (() => { const L = CAT.starter; const k = L.findIndex(p => p.key === pack.key); return L.length ? L[(k + 1) % L.length].key : null; })();

  const page = h('div', { class: 'page results' },
    h('section', { class: 'res-hero' + (isBest ? ' best' : '') },
      h('div', { class: 'res-belt' }, beltSvg(belt, 132)),
      h('div', { class: 'res-score' }, scoreEl, h('span', { class: 'res-of' }, '/ 100')),
      h('div', { class: 'res-rank' },
        h('p', { class: 'eyebrow' }, 'Your rank'),
        h('h1', {}, belt.name), h('p', { class: 'muted' }, belt.tag + ' · ', `${recorded.length} of ${rows.length} lines dubbed`),
        isBest ? h('span', { class: 'new-best' }, icon('trophy'), 'New personal best!') : prev ? h('span', { class: 'muted small' }, `Your best: ${prev.score}`) : null),
      h('div', { class: 'res-pack' }, h('span', { class: 'muted' }, kicker || pack.film), h('strong', {}, main))),
    h('div', { class: 'res-grid' },
      h('div', { class: 'res-left' },
        h('div', { class: 'vwrap' }, g.stage),
        h('div', { class: 'pbar' }, playBtn, seek, time),
        h('div', { class: 'res-actions' }, dlBtn, shareBtn,
          btn('ghost', 'replay', 'Play again', () => navigate(`#/play/${key}/1/new`)),
          nextKey ? h('a', { class: 'btn ghost', href: '#/pack/' + nextKey }, h('span', { class: 'btn-l' }, 'Next pack'), icon('arrowRight')) : null),
        h('div', { class: 'xopts' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: ev => { me.opts.tag = ev.target.checked; me.blob = null; } }), 'Add “Dubbed on DubDojo” tag'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: ev => { me.opts.subs = ev.target.checked; me.blob = null; } }), 'Burn in subtitles')),
        noExport ? h('p', { class: 'muted small' }, 'Video download needs a video whose audio the browser can capture; this one can only be watched here.') : null,
        prog,
        attributionBox(pack)),
      h('div', { class: 'res-right' },
        h('h2', { class: 'panel-h' }, 'Your takes'),
        h('ol', { class: 'takes' }, rows.map((r, k) => {
          const c = charOf(pack, r.l.speaker);
          return h('li', { class: 'take-row' },
            h('span', { class: 'tr-n' }, String(k + 1)),
            h('div', { class: 'tr-main' }, speakerChip(c), h('p', { class: 'tr-text' }, r.l.text),
              h('span', { class: 'muted small' }, r.tk ? r.tk.note : r.skip ? 'Skipped (original voice)' : 'Not recorded')),
            h('span', { class: 'score-pill ' + scoreCls(r.tk?.score) }, r.tk ? String(r.tk.score) : '–'),
            h('a', { class: 'btn ghost sm', href: `#/play/${key}/${k + 1}/redo`, 'aria-label': `Redo line ${k + 1}` }, icon('replay'), h('span', { class: 'btn-l' }, 'Redo')));
        })))),
    footer());
  $main.replaceChildren(page);

  // count-up
  const t0 = performance.now();
  const tick = now => { if (R !== me) return; const f = Math.min(1, (now - t0) / 1100); scoreEl.textContent = String(Math.round(total * (1 - Math.pow(1 - f, 3)))); if (f < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  // inline player for the finished dub
  const dubIds = recorded.map(r => r.l.id);
  const len = pack.clipEnd - pack.clipStart;
  const setPlayIcon = playing => { playBtn.replaceChildren(icon(playing ? 'pause' : 'play')); playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play my dub'); g.els.big.hidden = playing; };
  let seeking = false;
  seek.addEventListener('input', () => { seeking = true; });
  seek.addEventListener('change', async () => {
    const t = pack.clipStart + (seek.value / 1000) * len; seeking = false;
    if (g.mode === 'dub') { g.player.seek(t); } else await play(t);
  });
  g.onFrame = t => {
    if (R !== me) return;
    const l = pack.lines.find(x => t >= x.start - 0.1 && t < x.end + 0.2);
    setTele(g, l, { you: !!l && dubIds.includes(l.id) });
    if (!seeking) seek.value = String(Math.round(clamp((t - pack.clipStart) / len) * 1000));
    time.textContent = `${fmtDur(t - pack.clipStart)} / ${fmtDur(len)}`;
    if (me.exporting) me.exportFrame?.(t);
  };
  async function play(from = pack.clipStart) {
    if (!(await g.ready) || R !== me) return;
    if (g.aiOthers && g.role !== '*') await prepareAI(g, prog);
    if (R !== me) return;
    armClips(g, dubIds, g.aiOthers && g.role !== '*');
    setBadge(g, 'dub', 'Your dub');
    const ok = await playRange(g, from, pack.clipEnd, 'dub', () => { setPlayIcon(false); setBadge(g, null); });
    setPlayIcon(ok);
    if (!ok) setBadge(g, null);
  }
  me.toggle = () => {
    if (me.exporting) return;
    if (g.mode === 'dub' && !g.player.paused()) { stopPlayback(g); setPlayIcon(false); setBadge(g, null); }
    else { const t = pack.clipStart + (seek.value / 1000) * len; play(t >= pack.clipEnd - 0.3 ? pack.clipStart : t); }
  };
  playBtn.onclick = me.toggle;
  g.els.big.onclick = me.toggle;
  play();

  // export / share
  async function doDownload() {
    if (me.busy) return;
    if (!me.blob) { if (!await doExport()) return; }
    download(me.file.name, me.blob, me.blob.type);
    toast(`Saved ${me.file.name} (${(me.blob.size / 1048576).toFixed(1)} MB)`);
  }
  async function doShare() {
    if (me.busy) return;
    if (!me.blob) {
      if (!await doExport()) return;
      shareBtn.querySelector('.btn-l').textContent = 'Share video';
      toast('Your video is ready. Tap Share video to send it.');
      return;
    }
    const file = me.file;
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: pack.title, text: `I dubbed “${pack.title}” on DubDojo and scored ${total}!` }); }
      catch (err) { if (err.name !== 'AbortError') { download(file.name, me.blob, me.blob.type); toast('Sharing failed, so the video was downloaded instead.'); } }
    } else { download(file.name, me.blob, me.blob.type); toast('This browser can’t share files, so the video was downloaded instead.'); }
  }
  async function doExport() {
    me.busy = true; dlBtn.disabled = shareBtn.disabled = true;
    prog.hidden = false;
    const bar = prog.querySelector('i'), msg = prog.querySelector('p');
    msg.textContent = 'Creating your video… keep this tab open.';
    try {
      const blob = await exportDub(g, me, dubIds, f => { bar.style.width = (f * 100).toFixed(1) + '%'; msg.textContent = `Creating your video… ${Math.round(f * 100)}%. Keep this tab open.`; });
      if (!blob) { msg.textContent = 'Video export was cancelled.'; return false; }
      const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
      me.blob = blob; me.file = new File([blob], `${me.name}.${ext}`, { type: blob.type });
      msg.textContent = `Your video is ready (${(blob.size / 1048576).toFixed(1)} MB).`;
      return true;
    } catch (err) {
      msg.textContent = 'Export failed: ' + (err.message || err);
      return false;
    } finally {
      me.busy = false;
      if (R === me) { dlBtn.disabled = shareBtn.disabled = noExport; setPlayIcon(false); }
    }
  }
}

async function prepareAI(g, prog) {
  const others = g.pack.lines.filter(l => l.speaker !== g.role && !g.aiBufs.has(l.id) && l.text.trim());
  if (!others.length) return;
  const msg = prog.querySelector('p'); prog.hidden = false; prog.querySelector('i').style.width = '0%';
  let fail = 0;
  for (const [k, l] of others.entries()) {
    msg.textContent = `Preparing AI voices ${k + 1} / ${others.length}…`;
    try {
      const v = charOf(g.pack, l.speaker).voice || {};
      let buf = await decodeBlob(await Voices.speak(v, l.text));
      const win = Math.max(0.4, l.end - l.start);
      if (buf.duration > 1.15 * win) buf = await decodeBlob(await Voices.speak({ ...v, rate: Math.min(1.6, (v.rate || 1) * buf.duration / win) }, l.text));
      if (g.dead) return;
      g.aiBufs.set(l.id, buf);
    } catch (e) { fail++; console.warn('AI voice failed', e); }
    prog.querySelector('i').style.width = `${Math.round(100 * (k + 1) / others.length)}%`;
  }
  prog.hidden = true;
  if (fail) toast(`${fail} AI line(s) failed; the original voice plays there.`);
}

/** Renders clipStart..clipEnd with the dub mix to a video file (canvas + MediaRecorder), plus a credits end card. */
async function exportDub(g, me, dubIds, onProgress) {
  const p = g.player, mx = g.mixer, pack = g.pack;
  if (!g.canMix || p.kind !== 'html') throw new Error('this video’s audio can’t be captured');
  const mime = window.MediaRecorder && D.VIDEO_TYPES.find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error('this browser can’t record video');
  const v = p.el; const W = v.videoWidth || 854, H = v.videoHeight || 480;
  const canvas = h('canvas', { width: W, height: H }); const x = canvas.getContext('2d');
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...mx.exportDest.stream.getAudioTracks()]);
  const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3.5e6 });
  const chunks = []; mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { mr.onstop = r; });
  const END = 2.6, len = pack.clipEnd - pack.clipStart;
  const credit = `${pack.attribution.split(/[.,(]/)[0].slice(0, 70)} · ${pack.license}`.replace(/^ · /, '');
  stopPlayback(g);
  if (g.aiOthers && g.role !== '*') armClips(g, dubIds, true); else armClips(g, dubIds, false);
  await seekTo(g, pack.clipStart); await canPlay(g);
  let raf = 0, phase = 'video', endT0 = 0;
  const draw = () => {
    raf = requestAnimationFrame(draw);
    if (phase === 'video') {
      x.drawImage(v, 0, 0, W, H);
      const t = v.currentTime;
      if (me.opts.subs) { const l = pack.lines.find(z => t >= z.start && t < z.end); if (l) D.drawSub(x, W, H, `${charOf(pack, l.speaker).name}: ${l.text}`); }
      if (me.opts.tag) cornerTag(x, W, H);
      if (credit) smallCredit(x, W, H, credit);
      onProgress(clamp((t - pack.clipStart) / (len + END)));
    } else {
      const f = (performance.now() - endT0) / 1000;
      endCard(x, W, H, pack, me.total);
      onProgress(clamp((len + f) / (len + END)));
    }
  };
  draw();
  mr.start(500);
  g.mode = 'dub'; me.exporting = true;
  setBadge(g, 'dub', 'Recording your video');
  if (!await playV(g)) { cancelAnimationFrame(raf); mr.stop(); me.exporting = false; throw new Error('playback was blocked; press Download again'); }
  const ok = await new Promise(res => {
    const chk = () => {
      if (g.dead || R !== me) return res(false);
      if (v.currentTime >= pack.clipEnd || v.ended) return res(true);
      if (p.paused()) return res(false);
      setTimeout(chk, 50);
    };
    chk();
  });
  p.pause(); g.mode = 'idle'; mx.stopAll();
  if (ok) { phase = 'end'; endT0 = performance.now(); await wait(END * 1000); }
  cancelAnimationFrame(raf);
  if (mr.state !== 'inactive') mr.stop();
  await stopped;
  me.exporting = false;
  if (R === me) setBadge(g, null);
  if (!ok) return null;
  return new Blob(chunks, { type: mime.split(';')[0] });
}
function roundRect(x, X, Y, w, hh, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + hh, r); x.arcTo(X + w, Y + hh, X, Y + hh, r); x.arcTo(X, Y + hh, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
function cornerTag(x, W, H) {
  const fs = Math.max(12, Math.round(H * 0.032)); const pad = fs * 0.6;
  x.font = `700 ${fs}px "Bricolage Grotesque", system-ui, sans-serif`;
  const text = 'Dubbed on DubDojo'; const tw = x.measureText(text).width;
  const w = tw + pad * 2 + fs * 1.1, hh = fs * 1.9, X = W - w - fs * 0.8, Y = fs * 0.8;
  x.fillStyle = 'rgba(11,16,32,.72)'; roundRect(x, X, Y, w, hh, hh / 2); x.fill();
  x.fillStyle = '#ff7a3d'; x.beginPath(); x.arc(X + pad + fs * 0.35, Y + hh / 2, fs * 0.35, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(text, X + pad + fs * 1.0, Y + hh / 2 + 1);
}
function smallCredit(x, W, H, text) {
  const fs = Math.max(9, Math.round(H * 0.022));
  x.font = `500 ${fs}px Inter, system-ui, sans-serif`; x.textAlign = 'left'; x.textBaseline = 'top';
  x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.6)'; x.fillStyle = 'rgba(255,255,255,.85)';
  x.strokeText(text, fs, fs); x.fillText(text, fs, fs);
}
function wrapText(x, text, maxW) {
  const out = []; let cur = '';
  for (const w of text.split(/\s+/)) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out;
}
function endCard(x, W, H, pack, total) {
  const gr = x.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#0b1020'); gr.addColorStop(1, '#1b1440');
  x.fillStyle = gr; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const big = Math.round(H * 0.085);
  x.fillStyle = '#ff7a3d'; x.font = `800 ${big}px "Bricolage Grotesque", system-ui, sans-serif`; x.fillText('Dubbed on DubDojo', W / 2, H * 0.27);
  x.fillStyle = '#fff'; x.font = `700 ${Math.round(H * 0.05)}px "Bricolage Grotesque", system-ui, sans-serif`; x.fillText(`${pack.title} · score ${total}`, W / 2, H * 0.38);
  x.fillStyle = 'rgba(238,241,251,.8)'; const fs = Math.max(10, Math.round(H * 0.03)); x.font = `500 ${fs}px Inter, system-ui, sans-serif`;
  const lines = wrapText(x, pack.attribution || pack.title, W * 0.84).slice(0, 6);
  lines.forEach((l, i) => x.fillText(l, W / 2, H * 0.5 + i * fs * 1.35));
  if (pack.license) {
    x.fillStyle = '#ffc857'; x.font = `600 ${fs}px Inter, system-ui, sans-serif`;
    x.fillText(`License: ${pack.license}${pack.shareAlike ? ' · share alike' : ''}`, W / 2, H * 0.5 + lines.length * fs * 1.35 + fs * 0.9);
  }
}

// ---------------------------------------------------------------- routes
ROUTES[''] = { nav: 'home', tab: 'game', render: () => renderHome(true), leave: gameLeave };
ROUTES.packs = { nav: 'packs', tab: 'game', render: () => renderHome(false), leave: gameLeave };
ROUTES.pack = { nav: 'packs', tab: 'game', render: renderIntro, leave: gameLeave };
ROUTES.play = { nav: 'home', tab: 'game', immersive: true, render: renderBooth, leave: gameLeave };
ROUTES.results = { nav: 'home', tab: 'game', render: renderResults, leave: gameLeave };

// handles for tests / debugging
window.DubGame = { get G() { return G; }, get B() { return B; }, get R() { return R; }, CAT, getPack, beltOf, loadStarter, takeKey };
})();
