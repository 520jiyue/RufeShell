import fs from 'node:fs';
import path from 'node:path';
import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '520jiyue/RufeShell').split('/');
const tag = process.env.RELEASE_TAG;
const packagesDirectory = path.resolve(process.env.RELEASE_PACKAGES ?? 'packages');
if (!tag) throw new Error('RELEASE_TAG is required');

const version = tag.replace(/^v/, '');
const release = (await octokit.rest.repos.getReleaseByTag({ owner, repo, tag })).data;
const assets = (await octokit.rest.repos.listReleaseAssets({ owner, repo, release_id: release.id, per_page: 100 })).data;
const manifest = { version, notes: release.body, pub_date: new Date().toISOString(), platforms: {} };
const expectedAssets = new Set([
  `RufeShell_v${version}_windows_x64-setup.exe`,
  `RufeShell_v${version}_windows_x64-portable.zip`,
  `RufeShell_v${version}_windows_arm64-setup.exe`,
  `RufeShell_v${version}_darwin_aarch64.dmg`,
  `RufeShell_v${version}_darwin_x64.dmg`,
  `RufeShell_v${version}_darwin_aarch64.app.tar.gz`,
  `RufeShell_v${version}_darwin_x64.app.tar.gz`,
  `RufeShell_v${version}_Linux_x64.AppImage`,
  `RufeShell_v${version}_Linux_x64.deb`,
  'latest.json',
]);
const artifactDirectories = fs.readdirSync(packagesDirectory)
  .map(directory => ({ directory, match: directory.match(/^rufeshell-(windows|linux|darwin)-(x86_64|aarch64)$/) }))
  .filter(item => item.match);

function releaseAssetName(bundlePath, platform, arch) {
  const displayArch = platform === 'darwin' && arch === 'x86_64' ? 'x64' : arch;
  return path.basename(bundlePath)
    .replace(/^RufeShell\.app\.tar\.gz$/, `RufeShell_${displayArch}.app.tar.gz`)
    .replace(/^RufeShell[_-]/, `RufeShell_v${version}_${platform}_`)
    .replace(`_${version}_`, '_')
    .replace('_amd64.', '_x64.')
    .replace('_en-US.msi', '.msi');
}

artifactDirectories.forEach(({ directory, match }) => {
  const [, platform, arch] = match;
  const signatures = fs.globSync('**/*.sig', { cwd: path.join(packagesDirectory, directory) })
    .map(file => path.join(packagesDirectory, directory, file));

  for (const signaturePath of signatures) {
    const bundlePath = signaturePath.slice(0, -4);
    const assetName = releaseAssetName(bundlePath, platform, arch);
    const asset = assets.find(item => item.name === assetName);
    if (!asset) throw new Error(`Missing release package: ${assetName} (${signaturePath})`);
    const bundle = signaturePath.includes('.app.tar.gz') ? 'app'
      : signaturePath.includes('.AppImage') ? 'appimage'
        : signaturePath.endsWith('.exe.sig') ? 'nsis'
          : signaturePath.endsWith('.msi.sig') ? 'msi' : path.extname(bundlePath).slice(1);
    const entry = { signature: fs.readFileSync(signaturePath, 'utf8'), url: asset.browser_download_url };
    manifest.platforms[`${platform}-${arch}-${bundle}`] = entry;
    if (['nsis', 'app', 'appimage'].includes(bundle)) manifest.platforms[`${platform}-${arch}`] = entry;
  }

  if (signatures.length === 0) throw new Error(`No signatures found for ${directory}`);
});

for (const platform of ['windows-x86_64', 'windows-aarch64', 'linux-x86_64', 'darwin-x86_64', 'darwin-aarch64']) {
  if (!manifest.platforms[platform]) throw new Error(`Missing updater entry: ${platform}`);
}

const portableName = `RufeShell_v${version}_windows_x64-portable.zip`;
if (!assets.some(asset => asset.name === portableName)) {
  const portablePath = fs.globSync(`rufeshell-windows-x86_64/**/${portableName}`, { cwd: packagesDirectory })[0];
  if (!portablePath) throw new Error('Missing Windows x64 portable archive');
  const data = fs.readFileSync(path.join(packagesDirectory, portablePath));
  await octokit.rest.repos.uploadReleaseAsset({
    owner, repo, release_id: release.id, name: portableName, data,
    headers: { 'content-type': 'application/zip', 'content-length': data.length },
  });
}

for (const asset of assets) {
  if (!expectedAssets.has(asset.name)) {
    await octokit.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: asset.id });
  }
}

const data = Buffer.from(JSON.stringify(manifest, null, 2));
await octokit.rest.repos.uploadReleaseAsset({
  owner, repo, release_id: release.id, name: 'latest.json', data,
  headers: { 'content-type': 'application/json', 'content-length': data.length },
});

console.log(`Published the fixed ${tag} release asset set and latest.json.`);
