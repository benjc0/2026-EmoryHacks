import { planExercises } from './js/plan.js';
import { readData, writeData, localDate, weekDates, completedIds, streak } from './js/dashboardData.js';
const $ = s=>document.querySelector(s), today=new Date(), date=localDate(today);
const paths={expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l7 7m11-7-7 7M3 21l7-7m7 7-7-7',close:'m6 6 12 12M6 18 18 6',calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2',pill:'m9 15 6-6M5 19a5 5 0 0 1 0-7l7-7a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7 0',message:'M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z',mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8',move:'M12 3a2 2 0 1 0 0 .1M12 8v7m0-6L4 6m8 3 8-5m-8 11-5 6m5-6 5 6',check:'m5 12 4 4L19 6'};
const icon = name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.move}"/></svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------------------------------------------------------------- During Visit connection
// The dashboard reads the patient's latest visit from the Visit Copilot server: the therapist's exercise plan,
// medicines, appointments and questions. If the server can't be reached, everything works as before with the
// sample plan. Open as  dashboard.html?patient_id=kim-001  (add &server=http://host:8000 if it runs elsewhere;
// both are remembered on this device).
const store = { get:k=>{try{return localStorage.getItem(k);}catch{return null;}}, set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}} };
const params = new URLSearchParams(location.search);
const PATIENT_ID = params.get('patient_id') || store.get('visitCopilot.patientId') || 'demo-patient';
const SERVER = (params.get('server') ?? store.get('visitCopilot.server') ?? '').replace(/\/$/, '');
if (params.get('patient_id')) store.set('visitCopilot.patientId', PATIENT_ID);
if (params.get('server')) store.set('visitCopilot.server', SERVER);
const API = `${SERVER}/api/patients/${encodeURIComponent(PATIENT_ID)}`;

let plan=planExercises();           // sample plan until the visit server answers
let V=null;                          // dashboard data from the visit server (null = offline / no server)
let clinician='Dr. Lee';             // sample name; replaced by the real clinician from the visit
const prog=()=>V?.pt_plan?.program||{};

/** planExercises() + the extra fields the visit plan carries (sets, hold, times a day, therapist's limit). */
function fromVisitPlan(p) {
  const extras=Object.fromEntries((p.exercises||[]).map(x=>[x.id,x]));
  return planExercises(p).map(e=>{const x=extras[e.id]||{};return {...e,
    sets:x.sets??1, perDay:x.perDay??null, holdMs:x.holdMs??e.holdMs, note:x.note||e.note,
    checks:[...(e.checks||[]),...(x.checks||[])], prescribedAs:x.prescribedAs||''};});
}
const dose=e=>`${e.sets>1?`${e.sets} sets of `:''}${e.reps} reps${e.perDay?`, ${e.perDay}× a day`:''}`;

