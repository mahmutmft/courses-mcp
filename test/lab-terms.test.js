import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {LabTermPreferences,labTermSchema,resolveLabTerm} from '../src/lab-terms.js';
import {LabPreferences} from '../src/preferences.js';
import {buildLabSchedule} from '../src/labs.js';
import {Moodle} from '../src/moodle.js';
const config={baseUrl:'https://courses.finki.ukim.mk',username:'synthetic-user',password:'not-persisted'};
const time='2026-01-01T00:00:00.000Z';
async function setup(t){const root=await mkdtemp(join(tmpdir(),'finki-term-test-'));t.after(async()=>{
 const target=resolve(root);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('finki-term-test-'))throw Error('Invalid cleanup target');
 await rm(target,{recursive:true,force:true});
});return {root,store:new LabTermPreferences(config,{root,now:()=>time})};}
const url=id=>`https://courses.finki.ukim.mk/mod/choice/view.php?id=${id}`;
const choices=[{url:url(11)}];
const poll={status:'selected',sourceUrl:url(11),checkedAt:time,term:{weekday:'monday',startTime:'10:00',endTime:null,room:'123',group:'B'}};
const manual=term=>({source:'user_declared',updatedAt:time,term:labTermSchema.parse(term)});
const resolveTerm=(term,extra={})=>resolveLabTerm({manual:term,choices,readChoice:async()=>poll,...extra});

test('terms persist privately across restart, normalize labels and reset independently of attendance v1',async t=>{
 const {root,store}=await setup(t);const attendance=new LabPreferences(config,{root});
 await attendance.set(42,'exempt');const before=await readFile(attendance.location(42),'utf8');
 assert.equal((await store.getTerm(42)).source,'unset');
 const saved=await store.setTerm(42,{weekday:'monday',startTime:'10:00',room:'200аб',group:'Б'});
 assert.equal(saved.term.group,'B');assert.equal(saved.term.room,'200ab');
 assert.deepEqual(await new LabTermPreferences(config,{root}).getTerm(42),saved);
 assert.deepEqual(await store.setTerm(42,{weekday:'monday',startTime:'10:00',room:'200ab',group:'B'}),saved);
 const raw=await readFile(store.location(42),'utf8');assert.doesNotMatch(raw,/synthetic-user|not-persisted|https:/);
 assert.deepEqual(Object.keys(JSON.parse(raw)).sort(),['schemaVersion','term','updatedAt']);
 assert.equal(await readFile(attendance.location(42),'utf8'),before);
 assert.equal((await store.setTerm(42,null)).term,null);assert.equal((await attendance.get(42)).attendance,'exempt');
});

test('account/course isolation and full replacement preserve no omitted old fields',async t=>{
 const {root,store}=await setup(t);await store.setTerm(42,{weekday:'monday',startTime:'10:00',group:'B'});
 assert.equal((await store.getTerm(43)).term,null);
 assert.equal((await new LabTermPreferences({...config,username:'other'},{root}).getTerm(42)).term,null);
 assert.equal((await new LabTermPreferences({...config,password:'changed'},{root}).getTerm(42)).term.group,'B');
 const replaced=await store.setTerm(42,{group:'A'});assert.equal(replaced.term.weekday,null);assert.equal(replaced.term.startTime,null);
});

test('schema rejects freeform/unknown fields, invalid times, empty records and unsafe ids',()=>{
 for(const term of [{},{group:'Group B'},{weekday:'понеделник'},{startTime:'25:00'},{startTime:'10:00',endTime:'09:00'},{endTime:'11:00'},{choiceId:-1},{group:'B',password:'secret'}])assert.equal(labTermSchema.safeParse(term).success,false);
 assert.equal(labTermSchema.safeParse({group:'Б'}).data.group,'B');
});

test('corrupt records, stale locks and failed timestamps cannot overwrite a valid term',async t=>{
 const {root,store}=await setup(t);await store.setTerm(42,{group:'B'});const file=store.location(42);const original=await readFile(file,'utf8');
 await writeFile(file+'.lock','owned by another process');
 await assert.rejects(store.setTerm(42,null),/PREFERENCE_BUSY/);assert.equal(await readFile(file,'utf8'),original);await unlink(file+'.lock');
 await assert.rejects(new LabTermPreferences(config,{root,now:()=> 'invalid'}).setTerm(42,{group:'A'}),/INVALID_TIMESTAMP/);
 assert.equal(await readFile(file,'utf8'),original);
 await writeFile(file,'{"schemaVersion":99}');
 await assert.rejects(store.getTerm(42),/INVALID_PREFERENCE_FILE/);await assert.rejects(store.setTerm(42,null),/INVALID_PREFERENCE_FILE/);
 assert.equal(await readFile(file,'utf8'),'{"schemaVersion":99}');
});

