import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from 'playwright';
import { forumLink, parseForumIndex, parseForumDiscussion, readAnnouncements } from '../src/forums.js';
import { Moodle } from '../src/moodle.js';
const base='https://courses.finki.ukim.mk';
const view=`${base}/mod/forum/view.php?id=12`;
const discuss=id=>`${base}/mod/forum/discuss.php?d=${id}`;
const page=(kind,content)=>`<body id="page-mod-forum-${kind}" class="course-42 cmid-12 forumtype-news"><header>PRIVATE_PROFILE</header><main id="region-main">${content}</main></body>`;
const index=(ids=[100],pagination='')=>page('view',`<table class="discussion-list"><tbody>${ids.map(id=>`<tr><th class="topic"><a href="${discuss(id)}">Topic</a></th><td class="author">PRIVATE_AUTHOR</td><td><a href="${discuss(999)}">last reply</a></td></tr>`).join('')}</tbody></table>${pagination}`);
const article=(id=5,text='Лабораториската е преместена. / Lab moved. / Laboratori është shtyrë.',date='2026-10-08T12:30:00+02:00',starter=true)=>`<article id="p${id}" data-region="post" data-post-id="${id}"><div class="forumpost ${starter?'firstpost starter':''}"><div class="d-flex"><header><h3>Announcement</h3><a>PRIVATE_AUTHOR</a><time datetime="${date}">Displayed date</time></header><div><div class="post-content-container">${text}</div><div class="attachments">PRIVATE_ATTACHMENT</div></div><div class="post-actions">PRIVATE_ACTION</div><div data-region="replies-container">PRIVATE_REPLY</div></div></div></article>`;
const discussion=(...args)=>page('discuss',article(...args)+article(6,'PRIVATE_REPLY','2026-10-09T10:00:00Z',false));
const course={id:42,coverage:{partial:false},sections:[{resources:[{name:'Announcements',url:view}]}]};
function mock(entries){let disposed=0;const calls=[];return {calls,disposed:()=>disposed,get:async(url,options)=>{
 calls.push({url,options}); const item=entries[calls.length-1];assert.ok(item,'Unexpected request');
 if(item instanceof Error)throw item;
 return {status:()=>item.status||200,headers:()=>({'content-type':'text/html',...item.headers}),body:async()=>Buffer.from(item.html),dispose:async()=>{disposed++;}};
}};}
const read=(request,extra={})=>readAnnouncements({request,course,forumId:12,now:()=> '2026-10-09T00:00:00Z',...extra});

test('forum links accept canonical discovered routes but reject foreign/actions/cross-forum pagination',()=>{
 assert.equal(forumLink(view+'&p=1',12,'index'),view+'&p=1');
 assert.equal(forumLink(discuss(100)+'#p5',12,'discussion'),discuss(100));
 for(const u of [view+'&p=-1',view+'&p=100',view+'&id=12',view+'&subscribe=1',view.replace('id=12','id=13'),'https://outside.example/mod/forum/view.php?id=12'])assert.equal(forumLink(u,12,'index'),null);
 for(const u of [discuss(100)+'&reply=1',discuss(100)+'&d=101',discuss(100)+'&parent=1','javascript:alert(1)',discuss(100).replace('https://','https://user:password@')])assert.equal(forumLink(u,12,'discussion'),null);
});

test('index reads only topic links, deduplicates and reports unsafe pagination',()=>{
 const parsed=parseForumIndex(index([100,100],`<ul class="pagination"><li><a href="${view}&p=1">next</a><a href="${view}&mark=read">bad</a></li></ul>`),42,12);
 assert.deepEqual(parsed.discussions,[discuss(100)]);
 assert.deepEqual(parsed.pages,[view+'&p=1']);
 assert.ok(parsed.warnings.includes('UNSUPPORTED_FORUM_PAGINATION'));
 assert.doesNotMatch(JSON.stringify(parsed),/PRIVATE_|999/);
});

