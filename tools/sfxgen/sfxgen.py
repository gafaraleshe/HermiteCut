#!/usr/bin/env python3
"""HermiteCut sound library, synthesised from code (no samples, no licences).

    python tools/sfxgen/sfxgen.py            # -> build/sfx/<Category>/<Name>.wav + build/sfx/sfx.json

Every sound is 48 kHz, 16-bit WAV, mono or stereo, normalised to -1 dBFS peak,
with a short fade at both ends so it never clicks. The same seed always gives
the same file, so builds are reproducible. Categories: Whooshes, Swishes,
Risers, Downers, Impacts, Shutters, Camera, Glitches, Pops, UI, Film, Tape.
"""
import json
import math
import os
import sys
import wave

import numpy as np

SR = 48000
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'build', 'sfx')


# ---------------------------------------------------------------- building blocks
def t_(dur):
    return np.arange(int(dur * SR)) / SR


def noise(n, rng, colour='white'):
    x = rng.standard_normal(n)
    if colour == 'pink':
        f = np.fft.rfft(x)
        f /= np.sqrt(np.maximum(np.arange(len(f)), 1))
        x = np.fft.irfft(f, n)
    elif colour == 'brown':
        x = np.cumsum(x)
        x -= np.linspace(x[0], x[-1], n)
    return x / (np.max(np.abs(x)) + 1e-9)


def onepole_lp(x, cutoff):
    """Low-pass with a cutoff (Hz) that may be an array (time-varying)."""
    c = np.broadcast_to(np.asarray(cutoff, float), x.shape)
    a = np.exp(-2 * math.pi * np.clip(c, 10, SR / 2.2) / SR)
    y = np.empty_like(x)
    s = 0.0
    for i in range(len(x)):
        s = (1 - a[i]) * x[i] + a[i] * s
        y[i] = s
    return y


def bandpass(x, centre, q=2.0):
    """A state-variable band-pass whose centre (Hz) may change over time."""
    c = np.broadcast_to(np.asarray(centre, float), x.shape)
    f = 2 * np.sin(math.pi * np.clip(c, 20, SR / 6) / SR)
    damp = 1.0 / q
    low = band = 0.0
    y = np.empty_like(x)
    for i in range(len(x)):
        high = x[i] - low - damp * band
        band += f[i] * high
        low += f[i] * band
        y[i] = band
    return y


def swell(n, peak=0.5, power=2.0):
    """0 -> 1 -> 0 with the top at `peak` (0..1)."""
    x = np.linspace(0, 1, n)
    up = np.clip(x / max(peak, 1e-3), 0, 1) ** power
    down = np.clip((1 - x) / max(1 - peak, 1e-3), 0, 1) ** power
    return np.minimum(up, down)


def sweep(f0, f1, dur, shape='exp'):
    t = t_(dur)
    if shape == 'exp':
        f = f0 * (f1 / f0) ** (t / dur)
    else:
        f = f0 + (f1 - f0) * (t / dur)
    return np.sin(2 * math.pi * np.cumsum(f) / SR), f


def pan(x, start=-0.8, end=0.8):
    p = np.linspace(start, end, len(x))
    return np.stack([x * np.sqrt((1 - p) / 2), x * np.sqrt((1 + p) / 2)], axis=1)


def finish(x, fade_ms=4):
    x = np.atleast_2d(x.T).T if x.ndim == 1 else x
    x = x - np.mean(x, axis=0)          # remove DC before fading, so the ends land on 0
    n = len(x)
    k = max(1, int(fade_ms / 1000 * SR))
    ramp = np.linspace(0, 1, min(k, n))
    x[:len(ramp)] *= ramp[:, None]
    x[-len(ramp):] *= ramp[::-1][:, None]
    peak = np.max(np.abs(x)) + 1e-12
    return x * (10 ** (-1 / 20) / peak)


# ---------------------------------------------------------------- recipes
def whoosh(rng, dur=0.9, peak=0.55, lo=300, hi=3200, bright=1.0, stereo=True):
    n = int(dur * SR)
    e = swell(n, peak, 2.2)
    x = noise(n, rng, 'pink')
    centre = lo + (hi - lo) * e * bright
    y = bandpass(x, centre, 1.6) * e
    y += 0.25 * onepole_lp(noise(n, rng, 'brown'), 200 + 600 * e) * e
    return pan(y) if stereo else y


