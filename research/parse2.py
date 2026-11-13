import struct
from collections import Counter, defaultdict

data = open('real_stamp.bin','rb').read()
n = len(data)
tag_off = struct.unpack_from('<i', data, n-16)[0]
attr_off = struct.unpack_from('<i', data, n-12)[0]

def read_dict(off):
    cnt = struct.unpack_from('<i', data, off)[0]
    ids = [i & 0xffff for i in struct.unpack_from('<%dh'%cnt, data, off+4)]
    p = off+4+2*cnt
    names=[]
    for _ in range(cnt):
        e = data.index(b'\0', p)
        names.append(data[p:e].decode('latin1'))
        p = e+1
    return dict(zip(ids,names))

tags = read_dict(tag_off)
attrs = read_dict(attr_off)

class Node:
    def __init__(self, nid, is_attr, raw, children=None):
        self.nid=nid; self.is_attr=is_attr; self.raw=raw; self.children=children or []
    def name(self):
        return (attrs if self.is_attr else tags).get(self.nid, hex(self.nid))

def parse_node(o):
    size, nid = struct.unpack_from('<ii', data, o); o += 8
    nid &= 0xffff
    if nid >= 0x8000:
        raw = data[o:o+size]
        return o + (size+7)//8*8, Node(nid, True, raw)
    children=[]
    while True:
        if o+8 <= n and data[o:o+8] == b'\0'*8:
            o += 8; break
        o, ch = parse_node(o); children.append(ch)
    return o, Node(nid, False, b'', children)

o=0; roots=[]
while o < tag_off:
    if data[o:o+8] == b'\0'*8: o += 8; continue
    o, nd = parse_node(o); roots.append(nd)

print("roots:", [(r.name(), len(r.children)) for r in roots])
bi = [r for r in roots if r.name()=='BuildingInfo'][0]
print("BuildingInfo entries:", len(bi.children))
buildings=[]
for ch in bi.children:
    d={}
    for a in ch.children:
        nm=a.name(); raw=a.raw
        if nm=='Pos': d['Pos']=struct.unpack('<ff', raw)
        elif nm=='Dir': d['Dir']=struct.unpack('<f', raw)[0]
        elif nm=='GUID': d['GUID']=struct.unpack('<i', raw)[0]
        elif nm=='ComplexOwnerID': d['ComplexOwnerID']=struct.unpack('<q', raw)[0]
        elif nm=='Variation': d['Variation']=struct.unpack('<i', raw)[0]
        elif nm=='iconGUID' or nm=='IconGUID': d['Icon']=struct.unpack('<i', raw)[0]
        else: d[nm]=raw.hex()
    buildings.append(d)
print("first 8:", buildings[:8])
print("GUID counts:", Counter(b['GUID'] for b in buildings).most_common(15))
xs=[b['Pos'][0] for b in buildings if 'Pos' in b]; ys=[b['Pos'][1] for b in buildings if 'Pos' in b]
print("pos range x:", min(xs), max(xs), " y:", min(ys), max(ys))
print("dir values:", Counter(round(b.get('Dir',0),3) for b in buildings))
print("complex owners:", len(set(b.get('ComplexOwnerID') for b in buildings)))
print("variation:", Counter(b.get('Variation') for b in buildings).most_common(6))

for r in roots:
    if r.name()=='StreetInfo':
        print("StreetInfo children:", len(r.children))
        # pairs: attrib guid, tag with list of nodes
        for i,ch in enumerate(r.children[:6]):
            if ch.is_attr:
                print("  attr", ch.name(), struct.unpack('<i',ch.raw)[0] if len(ch.raw)==4 else ch.raw.hex())
            else:
                print("  tag", ch.name(), "children", len(ch.children), [ (c.name(), struct.unpack('<ff',c.raw) if c.name()=='None' else c.raw.hex()) for c in ch.children[:3]])
    if r.name()=='RailwayInfos':
        print("RailwayInfos:", len(r.children))
    if r.is_attr:
        nm=r.name()
        if len(r.raw)==4: print("root attrib", nm, struct.unpack('<i',r.raw)[0])
        elif len(r.raw)==8: print("root attrib", nm, struct.unpack('<q',r.raw)[0])
