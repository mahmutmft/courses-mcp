import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from 'playwright';
import { folderFileUrl, parseFolderHtml, collectFolder, readFolderFile } from '../src/folders.js';
import { Moodle } from '../src/moodle.js';
const base='https://courses.finki.ukim.mk';
const folder=id=>`${base}/mod/folder/view.php?id=${id}`;
const file=(path='notes.pdf',context=123,revision=0)=>`${base}/pluginfile.php/${context}/mod_folder/content/${revision}/${path}`;
const link=url=>`<li><a href="${url}">PRIVATE_LINK_LABEL</a></li>`;
const html=(links=link(file()),id=12,context=123)=>`<body id="page-mod-folder-view" class="course-42 cmid-${id} context-${context}"><main id="region-main"><div class="foldertree"><ul>${links}</ul></div><form>PRIVATE_FORM</form><a href="download_folder.php?id=${id}">Download all</a></main></body>`;
const course={id:42,coverage:{partial:false},sections:[{resources:[{name:'Folder',url:folder(12)},{name:'Child',url:folder(13)}]}]};
function mock(entries){const calls=[];let disposed=0;return {calls,disposed:()=>disposed,get:async(url,options)=>{
 calls.push({url,options});const entry=entries[calls.length-1];assert.ok(entry,'Unexpected request');if(entry instanceof Error)throw entry;
 return {status:()=>entry.status||200,headers:()=>({'content-type':'text/html',...entry.headers}),body:async()=>Buffer.isBuffer(entry.body)?entry.body:Buffer.from(entry.body??html()),dispose:async()=>{disposed++;}};
}};}
const collect=(request,extra={})=>collectFolder({request,course,folderId:12,...extra});

test('folder file policy restricts context/component/query/encoding and preserves nested paths',()=>{
 assert.equal(folderFileUrl(file('sub/%D0%A2%D0%B5%D1%81%D1%82.pdf')+'?forcedownload=1',123).path,'sub/Тест.pdf');
 for(const url of [file('notes.pdf',124),file().replace('mod_folder','mod_resource'),file()+'?token=PRIVATE',file()+'?forcedownload=1&forcedownload=0',file()+'#x',file('sub%2Fname.pdf'),file('sub%5Cname.pdf'),file('bad%00.pdf'),file('%252e%252e.pdf'),file().replace(base,'https://outside.example'),file().replace('https://','https://user:password@')])assert.equal(folderFileUrl(url,123),null,url);
});

test('folder parser verifies module/course/context/layout and does not expose unsafe labels',()=>{
 const allowed=new Map([[folder(12),{}],[folder(13),{}]]);
 const parsed=parseFolderHtml(html(link(file('nested/notes.pdf'))+link('https://outside.example/PRIVATE')+link(folder(13))+link(folder(99))),42,12,allowed);
 assert.equal(parsed.files[0].path,'nested/notes.pdf');assert.equal(parsed.files[0].depth,1);assert.deepEqual(parsed.children,[folder(13)]);
 assert.doesNotMatch(JSON.stringify(parsed),/PRIVATE/);assert.ok(parsed.warnings.includes('UNDISCOVERED_CHILD_FOLDER'));
 for(const [body,code] of [[html().replace('course-42','course-43'),'OWNERSHIP'],[html().replace('cmid-12','cmid-13'),'OWNERSHIP'],[html().replace('context-123','context-unknown'),'CONTEXT'],[html().replace('page-mod-folder-view','page-login'),'LAYOUT'],[html().replace('foldertree','unsupported'),'LAYOUT']])assert.throws(()=>parseFolderHtml(body,42,12,allowed),new RegExp(code));
 assert.equal(parseFolderHtml(html(''),42,12,allowed).files.length,0);
});

test('nested directories, duplicate/cyclic child links are normalized once and non-PDF types remain explicit',async()=>{
 const request=mock([{body:html(link(file('unit/notes.pdf'))+link(file('unit/notes.pdf')+'?forcedownload=1')+link(file('unit/slides.pptx'))+link(folder(13))+link(folder(13)))},{body:html(link(file('child.pdf',124))+link(folder(12)),13,124)}]);
 const {result,files}=await collect(request);assert.equal(request.calls.length,2);assert.equal(request.disposed(),2);
 assert.deepEqual(request.calls.map(c=>c.url),[folder(12),folder(13)]);
 assert.ok(request.calls.every(c=>c.options.maxRedirects===0));assert.equal(files.size,3);
 assert.equal(result.items.filter(i=>i.kind==='directory').length,1);
 assert.equal(result.items.filter(i=>i.readable).length,2);
 assert.equal(result.items.find(i=>i.name==='slides.pptx').reason,'UNSUPPORTED_FILE_TYPE');
 assert.doesNotMatch(JSON.stringify(result),/pluginfile|PRIVATE/);assert.equal(result.status,'read');
});