test('only supported news forum and exact course/module ownership are accepted',()=>{
 for(const [html,code] of [[index().replace('course-42','course-43'),'OWNERSHIP'],[index().replace('cmid-12','cmid-13'),'OWNERSHIP'],[index().replace('forumtype-news','forumtype-general'),'NOT_AN_ANNOUNCEMENT'],[index().replace('page-mod-forum-view','page-login'),'LAYOUT'],[page('view','unknown'),'INDEX_LAYOUT']])assert.throws(()=>parseForumIndex(html,42,12),new RegExp(code));
 assert.deepEqual(parseForumIndex(page('view','<div class="notification">There are no discussion topics yet in this forum.</div>'),42,12).discussions,[]);
});

test('root post text/date/citation exclude author, replies, hidden/forms, actions and attachments',()=>{
 const p=parseForumDiscussion(discussion(5,'<p>Опис / Description / Përshkrim</p><form>PRIVATE_FORM</form><div hidden>PRIVATE_HIDDEN</div><script>PRIVATE_SCRIPT</script><a href="https://outside.example/?secret=PRIVATE_TOKEN">reference</a>'),42,12,discuss(100));
 assert.match(p.text,/Опис/);
 assert.doesNotMatch(JSON.stringify(p),/PRIVATE_/);
 assert.equal(p.publishedAt,'2026-10-08T10:30:00.000Z');
 assert.equal(p.updatedAt,null);
 assert.equal(p.sourceUrl,discuss(100)+'#p5');
 assert.equal(p.discussionId,100);
  const withoutType=parseForumDiscussion(discussion().replace(' forumtype-news',''),42,12,discuss(100));
  assert.equal(withoutType.postId,5);
  assert.throws(()=>parseForumDiscussion(discussion().replace('cmid-12','cmid-13'),42,12,discuss(100)),/OWNERSHIP/);
});

test('publication/update dates are strict offset timestamps; missing dates stay unknown',()=>{
 const edited=parseForumDiscussion(discussion(5,'Body<div class="modified"><time datetime="2026-10-09T10:00:00Z">Edited date</time> PRIVATE_EDITOR</div>'),42,12,discuss(100));
 assert.equal(edited.updatedAt,'2026-10-09T10:00:00.000Z');
 assert.doesNotMatch(edited.text,/PRIVATE_EDITOR|Edited date/);
 for(const value of ['2026-10-08T12:30:00','2026-02-30T12:30:00Z','2026-10-08T24:30:00Z','2026-10-08T12:30:00-00:00','unknown']){
  const p=parseForumDiscussion(discussion(5,'Body',value),42,12,discuss(100));
  assert.equal(p.publishedAt,null);assert.ok(p.warnings.includes('FORUM_PUBLICATION_DATE_UNRESOLVED'));
 }
 assert.throws(()=>parseForumDiscussion(page('discuss',article(6,'reply','2026-10-01T00:00:00Z',false)),42,12,discuss(100)),/ROOT_POST/);
 assert.throws(()=>parseForumDiscussion(discussion().replace('data-post-id="5"','data-post-id="7"'),42,12,discuss(100)),/ROOT_POST/);
});

test('traversal reads only canonical GETs, deduplicates pages/discussions and disposes responses',async()=>{
 const request=mock([{html:index([100],`<ul class="pagination"><a href="${view}&p=1">next</a></ul>`)},{html:index([100,101],`<ul class="pagination"><a href="${view}">previous</a></ul>`)},{html:discussion()},{html:discussion(7)}]);
 const result=await read(request);
 assert.deepEqual(request.calls.map(x=>x.url),[view,view+'&p=1',discuss(100),discuss(101)]);
 assert.ok(request.calls.every(x=>x.options.maxRedirects===0 && x.options.timeout<=10000));
 assert.equal(request.disposed(),4);assert.equal(result.posts.length,2);assert.equal(result.status,'read');
 assert.equal(result.coverage.indexPagesVisited,2);assert.equal(result.checkedAt,'2026-10-09T00:00:00Z');
});

