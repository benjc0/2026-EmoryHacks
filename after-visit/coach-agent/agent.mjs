import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace, FPS, HEIGHT, WIDTH } from './face.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { watchCallerVideo } from './caller-video.mjs';
import { watchCallerAudio } from './caller-audio.mjs';
import { startPose } from './pose.mjs';
import { CoachSession } from './coach-session.mjs';
import { DEMO_PLAN, planExercises } from '../js/plan.js';

// The coach's personality and rules. Plain language, warm, never shaming (design-system MASTER.md: voice and tone).
// The exercise script itself (what to do, rep counts, feedback) comes from CoachSession, as COACH LINE messages.
const planText = planExercises(DEMO_PLAN).map((ex, i) => `${i + 1}. ${ex.name}: ${ex.reps} reps. ${ex.instruction}`).join('\n');
const instructions = `You are Mend, a friendly AI physical-therapy coach on a FaceTime video call.
The patient is at home doing the exercises their therapist (${DEMO_PLAN.therapist}) planned:
${planText}

An app watches the patient's camera, counts and scores every rep, and tells you what to say.
When you get a message that starts with "COACH LINE:", say that line to the patient right away, in your own warm
voice but with the same meaning, numbers and instructions. Do not add extra steps or change rep counts.
Between those lines, answer the patient briefly (one or two short sentences) and keep them going.
Use simple, everyday words. Be encouraging: say "Next time, try..." instead of "wrong".
Never give medical advice beyond the plan. If something hurts sharply, tell them to stop and rest, call skip_exercise,
and tell them to let their therapist know.
Tools:
- skip_exercise: when the patient asks to skip, can't do it, or it hurts.
- session_status: when they ask what they're on, how many reps are left, or how they're doing.
- record_pain: when they give a pain number from 0 to 10 (always ask for it at the end, if they haven't said).
Be clear that you are an AI, not their therapist.`;

const SESSIONS_DIR = fileURLToPath(new URL('./sessions/', import.meta.url));