async function loadVisitData() {
  try {
    const res=await fetch(`${API}/dashboard`);
    if(!res.ok) throw new Error(res.status);
    V=await res.json();
  } catch { V=null; return; }            // offline or no server: keep the sample dashboard
  if(V.pt_plan?.exercises?.length){
    plan=fromVisitPlan(V.pt_plan);
    store.set('visitCopilot.plan', JSON.stringify(V.pt_plan));   // so the session page can use the same plan
  }
  clinician=V.clinician||(V.has_visits?'your care team':clinician);
  // questions written on this device before the server was reachable -> send them too
  const local=data.questions||[];
  for(const q of local){ if(!V.questions.some(s=>s.id===q.id)) { try{ V.questions.push(await postQuestion(q.text,q.id)); }catch{} } }
  if(local.length){ data.questions=[]; persist(); }
  render(); route(); addVisitButtons();
  if(params.get('visit_id')) notice('Your visit is saved. Your plan, medicines and questions are up to date.');
  else if(V.pt_plan) notice(`Your exercise plan from your visit on ${V.pt_plan.createdAt} is ready.`);
}
async function postQuestion(text,id) {
  const res=await fetch(`${API}/questions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,id})});
  if(!res.ok) throw new Error(res.status); return res.json();
}
const questions=()=>V?V.questions:data.questions;

// ---------------------------------------------------------------- open Visit Copilot
// Visit Copilot runs on the same server as the API (SERVER, or this site if empty). The link carries the patient,
// their languages, and a way back here; their saved questions are preloaded by Visit Copilot itself.
const VISIT_URL = params.get('visit_url') || store.get('visitCopilot.visitUrl') || (SERVER ? `${SERVER}/` : '/');
if (params.get('visit_url')) store.set('visitCopilot.visitUrl', VISIT_URL);
function visitLink() {
  const back = new URL(location.href); back.hash = ''; for (const k of ['visit_id', 'return_url']) back.searchParams.delete(k);
  const q = new URLSearchParams({ patient_id: PATIENT_ID, return_url: back.toString() });
  if (V?.patient_lang) q.set('patient_lang', V.patient_lang);
  if (V?.doctor_lang) q.set('doctor_lang', V.doctor_lang);
  if (V?.clinician && V.clinician !== 'your care team') q.set('provider', V.clinician);
  return `${VISIT_URL}${VISIT_URL.includes('?') ? '&' : '?'}${q}`;
}
function addVisitButtons() {
  // Only offer the button when Visit Copilot actually answered (or its address was given explicitly).
  // Otherwise it would point back at this page (e.g. both apps started on the same port).
  const known = !!V || !!params.get('visit_url') || !!store.get('visitCopilot.visitUrl');
  for (const id of ['visit-copilot-link', 'visit-copilot-questions']) { const el = document.getElementById(id); if (el) el.hidden = !known; }
  if (!known) return;
  // 1) main button: in the top bar if there is one, otherwise next to the greeting
  let a = document.getElementById('visit-copilot-link');
  if (!a) {
    a = Object.assign(document.createElement('a'), { id: 'visit-copilot-link', className: 'btn btn--accent' });
    a.innerHTML = `${icon('message')}<span>Start a doctor's visit</span>`;
    a.querySelector('svg').style.cssText = 'width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round';
    a.title = 'Live interpreter, notes and question reminders during your appointment';
    a.style.cssText = 'display:inline-flex;align-items:center;gap:8px;text-decoration:none';
    const spot = document.querySelector('.mast .row') || document.querySelector('.mast') || document.querySelector('.greeting');
    spot ? spot.appendChild(a) : document.body.prepend(a);
  }
  a.href = visitLink();
  // 2) small link under the questions: "take these to your visit"
  const qs = document.querySelector('.questions');
  if (qs) {
    let l = document.getElementById('visit-copilot-questions');
    if (!l) {
      l = Object.assign(document.createElement('a'), { id: 'visit-copilot-questions', className: 'fine' });
      l.textContent = 'At your appointment? Open Visit Copilot. These questions will be ready. →';
      l.style.cssText = 'display:block;margin:8px 0';
      (document.getElementById('questions') || qs.lastElementChild).after(l);
    }
    l.href = visitLink();
  }
}

// ---------------------------------------------------------------- page
let data=readData(), opener=null;
function notice(text) { $('#notice').textContent=text; $('#notice').hidden=false; clearTimeout(notice.timer); notice.timer=setTimeout(()=>$('#notice').hidden=true,5000); }
function persist() { try {writeData(data);return true;}catch{notice('Storage is unavailable. Changes will last only in this tab.');return false;} }
$('#date').textContent=today.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
for(const el of document.querySelectorAll('[data-icon]')) el.innerHTML=icon(el.dataset.icon);
$('#expand').innerHTML=icon('expand'); $('#close').innerHTML=icon('close'); $('#mic').innerHTML=icon('mic');
const remaining=()=>plan.filter(e=>!completedIds(data,date).has(e.id));
function session(ids) { if(ids.length) location.href=`session.html?exercises=${encodeURIComponent(ids.join(','))}`; }

/** Replace a card's sample content (everything after its heading) with live content from the visit. */
function fillSection(sel, html) {
  const el=$(sel); if(!el) return;
  let box=el.querySelector('[data-live]');
  if(!box){
    const head=el.querySelector('.section-head')||el.querySelector('h2');
    for(let n=head?.nextElementSibling;n;){const next=n.nextElementSibling;n.remove();n=next;}
    box=document.createElement('div'); box.dataset.live=''; el.appendChild(box);
  }
  box.innerHTML=html;
}
const medsHtml=()=>(V.medications.length?V.medications.map(m=>`<p class="big-date">${esc(m.name)}${m.dose?` ${esc(m.dose)}`:''}</p><p>${esc(m.frequency||'')}${m.instructions?` · ${esc(m.instructions)}`:''}</p><p class="fine">${m.purpose?`${esc(m.purpose)} · `:''}From ${esc(m.provider||'your visit')}, ${esc(m.date)}</p>`).join(''):'<p class="muted">No medicines from your visits.</p>')
  +(V.stopped_medications.length?`<p class="fine">Stopped: ${V.stopped_medications.map(m=>esc(m.name)).join(', ')}</p>`:'');
