# cyfers-bin (AUR)

Packaging files for publishing **Cyfers** on the [Arch User Repository](https://aur.archlinux.org/) as `cyfers-bin`.

This directory lives in the Cyfers source repo for review; it does **not** publish to the AUR by itself. Sam (or another AUR maintainer) copies these files into the AUR git repo.

## Install behaviour

- The GitHub release **AppImage** is downloaded as the build source, then **extracted** at `package()` time into `/opt/cyfers`.
- Users launch via `/usr/bin/cyfers` (wrapper) + a `.desktop` entry — not by running the raw AppImage.
- The wrapper **unsets `APPIMAGE`**. Cyfers only enables `electron-updater` on Linux when `process.env.APPIMAGE` is set, so this install path keeps the in-app updater off.
- **Updates are manual** via pacman/AUR helpers (`yay`, `paru`, …). Do not expect the in-app “Installeren” banner on this channel.

## First-time publish (Sam)

1. Create an [AUR account](https://aur.archlinux.org/) and upload an SSH key.
2. Clone the empty package repo (after claiming the name, or it is created on first push):

   ```bash
   git clone ssh://aur@aur.archlinux.org/cyfers-bin.git
   cd cyfers-bin
   ```

3. Copy from this tree:

   ```bash
   cp /path/to/somtoday-login/packaging/aur/cyfers-bin/{PKGBUILD,.SRCINFO,cyfers.desktop,cyfers.sh} .
   ```

   Do **not** copy this README into the AUR repo (optional; AUR packages usually only ship `PKGBUILD` + `.SRCINFO` + local sources).

4. Verify hashes and metadata:

   ```bash
   makepkg --printsrcinfo > .SRCINFO
   makepkg -si   # optional local smoke install
   ```

5. Commit and push to the AUR:

   ```bash
   git add PKGBUILD .SRCINFO cyfers.desktop cyfers.sh
   git commit -m "Initial import: cyfers-bin ${pkgver}"
   git push
   ```

## Bumping on a new GitHub release

1. Set `pkgver` to the new release (match `package.json` / `vX.Y.Z` tag) and reset `pkgrel` to `1` (or bump `pkgrel` for packaging-only fixes).
2. Download the new AppImage and refresh `sha256sums`:

   ```bash
   curl -fsSL -O "https://github.com/Samhij/somtoday-login/releases/download/v${pkgver}/Cyfers-${pkgver}.AppImage"
   sha256sum "Cyfers-${pkgver}.AppImage"
   ```

3. Regenerate `.SRCINFO` and push:

   ```bash
   makepkg --printsrcinfo > .SRCINFO
   git add PKGBUILD .SRCINFO
   git commit -m "Update to ${pkgver}"
   git push
   ```

Users then update with their AUR helper (`yay -Syu cyfers-bin`, etc.).

## Notes

- `license` is `LicenseRef-Unknown` until upstream declares a project license; Electron/Chromium texts are installed under `/usr/share/licenses/cyfers-bin/`.
- Do not push secrets or personal tokens to the AUR git repo.
- Prefer keeping packaging in sync with `packaging/aur/cyfers-bin/` in `samhij/somtoday-login`.
