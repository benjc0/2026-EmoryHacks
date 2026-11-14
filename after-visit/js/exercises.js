// Exercises the camera can score. Add one by copying an entry.
//
// joint:      the three body points that form the measured angle; the angle is at the middle one.
// direction:  'increase' if the angle grows during the rep (arm raise), 'decrease' if it shrinks (squat).
// rest:       the angle zone each rep starts and ends in.
// partial:    reaching this counts as a partial rep.
// target:     full range (the patient's plan can override it).
// holdMs:     how long to hold at the target for the rep to count as good (0 = no hold).
// minRepMs:   faster than this = "too fast".
// checks:     form rules checked on every frame of a rep.

export const EXERCISES = {
  'shoulder-abduction': {
    name: 'Side arm raise',
    icon: '🙆',
    view: 'Face the camera',
    setup: 'Face the camera and stand back until your head to hips are in the frame. Raise your arm out to the side.',
    joint: ['hip', 'shoulder', 'elbow'],
    direction: 'increase',
    rest: 35, partial: 100, target: 140, holdMs: 0, minRepMs: 1500,
    reps: 5,
    note: 'Slow and controlled. Stop if pain goes above 4/10.',
    cueRange: 'Raise your arm a little higher',
    checks: [
      { id: 'elbow-straight', type: 'jointAngle', joint: ['shoulder', 'elbow', 'wrist'], min: 145, label: 'Keep your elbow straight' },
      { id: 'trunk-lean', type: 'trunkLean', max: 15, label: "Don't lean your body" },
    ],
  },

  'overhead-stretch': {
    name: 'Overhead reach and hold',
    icon: '🙋',
    view: 'Face the camera',
    setup: 'Face the camera, head to hips in the frame. Reach your arm up as high as you can and hold.',
    joint: ['hip', 'shoulder', 'elbow'],
    direction: 'increase',
    rest: 40, partial: 120, target: 160, holdMs: 3000, minRepMs: 2500,
    reps: 3,
    note: 'Reach up, hold for 3 seconds, lower slowly.',
    cueRange: 'Reach a little higher',
    checks: [{ id: 'trunk-lean', type: 'trunkLean', max: 15, label: "Don't lean to the side" }],
  },

  'knee-extension': {
    name: 'Seated knee extension',
    icon: '🦵',
    view: 'Sit side-on',
    setup: 'Sit on a chair side-on to the camera. Your whole leg, hip to ankle, must be in the frame.',
    joint: ['hip', 'knee', 'ankle'],
    direction: 'increase',
    rest: 110, partial: 145, target: 165, holdMs: 2000, minRepMs: 2000,
    reps: 5,
    note: 'Straighten slowly and hold 2 seconds at the top.',
    cueRange: 'Straighten your knee fully',
    checks: [{ id: 'trunk-lean', type: 'trunkLean', max: 25, label: 'Sit up tall' }],
  },

  'mini-squat': {
    name: 'Mini squat',
    icon: '🏋️',
    view: 'Stand side-on',
    setup: 'Stand side-on to the camera. Your whole body, including your feet, must be in the frame.',
    joint: ['hip', 'knee', 'ankle'],
    direction: 'decrease',
    rest: 160, partial: 130, target: 110, holdMs: 0, minRepMs: 1500,
    reps: 5,
    note: 'Only go as low as is pain-free.',
    cueRange: 'Bend your knees a little more',
    checks: [{ id: 'trunk-lean', type: 'trunkLean', max: 45, label: 'Keep your chest up' }],
  },
};
