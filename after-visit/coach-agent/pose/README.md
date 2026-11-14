# Pose helper

`pose_server.py` runs MediaPipe Pose (the same `pose_landmarker_lite` model as the browser app) on the caller's
FaceTime video, so the coach counts and scores reps exactly like `session.html`.

On Windows it runs **inside WSL Ubuntu**: Windows' Application Control blocks MediaPipe's native library, and Linux
in WSL is not subject to it. The coach and `chert dev` still run on Windows; only this helper runs in Ubuntu.

## One-time setup (Windows)

In a terminal:

```bash
wsl -d Ubuntu-24.04
```

Then, inside Ubuntu:

```bash
sudo apt update && sudo apt install -y python3-venv
python3 -m venv ~/.venvs/emory-pose
~/.venvs/emory-pose/bin/pip install mediapipe==1.2.3
```

The model file (about 6 MB) goes in `pose/models/` (not committed):

```bash
curl -L -o pose/models/pose_landmarker_lite.task https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
```

## Settings (optional, in `.env.local`)

| Name | Default | Use |
|---|---|---|
| `POSE_RUNTIME` | `wsl` on Windows, `native` elsewhere | `native` runs `pose/.venv` on this machine |
| `POSE_WSL_DISTRO` | `Ubuntu-24.04` | which WSL distro |
| `POSE_WSL_PYTHON` | `~/.venvs/emory-pose/bin/python` | Python inside WSL |

Frames are never saved: they live only in memory while the call is on.
