"""Standard exercise keys + camera-tracking hints for the physical-therapy (PT) side.

Gemini maps whatever the therapist says ("slide your heel toward you") to one of these
keys, so the PT/pose-tracking part of the app always gets a known exercise it can coach.

tracking:
  joint          which joint angle to measure (MediaPipe landmarks: hip, knee, ankle, shoulder, elbow...)
  measure        what the angle means
  target_deg     [start, goal] angle range for one good rep (default; the therapist's limits override)
  camera         best camera view for tracking: "side" or "front"
  rep_type       "range" = move between angles; "hold" = hold a position; "count" = timed / steps
"""

LIBRARY: dict[str, dict] = {
    # ---- knee / hip
    "quad_set":            {"name": "Quad sets", "body_part": "knee",
                            "tracking": {"joint": "knee", "measure": "knee extension (leg straight)", "target_deg": [175, 180], "camera": "side", "rep_type": "hold"}},
    "heel_slide":          {"name": "Heel slides", "body_part": "knee",
                            "tracking": {"joint": "knee", "measure": "knee flexion lying down", "target_deg": [170, 90], "camera": "side", "rep_type": "range"}},
    "straight_leg_raise":  {"name": "Straight leg raises", "body_part": "hip",
                            "tracking": {"joint": "hip", "measure": "hip flexion with knee straight", "target_deg": [180, 135], "camera": "side", "rep_type": "range"}},
    "short_arc_quad":      {"name": "Short arc quads", "body_part": "knee",
                            "tracking": {"joint": "knee", "measure": "knee extension over a roll", "target_deg": [150, 180], "camera": "side", "rep_type": "range"}},
    "seated_knee_extension": {"name": "Seated knee extensions", "body_part": "knee",
                            "tracking": {"joint": "knee", "measure": "knee extension sitting", "target_deg": [90, 175], "camera": "side", "rep_type": "range"}},
    "mini_squat":          {"name": "Mini squats", "body_part": "knee",
                            "tracking": {"joint": "knee", "measure": "knee flexion standing", "target_deg": [175, 135], "camera": "side", "rep_type": "range"}},
    "sit_to_stand":        {"name": "Sit to stand", "body_part": "knee",
                            "tracking": {"joint": "hip", "measure": "hip extension from sitting to standing", "target_deg": [90, 175], "camera": "side", "rep_type": "range"}},
    "wall_sit":            {"name": "Wall sits", "body_part": "knee",
                            "tracking": {"joint": "knee", "measure": "knee flexion held against wall", "target_deg": [120, 120], "camera": "side", "rep_type": "hold"}},
    "step_up":             {"name": "Step ups", "body_part": "knee",
                            "tracking": {"joint": "knee", "measure": "knee extension stepping up", "target_deg": [110, 175], "camera": "side", "rep_type": "range"}},
    "glute_bridge":        {"name": "Glute bridges", "body_part": "hip",
                            "tracking": {"joint": "hip", "measure": "hip extension lying down", "target_deg": [120, 170], "camera": "side", "rep_type": "range"}},
    "clamshell":           {"name": "Clamshells", "body_part": "hip",
                            "tracking": {"joint": "knee", "measure": "knee separation lying on side", "target_deg": [0, 45], "camera": "front", "rep_type": "range"}},
    "hip_abduction":       {"name": "Side-lying hip abduction", "body_part": "hip",
                            "tracking": {"joint": "hip", "measure": "leg lift to the side", "target_deg": [0, 35], "camera": "front", "rep_type": "range"}},
    "calf_raise":          {"name": "Calf raises", "body_part": "ankle",
                            "tracking": {"joint": "ankle", "measure": "heel lift", "target_deg": [90, 120], "camera": "side", "rep_type": "range"}},
    "ankle_pump":          {"name": "Ankle pumps", "body_part": "ankle",
                            "tracking": {"joint": "ankle", "measure": "ankle up/down", "target_deg": [70, 120], "camera": "side", "rep_type": "range"}},
    # ---- shoulder / upper body
    "pendulum":            {"name": "Shoulder pendulums", "body_part": "shoulder",
                            "tracking": {"joint": "shoulder", "measure": "small arm circles, relaxed", "target_deg": [0, 20], "camera": "side", "rep_type": "count"}},
    "shoulder_flexion":    {"name": "Shoulder flexion (wall slide / arm raise)", "body_part": "shoulder",
                            "tracking": {"joint": "shoulder", "measure": "arm raise forward", "target_deg": [0, 150], "camera": "side", "rep_type": "range"}},
    "shoulder_abduction":  {"name": "Shoulder abduction (side raise)", "body_part": "shoulder",
                            "tracking": {"joint": "shoulder", "measure": "arm raise to the side", "target_deg": [0, 120], "camera": "front", "rep_type": "range"}},
    "external_rotation":   {"name": "Shoulder external rotation", "body_part": "shoulder",
                            "tracking": {"joint": "elbow", "measure": "forearm rotation outward, elbow at side", "target_deg": [0, 45], "camera": "front", "rep_type": "range"}},
    "scapular_squeeze":    {"name": "Shoulder blade squeezes", "body_part": "upper back",
                            "tracking": {"joint": "shoulder", "measure": "shoulders back", "target_deg": [0, 15], "camera": "front", "rep_type": "hold"}},
    "bicep_curl":          {"name": "Bicep curls", "body_part": "elbow",
                            "tracking": {"joint": "elbow", "measure": "elbow flexion", "target_deg": [170, 45], "camera": "side", "rep_type": "range"}},
    # ---- spine / general
    "chin_tuck":           {"name": "Chin tucks", "body_part": "neck",
                            "tracking": {"joint": "neck", "measure": "head back, chin in", "target_deg": [0, 10], "camera": "side", "rep_type": "hold"}},
    "cat_cow":             {"name": "Cat-cow", "body_part": "back",
                            "tracking": {"joint": "hip", "measure": "spine flexion/extension on hands and knees", "target_deg": [80, 100], "camera": "side", "rep_type": "range"}},
    "bird_dog":            {"name": "Bird dog", "body_part": "back",
                            "tracking": {"joint": "hip", "measure": "opposite arm and leg reach", "target_deg": [90, 175], "camera": "side", "rep_type": "hold"}},
    "walking":             {"name": "Walking", "body_part": "whole body",
                            "tracking": {"joint": "none", "measure": "time / steps", "target_deg": None, "camera": "front", "rep_type": "count"}},
    "other":               {"name": "Other exercise", "body_part": None,
                            "tracking": {"joint": "none", "measure": "not auto-tracked", "target_deg": None, "camera": "front", "rep_type": "count"}},
}

