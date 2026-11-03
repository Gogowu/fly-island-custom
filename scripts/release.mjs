// Build a manually updated custom distribution; never publish upstream.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--no-upload')) throw new Error('Usage: pnpm release --no-upload. Publish reviewed files using the GitHub Release page.');
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const version = config.version;
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (version !== JSON.parse(readFileSync('package.json', 'utf8')).version || version !== cargo) throw new Error('Release version fields disagree.');
if (!existsSync(`docs/releases/v${version}.md`)) throw new Error('Missing release notes.');
if (config.plugins.updater.pubkey.trim()) throw new Error('This manual-release workflow requires automatic updating to remain disabled.');
function run(command, argv) {
  const result = spawnSync(command, argv, { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('node', ['scripts/collect-licenses.mjs']);
run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--ci', '--bundles', 'nsis,msi']);
const destination = `release-artifacts/v${version}`;
mkdirSync(destination, { recursive: true });
const assets = [];
for (const [kind, suffix] of [['nsis', `_${version}_x64-setup.exe`], ['msi', `_${version}_x64_en-US.msi`]]) {
  const directory = `src-tauri/target/release/bundle/${kind}`;
  const file = readdirSync(directory).find(name => name.endsWith(suffix));
  if (!file) throw new Error(`Missing ${kind} installer.`);
  copyFileSync(join(directory, file), join(destination, file));
  assets.push(file);
}
const legal = `fly-island-custom_${version}_licenses.zip`;
// Windows' bundled bsdtar creates ZIP archives without PowerShell module dependencies.
run('tar', ['-a', '-cf', `${destination}/${legal}`, 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses']);
assets.push(legal);
writeFileSync(join(destination, 'SHA256SUMS.txt'), assets.map(name => `${createHash('sha256').update(readFileSync(join(destination, name))).digest('hex')}  ${name}`).join('\n') + '\n');
console.log(`Release assets prepared at ${resolve(destination)}. Review and publish to Gogowu/fly-island-custom, tag v${version}.`);
