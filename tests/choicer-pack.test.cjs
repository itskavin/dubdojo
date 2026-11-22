'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = { window: {}, Blob, DOMException };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../choicer-pack.js'), 'utf8'), context);
const { parseINI, read, convert } = context.window.ChoicerPack;
const ini = data => '[data]\r\n' + Object.entries(data).map(([k, v]) => k + '=' + JSON.stringify(v)).join('\r\n');
function zip(overrides = {}) {
  const files = {
    'Folder/Scene/_pack_info.ini': ini({ title: 'Test scene', authors: ['Maker'], icon: 'icon.png' }),
    'Folder/Scene/dub_video.ogv': 'video',
    'Folder/Scene/icon.png': 'icon',
    'Folder/Scene/_backing_track.ogg': 'backing',
    'Folder/Scene/02_b.ini': ini({ caption: 'Second!', dub_timestamps: [4.07], dub_characters: ['Bear'] }),
    'Folder/Scene/02_b.mp3': 'voice2',
    'Folder/Scene/01_a.ini': ini({ caption: '“I love you…”', dub_timestamps: [0], dub_characters: ['Nikki'] }),
    'Folder/Scene/01_a.ogg': 'voice1',
    ...overrides,
  };
  return { names: Object.keys(files).filter(n => files[n] !== null), get: async (name, type = '') => files[name] == null ? null : new Blob([files[name]], { type }) };
}
test('Godot INI handles BOM, CRLF, whitespace, Unicode, escaped quotes and sections', () => {
  const data = parseINI('\uFEFF  [data]\r\n# comment\r\n' + 'caption="Say \\"hi\\" — now!"\r\n' + 'dub_timestamps=[0, 1.25]\r\n[other]\r\ncaption="ignored"');
  assert.equal(data.caption, 'Say "hi" — now!');
  assert.equal(JSON.stringify(data.dub_timestamps), '[0,1.25]');
  assert.throws(() => parseINI('[data]\ncaption="unfinished'), /Invalid caption/);
});
test('reads nested video pack and preserves timestamps, roles, credits and assets', async () => {
  const pack = await read(zip());
  assert.equal(pack.title, 'Test scene'); assert.equal(pack.authors, 'Maker');
  assert.deepEqual(Array.from(pack.refs, r => [r.start, r.speaker, r.text]), [[0, 'Nikki', '“I love you…”'], [4.07, 'Bear', 'Second!']]);
  assert.equal(pack.video.name, 'input.ogv'); assert.equal(pack.clips.length, 2);
  assert.equal(pack.backing.type, 'audio/ogg'); assert.equal(pack.icon.type, 'image/png');
});
test('repeated clips keep every timestamp and matching character without duplicating audio', async () => {
  const p = await read(zip({ 'Folder/Scene/01_a.ini': ini({ caption: 'Again', dub_timestamps: [8, 0], dub_characters: ['Nikki', 'Bear'] }) }));
  assert.deepEqual(Array.from(p.refs, r => [r.start, r.speaker]), [[0, 'Bear'], [4.07, 'Bear'], [8, 'Nikki']]);
  assert.equal(p.clips.length, 2); assert.equal(p.refs[0].file, p.refs[2].file);
});
test('supports uppercase extensions and optional backing/icon', async () => {
  const p = await read(zip({ 'Folder/Scene/01_a.ogg': null, 'Folder/Scene/01_A.OGG': 'voice', 'Folder/Scene/_backing_track.ogg': null, 'Folder/Scene/icon.png': null }));
  assert.equal(p.clips.length, 2); assert.equal(p.backing, null); assert.equal(p.icon, null);
});
test('rejects missing media before loading the converter', async () => {
  await assert.rejects(read(zip({ 'Folder/Scene/01_a.ogg': null })), /Missing voice clip/);
  await assert.rejects(read(zip({ 'Folder/Scene/dub_video.ogv': null })), /no dub_video/);
  await assert.rejects(read(zip({ 'Folder/Scene/_pack_info.ini': null })), /No DubDojo pack/);
});
test('rejects ambiguous multi-pack ZIP and invalid timing or role arrays', async () => {
  await assert.rejects(read(zip({ 'Another/_pack_info.ini': ini({ title: 'Another' }) })), /several packs/);
  for (const data of [
    { dub_timestamps: [-1], dub_characters: ['Nikki'] },
    { dub_timestamps: ['4'], dub_characters: ['Nikki'] },
    { dub_timestamps: [1, 2, 3], dub_characters: ['Nikki', 'Bear'] },
    { dub_timestamps: [1], dub_characters: [''] },
  ]) await assert.rejects(read(zip({ 'Folder/Scene/01_a.ini': ini({ caption: 'Bad', ...data }) })), /Invalid timestamps or characters/);
});
test('ignores unrelated files and refuses empty captions', async () => {
  const p = await read(zip({ '__MACOSX/Foo/_pack_info.ini': 'junk', 'Folder/Scene/unrelated.ini': ini({ title: 'Not a line' }) }));
  assert.equal(p.refs.length, 2);
  await assert.rejects(read(zip({ 'Folder/Scene/01_a.ini': ini({ caption: '', dub_timestamps: [0], dub_characters: ['Nikki'] }) })), /Missing caption/);
});
test('already cancelled imports never create a converter worker', async () => {
  await assert.rejects(convert({}, { signal: AbortSignal.abort() }), { name: 'AbortError' });
});
function studio(saved = []) {
  const g = { window: {}, store: { get: () => saved, set() {} }, uid: p => p + 'test',
    document: { addEventListener() {} }, ROUTES: {}, Blob, TextEncoder, TextDecoder, Response, DecompressionStream };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../scenes.js'), 'utf8'), g);
  return g.window.DubStudio;
}
test('saved imported packs reload after normalization helpers initialize', () => {
  const D = studio([{ id: 'saved', title: 'Imported', source: { kind: 'file', name: 'scene.mp4' }, chars: { nikki: { name: 'Nikki' } },
    lines: [{ id: 'cv_1', start: 0, end: 3.7, speaker: 'nikki', text: 'Hello' }], clipStart: 0, clipEnd: 75.1 }]);
  assert.equal(D.SC.list[0].lines[0].speaker, 'nikki');
  assert.equal(D.SC.list[0].clipEnd, 75.1);
});
test('backing scheduling survives dub clip clearing, pause and seek', () => {
  const { Mixer } = studio(); let time = 0, paused = false;
  const starts = [], stops = [];
  const mx = Object.create(Mixer.prototype);
  Object.assign(mx, { player: { time: () => time, paused: () => paused }, ctx: { state: 'running', currentTime: 0,
    createBufferSource: () => ({ connect() {}, start: (...args) => starts.push(args), stop: () => stops.push(true) }) },
    beds: new Map([['bed:backing', { buf: { duration: 80 }, offset: 0 }]]), clips: new Map(),
    muted: new Set(), active: new Map(), done: new Set(), dub: {}, started: 0, last: null });
  time = 12; mx.tick(); assert.equal(mx.active.has('bed:backing'), true); assert.equal(starts[0][1], 12);
  // Game armClips clears user takes; backing remains available.
  mx.stopAll(); mx.clips.clear(); time = 20; mx.tick(); assert.equal(starts[1][1], 20);
  paused = true; mx.tick(); assert.equal(mx.active.size, 0);
  paused = false; time = 2; mx.tick(); assert.equal(starts[2][1], 2); assert.equal(stops.length, 2);
});
test('cancelling an active import terminates its converter', async () => {
  let worker;
  context.Worker = class { constructor() { worker = this; } postMessage() {} terminate() { this.terminated = true; } };
  const controller = new AbortController();
  const job = convert({ refs: [] }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(job, { name: 'AbortError' });
  assert.equal(worker.terminated, true);
});
test('converter progress and errors reach the importer and release the worker', async () => {
  let worker; const updates = [];
  context.Worker = class { constructor() { worker = this; } postMessage() {} terminate() { this.terminated = true; } };
  const job = convert({ refs: [] }, { onProgress: t => updates.push(t) });
  worker.onmessage({ data: { op: 'progress', text: 'Converting… 50%' } });
  worker.onmessage({ data: { op: 'error', error: 'Invalid video' } });
  await assert.rejects(job, /Invalid video/);
  assert.deepEqual(updates, ['Converting… 50%']); assert.equal(worker.terminated, true);
});
