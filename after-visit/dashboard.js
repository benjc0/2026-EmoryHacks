// Patient dashboard: greeting, this week, today's exercises, next visit, medicine, questions.
// Layout and look follow design-system/ai-clinic-assistant/pages/patient-dashboard.md and design-preview.html.
// Data: the latest visit from the Visit Copilot server (plan, medicines, appointments, questions) when it answers;
// otherwise the sample plan (js/plan.js). Completed sessions are saved on this device (js/dashboardData.js).
import { planExercises, planExercisesFromVisit } from './js/plan.js';
import {
  readData, writeData, localDate, weekDates, completedIds, streak,
  SAMPLE_CARE, greeting, exerciseHeading, weekLabels, stoneLayout,
} from './js/dashboardData.js';
import { exerciseArt } from './js/exerciseArt.js';
import { esc } from './js/escapeHtml.js';
import { visitConnection } from './js/visitConnection.js';
import { coachUrl, coachHealth, startCall, watchCall, UNAVAILABLE } from './js/coachConnection.js';

const $ = (s) => document.querySelector(s);
const today = new Date();
const date = localDate(today);
const icon = (id, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const exIcon = (ex) => (ex.id === 'mini-squat' ? 'squat' : ex.joint.includes('knee') ? 'leg' : 'arm');

// ---------------------------------------------------------------- During Visit connection
// The dashboard reads the patient's latest visit from the Visit Copilot server: the therapist's exercise plan,
// medicines, appointments and questions. If the server can't be reached, everything works as before with the
// sample plan. Open as  index.html?patient_id=kim-001  (add &server=http://host:8000 if it runs elsewhere;
// both are remembered on this device).
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const params = new URLSearchParams(location.search);
let browserStorage; try { browserStorage = localStorage; } catch {}
const { patientId: PATIENT_ID, server: SERVER, api: API, visitUrl: VISIT_URL } = visitConnection(location.href, browserStorage);
const COACH = coachUrl(location.href, browserStorage);   // the AI coach's call service (see js/coachConnection.js)

let plan = planExercises();          // sample plan until the visit server answers
let V = null;                        // dashboard data from the visit server (null = offline / no server)
let clinician = 'Dr. Lee';           // sample name; replaced by the real clinician from the visit
const prog = () => V?.pt_plan?.program || {};

/** "2 sets of 8 reps, 2× a day" (sets and times a day only when the visit plan gives them). */
const dose = (e) => `${e.sets > 1 ? `${e.sets} sets of ` : ''}${e.reps} reps${e.perDay ? `, ${e.perDay}× a day` : ''}`;
/** The short line under an exercise: dose, target (precise mode), side. */
const prescription = (e) => `${dose(e)}${e.mode === 'precise' ? `, aim for ${e.target}°` : ''}${e.holdMs ? `, hold ${e.holdMs / 1000} s` : ''}${e.side && e.side !== 'auto' ? `, ${e.side} side` : ''}`;

let data = readData();
let opener = null;

async function loadVisitData() {
  try {
    const res = await fetch(`${API}/dashboard`);
    if (!res.ok) throw new Error(res.status);
    V = await res.json();
  } catch { V = null; return; }      // offline or no server: keep the sample dashboard
  V.questions ??= [];
  if (V.pt_plan) {
    plan = planExercisesFromVisit(V.pt_plan);
    store.set('visitCopilot.plan', JSON.stringify(V.pt_plan));   // so the session page can use the same plan
  } else { try { localStorage.removeItem('visitCopilot.plan'); } catch {} }
  clinician = V.clinician || (V.has_visits ? 'your care team' : clinician);
  // Questions written on this device before the server was reachable: send them too.
  const local = data.questions || [];
  const pending = [];
  for (const q of local) { if (!V.questions.some((s) => s.id === q.id)) { try { V.questions.push(await postQuestion(q.text, q.id)); } catch { pending.push(q); } } }
  if (local.length) { data.questions = pending; persist(); }
  render(); route(); addVisitButtons();
  if (params.get('visit_id')) notice('Your visit is saved. Your plan, medicines and questions are up to date.');
  else if (V.pt_plan) notice(`Your exercise plan from your visit on ${V.pt_plan.createdAt} is ready.`);
}
async function postQuestion(text, id) {
  const res = await fetch(`${API}/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, id }) });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}
const questions = () => V ? [...V.questions, ...data.questions.filter(q => !V.questions.some(s => s.id === q.id))] : data.questions;

// "Asked" ticks are kept on this device for both local and server questions.
const askedKey = `visitCopilot.asked.${PATIENT_ID}`;
const asked = new Set((() => { try { return JSON.parse(store.get(askedKey) || '[]'); } catch { return []; } })());
const saveAsked = () => store.set(askedKey, JSON.stringify([...asked]));

// ---------------------------------------------------------------- open Visit Copilot
// Visit Copilot runs on the same server as the API (SERVER, or this site if empty). The link carries the patient,
// their languages, and a way back here; their saved questions are preloaded by Visit Copilot itself.
// The backend serves this dashboard at /pt/. A standalone local dashboard needs
// a separate backend port so the visit link doesn't just reopen the dashboard.
function visitLink() {
  const back = new URL(location.href); back.hash = ''; for (const k of ['visit_id', 'return_url']) back.searchParams.delete(k);
  const q = new URLSearchParams({ patient_id: PATIENT_ID, return_url: back.toString() });
  if (V?.patient_lang) q.set('patient_lang', V.patient_lang);
  if (V?.doctor_lang) q.set('doctor_lang', V.doctor_lang);
  if (V?.clinician && V.clinician !== 'your care team') q.set('provider', V.clinician);
  for (const question of data.questions) q.append('q', question.text);
  return `${VISIT_URL}${VISIT_URL.includes('?') ? '&' : '?'}${q}`;
}
function addVisitButtons() {
  // Keep starting a visit available even before the API answers.
  for (const id of ['visit-copilot-link', 'visit-copilot-questions']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden = false;
    el.href = visitLink();
  }
}

// ---------------------------------------------------------------- storage + notices
function notice(text) {
  $('#notice').textContent = text; $('#notice').hidden = false;
  clearTimeout(notice.timer); notice.timer = setTimeout(() => ($('#notice').hidden = true), 5000);
}
function persist() {
  try { writeData(data); return true; }
  catch { notice('Storage is unavailable. Changes last only in this tab.'); return false; }
}

const remaining = () => plan.filter((e) => !completedIds(data, date).has(e.id));
function session(ids) { if (ids.length) location.href = `session.html?${new URLSearchParams({ exercises: ids.join(','), patient_id: PATIENT_ID, server: SERVER })}`; }

// Next visit + medicine: live from the visit when there is one, otherwise the sample care plan.
const medsList = () => (V?.has_visits ? V.medications : [{ name: SAMPLE_CARE.medicine.name, frequency: SAMPLE_CARE.medicine.when }]);
const apptsList = () => (V?.has_visits ? V.appointments : [{ due: SAMPLE_CARE.nextVisit.when, text: SAMPLE_CARE.nextVisit.who }]);

// ---------------------------------------------------------------- render
function render() {
  const done = completedIds(data, date);
  const count = plan.filter((e) => done.has(e.id)).length;
  const next = plan.find((e) => !done.has(e.id));

  // greeting
  $('#hello').innerHTML = `${esc(greeting(today.getHours()))}, <span class="nowrap">${esc(V?.patient_name || SAMPLE_CARE.patient)}</span>`;
  $('#date').textContent = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // week: streak pill, days on a path that fills up to today
  const days = streak(data, today), labels = weekLabels(days);
  $('#streak').textContent = labels.pill;
  $('#cheer').textContent = labels.cheer;
  const week = weekDates(today), todayIdx = week.findIndex((d) => localDate(d) === date);
  $('#week-fill').style.width = `calc(100% * ${Math.max(0, todayIdx)} / 7)`;
  $('#week').innerHTML = week.map((d) => {
    const key = localDate(d), isToday = key === date, complete = completedIds(data, key).size > 0;
    const long = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return `<li><button class="day ${complete ? 'day--done' : ''} ${isToday ? 'day--today' : ''}" type="button" data-day="${key}"
      ${isToday ? 'aria-current="date"' : ''} aria-label="${esc(long)}${isToday ? ', today' : ''}${complete ? ', exercises done' : ''}">
      <span class="day__dow day__dow--short" aria-hidden="true">${esc(d.toLocaleDateString(undefined, { weekday: 'narrow' }))}</span>
      <span class="day__dow day__dow--long" aria-hidden="true">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</span>
      <span class="day__dot" aria-hidden="true">${complete ? icon('check') : d.getDate()}</span></button></li>`;
  }).join('');

  // today's exercises
  $('#ex-title').textContent = exerciseHeading(count, plan.length);
  $('#ex-sub').textContent = `${count} of ${plan.length} exercises done today`;
  const { pts, d } = stoneLayout(plan.length);
  $('#stones').innerHTML = `<path d="${d}" fill="none" stroke="var(--border)" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>`
    + plan.map((e, i) => {
      const p = pts[i], delay = `style="animation-delay:${i * 0.25}s"`;
      return done.has(e.id)
        ? `<g class="stone" ${delay}><circle cx="${p.x}" cy="${p.y}" r="22" fill="var(--fg)"/><path d="M${p.x - 9} ${p.y} l6 6 l12 -12" fill="none" stroke="var(--tile)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`
        : e === next
          ? `<g class="stone" ${delay}><circle cx="${p.x}" cy="${p.y}" r="22" fill="var(--accent)"/><circle cx="${p.x}" cy="${p.y}" r="27" fill="none" stroke="var(--accent-ink)" stroke-width="2" stroke-dasharray="3 5"/><text x="${p.x}" y="${p.y + 6}" text-anchor="middle" font-size="17" font-weight="500" fill="var(--on-accent)">${i + 1}</text></g>`
          : `<g class="stone" ${delay}><circle cx="${p.x}" cy="${p.y}" r="22" fill="var(--surface)" stroke="var(--border)" stroke-width="1.5"/><text x="${p.x}" y="${p.y + 6}" text-anchor="middle" font-size="17" font-weight="500" fill="var(--fg)">${i + 1}</text></g>`;
    }).join('');
  $('#exercises').innerHTML = plan.map((e) => {
    const isDone = done.has(e.id);
    return `<li class="${isDone ? 'done' : ''}">
      <span class="badge-icon ${isDone ? 'badge-icon--white' : 'badge-icon--peach'}">${icon(exIcon(e))}</span>
      <div class="grow"><b>${esc(e.name)}</b><small>${isDone ? 'Done today' : esc(prescription(e))}</small></div>
      ${isDone ? `<span class="tick" role="img" aria-label="Done">${icon('check', 'icon icon--sm')}</span>`
        : `<span class="ring" role="img" aria-label="${e === next ? 'Up next' : 'Not done yet'}"></span>`}</li>`;
  }).join('');
  const quoteFrom = next || plan[plan.length - 1];
  $('#pt-note').textContent = quoteFrom ? `"${quoteFrom.note}" ${clinician}` : '';
  const allDone = count === plan.length;
  $('#start').textContent = allDone ? 'Today’s plan complete' : 'Start session';
  $('#start').disabled = allDone;
  $('#coach-open').disabled = allDone;

  // next visit + medicine (the first of each; the day view lists them all)
  const appts = apptsList(), meds = medsList();
  $('#visit').innerHTML = appts.length
    ? `${esc(appts[0].due || appts[0].text)}<small>${esc(appts[0].due ? appts[0].text : '')}${appts.length > 1 ? ` and ${appts.length - 1} more` : ''}</small>`
    : 'Nothing scheduled<small>From your visits</small>';
  $('#medicine').innerHTML = meds.length
    ? `${esc(meds[0].name)}${meds[0].dose ? ` ${esc(meds[0].dose)}` : ''}<small>${esc(meds[0].frequency || meds[0].instructions || '')}${meds.length > 1 ? ` and ${meds.length - 1} more` : ''}</small>`
    : 'None from your visits<small>Follow your care team’s advice</small>';

  // questions: tick a box once you've asked it
  const qs = questions();
  $('#questions').innerHTML = qs.length
    ? qs.map((q) => `<li class="${asked.has(q.id) ? 'asked' : ''}">
        <input type="checkbox" data-asked="${esc(q.id)}" ${asked.has(q.id) ? 'checked' : ''} aria-label="Asked: ${esc(q.text)}">
        <div class="q-text"><span class="q-body">${esc(q.text)}</span><small>${q.source === 'visit' ? 'Not asked at your last visit' : esc(q.for || clinician)}</small></div>
        <button class="btn btn--icon q-remove" type="button" data-remove="${esc(q.id)}" aria-label="Remove question: ${esc(q.text)}">${icon('x', 'icon icon--sm')}</button></li>`).join('')
    : '<li class="q-empty">Anything on your mind? Add it here so you remember to ask.</li>';
  $('#question-hint').textContent = V ? `Press Enter to save. Shared with ${clinician} for your next visit.` : 'Press Enter to save. Saved on this device only.';
}

