// Preserve upstream license texts for the lockfile-resolved build environment.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, realpathSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';

const out = 'licenses/dependency-texts';
mkdirSync(out, { recursive: true });
const result = spawnSync('cargo', ['metadata', '--offline', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc', '--manifest-path', 'src-tauri/Cargo.toml'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
if (result.status !== 0) throw new Error(result.stderr);
const metadata = JSON.parse(result.stdout);
const rows = [];
const missing = [];
function record(ecosystem, name, version, license, directory, licenseFile) {
  const id = `${ecosystem}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}-${version}`;
  const files = new Set();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(licen[sc]e|copying|notice|copyright)([._-]|$)/i.test(entry.name)) files.add(join(directory, entry.name));
    if (entry.isDirectory() && /^(licenses?|legal)$/i.test(entry.name)) {
      for (const child of readdirSync(join(directory, entry.name), { withFileTypes: true })) {
        if (child.isFile()) files.add(join(directory, entry.name, child.name));
      }
    }
  }
  if (licenseFile && existsSync(join(directory, licenseFile))) files.add(join(directory, licenseFile));
  if (!files.size) {
    const fallback = name.startsWith('tauri') || name.startsWith('@tauri-apps/') ? ['licenses/supplemental/tauri-MIT.txt', 'licenses/supplemental/tauri-Apache-2.0.txt']
      : name.startsWith('unic-') ? ['licenses/supplemental/unic-MIT.txt']
      : name.startsWith('webview2-com') ? ['licenses/supplemental/webview2-MIT.txt']
      : name === 'clipboard-win' ? ['licenses/supplemental/clipboard-win-Boost.txt']
      : name === 'imap-proto' ? ['licenses/supplemental/imap-proto-MIT.txt']
      : name === 'alloc-stdlib' ? ['licenses/dependency-texts/cargo-alloc-no-stdlib-2.0.4-1-LICENSE.txt']
      : name === 'selectors' ? ['licenses/dependency-texts/cargo-cssparser-0.36.0-1-LICENSE.txt']
      : name.startsWith('@esbuild/') ? ['licenses/dependency-texts/npm-esbuild-0.28.1-1-LICENSE.md.txt']
      : name.startsWith('@rollup/') ? ['licenses/dependency-texts/npm-rollup-4.62.2-1-LICENSE.md.txt'] : [];
    for (const file of fallback) if (existsSync(file)) files.add(file);
  }
  const links = [];
  let index = 0;
  for (const file of files) {
    const target = `${id}-${++index}-${basename(file).replace(/[^a-zA-Z0-9._-]/g, '_')}.txt`;
    writeFileSync(join(out, target), readFileSync(file));
    links.push(`[${index}](dependency-texts/${target})`);
  }
  if (!files.size) missing.push(`${id}: ${license || 'UNKNOWN'}`);
  const source = ecosystem === 'cargo' ? `https://crates.io/crates/${name}/${version}` : `https://www.npmjs.com/package/${name}/v/${version}`;
  rows.push(`| ${ecosystem} | [${name}](${source}) | ${version} | ${license || 'See package source'} | ${links.join(', ') || 'See shared license texts / source'} |`);
}
for (const pkg of metadata.packages) {
  if (pkg.name === 'focusd-island') continue;
  record('cargo', pkg.name, pkg.version, pkg.license, pkg.manifest_path.replace(/[\\/][^\\/]+$/, ''), pkg.license_file);
  if (pkg.license === 'MPL-2.0') {
    const source = pkg.manifest_path.replace(/[\\/]src[\\/].*$/, '') + `/cache/${pkg.manifest_path.split(/[\\/]/).slice(-3, -2)[0]}/${pkg.name}-${pkg.version}.crate`;
    if (!existsSync(source)) throw new Error(`Missing original MPL source archive: ${pkg.name}`);
    mkdirSync('licenses/mpl-sources', { recursive: true });
    copyFileSync(source, `licenses/mpl-sources/${pkg.name}-${pkg.version}.crate`);
  }
}
const seen = new Set();
const queue = [realpathSync('package.json')];
for (let cursor = 0; cursor < queue.length; cursor++) {
  const manifest = queue[cursor];
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (cursor) record('npm', pkg.name, pkg.version, typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license), manifest.replace(/[\\/][^\\/]+$/, ''));
  const require = createRequire(manifest);
  const dependencies = {...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies, ...(cursor === 0 ? pkg.devDependencies : {})};
  for (const dependency of Object.keys(dependencies)) {
    const candidate = require.resolve.paths(dependency).map(base => join(base, dependency, 'package.json')).find(existsSync);
    if (candidate) queue.push(realpathSync(candidate));
  }
}
writeFileSync('licenses/DEPENDENCIES.md', '# Resolved dependency license inventory\n\nIncludes runtime dependencies, target-specific dependencies and build tooling present in the resolved dependency environment. Not all packages are included in each binary. Original terms apply; OR expressions permit a choice of the stated licenses. Package source and lockfiles identify exact versions.\n\n| Ecosystem | Package | Version | Declared license | Original texts |\n| --- | --- | --- | --- | --- |\n' + rows.sort().join('\n') + '\n');
console.log(`Collected ${rows.length} packages. Packages without standalone license files:\n${missing.join('\n')}`);
if (missing.length) throw new Error('Resolve missing license texts before distributing.');
