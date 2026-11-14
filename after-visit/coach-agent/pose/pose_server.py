"""Pose helper for the FaceTime coach.

Reads RGB frames on stdin, writes one JSON line per frame on stdout with MediaPipe's 33 pose landmarks:
the same model (pose_landmarker_lite) and settings as the browser app (js/tracker.js), so the coach's
rep counting matches session.html.

Frame on stdin:  16-byte little-endian header (width, height, timestamp_ms, byte_length), then RGB bytes.
Line on stdout:  {"t": timestamp_ms, "lm": [[x, y, z, visibility] * 33]}  or  {"t": ..., "lm": null}
x and y are 0..1 of the frame that was sent. Nothing is saved; frames live only in memory.
"""
import json
import struct
import sys
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision

HEADER = struct.Struct("<IIII")
MODEL = Path(__file__).with_name("models") / "pose_landmarker_lite.task"


def read_exact(stream, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)


def main():
    model = Path(sys.argv[1]) if len(sys.argv) > 1 else MODEL
    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    stdin, stdout = sys.stdin.buffer, sys.stdout
    last_t = -1
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        stdout.write(json.dumps({"ready": True}) + "\n")
        stdout.flush()
        while True:
            head = read_exact(stdin, HEADER.size)
            if head is None:
                return
            width, height, t, length = HEADER.unpack(head)
            data = read_exact(stdin, length)
            if data is None or length != width * height * 3:
                return
            t = max(t, last_t + 1)  # VIDEO mode needs strictly increasing timestamps
            last_t = t
            frame = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
            result = landmarker.detect_for_video(image, t)
            lm = None
            if result.pose_landmarks:
                lm = [[round(p.x, 4), round(p.y, 4), round(p.z, 4), round(p.visibility or 0.0, 3)]
                      for p in result.pose_landmarks[0]]
            stdout.write(json.dumps({"t": t, "lm": lm}) + "\n")
            stdout.flush()


if __name__ == "__main__":
    main()