test('stable IDs survive revision changes but conflicting revisions in one listing cannot be read',async()=>{
 const first=(await collect(mock([{body:html(link(file()))}]))).result.items[0].fileId;
 const next=(await collect(mock([{body:html(link(file('notes.pdf',123,1)))}]))).result.items[0].fileId;assert.equal(first,next);
 const request=mock([{body:html(link(file())+link(file('notes.pdf',123,1)))}]);
 const result=await readFolderFile({request,course,folderId:12,fileId:first,extract:()=>assert.fail('must not extract')});
 assert.equal(result.status,'unsupported');assert.ok(result.warnings.includes('CONFLICTING_FOLDER_FILE_VERSIONS'));assert.equal(request.calls.length,1);
});

test('child failures preserve root items, with explicit scope/coverage',async()=>{
 const request=mock([{body:html(link(file())+link(folder(13)))},new Error('PRIVATE_PASSWORD')]);
 const {result}=await collect(request);assert.equal(result.status,'partial');assert.equal(result.items.length,1);
 assert.ok(result.coverage.warnings.includes('FOLDER_NETWORK_FAILURE'));assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 assert.equal(result.unavailableFolders[0].sourceUrl,folder(13));
});

test('root ownership/redirect/size/type/timeout/access failures dispose without unsafe requests',async()=>{
 for(const [entry,code] of [[{status:302,headers:{location:'https://outside.example/PRIVATE'}},'REDIRECT'],[{status:403},'ACCESS'],[{headers:{'content-type':'application/json'}},'CONTENT_TYPE'],[{headers:{'content-length':String(3*1024*1024)}},'SIZE'],[{body:'x'.repeat(2*1024*1024+1)},'SIZE'],[new errors.TimeoutError('PRIVATE'),'TIMEOUT'],[new Error('PRIVATE'),'NETWORK']]){
  const req=mock([entry]);await assert.rejects(collect(req),e=>e.message.includes(code)&&!e.message.includes('PRIVATE'));assert.equal(req.calls.length,1);assert.equal(req.disposed(),entry instanceof Error?0:1);
 }
 const req=mock([]);await assert.rejects(collect(req,{folderId:99}),/not in this course/);assert.equal(req.calls.length,0);
});

test('depth, output, page attempts, time and aggregate bytes have explicit bounds',async()=>{
 const deep=await collect(mock([{body:html(link(file('a/'.repeat(9)+'n.pdf')))}]));assert.ok(deep.result.coverage.warnings.includes('FOLDER_DEPTH_LIMIT'));
 const many=await collect(mock([{body:html(Array.from({length:205},(_,i)=>link(file(`${i}.pdf`))).join(''))}]));assert.equal(many.result.items.length,200);assert.ok(many.result.coverage.warnings.includes('FOLDER_ITEM_LIMIT'));
 const folders=Array.from({length:7},(_,i)=>({name:'Folder',url:folder(12+i)}));const c={...course,sections:[{resources:folders}]};
 const links=folders.map(f=>link(f.url)).join('');const request=mock([{body:html(links)},...Array.from({length:4},()=>({status:403}))]);
 const pageLimited=await collect(request,{course:c});assert.equal(request.calls.length,5);assert.ok(pageLimited.result.coverage.warnings.includes('FOLDER_TRAVERSAL_LIMIT'));
 let clock=0;const req=mock([{body:html(link(file())+link(folder(13)))}]);const get=req.get;req.get=async(...args)=>{const r=await get(...args);clock=30001;return r;};
 assert.ok((await collect(req,{clock:()=>clock})).result.coverage.warnings.includes('FOLDER_TRAVERSAL_LIMIT'));
 const pad=' '.repeat(1700000);const large=mock([{body:html(links)+pad},...Array.from({length:3},(_,i)=>({body:html('',13+i,124+i)+pad}))]);
 assert.ok((await collect(large,{course:c})).result.coverage.warnings.includes('FOLDER_SIZE_LIMIT'));assert.equal(large.calls.length,4);
});