// ---------------------------------------------------------------- dialogs: plan, day, help
function safetyHtml() {
  const p = prog(), pain = p.pain_stop_level ?? 4;
  const extra = [...(p.precautions || []), ...(V?.warning_signs || []).map((w) => `Call your care team: ${w.text}`)];
  return `<p class="safety">${icon('alert', 'icon icon--sm')}<span>Stop and rest if pain goes above ${pain} out of 10, or if you feel dizzy.${extra.length ? `<br>${extra.map(esc).join('<br>')}` : ''}</span></p>`;
}

function planView() {
  const left = remaining();
  $('#detail').className = 'plan-view';
  $('#detail-title').textContent = "Today's plan";
  const equipment = V?.pt_plan ? [...new Set(V.pt_plan.exercises.map((x) => (x.instruction || '').match(/Use: ([^.]+)/)?.[1]).filter(Boolean))] : ['chair or counter for balance'];
  $('#detail-sub').textContent = `${plan.length - left.length} of ${plan.length} done. About ${Math.max(5, plan.length * 5)} minutes.${equipment.length ? ` Equipment: ${equipment.join(', ')}.` : ''}`;
  const done = completedIds(data, date);
  const goals = prog().goals?.length ? `<p><b>Your goal:</b> ${esc(prog().goals.join('; '))}</p>` : '';
  const doneRows = plan.filter((e) => done.has(e.id)).map((e) => `<div class="done-row"><span>${esc(e.name)}</span><span class="status status--good">${icon('check', 'icon icon--sm')}Done</span></div>`).join('');
  const todo = left.map((e) => {
    const previous = data.completions.filter((c) => c.id === e.id && c.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
    return `<article class="plan-ex" aria-labelledby="pl-${e.id}">
      <h3 id="pl-${e.id}">${esc(e.name)}</h3>
      <div class="demo">${exerciseArt(e.id, { label: `${e.name}, shown moving: ${e.instruction}` })}<span class="demo__cap">${icon('play', 'icon icon--sm')}${esc(e.view)}</span></div>
      <dl class="facts">
        <div><dt>Sets and reps</dt><dd class="num">${esc(dose(e))}</dd></div>
        <div><dt>${e.mode === 'precise' ? 'Aim for' : e.direction === 'decrease' ? 'Bend to' : 'Reach'}</dt><dd class="num">${e.target}°</dd></div>
        <div><dt>Hold</dt><dd class="num">${e.holdMs ? `${e.holdMs / 1000} seconds` : 'No hold'}</dd></div>
        <div><dt>The camera</dt><dd>${e.mode === 'precise' ? 'Measures your angle' : 'Counts your reps'}</dd></div>
      </dl>
      ${e.side && e.side !== 'auto' ? `<p>Use your ${esc(e.side)} side.</p>` : ''}
      <div><h4>How to do it</h4><ol><li>${esc(e.setup)}</li><li>${esc(e.instruction)}</li><li>Move slowly, then come back to the start.</li></ol></div>
      <div><h4>A good rep</h4><ul class="checks"><li>${icon('check', 'icon icon--sm')}Reach the target</li><li>${icon('check', 'icon icon--sm')}Slow and steady</li>${e.checks.map((c) => `<li>${icon('check', 'icon icon--sm')}${esc(c.label)}</li>`).join('')}</ul></div>
      <blockquote class="quote">"${esc(e.note)}"<small>${esc(clinician)}</small></blockquote>
      <p class="fine">${previous ? `Last time: ${esc(new Date(`${previous.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' }))}${Number.isFinite(previous.peak) ? `, best ${previous.peak}°` : ''}.` : 'Your first time. A fresh starting point.'}</p>
      <div class="row"><button class="btn btn--secondary" type="button" data-exercise="${e.id}">Start this one</button><button class="btn btn--ghost" type="button" data-ask="${esc(e.name)}">Ask about this</button></div>
    </article>`;
  }).join('');
  const untracked = V?.pt_plan?.untracked || [];
  const also = untracked.length ? `<section class="day-sec"><h3>Also do (no camera needed)</h3><ul class="day-list">${untracked.map((u) => `<li><div class="grow">${esc(u.name)}<small>${esc([u.as_prescribed, u.duration_minutes ? `${u.duration_minutes} minutes` : ''].filter(Boolean).join(', '))}</small></div></li>`).join('')}</ul></section>` : '';
  $('#detail-body').innerHTML = `${safetyHtml()}${goals}
    ${doneRows ? `<div>${doneRows}</div>` : ''}${todo || '<p>All done for today. Nice work!</p>'}${also}
    <div class="plan-foot"><button class="btn btn--accent btn--lg" type="button" data-session ${left.length ? '' : 'disabled'}>${left.length ? 'Start session' : 'Today’s plan complete'}</button></div>`;
}

function dayView(key) {
  const parsed = new Date(`${key}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || localDate(parsed) !== key) { location.hash = ''; return false; }
  $('#detail').className = 'day-panel';
  $('#detail-title').textContent = parsed.toLocaleDateString(undefined, { weekday: 'long' });
  $('#detail-sub').textContent = parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const done = completedIds(data, key);
  const meds = medsList(), appts = apptsList();
  $('#detail-body').innerHTML = `
    <section class="day-sec"><h3>Exercises</h3><ul class="day-list">${plan.map((e) => `<li><span class="badge-icon badge-icon--peach">${icon(exIcon(e))}</span><div class="grow">${esc(e.name)}<small>${done.has(e.id) ? 'Done' : esc(prescription(e))}</small></div>${done.has(e.id) ? `<span class="tick" role="img" aria-label="Done">${icon('check', 'icon icon--sm')}</span>` : ''}</li>`).join('')}</ul></section>
    <section class="day-sec"><h3>Medicine</h3>${meds.length ? `<ul class="day-list">${meds.map((m) => `<li><div class="grow">${esc(m.name)}${m.dose ? ` ${esc(m.dose)}` : ''}<small>${esc([m.frequency, m.instructions].filter(Boolean).join(', '))}${m.provider ? ` · from ${esc(m.provider)}${m.date ? `, ${esc(m.date)}` : ''}` : ''}</small></div></li>`).join('')}</ul>` : '<p class="muted">No medicines from your visits.</p>'}
      ${V?.stopped_medications?.length ? `<p class="fine">Stopped: ${V.stopped_medications.map((m) => esc(m.name)).join(', ')}</p>` : ''}</section>
    <section class="day-sec"><h3>Appointments</h3>${appts.length ? `<ul class="day-list">${appts.map((a) => `<li><div class="grow">${esc(a.due || a.text)}<small>${esc(a.due ? a.text : '')}</small></div></li>`).join('')}</ul>` : '<p class="muted">No appointments from your visits.</p>'}</section>
    ${key === date && remaining().length ? '<button class="btn btn--accent btn--lg" type="button" data-session>Start session</button>' : key === date ? '' : '<p class="fine">Exercise sessions start from today’s plan.</p>'}`;
  return true;
}

function helpView() {
  $('#detail').className = '';
  $('#detail-title').textContent = 'A little help';
  $('#detail-sub').textContent = '';
  $('#detail-body').innerHTML = `<p>Tap a day to see its plan. Open today's exercises full screen for the steps, or press Start session to set up your camera.</p>
    ${V ? `<p>Your plan, medicines and appointments come from your visit with ${esc(clinician)}. Questions you add here are shared with your care team, so they're ready at your next visit. Completed exercises stay in this browser.</p>`
      : '<p>Your progress and questions stay in this browser. Nothing is sent to your clinic. This is a sample plan.</p>'}
    <p class="fine">For care questions, contact your care team. If you need urgent help, call your local emergency number.</p>
    <section class="day-sec"><h3>Demo tools</h3><button class="btn btn--secondary" type="button" data-reset>Reset demo data</button></section>`;
}

// Train with your AI coach: the coach calls the patient on FaceTime and talks them through today's plan.
function coachView() {
  $('#detail').className = '';
  $('#detail-title').textContent = 'Train with your coach';
  $('#detail-sub').textContent = 'Your AI coach talks you through today’s exercises and counts your reps out loud.';
  $('#detail-body').innerHTML = `
    <ol class="coach-steps"><li>Prop your phone up so your coach can see you from your head to your hips.</li><li>Tap <b>Call my iPhone</b> and answer the FaceTime call.</li><li>Follow along. Your coach tells you how each rep went.</li></ol>
    <div class="coach-status" id="coach-status" role="status" aria-live="polite">${icon('phone', 'icon icon--sm')}<span>Checking that your coach is ready…</span></div>
    <div class="coach-actions">
      <button class="btn btn--accent btn--lg" type="button" id="coach-call" data-call disabled>Call my iPhone</button>
      <a class="btn btn--secondary btn--lg coach-link" id="coach-browser" href="${esc(COACH)}/coach-test.html" target="_blank" rel="noopener" hidden>Talk to your coach in this browser</a>
      <button class="btn btn--ghost" type="button" data-session ${remaining().length ? '' : 'disabled'}>Start session on my own</button>
    </div>
    <p class="fine">Your coach is an AI, not your therapist. It knows today’s plan, and nothing else about you.</p>`;
  coachHealth(COACH).then((ready) => {
    if (!$('#coach-call')) return;                       // the view was closed meanwhile
    coachStatus(ready ? 'Your coach is ready. Tap Call my iPhone when you are.' : UNAVAILABLE, ready ? 'ok' : 'err');
    $('#coach-call').disabled = !ready;
    $('#coach-browser').hidden = !ready;
  });
}
function coachStatus(text, kind = '') {
  const el = document.getElementById('coach-status');
  if (!el) return;
  el.className = `coach-status ${kind}`;
  el.querySelector('span').textContent = text;
}
async function callCoach() {
  const btn = $('#coach-call');
  btn.disabled = true;
  coachStatus('Asking your coach to call…');
  const r = await startCall(COACH);
  if (!r.ok) { coachStatus(r.message, 'err'); btn.disabled = false; return; }
  coachStatus(r.message);
  const end = await watchCall(COACH, r.callId, (u) => coachStatus(u.message, u.state === 'ready' ? 'ok' : ''));
  if (end?.state === 'terminal') { coachStatus(end.message); const b = document.getElementById('coach-call'); if (b) b.disabled = false; }
}

function route() {
  const h = location.hash;
  if (!h) { if ($('#detail').open) $('#detail').close(); return; }
  if (h === '#plan') planView();
  else if (h === '#coach') coachView();
  else if (/^#day=\d{4}-\d{2}-\d{2}$/.test(h)) { if (!dayView(h.slice(5))) return; }
  else if (h === '#help') helpView();
  else return;
  if (!$('#detail').open) { opener = document.activeElement; $('#detail').showModal(); }
  $('#close').focus();
}
$('#detail').addEventListener('cancel', (e) => { e.preventDefault(); location.hash = ''; });
$('#detail').addEventListener('close', () => opener?.focus());
$('#close').onclick = () => { location.hash = ''; };
$('#expand').onclick = () => { location.hash = 'plan'; };
$('#start').onclick = () => session(remaining().map((e) => e.id));
$('#coach-open').onclick = () => { location.hash = 'coach'; };

// ---------------------------------------------------------------- clicks (days, plan buttons, questions, reset)
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.day) location.hash = `day=${b.dataset.day}`;
  if (b.hasAttribute('data-help')) location.hash = 'help';
  if (b.hasAttribute('data-call')) callCoach();
  if (b.dataset.exercise) session([b.dataset.exercise]);
  if (b.hasAttribute('data-session')) session(remaining().map((x) => x.id));
  if (b.dataset.ask) { location.hash = ''; $('#question').value = `About ${b.dataset.ask}: `; setTimeout(() => $('#question').focus(), 0); }
  if (b.hasAttribute('data-reset')) {
    if (!confirm(`Erase all demo data for ${PATIENT_ID}?\n\nThis clears completed exercises and questions on this device${V ? ', and the visits, plan, questions and home sessions saved on the visit server.' : '.'}`)) return;
    let serverOk = true;
    if (V) { try { const r = await fetch(`${API}?confirm=yes`, { method: 'DELETE' }); serverOk = r.ok; } catch { serverOk = false; } }
    data = { ...data, questions: [], completions: [] }; persist();
    asked.clear(); saveAsked();
    try { localStorage.removeItem('visitCopilot.plan'); } catch {}
    location.hash = '';
    if (!serverOk) { notice('This device was reset, but the visit server did not allow it (check ALLOW_RESET).'); setTimeout(() => location.reload(), 2500); }
    else location.reload();
    return;
  }
  if (b.dataset.remove) {
    const id = b.dataset.remove;
    if (V && V.questions.some(q => q.id === id)) {
      try { const res = await fetch(`${API}/questions/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!res.ok) throw new Error(res.status); V.questions = V.questions.filter((q) => q.id !== id); }
      catch { notice('Could not reach your clinic. Try again later.'); }
    } else { data.questions = data.questions.filter((q) => q.id !== id); persist(); }
    asked.delete(id); saveAsked();
    render(); $('#question').focus();
  }
});
document.addEventListener('change', (e) => {
  const id = e.target.dataset?.asked;
  if (!id) return;
  if (e.target.checked) asked.add(id); else asked.delete(id);
  saveAsked(); render();
  document.querySelector(`[data-asked="${CSS.escape(id)}"]`)?.focus();
});

