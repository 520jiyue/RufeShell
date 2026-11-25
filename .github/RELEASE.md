# Publishing RufeShell

1. Set the same version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`.
2. Update the lockfiles and run `npm run build` and the Rust test suite.
3. Commit the release and create an annotated tag such as `v1.2.0`.
4. Push `master` and the tag to GitHub.

```powershell
git push origin master
git push origin v1.2.0
```

The tag triggers `.github/workflows/release.yml`. Five native build jobs publish
Windows x64/ARM64, Linux x64, Apple Silicon, and Intel macOS packages to the
corresponding GitHub Release. No signing credentials are required. Packages are
currently unsigned, so operating systems may show an unknown-publisher warning.

The release workflow requires Actions to have **Read and write permissions**
under the repository's **Settings > Actions > General > Workflow permissions**.

For an existing tag, use **Actions > Build and release > Run workflow** on
`master`. The action publishes packages built from that commit under the version
recorded in `tauri.conf.json`, without moving the existing tag.