def swish(rng, dur=0.35):
    return whoosh(rng, dur, 0.4, 1500, 7000, 1.0)


def riser(rng, dur=3.0, f0=110, f1=880):
    n = int(dur * SR)
    tone, f = sweep(f0, f1, dur)
    tone2, _ = sweep(f0 * 1.5, f1 * 1.5, dur)
    e = np.linspace(0, 1, n) ** 2.2
    nz = bandpass(noise(n, rng, 'white'), np.linspace(400, 9000, n), 1.2)
    y = (0.5 * tone + 0.25 * tone2 + 0.6 * nz) * e
    y[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    return pan(y, -0.3, 0.3)


def downer(rng, dur=1.6, f0=900, f1=60):
    n = int(dur * SR)
    tone, _ = sweep(f0, f1, dur)
    e = (1 - np.linspace(0, 1, n)) ** 1.6
    nz = onepole_lp(noise(n, rng, 'pink'), np.linspace(6000, 200, n))
    return (0.7 * tone + 0.5 * nz) * e


def impact(rng, dur=1.4, body=55, crack=1.0, tail=1.0):
    n = int(dur * SR)
    t = t_(dur)
    f = body * (1 + 2.5 * np.exp(-t * 30))
    thump = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t * (4 / tail))
    hit = noise(n, rng, 'white') * np.exp(-t * 60) * crack
    rumble = onepole_lp(noise(n, rng, 'brown'), 300) * np.exp(-t * (2.5 / tail)) * 0.6
    return np.tanh(1.6 * (thump + 0.6 * hit + rumble))


def click(rng, dur=0.05, freq=3000, decay=120, noise_amt=0.6):
    t = t_(dur)
    n = len(t)
    return (np.sin(2 * math.pi * freq * t) * (1 - noise_amt) + noise(n, rng) * noise_amt) * np.exp(-t * decay)


def shutter(rng, curtain=0.06, blades=2, mech=1.0):
    parts = []
    for i in range(blades):
        parts.append(click(rng, 0.03, 2500 + 900 * i, 160, 0.75))
        parts.append(np.zeros(int(curtain * SR)))
    body = np.concatenate(parts)
    t = np.arange(len(body)) / SR
    return body + mech * 0.15 * onepole_lp(noise(len(body), rng, 'brown'), 900) * np.exp(-t * 25)


def glitch(rng, dur=0.6, grain=0.025, bits=5):
    n = int(dur * SR)
    out = np.zeros(n)
    i = 0
    while i < n:
        g = int(grain * SR * rng.uniform(0.3, 1.6))
        kind = rng.integers(0, 4)
        t = np.arange(min(g, n - i)) / SR
        if kind == 0:
            seg = np.sign(np.sin(2 * math.pi * rng.uniform(200, 2400) * t))
        elif kind == 1:
            seg = noise(len(t), rng)
        elif kind == 2:
            seg = np.sin(2 * math.pi * rng.uniform(60, 400) * t) * rng.uniform(0.3, 1)
        else:
            seg = np.zeros(len(t))
        out[i:i + len(seg)] = seg
        i += g
    q = 2 ** bits
    return np.round(out * q) / q


def pop(rng, f0=900, f1=220, dur=0.12):
    tone, _ = sweep(f0, f1, dur)
    t = t_(dur)
    return tone * np.exp(-t * 28)


def projector(rng, dur=4.0, rate=24):
    n = int(dur * SR)
    t = np.arange(n) / SR
    clicks = np.zeros(n)
    period = int(SR / rate)
    for k in range(0, n, period):
        c = click(rng, 0.012, 1800, 400, 0.8) * rng.uniform(0.5, 1)
        clicks[k:k + len(c)] += c[:n - k]
    hum = 0.25 * np.sin(2 * math.pi * 50 * t) + 0.12 * np.sin(2 * math.pi * 100 * t)
    hiss = 0.1 * noise(n, rng, 'white')
    return clicks + hum + hiss


