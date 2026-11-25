import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
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
const artifactDirectories = fs.readdirSync(packagesDirectory)
  .map(directory => ({ directory, match: directory.match(/^rufeshell-(windows|linux|darwin)-(x86_64|aarch64)$/) }))
  .filter(item => item.match);

function releaseAssetName(bundlePath, platform) {
  return path.basename(bundlePath)
    .replace(/^RufeShell\.app\.tar\.gz$/, `RufeShell_${archFromBundlePath(bundlePath)}.app.tar.gz`)
    .replace(/^RufeShell[_-]/, `RufeShell_v${version}_${platform === 'linux' ? 'Linux' : platform}_`)
    .replace(`_${version}_`, '_')
    .replace('_en-US.msi', '.msi');
}

function archFromBundlePath(bundlePath) {
  const directory = bundlePath.split(path.sep).find(part => /^rufeshell-/.test(part));
  const match = directory?.match(/^rufeshell-(windows|linux|darwin)-(x86_64|aarch64)$/);
  if (!match) throw new Error(`Unknown artifact directory: ${bundlePath}`);
  return match[2] === 'x86_64' && match[1] === 'darwin' ? 'x64' : match[2] === 'x86_64' ? 'amd64' : match[2];
}

const artifacts = artifactDirectories.map(({ directory, match }) => {
  const [, platform, arch] = match;
  const signatures = fs.globSync('**/*.sig', { cwd: path.join(packagesDirectory, directory) })
    .map(file => path.join(packagesDirectory, directory, file));
  const zip = new AdmZip();

  for (const signaturePath of signatures) {
    const bundlePath = signaturePath.slice(0, -4);
    const assetName = releaseAssetName(bundlePath, platform);
    const asset = assets.find(item => item.name === assetName);
    if (!asset) throw new Error(`Missing release package: ${assetName} (${signaturePath})`);
    const bundle = signaturePath.includes('.app.tar.gz') ? 'app'
      : signaturePath.includes('.AppImage') ? 'appimage'
        : signaturePath.endsWith('.exe.sig') ? 'nsis'
          : signaturePath.endsWith('.msi.sig') ? 'msi' : path.extname(bundlePath).slice(1);
    const entry = { signature: fs.readFileSync(signaturePath, 'utf8'), url: asset.browser_download_url };
    manifest.platforms[`${platform}-${arch}-${bundle}`] = entry;
    if (['nsis', 'app', 'appimage'].includes(bundle)) manifest.platforms[`${platform}-${arch}`] = entry;
    zip.addFile(path.basename(signaturePath), fs.readFileSync(signaturePath));
  }

  if (signatures.length === 0) throw new Error(`No signatures found for ${directory}`);
  return { platform, arch, name: `RufeShell_v${version}_${platform}_${arch}-Signatures.zip`, data: zip.toBuffer() };
});

for (const asset of assets) {
  if (asset.name.endsWith('.sig') || asset.name === 'latest.json' || asset.name.endsWith('-Signatures.zip')) {
    await octokit.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: asset.id });
  }
}

for (const { name, data } of artifacts) {
  await octokit.rest.repos.uploadReleaseAsset({
    owner, repo, release_id: release.id, name, data,
    headers: { 'content-type': 'application/zip', 'content-length': data.length },
  });
}

const data = Buffer.from(JSON.stringify(manifest, null, 2));
await octokit.rest.repos.uploadReleaseAsset({
  owner, repo, release_id: release.id, name: 'latest.json', data,
  headers: { 'content-type': 'application/json', 'content-length': data.length },
});

console.log(`Published ${artifacts.length} signature archives and latest.json for ${tag}.`);
