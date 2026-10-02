#!/bin/sh
# Pacman/AUR install path. Unset APPIMAGE so electron-updater stays off
# (in-app Linux updates are AppImage-only; package updates are manual).
unset APPIMAGE
exec /opt/cyfers/cyfers "$@"