test('child failures preserve readable posts with safe provenance and partial coverage',async()=>{
 const request=mock([{html:index([100,101])},{html:discussion()},new Error('PRIVATE_SECRET')]);
 const result=await read(request);
 assert.equal(result.status,'partial');assert.equal(result.posts.length,1);
 assert.equal(result.unavailableDiscussions[0].sourceUrl,discuss(101));
 assert.ok(result.coverage.warnings.includes('FORUM_NETWORK_FAILURE'));
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);
});

test('root redirect/type/size/access/network/timeout errors fail safely without following or leaking',async()=>{
 for(const [entry,code] of [[{status:302,headers:{location:'https://outside.example/PRIVATE'},html:''},'REDIRECT'],[{status:403,html:''},'ACCESS'],[{headers:{'content-type':'application/json'},html:'{}'},'CONTENT_TYPE'],[{headers:{'content-length':String(3*1024*1024)},html:''},'SIZE'],[{html:'x'.repeat(2*1024*1024+1)},'SIZE'],[new errors.TimeoutError('PRIVATE'),'TIMEOUT'],[new Error('PRIVATE'),'NETWORK']]){
  const request=mock([entry]);await assert.rejects(read(request),e=>e.message.includes(code)&&!e.message.includes('PRIVATE'));
  assert.equal(request.calls.length,1);assert.equal(request.disposed(),entry instanceof Error?0:1);
 }
 const request=mock([]);await assert.rejects(readAnnouncements({request,course,forumId:13}),/not in this course/);assert.equal(request.calls.length,0);
});

test('page attempts, discussion reads, post and total output are bounded',async()=>{
 const pagination=`<ul class="pagination">${[1,2,3,4].map(p=>`<a href="${view}&p=${p}">next</a>`).join('')}</ul>`;
 const pages=mock([{html:index([],pagination)},{status:403,html:''},{status:403,html:''}]);
 const partial=await read(pages);assert.equal(pages.calls.length,3);assert.ok(partial.coverage.warnings.includes('FORUM_PAGE_LIMIT'));
 const ids=Array.from({length:12},(_,i)=>100+i);
 const many=mock([{html:index(ids)},...ids.slice(0,10).map((_,i)=>({html:discussion(5+i)}))]);
 const result=await read(many);assert.equal(result.posts.length,10);assert.equal(many.calls.length,11);assert.equal(result.status,'partial');
 const text=mock([{html:index([100,101,102,103,104])},...Array.from({length:4},(_,i)=>({html:discussion(5+i,'x'.repeat(11000))}))]);
 const limited=await read(text);assert.equal(limited.posts.reduce((n,p)=>n+p.text.length,0),40000);assert.equal(limited.status,'partial');
});

test('time and aggregate response budgets stop additional discussion requests',async()=>{
 let clock=0;const req=mock([{html:index([100,101])},{html:discussion()}]);
 const original=req.get;req.get=async(...args)=>{const r=await original(...args);if(req.calls.length===2)clock=30001;return r;};
 const result=await read(req,{clock:()=>clock});assert.equal(req.calls.length,2);assert.equal(result.status,'partial');
 const pad=' '.repeat(1900000);
 const large=mock([{html:index([100,101,102,103,104])+pad},...Array.from({length:4},()=>({html:discussion()+pad}))]);
 const bounded=await read(large);assert.equal(large.calls.length,5);assert.ok(bounded.coverage.warnings.includes('FORUM_SIZE_LIMIT'));
});

test('Moodle verifies current enrollment/discovery before reading forum content',async()=>{
 const m=new Moodle({});m.getCourse=async()=>{throw Error('not enrolled');};
 await assert.rejects(m.getAnnouncements(42,12),/not enrolled/);
 const request=mock([{html:index()},{html:discussion()}]);m.getCourse=async id=>{assert.equal(id,42);return course;};m.page={context:()=>({request})};
 assert.equal((await m.getAnnouncements(42,12)).posts.length,1);
});
