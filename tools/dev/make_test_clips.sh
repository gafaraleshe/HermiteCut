#!/usr/bin/env bash
# Make three 6-second 1920x1080 25 fps test clips (CLIP_A/B/C.mp4). Each has a
# moving coloured box, a big frame counter and a tone, so effects, transitions
# and timing can be checked frame by frame.
#
#   tools/dev/make_test_clips.sh [output-folder]      (default: build/testmedia)
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-build/testmedia}"
mkdir -p "$OUT"
i=0
for NAME in A B C; do
  case $NAME in A) COLOR=0xE4572E ;; B) COLOR=0x29B6F6 ;; C) COLOR=0x66BB6A ;; esac
  ffmpeg -y -loglevel error \
    -f lavfi -i "color=c=0x16161c:s=1920x1080:r=25:d=6" \
    -f lavfi -i "color=c=${COLOR}:s=240x240:r=25:d=6" \
    -f lavfi -i "sine=frequency=$((330 + i * 110)):sample_rate=48000:duration=6" \
    -filter_complex "[0][1]overlay=x='mod(t*420\,1680)':y=420,drawtext=text='CLIP ${NAME}   %{frame_num}':x=80:y=80:fontsize=96:fontcolor=white[v]" \
    -map "[v]" -map 2:a -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest \
    "$OUT/CLIP_${NAME}.mp4"
  echo "wrote $OUT/CLIP_${NAME}.mp4"
  i=$((i + 1))
done
