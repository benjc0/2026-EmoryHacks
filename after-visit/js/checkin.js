// The between-session check-in: what the agent is told before a call, and the one interface the
// real Chert integration (or the mock used for the demo) must implement.
//
// Privacy rule: the agent gets a short summary, never the video, the body landmarks, or the full
// record. Only what it needs to ask good questions.
import { progressVsPrevious } from './sessionLog.js';

export const MAX_NOTE_CHARS = 200;
export const MAX_FLAGS = 3;
export const MAX_QUESTIONS = 5;

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/**
 * Build the briefing for the agent from the latest session record.
 * @param {object} latest   a session record from the store (no frames)
 * @param {object} opts
 * @param {object[]} [opts.previous]   earlier records, newest first (for "better than last time")
 * @param {string[]} [opts.openQuestions]  questions the patient added and nobody has answered yet
 * @param {string} [opts.therapist]   name shown to the patient
 */
export function buildBrief(latest, { previous = [], openQuestions = [], therapist = null } = {}) {
  const t = latest.totals || {};
  const flagged = (latest.flagged || []).slice(0, MAX_FLAGS).map((f) => ({
    exercise: f.exerciseName,
    rep: f.rep,
    quality: f.quality,
    issue: f.issues?.[0] || null,
  }));
  const progress = progressVsPrevious(latest, previous)
    .filter((p) => p.change != null)
    .map((p) => ({ exercise: p.name, change: Math.round(p.change), direction: p.change >= 0 ? 'more' : 'less' }));

  return {
    therapist: therapist || latest.therapist || null,
    lastSession: {
      date: (latest.startedAt || '').slice(0, 10),
      exercisesDone: t.exercisesDone ?? 0,
      exercisesPlanned: t.exercisesPlanned ?? 0,
      goodReps: t.good ?? 0,
      totalReps: t.reps ?? 0,
      skipped: (latest.exercises || []).filter((e) => e.skipped).map((e) => e.name),
    },
    pain: latest.checkIn?.pain ?? null,
    patientNote: clip(latest.checkIn?.note, MAX_NOTE_CHARS) || null,
    flagged,
    progress,
    openQuestions: openQuestions.slice(0, MAX_QUESTIONS).map((q) => clip(q, 160)),
    // Rules the agent must follow on every call.
    rules: {
      mayJudgeForm: false,        // only the app measures form; the agent may say what it saw, not score it
      mayChangePlan: false,       // the therapist owns the plan
      mustOfferHuman: true,       // always offer the therapist or clinic if the patient asks or pain is high
      painEscalateAt: 7,
    },
  };
}

/** True if the briefing needs the therapist's attention before any call. */
export function needsHuman(brief) {
  return (brief.pain ?? 0) >= brief.rules.painEscalateAt
    || brief.flagged.some((f) => f.quality === 'poor');
}

/**
 * The interface every agent implements. Chert's real client and the demo mock both match it.
 *   startCall(brief, { phone, at }) -> { callId, status }
 *   transcriptOf(callId) -> { lines: [{ who, text }], summary, newQuestions: [], painReported: number|null }
 */
export function createCheckInAgent(impl) {
  return {
    startCall: (brief, opts) => impl.startCall(brief, opts),
    transcriptOf: (callId) => impl.transcriptOf(callId),
  };
}

/**
 * Demo stand-in. It "calls" and returns a fixed, realistic outcome so the flow can be shown without
 * FaceTime access. Replace with the Chert client once the preview is granted.
 */
export function mockAgent() {
  const calls = new Map();
  return createCheckInAgent({
    async startCall(brief, { at = new Date() } = {}) {
      const callId = `mock-${calls.size + 1}`;
      const flagged = brief.flagged[0];
      const lines = [
        { who: 'agent', text: `Hi, this is your PT helper. Ready to check in?` },
        { who: 'patient', text: 'Yes, I did my arm raises.' },
        { who: 'agent', text: flagged ? `Your last session had a few short reps. Can you show me one arm raise for me?` : 'Nice work last time. Show me one arm raise.' },
        { who: 'patient', text: 'My knee clicks when I go downstairs.' },
        { who: 'agent', text: 'Thanks, I will pass that to your therapist. Anything else?' },
      ];
      calls.set(callId, {
        lines,
        summary: `Check-in at ${at.toISOString().slice(0, 16).replace('T', ' ')}. Patient did arm raises; reported a knee click on stairs.`,
        newQuestions: ['My knee clicks when I go downstairs.'],
        painReported: null,
      });
      return { callId, status: 'completed' };
    },
    async transcriptOf(callId) {
      const c = calls.get(callId);
      if (!c) throw new Error(`No call ${callId}`);
      return c;
    },
  });
}
