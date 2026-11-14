// The therapist's home plan for one patient. In the full app this comes from the During Visit summary
// (the visit's instructions become the plan); for now it's a fixed demo plan.
//
// mode 'precise': the patient sees the live angle, the target line and a degree readout.
// mode 'simple':  no numbers, just a fill bar and "good / almost / try again". Better for squats, where
//                 the side-on view makes exact degrees less reliable and the cue matters more than the number.
import { EXERCISES } from './exercises.js';

export const DEMO_PLAN = {
  id: 'plan-demo-1',
  therapist: 'Dr. Lee',
  createdAt: '2026-11-03',
  exercises: [
    {
      id: 'shoulder-abduction', mode: 'precise', side: 'auto', reps: 5, target: 140,
      instruction: 'Raise your arm out to the side, thumb up. Keep your elbow straight and your body still.',
    },
    {
      id: 'mini-squat', mode: 'simple', side: 'auto', reps: 5, target: 110,
      instruction: 'Bend your knees like you are sitting back into a chair. Keep your chest up.',
    },
  ],
};

/** Merge a plan item with its library entry. Plan values (target, reps, side, mode) win. */
export function planExercise(item) {
  const base = EXERCISES[item.id];
  if (!base) throw new Error(`Unknown exercise "${item.id}"`);
  return {
    ...base,
    id: item.id,
    mode: item.mode || 'precise',
    side: item.side || 'auto',
    reps: item.reps ?? base.reps,
    target: item.target ?? base.target,
    instruction: item.instruction || base.setup,
    name: item.name || base.name,
    holdMs: item.holdMs ?? base.holdMs,
    checks: [...(base.checks || []), ...(item.checks || [])],
    note: item.note || base.note,
    sets: item.sets ?? 1,
    perDay: item.perDay ?? null,
  };
}

export const planExercises = (plan = DEMO_PLAN) => plan.exercises.map(planExercise);
