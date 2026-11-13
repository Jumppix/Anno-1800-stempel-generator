import struct, zlib

def read_dict(data, off):
    cnt=struct.unpack_from('<i',data,off)[0]
    ids=[i&0xffff for i in struct.unpack_from('<%dh'%cnt,data,off+4)]
    p=off+4+2*cnt; names=[]
    for _ in range(cnt):
        e=data.index(b'\0',p); names.append(data[p:e]); p=e+1
    return cnt,ids,names

def parse(data):
    n=len(data)
    tag_off=struct.unpack_from('<i',data,n-16)[0]
    attr_off=struct.unpack_from('<i',data,n-12)[0]
    class Node:
        def __init__(self,nid,size,raw=None,children=None):
            self.nid=nid; self.size=size; self.raw=raw; self.children=children
    def pn(o):
        size,nid=struct.unpack_from('<ii',data,o); o+=8
        if nid & 0x8000:
            return o+(size+7)//8*8, Node(nid,size,raw=data[o:o+size])
        kids=[]
        while data[o:o+8]!=b'\0'*8:
            o,k=pn(o); kids.append(k)
        return o+8, Node(nid,size,children=kids)
    o=0; roots=[]
    while o<tag_off:
        if data[o:o+8]==b'\0'*8: o+=8; continue
        o,nd=pn(o); roots.append(nd)
    return roots, read_dict(data,tag_off), read_dict(data,attr_off), n

def serialize(roots, tagdict, attrdict):
    out=bytearray()
    def ser(nd):
        if nd.raw is not None:
            out.extend(struct.pack('<ii',nd.size,nd.nid)); out.extend(nd.raw)
            out.extend(b'\0'*((-nd.size)%8))
        else:
            out.extend(struct.pack('<ii',0,nd.nid))
            for k in nd.children: ser(k)
            out.extend(b'\0'*8)
    for r in roots: ser(r)
    out.extend(b'\0'*8)
    tag_off=len(out)
    tc,ti,tn=tagdict
    out.extend(struct.pack('<i',tc)); out.extend(struct.pack('<%dH'%tc,*ti)); out.extend(b'\0'.join(tn)+b'\0')
    out.extend(b'\0'*((-len(out))%8))
    attr_off=len(out)
    ac,ai,an=attrdict
    out.extend(struct.pack('<i',ac)); out.extend(struct.pack('<%dH'%ac,*ai)); out.extend(b'\0'.join(an)+b'\0')
    out.extend(b'\0'*((-len(out))%8))
    node_count=count_nodes(roots)+1
    out.extend(struct.pack('<ii',0,node_count))
    out.extend(struct.pack('<ii',tag_off,attr_off))
    out.extend(struct.pack('<ii',8,-3))
    return bytes(out)

def count_nodes(nodes):
    c=0
    def rec(n):
        nonlocal c
        c+=1
        if n.children:
            for k in n.children: rec(k)
    for n in nodes: rec(n)
    return c

if __name__=='__main__':
    raw=open('real_stamp.bin','rb').read()
    roots,(tc,ti,tn),(ac,ai,an),n=parse(raw)
    print('nodes',count_nodes(roots))
    rebuilt=serialize(roots,(tc,ti,tn),(ac,ai,an))
    print('orig len',len(raw),'rebuilt',len(rebuilt),'equal',rebuilt==raw)
    if rebuilt!=raw:
        for i,(a,b) in enumerate(zip(rebuilt,raw)):
            if a!=b:
                print('first diff at',i,hex(a),hex(b)); print('orig ',raw[i-16:i+16].hex(' ')); print('new  ',rebuilt[i-16:i+16].hex(' ')); break
    d=open('real/FBRxyEa8CYOsfy99RBLnj','rb').read()
    print('crc32 raw',zlib.crc32(raw),'adler',zlib.adler32(raw),'footer',struct.unpack('<iii',d[-12:]))