const agent = defineAgent({
  entry: async ctx => {
    // Audio and video: the coach needs the caller's camera to count reps.
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    // Chert prepares a room before a caller exists. Join promptly so Chert can
    // find us, but wait before opening a paid model session or sending video.
    const caller = await ctx.waitForParticipant();
    console.log(`[coach] caller is "${caller.identity}"`);

    // COACH_DIAGNOSTICS=1: log how loud the caller's voice is when it arrives (loudness only, nothing saved).
    if (process.env.COACH_DIAGNOSTICS === '1') {
      const stopAudio = watchCallerAudio(ctx.room, caller.identity);
      ctx.addShutdownCallback(async () => stopAudio());
    }

    // Video: one camera track, published by this agent. The Mac shows video only
    // from the participant that speaks, so the picture and the voice stay together.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let tick = 0, speaking = false;
    const frame = () => source.captureFrame(new VideoFrame(drawFace(tick++, speaking), WIDTH, HEIGHT, VideoBufferType.RGBA));
    frame();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(frame, 1000 / FPS);

    const session = new voice.AgentSession({
      // Gemini Live (free tier from Google AI Studio). Reads GOOGLE_API_KEY from .env.local.
      llm: new google.realtime.RealtimeModel({ voice: 'Kore' }),
    });

    // ---- What the coach says. Lines from the session script are queued while the coach is talking, and sent
    // together when it stops, so a burst of reps never piles up into a long backlog.
    const queue = [];
    const flush = () => {
      if (speaking || !queue.length) return;
      const lines = queue.splice(0, queue.length).slice(-2);   // at most the 2 newest lines
      const text = lines.join(' ');
      console.log(`[coach] script: ${text}`);
      session.generateReply({ instructions: `COACH LINE: "${text}"` });
    };
    const say = (text) => { queue.push(text); flush(); };

    // ---- The guided session: plan -> exercises -> reps -> pain question -> saved record.
    const coach = new CoachSession({ plan: DEMO_PLAN, say });
    let saved = false;
    const save = async () => {
      if (saved) return;
      saved = true;
      const record = coach.record();
      try {
        await mkdir(SESSIONS_DIR, { recursive: true });
        const file = `${SESSIONS_DIR}${record.id}.json`;
        await writeFile(file, JSON.stringify({ source: 'facetime-coach', ...record }, null, 2));
        console.log(`[coach] session saved: ${file} (${record.totals.reps} reps, pain ${record.checkIn.pain ?? 'not given'})`);
      } catch (error) { console.error(`[coach] could not save the session: ${error.message}`); }
    };

    const tools = {
      skip_exercise: llm.tool({
        description: 'Skip the current exercise and move to the next one. Use when the patient asks to skip, cannot do it, or it hurts.',
        execute: async () => (coach.skip() ? 'Skipped. The next instruction is coming as a COACH LINE.' : 'There is no exercise in progress to skip.'),
      }),
      session_status: llm.tool({
        description: 'Where the patient is in today\'s session: which exercise, reps done, reps left.',
        execute: async () => coach.status(),
      }),
      record_pain: llm.tool({
        description: 'Record the patient\'s pain score from 0 (none) to 10 (worst), with an optional short note in their words.',
        parameters: {
          type: 'object',
          properties: {
            pain: { type: 'integer', minimum: 0, maximum: 10, description: 'Pain from 0 to 10' },
            note: { type: 'string', description: 'Optional: what they said about it, in their words' },
          },
          required: ['pain'],
        },
        execute: async ({ pain, note }) => {
          const record = coach.recordPain(pain, note ?? '');
          if (coach.phase === 'done') await save();
          return `Recorded pain ${record.checkIn.pain} out of 10.`;
        },
      }),
    };

    // ---- Body tracking on the caller's video, fed into the session.
    let pose = null;
    if (process.env.COACH_POSE !== 'off') startPose().then((p) => { pose = p; console.log('[pose] tracking ready'); },
      (error) => console.error(`[pose] not available: ${error.message}`));
    let lastPhase = '';
    const stopVideo = watchCallerVideo(ctx.room, caller.identity, {
      fps: 10,
      onFrame: async (videoFrame) => {
        const result = await pose?.track(videoFrame);
        if (!result) return;
        coach.onPose({ landmarks: result.landmarks, w: result.w, h: result.h, t: result.t });
        const phase = `${coach.idx}:${coach.phase}`;
        if (phase !== lastPhase) { lastPhase = phase; console.log(`[coach] ${coach.status()}`); }
      },
    });

    // ---- Logs: what the coach hears and says, its state, and model errors. Text only, never audio or video.
    const E = voice.AgentSessionEventTypes;
    session.on(E.AgentStateChanged, e => {
      speaking = e.newState === 'speaking';
      if (!speaking) flush();
    });
    session.on(E.UserStateChanged, e => { if (e.newState === 'speaking') console.log('[coach] patient is talking'); });
    session.on(E.ConversationItemAdded, e => {
      const item = e.item;
      const text = (item?.textContent ?? (Array.isArray(item?.content) ? item.content.filter(c => typeof c === 'string').join(' ') : '')) || '';
      if (text) console.log(`[coach] ${item?.role === 'user' ? 'patient' : 'coach'}: "${text.slice(0, 160)}"`);
    });
    session.on(E.FunctionToolsExecuted, e => console.log(`[coach] used tools: ${(e.functionCalls ?? []).map(c => c.name).join(', ')}`));
    session.on(E.Error, e => console.error(`[coach] model error: ${e.error?.message ?? e.error ?? 'unknown'}`));

    ctx.addShutdownCallback(async () => {
      stopVideo(); pose?.close();
      await save();                     // a hang-up still saves what was done
      clearInterval(timer);
      await session.close();
      await track.close();
      await source.close();
    });

    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions, tools }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });

    // Start when FaceTime is ready (bridge_ready in the room metadata): the Mac ends the call if it hears nothing
    // within 10 seconds of that. The first line is the hello plus the first exercise's instructions.
    const stopGreeting = greetOnBridgeReady(ctx.room, () => coach.start("Hi, I'm Mend, your AI exercise coach. Let's do today's exercises together."));
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

// Your own LiveKit project when .env.local has its three LIVEKIT_ values; otherwise Chert rooms through chert dev.
runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'video-agent' });
