"""Spieldateien (assets.xml, texts_*.xml aus der neuesten dataNN.rda) in das
JSON-Format umwandeln, das scripts/data/build-db.mjs liest (wie anno-toolkit:
je Vorlage eine Liste {"Template", "Values"}; Texte als {GUID: Text}).

Zusätzlich zum anno-toolkit werden Einträge mit <BaseAssetGUID> aufgelöst:
Vorlage und Werte des Basis-Eintrags, darüber die eigenen Werte (Objekte
zusammengeführt, Listen ersetzt).

Aufruf: python3 -I scripts/data/convert-game.py <ordner-mit-xml> [ziel=research/raw/game]
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "..", "research", "raw", "game")
INT = re.compile(r"^-?\d+$")
FLOAT = re.compile(r"^-?\d*\.\d+(e-?\d+)?$", re.I)


def value(el):
    children = list(el)
    if not children:
        text = (el.text or "").strip()
        if INT.match(text) and len(text) < 16:
            return int(text)
        if FLOAT.match(text):
            return float(text)
        return text
    out = {}
    repeated = set()
    for c in children:
        v = value(c)
        if c.tag in out:
            if c.tag not in repeated:
                out[c.tag] = [out[c.tag]]
                repeated.add(c.tag)
            out[c.tag].append(v)
        else:
            out[c.tag] = v
    return out


def merge(base, over):
    """Basis-Werte mit eigenen Werten überschreiben (Objekte rekursiv, sonst ersetzen)."""
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = merge(base[k], v) if k in base else v
        return out
    return over


# ---------------------------------------------------------------- Assets
print("Lese assets.xml …", flush=True)
plain = {}  # GUID -> {"Template", "Values"}
derived = []  # (GUID, BaseAssetGUID, Values)
for _, el in ET.iterparse(os.path.join(src, "assets.xml"), events=("end",)):
    if el.tag != "Asset":
        continue
    tmpl = el.findtext("Template")
    base = el.findtext("BaseAssetGUID")
    vals_el = el.find("Values")
    vals = value(vals_el) if vals_el is not None else {}
    if not isinstance(vals, dict):
        vals = {}
    guid = vals.get("Standard", {}).get("GUID") if isinstance(vals.get("Standard"), dict) else None
    if tmpl and isinstance(guid, int):
        plain[guid] = {"Template": tmpl, "Values": vals}
    elif base and isinstance(guid, int):
        derived.append((guid, int(base), vals))
    el.clear()
print(f"  {len(plain)} Einträge mit Vorlage, {len(derived)} abgeleitet (BaseAssetGUID)", flush=True)

pending = {g: (b, v) for g, b, v in derived}


def resolve(guid, seen=()):
    if guid in plain:
        return plain[guid]
    if guid not in pending or guid in seen:
        return None
    b, v = pending[guid]
    base = resolve(b, seen + (guid,))
    if base is None:
        return None
    rec = {"Template": base["Template"], "Values": merge(base["Values"], v), "BaseAssetGUID": b}
    plain[guid] = rec
    return rec


resolved = sum(1 for g, _, _ in derived if resolve(g) is not None)
print(f"  {resolved}/{len(derived)} abgeleitete Einträge aufgelöst", flush=True)

# ---------------------------------------------------------------- Standardwerte
# Vorlage (templates.xml) und Eigenschafts-Standardwerte (properties.xml) für
# ausgewählte Komponenten einmischen; geerbte Listeneinträge (VectorElement/
# InheritedIndex) aus der Standardliste auflösen.
COMPONENTS = ["FactoryBase", "Cost", "Industrializable", "PublicService", "Powerplant", "ItemContainer", "Residence7", "ModuleOwner", "Maintenance", "Building"]
prop_defaults = {}
props_path = os.path.join(src, "properties.xml")
if os.path.exists(props_path):
    root = ET.parse(props_path).getroot()
    for dv in root.iter("DefaultValues"):
        for comp in dv:
            if comp.tag in COMPONENTS and comp.tag not in prop_defaults:
                prop_defaults[comp.tag] = value(comp)
templates = {}
tmpl_path = os.path.join(src, "templates.xml")
if os.path.exists(tmpl_path):
    root = ET.parse(tmpl_path).getroot()
    for el in root.iter("Template"):
        props = el.find("Properties")
        if props is not None:
            templates[el.findtext("Name")] = {c.tag: value(c) for c in props if c.tag in COMPONENTS}
print(f"  Standardwerte: {len(prop_defaults)} Komponenten (properties.xml), {len(templates)} Vorlagen (templates.xml)", flush=True)


def as_list(x):
    if isinstance(x, dict) and "Item" in x:
        x = x["Item"]
    if x in (None, ""):
        return []
    return x if isinstance(x, list) else [x]


def resolve_vector(own, default):
    """Listeneinträge mit VectorElement aus der Standardliste ergänzen."""
    out = []
    for item in as_list(own):
        if isinstance(item, dict) and "VectorElement" in item:
            ve = item["VectorElement"]
            idx = ve.get("InheritedIndex", 0) if isinstance(ve, dict) else 0
            base = default[idx] if isinstance(idx, int) and idx < len(default) else {}
            merged = merge(base if isinstance(base, dict) else {}, {k: v for k, v in item.items() if k != "VectorElement"})
            out.append(merged)
        else:
            out.append(item)
    return out


applied = 0
for rec in plain.values():
    tdef = templates.get(rec["Template"])
    if tdef is None:
        continue
    vals = rec["Values"]
    for comp, tval in tdef.items():
        if comp not in vals:
            continue  # Komponente nur, wenn das Asset sie trägt (wie bisher)
        base = merge(prop_defaults.get(comp, {}) if isinstance(prop_defaults.get(comp), dict) else {}, tval if isinstance(tval, dict) else {})
        own = vals[comp] if isinstance(vals[comp], dict) else {}
        if comp == "Cost":
            default_costs = as_list(base.get("Costs"))
            merged = merge(base, {k: v for k, v in own.items() if k != "Costs"})
            merged["Costs"] = {"Item": resolve_vector(own["Costs"], default_costs) if "Costs" in own else default_costs}
            vals[comp] = merged
        else:
            vals[comp] = merge(base, own)
        applied += 1
print(f"  {applied} Komponenten mit Standardwerten ergänzt", flush=True)

by_template = {}
for rec in plain.values():
    by_template.setdefault(rec["Template"], []).append(rec)
os.makedirs(os.path.join(dst, "assets"), exist_ok=True)
for tmpl, recs in by_template.items():
    name = re.sub(r"[^A-Za-z0-9_-]", "-", tmpl.lower())
    with open(os.path.join(dst, "assets", f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump(recs, f, ensure_ascii=False)
print(f"  {len(by_template)} Vorlagen geschrieben", flush=True)

# ---------------------------------------------------------------- Texte
os.makedirs(os.path.join(dst, "texts"), exist_ok=True)
for lang in ("german", "english"):
    path = os.path.join(src, f"texts_{lang}.xml")
    if not os.path.exists(path):
        continue
    texts = {}
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag == "Text" and el.find("GUID") is not None:
            g = el.findtext("GUID")
            t = el.findtext("Text")
            if g and t is not None:
                texts[g] = t
            el.clear()
    with open(os.path.join(dst, "texts", f"texts_{lang}.json"), "w", encoding="utf-8") as f:
        json.dump(texts, f, ensure_ascii=False)
    print(f"  texts_{lang}: {len(texts)} Einträge", flush=True)
print("Fertig:", os.path.abspath(dst))
