import test from 'node:test';
import assert from 'node:assert/strict';
import {localDate,weekDates,streak,readData,recordCompletion,completedIds} from '../js/dashboardData.js';
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
