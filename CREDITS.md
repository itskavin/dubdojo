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
| [Lucide](https://lucide.dev) icons | ISC | Icon paths in `icons.js`. Copyright (c) Lucide Contributors (ISC License); portions Copyright (c) 2013-2022 Cole Bemis (MIT, Feather). |
| [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque), [Inter](https://fonts.google.com/specimen/Inter) | SIL OFL 1.1 | Loaded from Google Fonts |

## Starter dub packs

`packs/starter.json` holds 15 short scenes from open-licensed films. The video streams from Wikimedia Commons (480p VP9 transcodes); line text and timings come from the films' official English subtitles on Commons. Card thumbnails are Commons-generated frames of the same files. The pack intro, the results screen and every exported video (corner credit and end card) show the attribution and license.

Packs under **CC BY-SA** (Morevna, Pepper&Carrot, Cosmos Laundromat) are ShareAlike: a dub you share must be released under the same license, with the credit kept.

| Film | License | Attribution |
|---|---|---|
| Morevna Episode 3: Underground (English, v3.0.2) | CC BY-SA 4.0 | Morevna Episode 3 "Underground" (English, v3.0.2) by Morevna Project (morevnaproject.org) in association with "Adamant" Art School of Gorno-Altaisk, licensed CC BY-SA 4.0. Music: Mattias Westlund, Kevin MacLeod (incompetech.com), The Vegetarians, Radio Nowhere, Geigermeister, Deadly Past, Grégoire Lourme, Other Noises, Per Kiilstofte (CC BY / CC BY-SA) ([source](https://commons.wikimedia.org/wiki/File:Morevna_Episode_3.0.2_(English).webm)) |
| Pepper&Carrot Episode 6: The Potion Contest (animated) | CC BY-SA 4.0 | Pepper&Carrot Episode 6 "The Potion Contest" (animated) by Morevna Project (morevnaproject.org) in association with Ethic Cinema, music by Grégoire Lourme, based on the webcomic by David Revoy (peppercarrot.com); licensed CC BY-SA 4.0 ([source](https://commons.wikimedia.org/wiki/File:Morevna_Project_-_Pepper%26Carrot_(animated_comic)_-_Episode_6_-_The_Potion_Contest.webm)) |
| Pepper&Carrot Episode 3: The Secret Ingredients (animated) | CC BY-SA 4.0 | Pepper&Carrot Episode 3 "The Secret Ingredients" animated by Morevna Project (morevnaproject.org), based on the webcomic by David Revoy (peppercarrot.com), licensed CC BY-SA 4.0 ([source](https://commons.wikimedia.org/wiki/File:Pepper%26Carrot_Episode_3_-_The_Secret_Ingredients.ogv)) |
| Sintel (2010) | CC BY 3.0 | Sintel (2010) by the Blender Foundation / Durian Open Movie Project, www.sintel.org, licensed CC BY 3.0 ([source](https://commons.wikimedia.org/wiki/File:Sintel_movie_4K.webm)) |
| Elephants Dream (2006) | CC BY 2.5 | Elephants Dream (2006) by the Orange Open Movie Project (Blender Foundation / Netherlands Media Art Institute), orange.blender.org, licensed CC BY 2.5 ([source](https://commons.wikimedia.org/wiki/File:Elephants_Dream_(2006).webm)) |
| Cosmos Laundromat: First Cycle (2015) | CC BY-SA 3.0 | Cosmos Laundromat: First Cycle (2015) by the Blender Institute / Gooseberry Open Movie Project, gooseberry.blender.org, licensed CC BY-SA 3.0 ([source](https://commons.wikimedia.org/wiki/File:Cosmos_Laundromat_-_First_Cycle_-_Official_Blender_Foundation_release.webm)) |
| Sprite Fright (2021) | CC BY 4.0 | Sprite Fright (2021) by Blender Studio, studio.blender.org, licensed CC BY 4.0 ([source](https://commons.wikimedia.org/wiki/File:Sprite_Fright_-_Blender_Open_Movie-full_movie.webm)) |
| Tears of Steel (2012) | CC BY 3.0 | Tears of Steel (2012) by the Blender Foundation / Mango Open Movie Project, mango.blender.org, licensed CC BY 3.0 ([source](https://commons.wikimedia.org/wiki/File:Tears_of_Steel_1080p.webm)) |