async function fileId(){return (await collect(mock([{}]))).result.items[0].fileId;}

test('PDF read re-discovers the file and returns page citations without exposing file URLs',async()=>{
 const id=await fileId();const request=mock([{}, {headers:{'content-type':'application/pdf'},body:Buffer.from('%PDF-fixture')}]);
 const result=await readFolderFile({request,course,folderId:12,fileId:id,extract:async body=>{assert.equal(body.toString(),'%PDF-fixture');return {pages:[{pageNumber:1,text:'Synthetic content'}],pageCount:1};}});
 assert.equal(result.status,'read');assert.equal(result.pages[0].sourceUrl,folder(12));assert.equal(result.pages[0].fileId,id);assert.equal(request.disposed(),2);
 assert.doesNotMatch(JSON.stringify(result),/pluginfile/);
 const forged=mock([{}]);await assert.rejects(readFolderFile({request:forged,course,folderId:12,fileId:'0'.repeat(24)}),/not in this folder/);assert.equal(forged.calls.length,1);
});

test('non-PDFs stay listed but are not downloaded',async()=>{
 const body=html(link(file('notes.docx')));const id=(await collect(mock([{body}]))).result.items[0].fileId;
 const request=mock([{body}]);const result=await readFolderFile({request,course,folderId:12,fileId:id});assert.equal(result.status,'unsupported');assert.equal(request.calls.length,1);
});

test('file redirects never leave the exact discovered context/path; MIME/errors remain safe',async()=>{
 const id=await fileId();
 for(const [entry,code] of [[{status:302,headers:{location:file('other.pdf')}},'UNSAFE'],[{status:302,headers:{location:'https://outside.example/PRIVATE'}},'UNSAFE'],[{headers:{'content-type':'text/html'},body:'login'},'CONTENT_TYPE'],[{status:403},'ACCESS'],[{headers:{'content-type':'application/pdf','content-length':String(11*1024*1024)}},'SIZE'],[new errors.TimeoutError('PRIVATE'),'TIMEOUT'],[new Error('PRIVATE'),'FAILED']]){
  const request=mock([{},entry]);const result=await readFolderFile({request,course,folderId:12,fileId:id});assert.equal(result.status,'unsupported');assert.ok(result.warnings.some(c=>c.includes(code)));assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);assert.equal(request.calls.length,2);
 }
 const request=mock([{}, {status:302,headers:{location:file()+'?forcedownload=1'}},{headers:{'content-type':'application/pdf'},body:Buffer.from('%PDF-fixture')}]);
 assert.equal((await readFolderFile({request,course,folderId:12,fileId:id,extract:async()=>({pages:[{pageNumber:1,text:'ok'}]})})).status,'read');
});

test('PDF parser rejects malformed folder PDFs instead of pretending no text',async()=>{
 const request=mock([{}, {headers:{'content-type':'application/pdf'},body:Buffer.from('not a PDF')}]);
 const result=await readFolderFile({request,course,folderId:12,fileId:await fileId()});assert.equal(result.status,'unsupported');assert.ok(result.warnings.length>0);
});

test('real PDF worker extracts synthetic folder-file text with page provenance',async()=>{
 const stream='BT /F1 12 Tf 50 700 Td (Synthetic folder notes) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 const request=mock([{}, {headers:{'content-type':'application/pdf'},body:Buffer.from(pdf)}]);
 const result=await readFolderFile({request,course,folderId:12,fileId:await fileId()});
 assert.equal(result.status,'read');assert.match(result.pages[0].text,/Synthetic folder notes/);assert.equal(result.pages[0].sourceUrl,folder(12));assert.equal(result.pageCount,1);
});

test('Moodle folder methods authorize discovery before list/read',async()=>{
 const m=new Moodle({});m.getCourse=async()=>{throw Error('not enrolled');};await assert.rejects(m.getFolder(42,12),/not enrolled/);await assert.rejects(m.readFolderFile(42,12,'0'.repeat(24)),/not enrolled/);
 m.getCourse=async()=>course;const request=mock([{}]);m.page={context:()=>({request})};const result=await m.getFolder(42,12);assert.equal(result.items.length,1);assert.equal(result.files,undefined);
});
