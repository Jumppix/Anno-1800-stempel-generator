Compression version 2 is based on Compression version 1, of which a detailed explanation can be found [here](https://github.com/lysannschlegel/RDAExplorer/wiki/file.db-format)

# Sections

| Offset | Field | Size |
|--------|-------|------|
| 0 | content section | variable |
| X | Tag section | variable | 
| Y | Attribs section | variable |
| -16 | offset to Tag section (X) | 4 |
| -12 | offset to Attribs section (Y) | 4 | 
| -8 | Magic Bytes | 8 |

# Content Section

This format is a document tree (similar to xml) in which node names are replaced by Integer IDs. There are two types of nodes: 

- _Tags_ hold other nodes
- _Attribs_ hold actual content

The document can contain multiple root elements, all of which can be either Attrib or Tag. 
The Content Section has an additional Node Terminator at its end. 

# Node Structure

```Attribute Node: <Int32 bytesize> <Int32 ID> <Content>```

Content is stored in 8 byte data blocks. If content is not dividable by 8, the end is filled up with 0x00 until it is. These extra bytes do not count towards the bytesize of the attribute. 

```Tag Node (Node that holds other nodes): <Int32 bytesize> <Int32 ID> <childnodes> <8 bytes End_of_Node>```

The Node Terminator is `0x0000000000000000` (0 as Int64).

# Tags and Attrib Dictionary Section

At the end of the file, there is a dictionary containing a mapping of IDs to their real name. Both Tags and Attrib Section follow the same pattern.

| Element | Notes | 
|-|-|
| Count of Structure Tags | Int32 |
| Array of Tag/Attrib IDs | Int16 per Tag ID | 
| Array of Tag/Attrib Names | 0-terminated ASCII String |
| Fill Bytes | Fill up with 0x00 until the block size is dividable by 8 |

> Otherwise, ID allocating convention is exactly the same as in version 1. 

!!! IDs are only available in a 16 bit range !!! 
Even though the content section uses them in 32 bit representation, the Tags and Attrib Dictionary can only work with Int16s. 

# Magic Bytes 

The magic bytes are 8, -2 in Int32:
`0x08 0x00 0x00 0x00 0xFE 0xFF 0xFF 0xFF`

# Version 3 
It's just like version 2, but the magic bytes are 8, -3 in Int32:
`0x08 0x00 0x00 0x00 0xFD 0xFF 0xFF 0xFF`

Also, there is information on overall node count in the document, which is located at the end of the file right before the offsets: 

| Offset | Field | Size |
|-|-|-|
| -32 | unknown (all 0) | 8 |
| -24 | Node Count | 8 | 