# Publishing RufeShell

1. Set the same version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`, then update the lockfiles.
2. Run `npm run build` and `.\scripts\dev-env.ps1 test`.
3. Commit the release and create an annotated tag such as `v1.3.1`.
4. Push `master` and the tag to GitHub.

```powershell
git push origin master
git push origin v1.3.1
```

The tag triggers `.github/workflows/release.yml`. Five native build jobs publish
Windows x64/ARM64, Linux x64, Apple Silicon, and Intel macOS packages.

Each release has a fixed asset set:

- Windows: x64 NSIS installer, x64 portable ZIP, and ARM64 NSIS installer.
- macOS: Apple Silicon and Intel DMG installers and signed `.app.tar.gz` updater archives.
- Linux: x64 AppImage and Debian package.
- `latest.json`: Tauri updater metadata with updater-package signatures embedded.

Standalone `.sig` files, MSI installers, RPM packages, and signature archives are
not published. Build filenames are normalized by the finalize script to match the
release convention.

Configure these repository secrets under **Settings > Secrets and variables > Actions**:

- `TAURI_SIGNING_PRIVATE_KEY`: Contents of your private updater signing key (`~/.tauri/rufeshell.key`).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Signing key password (omit or leave blank if key has no password).

The workflow also requires Actions to have **Read and write permissions**
under the repository's **Settings > Actions > General > Workflow permissions**.

For an existing tag, use **Actions > Build and release > Run workflow** on
`master`. The action publishes packages built from that commit under the version
recorded in `tauri.conf.json`, without moving the existing tag.
