# Publishing RufeShell

1. Set the same version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`.
2. Update the lockfiles and run `npm run build` and the Rust test suite.
3. Commit the release and create an annotated tag such as `v1.3.0`.
4. Push `master` and the tag to GitHub.

```powershell
git push origin master
git push origin v1.3.0
```

The tag triggers `.github/workflows/release.yml`. Five native build jobs publish
Windows x64/ARM64, Linux x64, Apple Silicon, and Intel macOS packages along with
signed updater manifests (`latest.json` and `.sig` files) to the corresponding
GitHub Release.
Uploaded package names include the version, Windows/Linux/macOS platform,
architecture, and NSIS setup suffix where applicable.

Configure these repository secrets under **Settings > Secrets and variables > Actions**:

- `TAURI_SIGNING_PRIVATE_KEY`: Contents of your private updater signing key (`~/.tauri/rufeshell.key`).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Signing key password (omit or leave blank if key has no password).

The workflow also requires Actions to have **Read and write permissions**
under the repository's **Settings > Actions > General > Workflow permissions**.

For an existing tag, use **Actions > Build and release > Run workflow** on
`master`. The action publishes packages built from that commit under the version
recorded in `tauri.conf.json`, without moving the existing tag.
