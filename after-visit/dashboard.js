import { planExercises } from './js/plan.js';
import { readData, writeData, localDate, weekDates, completedIds, streak } from './js/dashboardData.js';
const $ = s=>document.querySelector(s), plan=planExercises(), today=new Date(), date=localDate(today);
const paths={expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l7 7m11-7-7 7M3 21l7-7m7 7-7-7',close:'m6 6 12 12M6 18 18 6',calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2',pill:'m9 15 6-6M5 19a5 5 0 0 1 0-7l7-7a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7 0',message:'M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z',mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8',move:'M12 3a2 2 0 1 0 0 .1M12 8v7m0-6L4 6m8 3 8-5m-8 11-5 6m5-6 5 6',check:'m5 12 4 4L19 6'};
const icon = name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.move}"/></svg>`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data=readData(), opener=null;
function notice(text) { $('#notice').textContent=text; $('#notice').hidden=false; clearTimeout(notice.timer); notice.timer=setTimeout(()=>$('#notice').hidden=true,5000); }
function persist() { try {writeData(data);return true;}catch{notice('Storage is unavailable. Changes will last only in this tab.');return false;} }
$('#date').textContent=today.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
for(const el of document.querySelectorAll('[data-icon]')) el.innerHTML=icon(el.dataset.icon);
$('#expand').innerHTML=icon('expand'); $('#close').innerHTML=icon('close'); $('#mic').innerHTML=icon('mic');
const remaining=()=>plan.filter(e=>!completedIds(data,date).has(e.id));
function session(ids) { if(ids.length) location.href=`session.html?exercises=${encodeURIComponent(ids.join(','))}`; }
function render() {
  const done=completedIds(data,date), count=plan.filter(e=>done.has(e.id)).length;
  $('#progress').textContent=`${count} of ${plan.length} done`;
  $('#encouragement').textContent=count===plan.length?'Nice work today!':count===plan.length-1?'One to go!':'Let’s take it one step at a time.';
  $('#streak').textContent=streak(data,today)?`${streak(data,today)}-day streak`:'A fresh start';
  $('#stones').innerHTML=plan.map((e,i)=>`<span class="stone ${done.has(e.id)?'done':''}" style="animation-delay:${i*100}ms">${done.has(e.id)?'✓':i+1}</span>`).join('');
  $('#week').innerHTML=weekDates(today).map(d=>{const key=localDate(d),complete=completedIds(data,key).size>0;return `<button class="day ${key===date?'today':''} ${complete?'done':''}" data-day="${key}" ${key===date?'aria-current="date"':''} aria-label="${esc(d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}))}${complete?', exercises recorded':''}"><span class="day__dow">${d.toLocaleDateString(undefined,{weekday:'narrow'})}</span><span class="day__dot">${complete?'✓':d.getDate()}</span></button>`;}).join('');
  $('#exercises').innerHTML=plan.map(e=>`<div class="exercise-row"><span class="badge">${icon('move')}</span><div class="text"><h3>${esc(e.name)}</h3><p>${e.reps} reps${e.mode==='precise'?`, target ${e.target}°`:''}</p><p class="fine">${done.has(e.id)?'✓ Done today':esc(e.view)}</p></div><button class="btn btn--ghost" data-plan>Details</button></div>`).join('');
  $('#start').textContent=count===plan.length?'Today’s plan complete':'Start session'; $('#start').disabled=count===plan.length;
  $('#questions').innerHTML=data.questions.length?data.questions.map(q=>`<li><span>${esc(q.text)}<br><span class="chip">For Dr. Lee</span></span><button class="btn btn--icon" data-remove="${esc(q.id)}" aria-label="Remove question: ${esc(q.text)}">${icon('close')}</button></li>`).join(''):'<li class="muted">A place for anything on your mind.</li>';
}
function ask(name) { location.hash=''; $('#question').value=`About ${name}: `; setTimeout(()=>$('#question').focus(),0); }
function planView() {
  $('#detail-title').textContent="Today's plan"; $('#detail').className='';
  $('#detail-body').innerHTML=`<p>${plan.length-remaining().length} of ${plan.length} done. Equipment: chair or counter for balance.</p><p class="safety">Stop and rest if pain goes above 4/10, or if you feel dizzy.</p>${plan.map(e=>{const done=completedIds(data,date).has(e.id);const previous=data.completions.filter(c=>c.id===e.id&&c.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0];return `<details class="plan-item" ${done?'':'open'}><summary>${done?'✓ ':''}${esc(e.name)}${done?' — done today':''}</summary><div class="pose-demo" role="img" aria-label="Illustration of a person exercising">${icon('move')}</div><p class="fine">Position illustration. Follow the steps below.</p><p>${e.reps} reps. ${e.mode==='precise'?`Target ${e.target} degrees.`:'Rep counting mode.'} ${e.holdMs?`Hold for ${e.holdMs/1000} seconds.`:'No hold prescribed.'}</p><h3>How to do it</h3><ol><li>${esc(e.setup)}</li><li>${esc(e.instruction)}</li><li>Move slowly and return to your starting position.</li></ol><h3>What counts as a good rep</h3><p>✓ Reach your prescribed range.<br>✓ Move slowly and steadily.<br>${e.checks.map(c=>`✓ ${esc(c.label)}.`).join('<br>')}</p><h3>Camera setup</h3><p>${esc(e.view)}. ${e.mode==='precise'?'Precise angle tracking':'Rep counting'}.</p><blockquote>${esc(e.note)}<br>— Dr. Lee</blockquote><p class="fine">${previous?`Last time: ${esc(previous.date)}${Number.isFinite(previous.peak)?`, best ${previous.peak}°`:''}.`:'Your first session is a fresh starting point.'}</p><div class="row"><button class="btn btn--secondary" data-exercise="${e.id}">Start this exercise</button><button class="btn btn--ghost" data-ask="${esc(e.name)}">Ask a question about this</button></div></details>`;}).join('')}<div class="sticky-action"><button class="btn btn--accent btn--lg" data-session ${remaining().length?'':'disabled'}>${remaining().length?'Start session':'Today’s plan complete'}</button></div>`;
}
function dayView(key) {
  const parsed=new Date(`${key}T12:00:00`); if(Number.isNaN(parsed.getTime())||localDate(parsed)!==key){location.hash='';return;}
  $('#detail-title').textContent=parsed.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}); $('#detail').className='day-panel';
  const done=completedIds(data,key);
  $('#detail-body').innerHTML=`<h3>Your exercises</h3>${plan.map(e=>`<div class="exercise-row"><span class="badge">${icon('move')}</span><div><h3>${esc(e.name)}</h3><p>${e.reps} reps${done.has(e.id)?' — ✓ Recorded':''}</p></div></div>`).join('')}<h3>Medicine</h3><p>No medicines in this sample plan.</p><h3>Appointments</h3><p>No appointments scheduled.</p>${key===date?'<button class="btn btn--accent btn--lg" data-session>Start session</button>':'<p class="fine">Exercise sessions are available from today’s plan.</p>'}`;
}
function route() {
  if(!location.hash){if($('#detail').open)$('#detail').close();return;}
  if(location.hash==='#plan')planView();
  else if(/^#day=\d{4}-\d{2}-\d{2}$/.test(location.hash))dayView(location.hash.slice(5));
  else if(location.hash==='#help'){ $('#detail').className='';$('#detail-title').textContent='A little help';$('#detail-body').innerHTML='<p>Choose a day to see your plan. Open exercise details to read instructions, or choose Start session to set up your camera.</p><p>Completed exercises and questions stay in this browser. Nothing is sent to your clinic. Videos stay in the session until you download them.</p><p>This is a sample plan. For care questions, contact your care team. If you need urgent help, call your local emergency number.</p>';}
  else return;
  if(!$('#detail').open){opener=document.activeElement;$('#detail').showModal();} $('#close').focus();
}
$('#detail').addEventListener('cancel',e=>{e.preventDefault();location.hash='';});
$('#detail').addEventListener('close',()=>{opener?.focus();});
$('#close').onclick=()=>{location.hash='';};
$('#expand').onclick=()=>location.hash='plan'; $('#start').onclick=()=>session(remaining().map(e=>e.id));
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.day)location.hash=`day=${b.dataset.day}`;if(b.hasAttribute('data-plan'))location.hash='plan';if(b.hasAttribute('data-help'))location.hash='help';if(b.dataset.exercise)session([b.dataset.exercise]);if(b.hasAttribute('data-session'))session(remaining().map(e=>e.id));if(b.dataset.ask)ask(b.dataset.ask);if(b.dataset.remove){data.questions=data.questions.filter(q=>q.id!==b.dataset.remove);persist();render();$('#question').focus();}});
$('#question-form').onsubmit=e=>{e.preventDefault();const text=$('#question').value.trim();if(!text){$('#question').setCustomValidity('Please write a question.');$('#question').reportValidity();return;}data.questions.push({id:crypto.randomUUID(),text});const saved=persist();render();$('#question').value='';if(saved)notice('Question saved on this device.');};
$('#question').oninput=()=>$('#question').setCustomValidity('');
const Recog=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!Recog){$('#mic').disabled=true;$('#question-hint').textContent='Type your question. Voice input is unavailable in this browser.';}
else $('#mic').onclick=()=>{const r=new Recog();r.lang=navigator.language;r.onresult=e=>{$('#question').value=($('#question').value+' '+e.results[0][0].transcript).slice(0,500).trim();$('#question').setCustomValidity('');};r.onerror=()=>notice('Voice input could not start. You can type your question.');r.onend=()=>$('#mic').disabled=false;try{r.start();$('#mic').disabled=true;notice('Listening…');}catch{notice('Voice input is unavailable. Please type your question.');}};
let dark=matchMedia('(prefers-color-scheme:dark)').matches;
function theme(){document.documentElement.dataset.theme=dark?'dark':'light';$('#theme').textContent=dark?'Light mode':'Dark mode';}
$('#theme').onclick=()=>{dark=!dark;theme();};theme();
addEventListener('hashchange',route);addEventListener('pageshow',()=>{data=readData();render();});render();route();
