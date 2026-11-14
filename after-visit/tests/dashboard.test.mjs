import test from 'node:test';
import assert from 'node:assert/strict';
import {localDate,weekDates,streak,readData,recordCompletion,completedIds,greeting,exerciseHeading,weekLabels,stoneLayout,SAMPLE_CARE} from '../js/dashboardData.js';
test('greeting follows the time of day',()=>{
 assert.equal(greeting(8),'Good morning');assert.equal(greeting(13),'Good afternoon');assert.equal(greeting(19),'Good evening');
});
test('exercise heading is encouraging at every step (design: "One to go!")',()=>{
 assert.equal(exerciseHeading(1,2),'One to go!');assert.equal(exerciseHeading(2,3),'One to go!');
 assert.equal(exerciseHeading(2,2),'All done today!');assert.equal(exerciseHeading(0,2),'Ready when you are');
 for(const [d,t] of [[0,3],[1,3],[2,3],[3,3]]) assert.doesNotMatch(exerciseHeading(d,t),/missed|behind|only/i);
});
test('week labels: streak pill and "You\'re on a roll", never shaming with no streak',()=>{
 assert.deepEqual(weekLabels(4),{pill:'4-day streak',cheer:"You're on a roll"});
 assert.equal(weekLabels(1).pill,'1-day streak');
 assert.equal(weekLabels(0).pill,'Start a streak today');
});
test('stepping stones: the design\'s three-stone curve, and any count fits the 320-wide path',()=>{
 const three=stoneLayout(3);
 assert.deepEqual(three.pts,[{x:44,y:52},{x:160,y:40},{x:276,y:34}]);
 assert.match(three.d,/^M44 52 C .* 160 40 C .* 276 34$/);
 for(const n of [1,2,4,5]){const {pts}=stoneLayout(n);assert.equal(pts.length,n);for(const p of pts)assert.ok(p.x>=22&&p.x<=298&&p.y>=22&&p.y<=62);}
});
test('sample care has the design\'s visit and medicine',()=>{
 assert.equal(SAMPLE_CARE.nextVisit.who,'Sam Rivera, PT');assert.equal(SAMPLE_CARE.medicine.name,'Meloxicam');
});
test('week uses local Monday through Sunday across year boundaries',()=>{
 const week=weekDates(new Date(2027,0,1));
 assert.equal(localDate(week[0]),'2026-12-28');assert.equal(localDate(week[6]),'2027-01-03');
});
test('partial sessions do not complete the plan; repeat sessions count once',()=>{
 let data={questions:[],completions:[]};
 const s={exercise_id:'mini-squat',recorded_at:new Date(2026,10,14,12).toISOString(),reps_target:5,summary:{totalReps:4,bestPeakAngle:112}};
 assert.equal(recordCompletion(data,s),data);
 s.summary.totalReps=5;data=recordCompletion(data,s);data=recordCompletion(data,s);
 assert.equal(completedIds(data,'2026-11-14').size,1);assert.equal(data.completions.length,1);
});
test('streak allows today to be pending and stops at a gap',()=>{
 const data={completions:[{date:'2026-11-13'},{date:'2026-11-12'},{date:'2026-11-10'}]};
 assert.equal(streak(data,new Date(2026,10,14)),2);
 assert.equal(streak(data,new Date(2026,10,15)),0);
});
test('corrupt and blocked storage recover to an empty state',()=>{
 assert.deepEqual(readData({getItem:()=>'{bad'}),{questions:[],completions:[]});
 assert.deepEqual(readData({getItem:()=>{throw Error('blocked');}}),{questions:[],completions:[]});
 assert.deepEqual(readData({getItem:()=>'{"questions":[null],"completions":[]}'}),{questions:[],completions:[]});
});
