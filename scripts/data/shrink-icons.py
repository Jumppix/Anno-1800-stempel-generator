"""Icons für die Datenbank verkleinern: PNG (Spiel, 77 px) → WebP 64 px.

Aufruf (aus build-db.mjs): python3 -I scripts/data/shrink-icons.py <liste.json>
<liste.json> ist eine Liste von [quelle.png, ziel.webp].
"""
import json
import sys

from PIL import Image

pairs = json.load(open(sys.argv[1], encoding="utf-8"))
total = 0
for src, dst in pairs:
    im = Image.open(src).convert("RGBA")
    im.thumbnail((64, 64), Image.LANCZOS)
    im.save(dst, "WEBP", quality=82, method=6)
    total += 1
print(f"{total} Icons verkleinert")