def tape_stop(rng, dur=1.2, f0=440):
    t = t_(dur)
    f = f0 * (1 - t / dur) ** 1.8 + 10
    tone = np.sin(2 * math.pi * np.cumsum(f) / SR) + 0.4 * np.sin(4 * math.pi * np.cumsum(f) / SR)
    return tone * (1 - t / dur) ** 0.5


def reverse(x):
    return x[::-1].copy()


# ---------------------------------------------------------------- the library
def library():
    S = []

    def add(cat, name, fn, seed, **kw):
        S.append((cat, name, fn, seed, kw))

    for i, (d, lo, hi, nm) in enumerate([(0.6, 400, 4200, 'Fast'), (0.9, 300, 3200, 'Medium'),
                                         (1.4, 200, 2400, 'Slow'), (0.7, 800, 7000, 'Air'),
                                         (1.1, 120, 1600, 'Deep'), (0.5, 600, 5200, 'Short'),
                                         (1.8, 150, 2000, 'Long'), (0.8, 500, 6000, 'Bright')]):
        add('Whooshes', f'Whoosh {nm}', whoosh, 10 + i, dur=d, lo=lo, hi=hi)
    for i, d in enumerate([0.22, 0.3, 0.38, 0.45, 0.28, 0.33]):
        add('Swishes', f'Swish {i + 1:02d}', swish, 30 + i, dur=d)
    for i, (d, a, b) in enumerate([(2, 110, 880), (3, 80, 1200), (4, 60, 960), (1.5, 220, 1760),
                                   (6, 55, 660), (2.5, 140, 2200)]):
        add('Risers', f'Riser {d:g}s {i + 1:02d}', riser, 50 + i, dur=d, f0=a, f1=b)
    for i, (d, a, b) in enumerate([(1.0, 1200, 80), (1.6, 900, 60), (2.4, 700, 40), (0.8, 2000, 200),
                                   (3.0, 500, 30)]):
        add('Downers', f'Downer {i + 1:02d}', downer, 70 + i, dur=d, f0=a, f1=b)
    for i, (body, crack, tail, nm) in enumerate([(55, 1.0, 1.0, 'Hit'), (40, 0.6, 1.6, 'Boom'),
                                                 (70, 1.4, 0.6, 'Punch'), (35, 0.4, 2.2, 'Sub Drop'),
                                                 (90, 1.6, 0.5, 'Snap'), (48, 0.9, 1.3, 'Thud'),
                                                 (62, 1.2, 0.9, 'Slam'), (30, 0.3, 2.8, 'Cinematic Boom')]):
        add('Impacts', f'Impact {nm}', impact, 90 + i, body=body, crack=crack, tail=tail)
    for i, (c, bl, nm) in enumerate([(0.05, 2, 'DSLR'), (0.08, 2, 'Mirrorless'), (0.03, 2, 'Fast'),
                                     (0.12, 2, 'Slow'), (0.04, 3, 'Burst Single'), (0.06, 1, 'Leaf')]):
        add('Shutters', f'Shutter {nm}', shutter, 110 + i, curtain=c, blades=bl)
    add('Camera', 'Camera Burst', lambda rng: np.concatenate([shutter(rng, 0.03, 2) for _ in range(6)]), 120)
    add('Camera', 'Film Advance', lambda rng: onepole_lp(glitch(rng, 0.5, 0.008, 6), 3500), 121)
    add('Camera', 'Focus Beep', lambda rng: np.concatenate([np.sin(2 * math.pi * 2700 * t_(0.06)),
                                                             np.zeros(int(0.05 * SR)),
                                                             np.sin(2 * math.pi * 2700 * t_(0.06))]), 122)
    add('Camera', 'Flash Charge', lambda rng: sweep(800, 9000, 1.6)[0] * np.linspace(0.2, 1, int(1.6 * SR)), 123)
    add('Camera', 'Flash Pop', lambda rng: click(rng, 0.25, 1200, 18, 0.9), 124)
    for i, (d, g, bt) in enumerate([(0.4, 0.02, 4), (0.7, 0.03, 5), (0.25, 0.01, 3), (1.0, 0.04, 6),
                                    (0.5, 0.015, 4), (0.8, 0.05, 5), (0.3, 0.008, 3), (0.6, 0.02, 2)]):
        add('Glitches', f'Glitch {i + 1:02d}', glitch, 130 + i, dur=d, grain=g, bits=bt)
    for i, (a, b, d) in enumerate([(900, 220, 0.12), (1400, 300, 0.09), (600, 150, 0.16), (2000, 500, 0.07),
                                   (1100, 1800, 0.1), (500, 900, 0.14)]):
        add('Pops', f'Pop {i + 1:02d}', pop, 150 + i, f0=a, f1=b, dur=d)
    for i, (f, dcy, nz, nm) in enumerate([(3000, 120, 0.6, 'Click'), (1800, 200, 0.3, 'Tap'),
                                          (4200, 300, 0.8, 'Tick'), (1200, 90, 0.2, 'Soft Click'),
                                          (2400, 60, 0.1, 'Select'), (5200, 400, 0.9, 'Hi Tick')]):
        add('UI', f'UI {nm}', click, 170 + i, freq=f, decay=dcy, noise_amt=nz)
    add('UI', 'UI Confirm', lambda rng: np.concatenate([np.sin(2 * math.pi * 880 * t_(0.07)) * np.exp(-t_(0.07) * 30),
                                                         np.sin(2 * math.pi * 1320 * t_(0.12)) * np.exp(-t_(0.12) * 20)]),
        176)
    add('UI', 'UI Error', lambda rng: np.sign(np.sin(2 * math.pi * 180 * t_(0.25))) * np.exp(-t_(0.25) * 8), 177)
    add('Film', 'Film Projector', projector, 190)
    add('Film', 'Film Projector Slow', projector, 191, rate=18)
    add('Film', 'Film Reel Start', lambda rng: projector(rng, 2.5, 24) * np.linspace(0, 1, int(2.5 * SR)) ** 1.5, 192)
    add('Film', 'Film Burn Crackle', lambda rng: glitch(rng, 2.0, 0.004, 8) * 0.4 + 0.3 * noise(int(2 * SR), rng, 'pink'),
        193)
    add('Tape', 'Tape Stop', tape_stop, 200)
    add('Tape', 'Tape Stop Long', tape_stop, 201, dur=2.2, f0=330)
    add('Tape', 'Tape Start', lambda rng: reverse(tape_stop(rng, 1.0, 440)), 202)
    add('Tape', 'Rewind', lambda rng: glitch(rng, 1.2, 0.006, 6) * np.linspace(0.3, 1, int(1.2 * SR)), 203)
    add('Whooshes', 'Reverse Whoosh', lambda rng: reverse(whoosh(rng, 1.2, 0.8, 200, 3000)), 210)
    add('Impacts', 'Reverse Impact', lambda rng: reverse(impact(rng, 1.6, 45, 0.8, 1.5)), 211)
    add('Whooshes', 'Whoosh Double', lambda rng: np.concatenate([whoosh(rng, 0.45, 0.5, 400, 4000),
                                                                  whoosh(rng, 0.55, 0.45, 300, 3200)]), 212)
    add('Swishes', 'Swish Low', swish, 213, dur=0.5)
    add('Risers', 'Riser Tension 8s', riser, 214, dur=8, f0=45, f1=540)
    add('Impacts', 'Heartbeat', lambda rng: np.concatenate([impact(rng, 0.28, 50, 0.2, 0.25),
                                                           impact(rng, 0.7, 45, 0.15, 0.3)]), 215)
    add('Pops', 'Bubble Pop', pop, 216, f0=400, f1=1600, dur=0.09)
    return S


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    data = (x * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(data.shape[1] if data.ndim == 2 else 1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def main(out=OUT):
    items = []
    for cat, name, fn, seed, kw in library():
        rng = np.random.default_rng(seed)
        x = finish(np.asarray(fn(rng, **kw), float))
        folder = os.path.join(out, cat)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name + '.wav')
        write_wav(path, x)
        items.append({'name': name, 'category': cat, 'file': f'{cat}/{name}.wav',
                      'seconds': round(len(x) / SR, 3), 'channels': int(x.shape[1])})
    with open(os.path.join(out, 'sfx.json'), 'w', encoding='utf-8') as fh:
        json.dump({'sampleRate': SR, 'count': len(items), 'sounds': items}, fh, indent=1)
    print(f'Wrote {len(items)} sounds to {os.path.relpath(out, ROOT)}')
    return items


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else OUT)
