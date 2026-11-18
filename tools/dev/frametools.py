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


def mean_diff(png_a, png_b, step=4):
    """Mean absolute difference of two frames (0-255, RGB), sampling every
    `step` pixels. 0 means identical."""
    wa, ha, ca, ra = decode_png(png_a)
    wb, hb, cb, rb = decode_png(png_b)
    if (wa, ha) != (wb, hb):
        raise ValueError('frames differ in size: %dx%d vs %dx%d' % (wa, ha, wb, hb))
    total = count = 0
    for y in range(0, ha, step):
        a, b = ra[y], rb[y]
        for x in range(0, wa, step):
            i, j = x * ca, x * cb
            total += abs(a[i] - b[j]) + abs(a[i + 1] - b[j + 1]) + abs(a[i + 2] - b[j + 2])
            count += 3
    return total / max(1, count)


def encode_png(w, h, rows):
    """8-bit RGB PNG from a list of `h` bytearrays of `w * 3` bytes."""
    raw = b''.join(b'\x00' + bytes(r) for r in rows)

    def chunk(kind, data):
        c = struct.pack('>I', len(data)) + kind + data
        return c + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def thumbnail(png, width=320, height=180):
    """Scale a frame down to width x height (box filter, centre-cropped to the
    same aspect ratio) and return it as PNG bytes."""
    w, h, ch, rows = decode_png(png)
    aspect = width / float(height)
    cw, chh = (w, int(round(w / aspect))) if w / float(h) < aspect else (int(round(h * aspect)), h)
    x0, y0 = (w - cw) // 2, (h - chh) // 2
    out = []
    for ty in range(height):
        ya, yb = y0 + ty * chh // height, max(y0 + (ty + 1) * chh // height, y0 + ty * chh // height + 1)
        line = bytearray(width * 3)
        for tx in range(width):
            xa, xb = x0 + tx * cw // width, max(x0 + (tx + 1) * cw // width, x0 + tx * cw // width + 1)
            sr = sg = sb = n = 0
            for y in range(ya, yb, max(1, (yb - ya) // 3)):
                r = rows[y]
                for x in range(xa, xb, max(1, (xb - xa) // 3)):
                    i = x * ch
                    sr += r[i]
                    sg += r[i + 1]
                    sb += r[i + 2]
                    n += 1
            line[tx * 3:tx * 3 + 3] = bytes((sr // n, sg // n, sb // n))
        out.append(line)
    return encode_png(width, height, out)


def black_bars(png, threshold=3.0):
    """Fraction of the frame height covered by solid black rows at the top and
    at the bottom, as (top, bottom). Used to check the Letterbox effect."""
    w, h, ch, rows = decode_png(png)

    def dark(y):
        r = rows[y]
        return sum(r[x] + r[x + 1] + r[x + 2] for x in range(0, w * ch, ch * 4)) / (3.0 * len(range(0, w, 4))) < threshold
    top = 0
    while top < h and dark(top):
        top += 1
    bottom = 0
    while bottom < h - top and dark(h - 1 - bottom):
        bottom += 1
    return top / float(h), bottom / float(h)
