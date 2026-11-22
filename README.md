# DubDojo

A free dubbing game in the browser: pick a scene, record each line with your own voice, get a sync score and a belt, and download your dub.

**How it plays**
1. **Home** – hit *Play now* (straight into an easy anime-style scene) or pick one of 15 starter packs (open-licensed films from Wikimedia Commons).
2. **Pack intro** – watch the scene, choose to dub every role or one character (the others keep the original voice, or an AI voice).
3. **Booth** – one line at a time: *Replay* hears the original, *Record* counts 3-2-1 and plays the scene with the original voice muted while you speak (no headphones needed), then you get a score and your waveform against the line window. Keys: R record, Space play, O original, Enter next.
4. **Results** – total score and belt (White → Black), your dub plays inline, redo any line, download the video (with credits) or share it.
5. **Make a pack** – the editor: load a video file, link or YouTube clip, import subtitles or auto-script with Whisper, set characters, AI voices and a clip range, export/import `.dubpack.zip`, then *Play this pack*.

**Story mode** is also included: write branching stories, voice every line yourself, then play them.

It runs entirely in the browser. There's no backend, no accounts and no build step, and it costs nothing to host.

## Run locally
```
cd choicer-voicer && python3 -m http.server 8000   # then open http://localhost:8000
```
The microphone only works over `https://` or on `localhost`. Opening the file directly (`file://`) won't work.

## Import The Choicer Voicer packs

In **Packs → Import pack (.zip)** or **Make a pack → Import pack**, select the downloaded ZIP directly. Video dub packs from The Choicer Voicer are detected using `_pack_info.ini`; DubDojo imports the title, authors, cover, captions, character names and exact `dub_timestamps`. Voice-clip lengths determine the line end times, including overlapping dialogue.

The importer converts `dub_video.ogv` and the supplied voice clips into a playable MP4 (up to 960 pixels wide) locally. The first import downloads about 31 MB of FFmpeg WASM; conversion can take a few minutes and can be cancelled. Music/effects from `_backing_track` stay separate and continue while you record. Original voice clips become reference audio, so they do not count as your recordings or scores. Exporting a `.dubpack.zip` with video preserves the backing track for re-import without another conversion.

Import one video dub pack per ZIP. Packs containing only soundboard clips and images, without a `dub_video` file, are not supported.

Run importer checks with `node --test tests/choicer-pack.test.cjs`.

## Voice engines
- **Browser robot voice:** the browser's built-in speech. It's instant and needs no download, but the voices differ from device to device.
- **Kokoro-82M** via `kokoro-js`: 28 English voices, Apache-2.0. About 92 MB, downloaded once when you first use it.
- **Piper** via `onnxruntime-web`: the official `rhasspy/piper-voices` catalog has 183 models covering 2,719 speakers in 58 languages. Each voice has its own license (check its MODEL_CARD). `lessac` and `ryan` are **non-commercial**.
- **Custom Piper models:** load any Piper `.onnx` model together with its `.onnx.json` config. The files stay in your browser.
- **Whisper** (transformers.js): writes the script automatically and translates lines.

## Content policy
- Bring your own clips, for personal use. DubDojo doesn't bundle any copyrighted media.
- The starter packs use open-licensed films only (CC BY / CC BY-SA, see [CREDITS.md](CREDITS.md)); the video streams from Wikimedia Commons.
- Only share a dub pack publicly if you have the rights to everything in it: the clip, the voices and the script.
- Don't clone a real person's voice without their consent.

## License
The phonemizers used by both Piper and Kokoro are built on eSpeak NG, which is GPL-3.0. For that reason, DubDojo's source is released under **GPL-3.0** (see [LICENSE](LICENSE)). Third-party licenses are listed in [CREDITS.md](CREDITS.md).

## Free hosting plan
- **Site:** Cloudflare Pages, connected to the GitHub repo. Static bandwidth is unlimited.
- **Pack hub:** a GitHub repo with a `packs/` folder and a `catalog.json`. People submit packs by pull request, and large files go in GitHub Releases.
- **Optional:** mirror the app on itch.io as an HTML5 game.

## Storage
Stories and settings are saved in `localStorage`, and recordings in IndexedDB (`dubdojo`). Export your packs to back them up: Safari can delete site data after 7 days without a visit.

## Roadmap
1. A community pack catalog
2. Multiplayer co-op dubbing
3. Better scoring (pitch and emotion, not only timing)
4. Mobile polish
