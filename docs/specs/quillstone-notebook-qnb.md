# Quillstone Notebook file format (.QNB), version 3

> **Self-made, fictional format.** "Quillstone Notebook" is not a real product. This document was
> written for Reopen as an openly licensed (Apache-2.0) example of *public format documentation*:
> the kind of text a user would paste into Reopen's format researcher. Sample files in
> `samples/mystery/` follow this specification.

Quillstone Notebook was a (fictional) note-taking program for home computers. Each notebook page
is saved as one `.QNB` file. All multi-byte integers are **little-endian**.

## 1. File header (32 bytes)

| Offset | Size | Field | Description |
|---|---|---|---|
| 0 | 4 | `magic` | ASCII `QNB1` |
| 4 | 2 | `version` | Format version. Always `3` for this specification. |
| 6 | 2 | `recordCount` | Number of records that follow the header. |
| 8 | 2 | `year` | Year the page was created, e.g. `1989`. |
| 10 | 1 | `month` | 1–12 |
| 11 | 1 | `day` | 1–31 |
| 12 | 1 | `titleLength` | Length of the title in bytes (0–19). |
| 13 | 19 | `title` | Page title, scrambled (see §3), padded with zero bytes. |

## 2. Records

Records follow the header immediately, one after another. Each record is:

| Offset | Size | Field | Description |
|---|---|---|---|
| 0 | 1 | `type` | `1` = heading, `2` = paragraph, `3` = list item |
| 1 | 2 | `length` | Number of text bytes that follow |
| 3 | `length` | `text` | Record text, scrambled (see §3) |

There is no padding between records. The file ends after the last record.

## 3. Text encoding and scrambling

Text is stored in the Windows-1252 character set. To stop casual snooping, every text byte
(title and record text) is XOR-ed with the constant **`0x5A`** before it is written. To read the
text, XOR every byte with `0x5A` again, then decode as Windows-1252.

## 4. Example

A page titled `Garden` (6 bytes) with one heading record "Spring" begins:

```
51 4E 42 31  03 00  01 00  C5 07  04  0F  06  1D 3B 28 3E 3F 34 00 …
```

`1D 3B 28 3E 3F 34` is `Garden` XOR `0x5A`.
