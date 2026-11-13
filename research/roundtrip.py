import struct

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
        e = data.index(b'\0', p); names.append(data[p:e]); p=e+1
    return cnt, ids, names

tag_cnt, tag_ids, tag_names = read_dict(tag_off)
attr_cnt, attr_ids, attr_names = read_dict(attr_off)

class Node:
    def __init__(self, nid, size, raw=None, children=None):
        self.nid=nid; self.size=size; self.raw=raw; self.children=children

def parse_node(o):
    size, nid = struct.unpack_from('<ii', data, o); o += 8
    if nid & 0x8000:
        raw = data[o:o+size]
        return o + (size+7)//8*8, Node(nid, size, raw=raw)
    kids=[]
    while True:
        if data[o:o+8] == b'\0'*8:
            o += 8; break
        o, k = parse_node(o); kids.append(k)
    return o, Node(nid, size, children=kids)

o=0; roots=[]
while o < tag_off:
    if data[o:o+8] == b'\0'*8: o += 8; continue
    o, nd = parse_node(o); roots.append(nd)

tag_size_nonzero = set()
attr_size_nonzero = set()
def stats(node):
    if node.raw is None:
        if node.size != 0: tag_size_nonzero.add((node.nid,node.size))
        for k in node.children: stats(k)
    else:
        attr_size_nonzero.add(node.size)
for r in roots: stats(r)
print('roots', [(hex(r.nid), r.size, len(r.children)) for r in roots])
print('tag nonzero sizes', list(tag_size_nonzero)[:5])
print('attr sizes', sorted(attr_size_nonzero))

def ser_attr(node, out):
    out += struct.pack('<ii', node.size, node.nid)
    out += node.raw
    pad = (-node.size) % 8
    out += b'\0'*pad

def ser_tag(node, out):
    out += struct.pack('<ii', 0, node.nid)
    for k in node.children: ser(k, out)
    out += b'\0'*8

def ser(node, out):
    if node.raw is not None: ser_attr(node, out)
    else: ser_tag(node, out)

out=bytearray()
for r in roots: ser(r, out)
content_len = len(out)
out += struct.pack('<i', tag_cnt) + struct.pack('<%dh'%tag_cnt, *tag_ids) + b'\0'.join(tag_names) + b'\0'
out += b'\0' * ((-len(out)) % 8)
attr_off_new = len(out)
out += struct.pack('<i', attr_cnt) + struct.pack('<%dh'%attr_cnt, *attr_ids) + b'\0'.join(attr_names) + b'\0'
out += b'\0' * ((-len(out)) % 8)
out += b'\0'*8
out += struct.pack('<i', 2460)  # node count candidate
out += struct.pack('<ii', content_len if False else len(out)-0, 0)
# rewrite offsets properly