KEYS = list(LIBRARY)


def prompt_list() -> str:
    """One line per key for the Gemini prompt."""
    return "\n".join(f"  {k}: {v['name']}" for k, v in LIBRARY.items())


def tracking_for(key: str | None, limit_deg: int | None = None) -> dict:
    """Library tracking hints, with the therapist's movement limit applied.

    Angles in target_deg are what a pose tracker measures:
      - knee/hip/elbow/ankle: the joint angle, 180 = straight. Bending makes it smaller.
      - shoulder/neck etc. ("raise" movements): 0 = resting, bigger = more movement.
    Therapists speak clinically ("bend to 90 degrees", "don't raise past 120"), so limit_deg
    is clinical: degrees of bend for bending moves, degrees of raise for raise moves.
    """
    t = dict(LIBRARY.get(key or "other", LIBRARY["other"])["tracking"])
    t["target_deg"] = list(t["target_deg"]) if t.get("target_deg") else None
    if not limit_deg or not t["target_deg"]:
        return t
    start, goal = t["target_deg"]
    t["therapist_limit_deg"] = limit_deg
    if goal < start:
        # bending movement (joint angle closes): 90 deg of bend -> joint angle of 90 (180 - 90)
        t["target_deg"] = [start, max(goal, 180 - limit_deg)]
        t["min_joint_angle_deg"] = 180 - limit_deg      # tracker: warn if the angle goes below this
    elif start < 90 and goal <= 180:
        # raise movement (0 = resting): don't go past the limit
        t["target_deg"] = [start, min(goal, limit_deg)]
        t["max_raise_deg"] = limit_deg                  # tracker: warn if the raise goes above this
    return t


