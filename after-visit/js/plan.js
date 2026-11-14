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
  };
}

export const planExercises = (plan = DEMO_PLAN) => plan.exercises.map(planExercise);

/**
 * planExercises() plus the extra fields a visit-server plan carries that planExercise() doesn't
 * (sets, times a day, hold/rest overrides, form checks, prescribed-as text). Used wherever a plan
 * fetched from the During Visit server (shape: pt_plan_from_visit) needs to drive a session, so the
 * dashboard and the session page stay in sync about what the therapist actually prescribed.
 */
export function planExercisesFromVisit(plan) {
  const extras = Object.fromEntries((plan.exercises || []).map((x) => [x.id, x]));
  return planExercises(plan).map((e) => {
    const x = extras[e.id] || {};
    return {
      ...e,
      sets: x.sets ?? 1,
      perDay: x.perDay ?? null,
      holdMs: x.holdMs ?? e.holdMs,
      note: x.note || e.note,
      checks: [...(e.checks || []), ...(x.checks || [])],
      prescribedAs: x.prescribedAs || '',
    };
  });
}

/**
 * Narrow a resolved exercise list to just the ids in a comma-separated string (e.g. from the
 * session page's ?exercises=id,id link). No selection, or one that matches nothing in the list,
 * returns the whole list unchanged rather than an empty session.
 */
export function selectExercises(exs, idsParam) {
  if (!idsParam) return exs;
  const ids = new Set(String(idsParam).split(',').map((s) => s.trim()).filter(Boolean));
  const filtered = exs.filter((e) => ids.has(e.id));
  return filtered.length ? filtered : exs;
}
