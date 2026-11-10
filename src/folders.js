import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { errors } from 'playwright';
import { UserError } from './config.js';
import { moduleUrl } from './resources.js';
import { extractPdfText, pdfLimits } from './pdf.js';

const base = 'https://courses.finki.ukim.mk';
const fingerprint = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
export class FolderError extends UserError {
  constructor(code) { super(`Folder content could not be read (${code}).`); this.code = code; }
}

export function folderFileUrl(value, contextId) {
  try {
    const url = new URL(value, base);
    if (url.origin !== base || url.username || url.password || url.hash) return null;
    const match = url.pathname.match(/^\/pluginfile\.php\/([1-9]\d*)\/mod_folder\/content\/(\d+)\/(.+)$/);
    if (!match || match[1] !== String(contextId)) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.length && (keys.length !== 1 || keys[0] !== 'forcedownload' || !/^[01]$/.test(url.searchParams.get('forcedownload')))) return null;
    const parts = match[3].split('/').map(part => decodeURIComponent(part));
    if (parts.some(part => !part || part === '.' || part === '..' || /[%/\\\u0000-\u001f\u007f]/.test(part) || part.length > 255)) return null;
    const path = parts.join('/');
    if (path.length > 1024) return null;
    // Canonicalize encoding/query for safe deduplication; revisions remain in the fetch URL.
    url.pathname = `/pluginfile.php/${match[1]}/mod_folder/content/${match[2]}/${parts.map(encodeURIComponent).join('/')}`;
    url.search = keys.length ? `?forcedownload=${url.searchParams.get('forcedownload')}` : '';
    return { url: url.href, path, depth: parts.length - 1 };
  } catch { return null; }
}

export function parseFolderHtml(html, courseId, folderId, allowedFolders) {
  const $ = load(html);
  const classes = ($('body').attr('class') || '').split(/\s+/);
  if (classes.filter(c=>/^course-\d+$/.test(c)).join() !== `course-${courseId}` ||
    classes.filter(c=>/^cmid-\d+$/.test(c)).join() !== `cmid-${folderId}`) throw new FolderError('FOLDER_OWNERSHIP_UNVERIFIED');
  if ($('body').attr('id') !== 'page-mod-folder-view') throw new FolderError('UNSUPPORTED_FOLDER_LAYOUT');
  const contexts = classes.filter(c=>/^context-\d+$/.test(c));
  if (contexts.length !== 1) throw new FolderError('FOLDER_CONTEXT_UNVERIFIED');
  const contextId = contexts[0].slice('context-'.length);
  if ($('#notice,.errorcode,.alert-danger').length) throw new FolderError('FOLDER_ACCESS_UNAVAILABLE');
  $('script,style,noscript,form,input,button,select,textarea,iframe,nav,[hidden],[aria-hidden="true"],.accesshide,.sr-only').remove();
  const trees = $('#region-main .foldertree');
  if (trees.length !== 1 || !trees.find('ul,a[href]').length) throw new FolderError('UNSUPPORTED_FOLDER_LAYOUT');
  const files = [], children = new Set(), warnings = [];
  const links = trees.find('a[href]');
  if (links.length > 500) warnings.push('FOLDER_LINK_LIMIT');
  links.slice(0,500).each((_, anchor) => {
    const href = $(anchor).attr('href');
    const child = moduleUrl(href);
    if (child && child.includes('/mod/folder/')) {
      if (allowedFolders.has(child)) children.add(child);
      else warnings.push('UNDISCOVERED_CHILD_FOLDER');
      return;
    }
    const file = folderFileUrl(href, contextId);
    if (!file) { warnings.push('UNSAFE_OR_UNSUPPORTED_FOLDER_LINK'); return; }
    if (file.depth > 8) { warnings.push('FOLDER_DEPTH_LIMIT'); return; }
    files.push({ ...file, folderId, contextId, fileId: fingerprint(`${folderId}\0${file.path}`) });
  });
  return { files, children: [...children], warnings: [...new Set(warnings)] };
}