// ---------------------------------------------------------------- add a question (Enter to save, or the mic)
function questionError(msg) {
  $('#question').setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (msg) $('#question-hint').textContent = msg; else render();
  $('#question-hint').classList.toggle('err', !!msg);
}
$('#question-form').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#question').value.trim();
  if (!text) { questionError('Type a question first, then press Enter.'); $('#question').focus(); return; }
  const id = crypto.randomUUID();
  if (V) {
    try {
      V.questions.push(await postQuestion(text, id));
      $('#question').value = ''; questionError('');
      notice(`Question saved for ${clinician}. It will be ready at your next visit.`);
      return;
    } catch { /* fall back to this device */ }
  }
  data.questions.push({ id, text, for: clinician });
  const saved = persist();
  $('#question').value = ''; questionError('');
  if (saved) notice('Question saved on this device.');
};
$('#question').oninput = () => { if ($('#question').getAttribute('aria-invalid') === 'true') questionError(''); };
const Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recog) {
  $('#mic').disabled = true;
  $('#mic').setAttribute('aria-label', 'Voice input is unavailable in this browser');
} else {
  $('#mic').onclick = () => {
    const r = new Recog();
    r.lang = navigator.language;
    r.onresult = (e) => { $('#question').value = `${$('#question').value} ${e.results[0][0].transcript}`.slice(0, 500).trim(); };
    r.onerror = () => notice('Voice input could not start. You can type your question.');
    r.onend = () => { $('#mic').disabled = false; };
    try { r.start(); $('#mic').disabled = true; notice('Listening…'); }
    catch { notice('Voice input is unavailable. Please type your question.'); }
  };
}

// ---------------------------------------------------------------- light / dark
let dark = matchMedia('(prefers-color-scheme: dark)').matches;
function theme() {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme').setAttribute('aria-pressed', String(dark));
  $('#theme').setAttribute('aria-label', dark ? 'Light mode' : 'Dark mode');
  $('#theme').innerHTML = icon(dark ? 'sun' : 'moon');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#101F2B' : '#F4F0E2';
}
$('#theme').onclick = () => { dark = !dark; theme(); };
theme();

addEventListener('hashchange', route);
addEventListener('pageshow', (event) => { data = readData(); render(); if (event.persisted) loadVisitData(); });
render();
route();
addVisitButtons();
loadVisitData();
