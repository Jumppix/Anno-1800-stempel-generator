import struct, sys, math

def parse(path):
    data = open(path,'rb').read()
    n = len(data)
    tag_off = struct.unpack_from('<i', data, n-16)[0]
    attr_off = struct.unpack_from('<i', data, n-12)[0]
    magic = struct.unpack_from('<ii', data, n-8)
    print(f"file={n} tag_off={tag_off} attr_off={attr_off} magic={magic}")

    def read_dict(off):
        cnt = struct.unpack_from('<i', data, off)[0]
        ids = struct.unpack_from('<%dh'%cnt, data, off+4)
        p = off+4+2*cnt
        names=[]
        for _ in range(cnt):
            e = data.index(b'\0', p)
            names.append(data[p:e].decode('latin1'))
            p = e+1
        return dict(zip(ids,names))

    tags = read_dict(tag_off)
    attrs = read_dict(attr_off)
    print("tag ids:", tags)
    print("attr ids:", attrs)

    def u32(o): return struct.unpack_from('<i', data, o)[0]

    nodes=[]
    def parse_node(o):
        size = u32(o); nid = u32(o+4); o += 8
        if nid & 0x8000 or nid >= 0x8000:
            raw = data[o:o+size]
            nodes.append((nid,size,raw))
            o += (size+7)//8*8
            return o
        children=[]
        while True:
            if o+8 <= n and data[o:o+8] == b'\0'*8:
                o += 8; break
            o = parse_node(o)
        return o

    o=0
    while o+8 <= n and data[o:o+8] != b'\0'*8 and o < tag_off:
        o = parse_node(o)
    return data, nodes, tags, attrs

data, nodes, tags, attrs = parse('real_stamp.bin')
from collections import Counter
c = Counter(attrs.get(nid, hex(nid)) for nid,size,raw in nodes)
print("attribute counts:", c)
print("first 60 nodes:")
for nid,size,raw in nodes[:40]:
    name = attrs.get(nid, tags.get(nid, hex(nid)))
    if size == 4 and name not in ('GUID','IconGUID','Variation','StreetCount','StampPath'):
        val = struct.unpack('<f', raw)[0]
        print(f"  {name:15s} size={size} raw={raw.hex()} float={val:.4f}")
    elif size == 8 and name == 'Pos':
        x,y = struct.unpack('<ff', raw)
        print(f"  {name:15s} size={size} pos=({x:.2f},{y:.2f})")
    elif size == 4:
        print(f"  {name:15s} size={size} int={struct.unpack('<i',raw)[0]}")
    elif size == 8:
        print(f"  {name:15s} size={size} long={struct.unpack('<q',raw)[0]}")
    else:
        print(f"  {name:15s} size={size} raw={raw.hex()[:40]}")