export async function collectFolder({ request, course, folderId, clock = Date.now, now = () => new Date().toISOString() }) {
  if (!Number.isSafeInteger(folderId) || folderId < 1) throw new UserError('folderId must be a positive safe integer.');
  const allowed = new Map(course.sections.flatMap(s=>s.resources).map(r=>[moduleUrl(r.url),r])
    .filter(([url])=>url?.includes('/mod/folder/')));
  const sourceUrl = `${base}/mod/folder/view.php?id=${folderId}`;
  if (!allowed.has(sourceUrl)) throw new UserError('Folder is not in this course discovery result. Check get_course and its coverage warnings.');
  const result = { courseId: course.id, folderId, name: allowed.get(sourceUrl).name, sourceUrl, checkedAt: now(), status:'read', items:[], unavailableFolders:[],
    coverage:{partial:false,pagesVisited:0,course:course.coverage,warnings:[]},
    scope:'Discovered same-course folder trees and allowed child folder modules only. Directories are inferred from file paths; empty directories are not enumerated. Files are listed, not downloaded. PDF files may be read separately by current fileId; other types, unsafe links and unsupported layouts stay explicit. Empty/partial listings never prove complete course coverage.' };
  const warnings = result.coverage.warnings;
  if (course.coverage?.partial) warnings.push('PARTIAL_COURSE_COVERAGE');
  const queue = [{url:sourceUrl,depth:0}], visited = new Set(), files = new Map(), directories = new Set();
  const deadline = clock()+30000;
  let bytes = 0;
  while(queue.length) {
    if (result.coverage.pagesVisited>=5 || clock()>=deadline || bytes>=6*1024*1024) { warnings.push('FOLDER_TRAVERSAL_LIMIT'); break; }
    const {url,depth} = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);result.coverage.pagesVisited++;
    let response;
    try {
      response = await request.get(url,{maxRedirects:0,timeout:Math.max(1,Math.min(10000,deadline-clock()))});
      if (response.status()>=300 && response.status()<400) throw new FolderError('FOLDER_REDIRECT_NOT_FOLLOWED');
      if (response.status()!==200) throw new FolderError('FOLDER_ACCESS_UNAVAILABLE');
      if (!/^text\/html(?:;|$)/i.test(response.headers()['content-type']||'')) throw new FolderError('UNSUPPORTED_FOLDER_CONTENT_TYPE');
      if (Number(response.headers()['content-length'])>2*1024*1024) throw new FolderError('FOLDER_SIZE_LIMIT');
      const body = await response.body();bytes+=body.byteLength;
      if (body.byteLength>2*1024*1024 || bytes>6*1024*1024) throw new FolderError('FOLDER_SIZE_LIMIT');
      const currentId = Number(new URL(url).searchParams.get('id'));
      const parsed = parseFolderHtml(body.toString('utf8'),course.id,currentId,allowed);
      warnings.push(...parsed.warnings);
      for (const file of parsed.files) {
        if (files.has(file.fileId)) {
          if (new URL(files.get(file.fileId).url).pathname!==new URL(file.url).pathname) { files.get(file.fileId).conflict=true;warnings.push('CONFLICTING_FOLDER_FILE_VERSIONS'); }
          continue;
        }
        if (result.items.length>=200) {warnings.push('FOLDER_ITEM_LIMIT');break;}
        const parts = file.path.split('/');
        for (let i=1;i<parts.length;i++) {
          const path=parts.slice(0,i).join('/'), id=`${currentId}:${path}`;
          if (!directories.has(id) && result.items.length<199) { directories.add(id);result.items.push({kind:'directory',id:fingerprint(id),folderId:currentId,path,sourceUrl:url}); }
        }
        const supported=/\.pdf$/i.test(file.path);
        files.set(file.fileId,file);
        result.items.push({kind:'file',fileId:file.fileId,folderId:currentId,path:file.path,name:parts.at(-1),sourceUrl:url,
          readable:supported,format:supported?'pdf':null,reason:supported?null:'UNSUPPORTED_FILE_TYPE'});
      }
      for(const child of parsed.children) {
        if(visited.has(child) || queue.some(item=>item.url===child))continue;
        if(depth>=4){warnings.push('FOLDER_DEPTH_LIMIT');continue;}
        if(queue.length>=50){warnings.push('FOLDER_QUEUE_LIMIT');continue;}
        queue.push({url:child,depth:depth+1});
      }
    } catch(error) {
      const failure = error instanceof FolderError ? error : new FolderError(error instanceof errors.TimeoutError?'FOLDER_TIMEOUT':'FOLDER_NETWORK_FAILURE');
      if(url===sourceUrl)throw failure;
      warnings.push(failure.code);
      result.unavailableFolders.push({folderId:Number(new URL(url).searchParams.get('id')),sourceUrl:url,code:failure.code});
    } finally {await response?.dispose().catch(()=>{});}
  }
  for(const item of result.items) if(item.kind==='file' && files.get(item.fileId)?.conflict) {item.readable=false;item.reason='CONFLICTING_FOLDER_FILE_VERSIONS';}
  result.coverage.warnings=[...new Set(warnings)];result.coverage.partial=result.coverage.warnings.length>0;
  result.status=result.coverage.partial?'partial':'read';
  return {result,files};
}

