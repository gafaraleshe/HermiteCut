# Reference breakdown: "Automated grid" subject-reveal transition

The owner shared a 90-second vertical tutorial reel (1080 × 1920 shown, the
footage is UHD 3840 × 2160) teaching this effect in DaVinci Resolve. This file
records what it does and how it is built, so HermiteCut can automate it. The
video is not stored in the repo. Build an original implementation and don't
copy the creator's footage, captions or branding.

## What the viewer sees (0:00–0:23)

- A white grid of square cells sits over the whole shot.
- The **next shot appears cell by cell, following a moving subject** (a hand,
  a person walking). The cells covering the subject switch to the new clip, so
  the movement "drives" the transition.
- The incoming clip is revealed as hard-edged square blocks, never soft edges.
  Variations seen:
  - blocks revealing a white frame;
  - blocks that hold a different clip inside each cell;
  - a mix of several shots at once, collage style.
- Captions are one or two words at a time, large, centred, white, with some
  words highlighted in red. This fits the **Captions+** word-caption style
  already on the roadmap.

## How it is built in the tutorial (0:23–1:26)

**Timeline:** the incoming (next) shot goes on the track **underneath** the
outgoing shot. An **adjustment clip** sits above both.

**Fusion comp on the outgoing (top) clip:**

```
MediaIn1 ──────────────────────────────► Merge1 (Background) ─► MediaOut1
   │                                       ▲  ▲
   ▼                                       │  └─ Background2 (Foreground)
MagicMask1 ─► Background1 ─► MosaicBlur1 ─► Bitmap1 ──┘ (Effect Mask on Merge1)
```

| Node | Settings shown |
|---|---|
| **MagicMask1** | Draw a stroke on the subject, then track it forwards and backwards. This is a Studio feature. |
| **Background1** | Solid colour. Gets its alpha from the Magic Mask, so the output is a solid silhouette of the subject. |
| **MosaicBlur1** | **Pixel Frequency 15.9**, Cell Shape **Square**, Aliasing 1.0. Turns the silhouette into square blocks. |
| **Bitmap1** | Channel **Alpha**, Low **0.0**, High **0.001**, Clip Black and Clip White on, Fit Input Crop. Turns any partly covered cell into a fully solid block, giving a hard, blocky matte. |
| **Background2** | Black, with **Alpha set to 0**. Merged over the clip through the Bitmap matte, so the blocks are cut out of the top clip and the shot underneath shows through. |
| **Merge1** | MediaIn → Background, Background2 → Foreground, Bitmap1 → effect mask. |

**Grid overlay (Edit page):** the OpenFX **Grid** effect on the adjustment
clip, with:

- Row Cells **8**, Column Cells **14**, Major Line Spacing **0**;
- Line Colour white, horizontal and vertical line width **0.050**;
- **Width** and **Height** under Transform Controls nudged until the grid lines
  fall exactly on the mosaic block edges.

The tutorial's own captions: "adjust the width and height until the lines match
the blocks".

## What HermiteCut should automate

Add this as a **Grid Reveal** transition-style tool in step 6 (template pack)
and step 8 (app UI). It's a good example of the "Fusion powers" the owner wants:
multi-node setups that normally take a minute of manual wiring.

1. **One action, "Grid Reveal":**
   - Select the outgoing clip with the next shot underneath it, or let the tool
     place it there.
   - The tool builds the comp above on the outgoing clip.
   - It adds the grid on top.
   - It tells the user to draw a Magic Mask stroke on the subject and press
     Track. Tracking needs a human stroke, so it can't be fully automatic.
2. **Draw the grid in the same Fusion comp, not with the OFX Grid effect.**
   OFX parameters can't be set from scripts (see RESOLVE_API_NOTES), and the
   grid must line up exactly with the mosaic cells. Generate the lines from the
   **same cell size** that drives MosaicBlur, for example:
   - a `CustomTool` with an expression like `abs(frac(x*cols) - 0.5) > 0.5 - w`;
   - or a macro of thin `Rectangle` / `Background` lines.

   Then the user only sets **Cells across** and everything stays aligned.
   *Measure the MosaicBlur Pixel Frequency ↔ cells-across relationship in
   Resolve*. 15.9 on UHD matched a 14 × 8 grid in the video; it may depend on
   the frame size or aspect ratio.
