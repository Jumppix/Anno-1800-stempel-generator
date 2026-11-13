import struct, zlib
from writer import serialize

TAG_IDS=[4,2,3]; TAG_NAMES=[b'RailwayInfos',b'BuildingInfo',b'StreetInfo']
ATTR_IDS=[32769,32776,32770,32771,32773,32772,32774,32775]
ATTR_NAMES=[b'StampPath',b'StreetCount',b'IconGUID',b'Pos',b'GUID',b'Dir',b'ComplexOwnerID',b'Variation']
A_STAMP, A_ICON, A_POS, A_GUID, A_DIR, A_OWNER = 32769,32770,32771,32773,32772,32774
T_BUILDING, T_STREETS, T_RAIL = 2,3,4

class N:
    def __init__(self, nid, raw=None, kids=None):
        self.nid=nid; self.size=len(raw) if raw is not None else 0; self.raw=raw; self.children=kids or []

def attr(nid, fmt, *vals):
    return N(nid, struct.pack(fmt,*vals))

def make_stamp(chambers, cx, cy, region=5000000, icon=1010516):
    buildings=[]
    for i,(x,y) in enumerate(chambers):
        posx = -(y - cy) - 1.5
        posy = -(x - cx) - 1.5
        buildings.append(N(1, kids=[
            attr(A_POS,'<ff',posx,posy),
            attr(A_DIR,'<f',0.0),
            attr(A_GUID,'<i',1010516),
            attr(A_OWNER,'<q',i+1),
        ]))
    roots=[
        attr(A_STAMP,'<i',region),
        attr(A_ICON,'<i',icon),
        N(T_BUILDING, kids=buildings),
        N(T_STREETS, kids=[]),
        attr(32776,'<i',0),
        N(T_RAIL, kids=[]),
    ]
    return serialize(roots,(len(TAG_IDS),TAG_IDS,TAG_NAMES),(len(ATTR_IDS),ATTR_IDS,ATTR_NAMES))

def pack(raw):
    return zlib.compress(raw,9) + zlib.compress(b'',9) + struct.pack('<I',len(raw))

if __name__ == '__main__':
    chambers=[(0,0),(30,0),(15,26),(45,26)]
    raw=make_stamp(chambers,24.5,15.0)
    out=pack(raw)
    open('/workspace/chats/6e1d4e8a1c08e7c846cf965c/HK_Test_4.stamp','wb').write(out)
    print('raw',len(raw),'packed',len(out))