# ------------------------------------------------------------------ PT app (pt/js/exercises.js) mapping
# Standard key -> the PT camera app's exercise id + what's needed to turn a therapist's limit into
# a safe target and a form check. Keep in sync with pt/js/exercises.js.
#   direction: 'decrease' = joint angle closes during the rep (bending), 'increase' = opens / raises
#   mode:      'simple' (no numbers, for views where exact degrees are unreliable) or 'precise'
PT_APP = {
    "heel_slide":            {"id": "heel-slide",         "direction": "decrease", "target": 90,  "joint": ["hip", "knee", "ankle"],     "mode": "precise"},
    "straight_leg_raise":    {"id": "straight-leg-raise", "direction": "decrease", "target": 140, "joint": ["shoulder", "hip", "knee"], "mode": "precise"},
    "sit_to_stand":          {"id": "sit-to-stand",       "direction": "increase", "target": 165, "joint": ["shoulder", "hip", "knee"], "mode": "simple"},
    "mini_squat":            {"id": "mini-squat",         "direction": "decrease", "target": 110, "joint": ["hip", "knee", "ankle"],     "mode": "simple"},
    "seated_knee_extension": {"id": "knee-extension",     "direction": "increase", "target": 165, "joint": ["hip", "knee", "ankle"],     "mode": "precise"},
    "short_arc_quad":        {"id": "knee-extension",     "direction": "increase", "target": 165, "joint": ["hip", "knee", "ankle"],     "mode": "precise"},
    "shoulder_abduction":    {"id": "shoulder-abduction", "direction": "increase", "target": 140, "joint": ["hip", "shoulder", "elbow"], "mode": "precise"},
    "shoulder_flexion":      {"id": "overhead-stretch",   "direction": "increase", "target": 160, "joint": ["hip", "shoulder", "elbow"], "mode": "precise"},
}


# Exercise ids that exist in the PT app's library today (pt js/exercises.js). Their planExercise() throws on
# anything else, so the plan only ever contains these. If they add exercises (e.g. heel-slide), list them in
# PT_APP_EXERCISES in .env, e.g. PT_APP_EXERCISES=shoulder-abduction,overhead-stretch,knee-extension,mini-squat,heel-slide
import os as _os
PT_APP_KNOWN = {x.strip() for x in _os.getenv(
    "PT_APP_EXERCISES", "shoulder-abduction,overhead-stretch,knee-extension,mini-squat").split(",") if x.strip()}


def pt_target_and_checks(m: dict, limit_deg: int | None) -> tuple[int, list[dict]]:
    """Apply the therapist's clinical limit ("don't bend past 90") to the PT app's joint-angle target."""
    target = m["target"]
    if not limit_deg:
        return target, []
    if m["direction"] == "decrease":
        # 90 degrees of bend = joint angle of 90 (180 = straight). Never ask for more than the limit.
        min_angle = 180 - limit_deg
        return max(target, min_angle), [{"id": "therapist-limit", "type": "jointAngle", "joint": m["joint"],
                                         "min": min_angle, "label": f"Don't bend past {limit_deg}°"}]
    if m["joint"][1] == "shoulder":
        # raise movements: the measured angle is the raise itself
        return min(target, limit_deg), [{"id": "therapist-limit", "type": "jointAngle", "joint": m["joint"],
                                         "max": limit_deg, "label": f"Don't raise past {limit_deg}°"}]
    return target, []