const apptsHtml=()=>V.appointments.length?V.appointments.map((a,i)=>`${i===0&&a.due?`<p class="big-date">${esc(a.due)}</p>`:''}<p>${esc(a.text)}${i>0&&a.due?` <span class="fine">(${esc(a.due)})</span>`:''}</p>`).join(''):'<p class="muted">No appointments from your visits.</p>';

function render() {
  const done=completedIds(data,date), count=plan.filter(e=>done.has(e.id)).length;
  $('#progress').textContent=`${count} of ${plan.length} done`;
  $('#encouragement').textContent=count===plan.length?'Nice work today!':count===plan.length-1?'One to go!':'Let’s take it one step at a time.';
  $('#streak').textContent=streak(data,today)?`${streak(data,today)}-day streak`:'A fresh start';
  $('#stones').innerHTML=plan.map((e,i)=>`<span class="stone ${done.has(e.id)?'done':''}" style="animation-delay:${i*100}ms">${done.has(e.id)?'✓':i+1}</span>`).join('');
  $('#week').innerHTML=weekDates(today).map(d=>{const key=localDate(d),complete=completedIds(data,key).size>0;return `<button class="day ${key===date?'today':''} ${complete?'done':''}" data-day="${key}" ${key===date?'aria-current="date"':''} aria-label="${esc(d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}))}${complete?', exercises recorded':''}"><span class="day__dow">${d.toLocaleDateString(undefined,{weekday:'narrow'})}</span><span class="day__dot">${complete?'✓':d.getDate()}</span></button>`;}).join('');
  $('#exercises').innerHTML=plan.map(e=>`<div class="exercise-row"><span class="badge">${icon('move')}</span><div class="text"><h3>${esc(e.name)}</h3><p>${esc(dose(e))}${e.mode==='precise'?`, target ${e.target}°`:''}${e.side&&e.side!=='auto'?` · ${esc(e.side)} side`:''}</p><p class="fine">${done.has(e.id)?'✓ Done today':esc(e.view)}</p></div><button class="btn btn--ghost" data-plan>Details</button></div>`).join('');
  $('#start').textContent=count===plan.length?'Today’s plan complete':'Start session'; $('#start').disabled=count===plan.length;
  const qs=questions();
  $('#questions').innerHTML=qs.length?qs.map(q=>`<li><span>${esc(q.text)}<br><span class="chip">${q.source==='visit'?'Not asked at your last visit':`For ${esc(clinician)}`}</span></span><button class="btn btn--icon" data-remove="${esc(q.id)}" aria-label="Remove question: ${esc(q.text)}">${icon('close')}</button></li>`).join(''):'<li class="muted">A place for anything on your mind.</li>';
  if(V?.has_visits){ fillSection('.medicine',medsHtml()); fillSection('.appointments',apptsHtml()); }
}
function ask(name) { location.hash=''; $('#question').value=`About ${name}: `; setTimeout(()=>$('#question').focus(),0); }
function safetyHtml() {
  const p=prog(), pain=p.pain_stop_level??4;
  const extra=[...(p.precautions||[]),...(V?.warning_signs||[]).map(w=>`Call your care team: ${w.text}`)];
  return `<p class="safety">Stop and rest if pain goes above ${pain}/10, or if you feel dizzy.${extra.length?`<br>${extra.map(esc).join('<br>')}`:''}</p>`;
}
function planView() {
  $('#detail-title').textContent="Today's plan"; $('#detail').className='';
  const untracked=V?.pt_plan?.untracked||[];
  const equipment=V?.pt_plan?[...new Set(V.pt_plan.exercises.map(x=>(x.instruction||'').match(/Use: ([^.]+)/)?.[1]).filter(Boolean))]:['chair or counter for balance'];
  $('#detail-body').innerHTML=`<p>${plan.length-remaining().length} of ${plan.length} done.${equipment.length?` Equipment: ${esc(equipment.join(', '))}.`:''}</p>${safetyHtml()}${p_goals()}${plan.map(e=>{const done=completedIds(data,date).has(e.id);const previous=data.completions.filter(c=>c.id===e.id&&c.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0];return `<details class="plan-item" ${done?'':'open'}><summary>${done?'✓ ':''}${esc(e.name)}${done?' — done today':''}</summary><div class="pose-demo" role="img" aria-label="Illustration of a person exercising">${icon('move')}</div><p class="fine">Position illustration. Follow the steps below.</p><p>${esc(dose(e))}. ${e.mode==='precise'?`Target ${e.target} degrees.`:'Rep counting mode.'} ${e.holdMs?`Hold for ${e.holdMs/1000} seconds.`:'No hold prescribed.'}${e.side&&e.side!=='auto'?` Your ${esc(e.side)} side.`:''}</p><h3>How to do it</h3><ol><li>${esc(e.setup)}</li><li>${esc(e.instruction)}</li><li>Move slowly and return to your starting position.</li></ol><h3>What counts as a good rep</h3><p>✓ Reach your prescribed range.<br>✓ Move slowly and steadily.<br>${e.checks.map(c=>`✓ ${esc(c.label)}.`).join('<br>')}</p><h3>Camera setup</h3><p>${esc(e.view)}. ${e.mode==='precise'?'Precise angle tracking':'Rep counting'}.</p><blockquote>${esc(e.note)}<br>— ${esc(clinician)}</blockquote><p class="fine">${previous?`Last time: ${esc(previous.date)}${Number.isFinite(previous.peak)?`, best ${previous.peak}°`:''}.`:'Your first session is a fresh starting point.'}</p><div class="row"><button class="btn btn--secondary" data-exercise="${e.id}">Start this exercise</button><button class="btn btn--ghost" data-ask="${esc(e.name)}">Ask a question about this</button></div></details>`;}).join('')}${untracked.length?`<h3>Also do (no camera needed)</h3><ul>${untracked.map(u=>`<li>${esc(u.name)}${u.as_prescribed?` – ${esc(u.as_prescribed)}`:''}${u.duration_minutes?`, ${u.duration_minutes} minutes`:''}</li>`).join('')}</ul>`:''}<div class="sticky-action"><button class="btn btn--accent btn--lg" data-session ${remaining().length?'':'disabled'}>${remaining().length?'Start session':'Today’s plan complete'}</button></div>`;
}
const p_goals=()=>prog().goals?.length?`<p>🎯 Goal: ${esc(prog().goals.join('; '))}</p>`:'';
function dayView(key) {
  const parsed=new Date(`${key}T12:00:00`); if(Number.isNaN(parsed.getTime())||localDate(parsed)!==key){location.hash='';return;}
  $('#detail-title').textContent=parsed.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}); $('#detail').className='day-panel';
  const done=completedIds(data,key);
  const meds=V?.has_visits?medsHtml():'<p>No medicines in this sample plan.</p>';
  const appts=V?.has_visits?apptsHtml():'<p>No appointments scheduled.</p>';
  $('#detail-body').innerHTML=`<h3>Your exercises</h3>${plan.map(e=>`<div class="exercise-row"><span class="badge">${icon('move')}</span><div><h3>${esc(e.name)}</h3><p>${esc(dose(e))}${done.has(e.id)?' — ✓ Recorded':''}</p></div></div>`).join('')}<h3>Medicine</h3>${meds}<h3>Appointments</h3>${appts}${key===date?'<button class="btn btn--accent btn--lg" data-session>Start session</button>':'<p class="fine">Exercise sessions are available from today’s plan.</p>'}`;
}
function route() {
  if(!location.hash){if($('#detail').open)$('#detail').close();return;}
  if(location.hash==='#plan')planView();
  else if(/^#day=\d{4}-\d{2}-\d{2}$/.test(location.hash))dayView(location.hash.slice(5));
  else if(location.hash==='#help'){ $('#detail').className='';$('#detail-title').textContent='A little help';$('#detail-body').innerHTML=`<p>Choose a day to see your plan. Open exercise details to read instructions, or choose Start session to set up your camera.</p>${V?`<p>Your plan, medicines and appointments come from your visit with ${esc(clinician)}. Questions you add here are shared with your care team so they are ready at your next visit. Completed exercises stay in this browser.</p>`:'<p>Completed exercises and questions stay in this browser. Nothing is sent to your clinic. Videos stay in the session until you download them.</p><p>This is a sample plan.</p>'}<p>For care questions, contact your care team. If you need urgent help, call your local emergency number.</p><hr><p class="fine">Demo tools</p><button class="btn btn--ghost" data-reset>Reset demo data</button>`;}
  else return;
  if(!$('#detail').open){opener=document.activeElement;$('#detail').showModal();} $('#close').focus();
}
$('#detail').addEventListener('cancel',e=>{e.preventDefault();location.hash='';});
$('#detail').addEventListener('close',()=>{opener?.focus();});
$('#close').onclick=()=>{location.hash='';};
$('#expand').onclick=()=>location.hash='plan'; $('#start').onclick=()=>session(remaining().map(e=>e.id));
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.day)location.hash=`day=${b.dataset.day}`;if(b.hasAttribute('data-plan'))location.hash='plan';if(b.hasAttribute('data-help'))location.hash='help';if(b.dataset.exercise)session([b.dataset.exercise]);if(b.hasAttribute('data-session'))session(remaining().map(e=>e.id));if(b.dataset.ask)ask(b.dataset.ask);
  if(b.hasAttribute('data-reset')){
    if(!confirm(`Erase all demo data for ${PATIENT_ID}?\n\nThis clears completed exercises and questions on this device`+(V?', and the visits, plan, questions and home sessions saved on the visit server.':'.')))return;
    let serverOk=true;
    if(V){try{const r=await fetch(`${API}?confirm=yes`,{method:'DELETE'});serverOk=r.ok;}catch{serverOk=false;}}
    data={...data,questions:[],completions:[]};persist();
    try{localStorage.removeItem('visitCopilot.plan');}catch{}
    location.hash='';
    if(!serverOk){notice('This device was reset, but the visit server did not allow it (check ALLOW_RESET).');setTimeout(()=>location.reload(),2500);}
    else location.reload();
    return;}
  if(b.dataset.remove){const id=b.dataset.remove;
    if(V){try{await fetch(`${API}/questions/${encodeURIComponent(id)}`,{method:'DELETE'});V.questions=V.questions.filter(q=>q.id!==id);}catch{notice('Could not reach your clinic. Try again later.');}}
    else{data.questions=data.questions.filter(q=>q.id!==id);persist();}
    render();$('#question').focus();}});
