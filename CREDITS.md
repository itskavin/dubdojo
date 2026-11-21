# Credits and third-party licenses

DubDojo is GPL-3.0 (see LICENSE). It uses the components below, each under its own license:

| Component | License | Notes |
|---|---|---|
| [kokoro-js](https://github.com/hexgrad/kokoro) | Apache-2.0 | Kokoro TTS in the browser |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) weights | Apache-2.0 | 28 English voices |
| [Piper voices](https://huggingface.co/rhasspy/piper-voices) | Per voice | Each voice has its own license, listed in its `MODEL_CARD` file in the catalog. `lessac` and `ryan` are non-commercial. |
| @diffusionstudio/piper-wasm / piper_phonemize | See note | `vendor/piper_phonemize.js` comes from [@mintplex-labs/piper-tts-web](https://github.com/Mintplex-Labs/piper-tts-web) (MIT). Its phonemizer is built on [eSpeak NG](https://github.com/espeak-ng/espeak-ng), which is GPL-3.0. |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | MIT | Runs Piper models |
| [transformers.js](https://github.com/huggingface/transformers.js) | Apache-2.0 | Runs Whisper |
| [Whisper](https://github.com/openai/whisper) weights | MIT | Speech recognition and translation |
| [Sintel](https://durian.blender.org/) trailer | CC-BY 3.0 | © Blender Foundation, durian.blender.org |
