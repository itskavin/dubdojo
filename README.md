# DubDojo

Dub scenes from movies, series and anime with your own voice. You get a timing score for each line, and AI voices can read the parts you don't record. When you're done, export the dubbed video or share your work as a dub pack.

**Story mode** is also included: write branching stories, voice every line yourself, then play them.

It runs entirely in the browser. There's no backend, no accounts and no build step, and it costs nothing to host.

## Run locally
```
cd choicer-voicer && python3 -m http.server 8000   # then open http://localhost:8000
```
The microphone only works over `https://` or on `localhost`. Opening the file directly (`file://`) won't work.

## Voice engines
- **Browser robot voice:** the browser's built-in speech. It's instant and needs no download, but the voices differ from device to device.
- **Kokoro-82M** via `kokoro-js`: 28 English voices, Apache-2.0. About 92 MB, downloaded once when you first use it.
- **Piper** via `onnxruntime-web`: the official `rhasspy/piper-voices` catalog has 183 models covering 2,719 speakers in 58 languages. Each voice has its own license (check its MODEL_CARD). `lessac` and `ryan` are **non-commercial**.
- **Custom Piper models:** load any Piper `.onnx` model together with its `.onnx.json` config. The files stay in your browser.
- **Whisper** (transformers.js): writes the script automatically and translates lines.

## Content policy
- Bring your own clips, for personal use. DubDojo doesn't bundle any copyrighted media.
- The only bundled sample is the *Sintel* trailer (CC-BY 3.0, © Blender Foundation).
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
1. A pack browser that reads the hub's catalog
2. Multiplayer co-op dubbing
3. Better scoring (pitch and emotion, not only timing)
4. Mobile polish
