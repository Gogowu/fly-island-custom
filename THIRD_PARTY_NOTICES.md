# Third-party notices / 第三方声明

Fly Island Custom is independently distributed by Gogowu, not an official upstream release.

## fly-island

Source: https://github.com/flyl1u/fly-island

Copyright (c) 2026 flyl1u and contributors. Original MIT notice and terms remain in `LICENSE`. Original features and assets remain credited to upstream and their authors.

## BrimDeck reference adaptations

Source: https://github.com/MoFeng2223/BrimDeck

Apache License 2.0 is reproduced in `licenses/BrimDeck-Apache-2.0.txt`. No root NOTICE was present in the reviewed snapshot. Monitoring / quota designs and service-reading references were adapted to Rust / React. Modified by Gogowu contributors in 2026: native sampling, GPU identity mapping, optional panels, credential handling, caching/backoff and integration. Relevant files: `src/Monitoring.tsx`, `src/Monitoring.css`, `src-tauri/src/system_monitor.rs`, `src-tauri/src/ai_quota.rs`, `src-tauri/src/gpu_monitor.rs`. These adaptations are provided under Apache-2.0; the root MIT license does not replace third-party terms.

BrimDeck's monitor credits ftop (Nongfsq), MIT. Its notice is retained in `licenses/ftop-MIT.txt`. BrimDeck's .NET dependencies are not bundled here.

## Fonts and brand marks

Fusion Pixel Font and upstream notices are retained under SIL OFL-1.1 in `licenses/Fusion-Pixel-OFL.txt` and `licenses/font-upstream/`. Font files are unmodified.

QQ, WeChat and QQ Mail marks belong to Tencent / their respective owners. See `licenses/brand-notices.md`. They identify notification sources without implying endorsement; software licenses do not grant trademark rights.

## Dependencies

`licenses/DEPENDENCIES.md` lists lockfile-resolved Rust and npm packages, including build tools. `licenses/dependency-texts/` preserves license / notice texts from installed source packages. Each package retains its own terms. Generate this inventory using `scripts/collect-licenses.mjs`.

Installers include this notice, the root MIT license and `licenses/`. The legal archive provides the same notices without installing the program.
