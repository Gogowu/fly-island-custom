# Fly Island Custom

English · [中文](README.md)

A Windows floating productivity island derived from [flyl1u/fly-island](https://github.com/flyl1u/fly-island), independently maintained and distributed by Gogowu. This is not an official upstream or AI-provider release.

[Download](https://github.com/Gogowu/fly-island-custom/releases/latest) · [Issues](https://github.com/Gogowu/fly-island-custom/issues)

## Changes

- CPU, per-core, RAM, GPU, network and process monitoring. GPUs use actual names and device identities, without invented Task Manager-style numbering.
- Optional Codex / Claude quota panels: enable either, both or neither; Codex is enabled by default.
- DeepSeek or custom OpenAI-compatible translation providers, models and keys. Keyless localhost is supported; private-LAN HTTP requires explicit opt-in.
- Upstream update / Star links removed. Install updates manually from this repository; in-app updating is disabled.

Existing tasks, notes, clipboard, media, notifications and appearance features remain available. Monitoring / quota designs reference [BrimDeck](https://github.com/MoFeng2223/BrimDeck), adapted to Rust / React. See [feature details](docs/monitoring-and-translation.md).

## Installation

Windows 10 / 11 x64 and WebView2 Runtime are required. Use either `*-setup.exe` or `.msi`. Installers are not Authenticode-signed; Windows may identify the publisher as unknown. Verify downloads using `SHA256SUMS.txt`.

The original application identifier is retained for local data compatibility. Avoid installing or running alongside upstream. Back up important notes and settings before upgrading or uninstalling.

For private models, configure the model ID and Base URL, e.g. `http://192.168.1.2:11434/v1`, and enable private-LAN HTTP for a keyless LAN server. Public services require HTTPS. The server must support Chat Completions.

## Privacy and limitations

Translation sends input to your chosen provider, whose fees apply. Keys are stored in Windows Credential Manager. Quotas read local Codex / Claude Code login credentials and query their usage endpoints without uploading conversations or modifying login state. Claude Desktop encrypted credentials are unsupported. Endpoints are not stable public APIs; local token/cost estimates are not included. Live Claude-account queries have not been verified.

GPU availability depends on drivers and Windows counters; virtual network interfaces can cause duplicate totals. Clipboard, mail and notification features may handle sensitive local content; enable as needed. Published files exclude maintainer credentials and private model addresses.

## Development and licensing

Requires Node.js, pnpm, Rust stable, Visual Studio C++ Build Tools and Windows SDK.

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1
pnpm release --no-upload
```

See [release instructions](docs/RELEASING.md). The release command collects licenses, builds EXE / MSI installers and prepares checksums. Automatic updater signing is disabled.

Original copyright and MIT terms remain in [LICENSE](LICENSE). BrimDeck-derived adaptations use Apache-2.0 with ftop MIT attribution preserved. Fonts use SIL OFL-1.1; brand marks belong to their owners. See [third-party notices](THIRD_PARTY_NOTICES.md) and [licenses](licenses), included in binary distributions. The public repository starts from a sanitized snapshot; [provenance](docs/PROVENANCE.md) records its baselines.
