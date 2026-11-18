#!/bin/bash
# Lädt die Rohdaten-Quellen der Spieldatenbank nach research/raw/ (nicht im Repository).
#   anno-toolkit (jansepke, MIT): assets.xml als JSON, Texte de/en, Icons als PNG
#   Anno1800Calculator (NiHoel, MIT): params.js zur Gegenprobe (Produktion, DLCs)
# Danach: npm run build-db
set -e
cd "$(dirname "$0")/../.."
mkdir -p research/raw
for repo in jansepke/anno-toolkit NiHoel/Anno1800Calculator; do
  dir="research/raw/${repo#*/}"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" pull --ff-only
  else
    git clone --depth 1 "https://github.com/$repo.git" "$dir"
  fi
done
