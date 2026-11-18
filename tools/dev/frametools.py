"""Frame checks for automated tests inside DaVinci Resolve's Python.

Grabs the frame under the playhead as a PNG, decodes it without third-party
packages and measures it, so a test can assert that an effect actually changed
the picture (for example: "the flash makes frame 0 brighter than frame 20").

    import frametools as ft
    luma = ft.mean_luma(ft.grab(project, timeline, frame_offset=0))

Only the standard library is used, because Resolve's bundled Python may not
have numpy or Pillow.
"""
import os
import struct
import tempfile
import zlib


def decode_png(data):
    """Return (width, height, channels, rows) for an 8-bit RGB or RGBA PNG.
    rows is a list of bytearrays, one per scanline, already unfiltered."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    pos, idat, w = 8, b'', None
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', chunk[:10])
            if depth != 8 or ctype not in (2, 6):
                raise ValueError('only 8-bit RGB/RGBA PNGs are supported')
            ch = 3 if ctype == 2 else 4
        elif kind == b'IDAT':
            idat += chunk
        elif kind == b'IEND':
            break
        pos += 12 + n
    raw = zlib.decompress(idat)
    stride = w * ch
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return w, h, ch, rows


def mean_luma(png, step=8):
    """Average Rec.709 luma (0-255), sampling every `step` pixels."""
    w, h, ch, rows = decode_png(png)
    total = count = 0
    for y in range(0, h, step):
        r = rows[y]
        for x in range(0, w * ch, ch * step):
            total += 0.2126 * r[x] + 0.7152 * r[x + 1] + 0.0722 * r[x + 2]
            count += 1
    return total / max(1, count)


def grab(project, timeline, frame_offset=None, path=None):
    """Move the playhead (frames from the timeline start) and return the
    current frame as PNG bytes, via Project.ExportCurrentFrameAsStill."""
    if frame_offset is not None:
        fps = float(timeline.GetSetting('timelineFrameRate'))
        f = int(timeline.GetStartFrame()) + int(frame_offset)
        n = int(round(fps))
        tc = '%02d:%02d:%02d:%02d' % (f // (3600 * n), (f // (60 * n)) % 60, (f // n) % 60, f % n)
        timeline.SetCurrentTimecode(tc)
    path = path or os.path.join(tempfile.gettempdir(), 'hermitecut-frame.png')
    if not project.ExportCurrentFrameAsStill(path):
        raise RuntimeError('ExportCurrentFrameAsStill failed (is the Edit or Color page open?)')
    with open(path, 'rb') as fh:
        return fh.read()