3. **Exposed controls:**
   - Cells across (rows follow from the aspect ratio so cells stay square);
   - Grid on/off, line colour, line width and grid opacity;
   - Reveal colour: transparent (shows the next shot), white or black;
   - Invert (reveal outside the subject instead);
   - Block threshold (Bitmap High);
   - Optional "fill white flash" for 1–2 frames.
4. **Mattes without Magic Mask:** offer other matte sources, so the effect
   works on Resolve free and without tracking:
   - luma key;
   - an animated wipe (cells flip in rows, columns, randomly or diagonally,
     using `FastNoise` or a gradient into the same MosaicBlur → Bitmap chain);
   - the alpha of the clip above.

   These timed variants can be fully automatic transitions in the pack.
5. **Collage variant:** each cell shows a different clip. This is a later
   stretch goal.

## How to check it

On the test clips (`tools/dev/make_test_clips.sh`):

- with the wipe matte, frames before the transition match clip A exactly, and
  frames after match clip B;
- mid-transition, every cell is entirely A or entirely B, with no soft or
  half-filled cells: check pixel values at cell centres and edges with
  `frametools.py`;
- grid lines sit on the cell borders (no offset) at 1920 × 1080, 3840 × 2160
  and 1080 × 1920.

## Full spec: make it the best grid effect in Resolve

The owner wants this tool to be "as flexible as possible, very smooth and
effective". It should have everything. Treat the tutorial as the baseline and
build all of the following. Group the controls in the Inspector as below, and
give the app a live preview and presets.

### Grid
- **Cells across** with rows set automatically to keep cells square, or rows
  and columns set separately.
- **Fit to:** frame or safe area.
- **Offset X / Y**, **rotation**, **perspective tilt**.
- Lock to a **tracker or planar track**, so the grid sticks to a surface.

### Lines
- Show or hide each of: lines, outer border, major lines every N cells.
- **Width**, **colour**, **opacity**, **glow**, **dashed** option.
- **Line animation:** draw-on (lines grow in from a corner, the centre or the
  edges), fade in and out, and a pulse to the beat.

### Cells (smoothness)
- No hard pop by default. Each cell **animates** as it switches: scale-in
  (from 0 or 120 %), fade, flip, slide or a white flash. Settings: **duration**
  (frames), **ease curve** (shared with Ease) and overshoot (shared with
  Bounce).
- **Stagger:** the order and delay in which cells turn on. Options:
  - follow the subject,
  - row by row,
  - column by column,
  - diagonal,
  - from centre outwards,
  - spiral,
  - random (with a seed),
  - by brightness.
- **Gap between cells**, **rounded corners**, **feather**. Square stays the
  default.
- **Fill:** next shot (transparent), white, black, any colour, blur of the
  current shot, inverted, or a different clip per cell (collage).
- **Hold cells:** a cell that turned on stays on until the end, or it follows
  the subject live.

### Matte (what drives the reveal)
- Magic Mask: the subject is tracked, which needs Studio and the user's stroke.
- Luma, chroma or the alpha of a clip.
- A timed wipe for the automatic transition variants.
- A hand-drawn mask.
- **Threshold**, **grow / shrink by N cells**, **invert**,
  **temporal smoothing** (stops cells flickering on and off).

### Timing
- As a transition: duration and alignment.
- As an effect: **Apply at** Post / Pre / Both / Whole, matching the other
  HermiteCut effects.
- **Sync to beats:** cells or lines step on HermiteCut beat markers.
- **Motion blur** on cell animation.

### Extras
- **Sound:** one click adds a matching SFX (digital ticks or a whoosh) from
  the HermiteCut sound library.
- **Presets:** at least 10 shipped looks (Clean Reveal, Hand Track, Beat Grid,
  Glitch Grid, Collage, White Flash Grid, Neon Grid, Mosaic Out, Diagonal
  Sweep, Spiral In), and user-saved presets.
- **Performance:** a "fast preview" switch that lowers mosaic and matte
  resolution while scrubbing.

### Quality bar
- Lines and cells line up to the pixel at every resolution and aspect ratio,
  including vertical 9:16.
- No flicker when nothing is moving.
- Undo removes everything the tool added.
- Every preset is checked with frame grabs before shipping.