export async function readFolderFile({ request, course, folderId, fileId, extract = extractPdfText }) {
  if(typeof fileId!=='string'||! /^[a-f0-9]{24}$/.test(fileId)) throw new UserError('fileId must be an ID returned by get_folder.');
  const {result:listing,files} = await collectFolder({request,course,folderId});
  const file=files.get(fileId), item=listing.items.find(item=>item.fileId===fileId);
  if(!file || !item) throw new UserError('File is not in this folder discovery result. Refresh get_folder and check coverage.');
  const result={courseId:course.id,folderId,fileId,sourceUrl:item.sourceUrl,path:item.path,checkedAt:new Date().toISOString(),status:'unsupported',pages:[],warnings:[],coverage:listing.coverage,
    scope:'Text from one currently discovered folder PDF only. No OCR, attachments of other types, bulk download, content persistence or schedule inference.'};
  if(!item.readable){result.warnings.push(item.reason);return result;}
  const seen=new Set(),deadline=Date.now()+15000;
  let url=file.url;
  for(let hop=0;hop<5;hop++) {
    if(seen.has(url)){result.warnings.push('FOLDER_FILE_REDIRECT_CYCLE');break;}seen.add(url);
    let response;
    try {
      if(Date.now()>=deadline)throw new FolderError('FOLDER_FILE_TIMEOUT');
      response=await request.get(url,{maxRedirects:0,timeout:Math.max(1,deadline-Date.now())});
      if(response.status()>=300&&response.status()<400){
        const next=folderFileUrl(new URL(response.headers().location,url).href,file.contextId);
        if(!next||new URL(next.url).pathname!==new URL(file.url).pathname)throw new FolderError('UNSAFE_FOLDER_FILE_REDIRECT');
        url=next.url;continue;
      }
      if(response.status()!==200)throw new FolderError('FOLDER_FILE_ACCESS_UNAVAILABLE');
      if(!/^application\/pdf(?:;|$)/i.test(response.headers()['content-type']||''))throw new FolderError('UNSUPPORTED_FOLDER_FILE_CONTENT_TYPE');
      if(Number(response.headers()['content-length'])>pdfLimits.bytes)throw new FolderError('FOLDER_FILE_SIZE_LIMIT');
      const body=await response.body();if(body.byteLength>pdfLimits.bytes)throw new FolderError('FOLDER_FILE_SIZE_LIMIT');
      const pdf=await extract(body);
      result.pages=(pdf.pages||[]).map(page=>({...page,sourceUrl:item.sourceUrl,fileId}));
      result.pageCount=pdf.pageCount??null;result.emptyPages=pdf.emptyPages||[];result.failedPages=pdf.failedPages||[];result.truncated=pdf.truncated||false;
      if(pdf.errorCode)result.warnings.push(pdf.errorCode);
      if(result.truncated)result.warnings.push('PDF_OUTPUT_LIMIT');
      if(result.emptyPages.length)result.warnings.push('PDF_PAGES_WITHOUT_TEXT');
      if(result.failedPages.length)result.warnings.push('PDF_UNREADABLE_PAGES');
      result.status=!result.pages.some(page=>page.text.trim())?'unsupported':result.warnings.length||listing.coverage.partial?'partial':'read';
      return result;
    } catch(error){result.warnings.push(error instanceof FolderError?error.code:error instanceof errors.TimeoutError?'FOLDER_FILE_TIMEOUT':'FOLDER_FILE_READ_FAILED');return result;}
    finally{await response?.dispose().catch(()=>{});}
  }
  if(!result.warnings.length)result.warnings.push('FOLDER_FILE_REDIRECT_LIMIT');
  return result;
}
