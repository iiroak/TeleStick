#!/usr/bin/env python3
"""Renders a Telegram .tgs (gzipped Lottie JSON) animation to a sequence of
RGBA PNG frames using rlottie.

Usage: tgs_render.py <input.tgs> <output_dir> <target_size> <max_frames>

Writes frame_0000.png, frame_0001.png, ... to output_dir, and prints a JSON
line to stdout with {"frame_count": N, "fps": F, "duration_ms": D}.

This is invoked as a subprocess from Node (see src/convert/tgs.ts) rather
than imported, so a pathological animation can be killed without touching
the bot's event loop.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from rlottie_python import LottieAnimation


def main() -> int:
    if len(sys.argv) != 5:
        print("usage: tgs_render.py <input.tgs> <output_dir> <target_size> <max_frames>", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    size = int(sys.argv[3])
    max_frames = int(sys.argv[4])
    output_dir.mkdir(parents=True, exist_ok=True)

    anim = LottieAnimation.from_tgs(str(input_path))
    try:
        total_frames = anim.lottie_animation_get_totalframe()
        frame_rate = anim.lottie_animation_get_framerate()
        duration_s = anim.lottie_animation_get_duration()

        # WhatsApp animated sticker limits: <=10s total, so cap frames if the
        # source is longer instead of failing outright.
        max_duration_s = 10.0
        if duration_s > max_duration_s and frame_rate > 0:
            total_frames = min(total_frames, int(max_duration_s * frame_rate))

        output_frames = min(total_frames, max_frames)
        for output_index in range(output_frames):
            if output_frames <= 1:
                frame_index = 0
            else:
                frame_index = round(output_index * (total_frames - 1) / (output_frames - 1))
            buffer = anim.render_pillow_frame(frame_num=frame_index)
            resized = buffer.resize((size, size))
            resized.save(output_dir / f"frame_{output_index:04d}.png")

        print(
            json.dumps(
                {
                    "frame_count": output_frames,
                    "fps": frame_rate,
                    "duration_ms": int((total_frames / frame_rate) * 1000)
                    if frame_rate
                    else 0,
                }
            )
        )
        return 0
    finally:
        anim.lottie_animation_destroy()


if __name__ == "__main__":
    sys.exit(main())