$('#question-form').onsubmit=async e=>{e.preventDefault();const text=$('#question').value.trim();if(!text){$('#question').setCustomValidity('Please write a question.');$('#question').reportValidity();return;}
  const id=crypto.randomUUID();
  if(V){try{V.questions.push(await postQuestion(text,id));render();$('#question').value='';notice(`Question saved for ${clinician}. It will be ready at your next visit.`);return;}catch{/* fall back to this device */}}
  data.questions.push({id,text});const saved=persist();render();$('#question').value='';if(saved)notice('Question saved on this device.');};
$('#question').oninput=()=>$('#question').setCustomValidity('');
const Recog=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!Recog){$('#mic').disabled=true;$('#question-hint').textContent='Type your question. Voice input is unavailable in this browser.';}
else $('#mic').onclick=()=>{const r=new Recog();r.lang=navigator.language;r.onresult=e=>{$('#question').value=($('#question').value+' '+e.results[0][0].transcript).slice(0,500).trim();$('#question').setCustomValidity('');};r.onerror=()=>notice('Voice input could not start. You can type your question.');r.onend=()=>$('#mic').disabled=false;try{r.start();$('#mic').disabled=true;notice('Listening…');}catch{notice('Voice input is unavailable. Please type your question.');}};
let dark=matchMedia('(prefers-color-scheme:dark)').matches;
function theme(){document.documentElement.dataset.theme=dark?'dark':'light';$('#theme').textContent=dark?'Light mode':'Dark mode';}
$('#theme').onclick=()=>{dark=!dark;theme();};theme();
addEventListener('hashchange',route);addEventListener('pageshow',()=>{data=readData();render();});render();route();
addVisitButtons();
loadVisitData();