test('fresh poll fills missing manual fields and matching declarations retain field provenance',async()=>{
 const result=await resolveTerm(manual({group:'Б',endTime:null}));
 assert.equal(result.status,'resolved');assert.equal(result.term.startTime,'10:00');assert.equal(result.term.endTime,null);
 assert.equal(result.fieldSources.group,'poll_and_user');assert.equal(result.fieldSources.startTime,'poll');
 const noGroup=await resolveTerm(manual({group:'B'}),{readChoice:async()=>({...poll,term:{...poll.term,group:null}})});
 assert.equal(noGroup.term.group,'B');assert.equal(noGroup.fieldSources.group,'user_declared');
});

test('manual/poll disagreement is a conflict, never a silent override',async()=>{
 for(const value of [{group:'A'},{weekday:'tuesday'},{startTime:'11:00'},{room:'124'}]){
  const result=await resolveTerm(manual(value));assert.equal(result.status,'conflict');assert.ok(result.conflicts.length);
  assert.ok(result.warnings.includes('MANUAL_POLL_TERM_CONFLICT'));
 }
});

test('absent and ambiguous polls can use explicit manual terms; pin selects only a discovered choice',async()=>{
 const declared=manual({weekday:'monday',startTime:'10:00',group:'B'});
 const absent=await resolveTerm(declared,{choices:[],readChoice:()=>assert.fail('no poll request')});
 assert.equal(absent.status,'resolved');assert.equal(absent.fieldSources.weekday,'user_declared');
 const ambiguous=await resolveTerm(declared,{choices:[...choices,{url:url(12)}],readChoice:()=>assert.fail('no guessing')});assert.equal(ambiguous.status,'resolved');assert.ok(ambiguous.warnings.includes('MULTIPLE_LAB_CHOICES'));
 const pinned=await resolveTerm(manual({choiceId:12}),{choices:[...choices,{url:url(12)}],readChoice:async id=>{assert.equal(id,12);return {...poll,sourceUrl:url(12)};}});assert.equal(pinned.status,'resolved');
 const stale=await resolveTerm(manual({choiceId:12,weekday:'monday',startTime:'10:00'}));assert.equal(stale.status,'unavailable');assert.ok(stale.warnings.includes('PINNED_CHOICE_NOT_DISCOVERED'));
});

test('failed/unknown poll cannot silently reuse manual data; explicit no selection can',async()=>{
 const local=manual({weekday:'monday',startTime:'10:00'});
 assert.equal((await resolveTerm(local,{readChoice:async()=>{throw Error('PRIVATE');}})).status,'unavailable');
 assert.equal((await resolveTerm(local,{readChoice:async()=>({status:'unknown'})})).status,'unavailable');
 assert.equal((await resolveTerm(local,{readChoice:async()=>({status:'not_selected',sourceUrl:url(11),checkedAt:time})})).status,'resolved');
});

test('schedule refuses conflict, uses declared group fallback and leaves dated obligations unproven',async()=>{
 const course={id:42,sections:[{name:'Labs',resources:[{name:'Laboratory term',url:url(11)},{name:'Lab homework Group B',url:'https://courses.finki.ukim.mk/mod/assign/view.php?id=13'}]}]};
 const run=manualTerm=>buildLabSchedule({course,preference:{attendance:'unknown'},manualTerm,weekStart:'2026-10-05',readChoice:async()=>poll});
 const conflict=await run(manual({group:'A'}));assert.equal(conflict.status,'unknown');assert.equal(conflict.termLinkedHomework.length,0);assert.equal(conflict.termResolution.status,'conflict');
 const good=await run(manual({group:'B'}));assert.equal(good.termLinkedHomework.length,1);assert.equal(good.termLinkedHomework[0].date,null);
});

test('term tools require enrollment and pinned choice discovery before any local write',async()=>{
 let writes=0;const m=new Moodle({}, {termPreferences:{getTerm:async()=>({term:null}),setTerm:async()=>{writes++;return {};}}});
 m.listCourses=async()=>({courses:[{id:42}]});
 await assert.rejects(m.labTermPreference(43,{group:'B'}),/not in your enrolled/);
 m.getCourse=async()=>({sections:[{resources:[]}]});await assert.rejects(m.labTermPreference(42,{choiceId:11}),/not in this course/);assert.equal(writes,0);
 await m.labTermPreference(42,null);assert.equal(writes,1);
 m.getCourse=async()=>({sections:[{resources:[{url:url(11)}]}]});await m.labTermPreference(42,{choiceId:11});assert.equal(writes,2);
});

