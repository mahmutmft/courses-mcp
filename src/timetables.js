import { createHash } from 'node:crypto';

const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/:$/, '').trim();
const aliases = {
  group: ['group','група','grupi'], weekday:['day','weekday','ден','dita'],
  startTime:['start','start time','почеток','fillimi'], endTime:['end','end time','крај','mbarimi'],
  time:['time','час','време','ora'], room:['room','lab','просторија','лабораторија','salla'],
  dates:['date','dates','датум','датуми','data','datat'],
  effectiveFrom:['from','valid from','од','важи од','nga'], effectiveUntil:['until','valid until','до','важи до','deri'],
  timeZone:['timezone','time zone','временска зона','zona kohore'],
  recurrence:['recurrence','повторување','përsëritja'], anchorDate:['anchor','anchor date','почетна недела','data bazë'],
};
const fieldFor = value => Object.keys(aliases).find(key => aliases[key].includes(normalize(value)));
const days = [
 ['monday','понеделник','e hënë'],['tuesday','вторник','e martë'],['wednesday','среда','e mërkurë'],
 ['thursday','четврток','e enjte'],['friday','петок','e premte'],['saturday','сабота','e shtunë'],['sunday','недела','e diel'],
];
function date(value) {
  let candidate = value.trim();
  const local = candidate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (local) candidate = `${local[3]}-${local[2].padStart(2,'0')}-${local[1].padStart(2,'0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === candidate ? candidate : null;
}
const time = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
const token = value => /^[\p{L}\p{N}-]{1,16}$/u.test(value) ? value : null;
const canonical = value => value.toUpperCase().replace(/А/g,'A').replace(/Б/g,'B').replace(/Ц/g,'C');

function entryFromFields(fields, source, courseId) {
  const warnings = [];
  const has = key => typeof fields[key] === 'string' && fields[key].trim() !== '';
  if (!['weekday','time','startTime'].some(has) || !['dates','effectiveFrom','effectiveUntil','group'].some(has)) return null;
  const entry = { courseId, group:null,weekday:null,startTime:null,endTime:null,room:null,timeZone:null,
    dates:[],effectiveFrom:null,effectiveUntil:null,recurrence:null,anchorDate:null, sources:[source],warnings };
  for (const key of ['group','room']) if (has(key)) {
    const parsed = token(fields[key].trim());
    entry[key] = parsed ? key === 'group' ? canonical(parsed) : canonical(parsed).toLowerCase() : null;
    if (!parsed) warnings.push('UNRESOLVED_'+key.toUpperCase());
  }
  if (has('weekday')) {
    const found = days.find(names=>names.includes(normalize(fields.weekday)));
    entry.weekday = found?.[0] ?? null;
    if (!found) warnings.push('UNRESOLVED_WEEKDAY');
  }
  if (has('time')) {
    const parts=fields.time.trim().split(/\s*[–—-]\s*/);
    if (parts.length > 2 || parts.some(part=>!time(part))) warnings.push('UNRESOLVED_TIME');
    else { entry.startTime=parts[0];entry.endTime=parts[1]??null; }
  }
  for (const key of ['startTime','endTime']) if (has(key)) {
    const parsed=time(fields[key].trim());
    if (!parsed || (entry[key] && entry[key]!==parsed)) {entry[key]=null;warnings.push('CONFLICTING_OR_INVALID_TIME');}
    else entry[key]=parsed;
  }
  if (entry.endTime && (!entry.startTime || entry.endTime<=entry.startTime)) {entry.startTime=entry.endTime=null;warnings.push('INVALID_TIME_RANGE');}
  if (has('dates')) {
    const parts=fields.dates.split(/\s*[,;]\s*/);
    const parsed=parts.map(date);
    if (parts.length>32 || parsed.some(value=>!value)) warnings.push('UNRESOLVED_DATES');
    else entry.dates=[...new Set(parsed)].sort();
  }
  for (const key of ['effectiveFrom','effectiveUntil','anchorDate']) if (has(key)) {
    entry[key]=date(fields[key]);if (!entry[key]) warnings.push('UNRESOLVED_'+key.toUpperCase());
  }
  if (entry.effectiveFrom && entry.effectiveUntil && entry.effectiveUntil<entry.effectiveFrom) {
    entry.effectiveFrom=entry.effectiveUntil=null;warnings.push('INVALID_EFFECTIVE_PERIOD');
  }
  if (entry.dates.length && (entry.effectiveFrom || entry.effectiveUntil)) warnings.push('MIXED_DATE_AND_PERIOD_RULES');
  if (has('timeZone')) {
    const candidate=fields.timeZone.trim();
    // Do not interpret abbreviations or a runtime default as a faculty timezone.
    if (candidate === 'UTC' || /^[A-Za-z_-]+\/[A-Za-z_-]+(?:\/[A-Za-z_-]+)?$/.test(candidate)) {
      try {new Intl.DateTimeFormat('en',{timeZone:candidate});entry.timeZone=candidate;} catch { /* unresolved */ }
    }
    if (!entry.timeZone) warnings.push('UNRESOLVED_TIMEZONE');
  }
  if (has('recurrence')) {
    const rules={weekly:'weekly','неделно':'weekly','çdo javë':'weekly',alternating:'alternating','секоја втора недела':'alternating','çdo dy javë':'alternating'};
    entry.recurrence=rules[normalize(fields.recurrence)]??null;
    if (!entry.recurrence) warnings.push('UNRESOLVED_RECURRENCE');
  }
  if (entry.dates.length && entry.recurrence) warnings.push('MIXED_DATE_AND_RECURRENCE_RULES');
  if (entry.dates.length && entry.weekday) {
    const dayNames=['sunday',...days.slice(0,6).map(names=>names[0])];
    if (entry.dates.some(value=>dayNames[new Date(`${value}T00:00:00Z`).getUTCDay()]!==entry.weekday)) warnings.push('DATE_WEEKDAY_CONFLICT');
  }
  for (const key of ['group','startTime','endTime','room','timeZone']) if (!entry[key]) warnings.push('MISSING_'+key.toUpperCase());
  if (!entry.dates.length) {
    if (!entry.weekday) warnings.push('MISSING_WEEKDAY');
    if (!entry.effectiveFrom || !entry.effectiveUntil) warnings.push('UNBOUNDED_EFFECTIVE_PERIOD');
    if (!entry.recurrence) warnings.push('RECURRENCE_UNSPECIFIED');
    if (entry.recurrence==='alternating' && !entry.anchorDate) warnings.push('MISSING_ALTERNATING_ANCHOR');
  }
  entry.warnings=[...new Set(warnings)];
  entry.status=entry.warnings.length?'incomplete':'candidate';
  // Includes source identity so different documents never silently replace each other.
  entry.id=createHash('sha256').update(JSON.stringify({sourceUrl:source.url,...entry,sources:undefined,warnings:undefined,status:undefined})).digest('hex').slice(0,24);
  return entry;
}

export function extractTimetable(resource) {
  const result={courseId:resource.courseId,resourceId:resource.resourceId,sourceUrl:resource.sourceUrl,checkedAt:resource.checkedAt,
    status:'unsupported',entries:[],coverage:{partial:false,readerStatus:resource.status,course:resource.coverage,warnings:[]},
    scope:'Conservative candidate extraction from explicit table columns or pipe-separated labelled text lines. No roster/group inference, OCR, recurrence expansion, exception resolution, persistence or confirmed attendance. Missing dates/timezones remain unknown; versions are retained rather than superseded.'};
  const warnings=result.coverage.warnings;
  if (resource.status==='unsupported') {warnings.push('TIMETABLE_SOURCE_UNSUPPORTED',...(resource.warnings||[]));result.coverage.partial=true;return result;}
  if (resource.status==='partial'||resource.coverage?.partial||resource.truncated) warnings.push('PARTIAL_TIMETABLE_SOURCE');
  const entries=new Map();let inspected=0;
  const add=(fields,location)=>{
    if (++inspected>1000 || entries.size>=200) {warnings.push('TIMETABLE_OUTPUT_LIMIT');return;}
    const source={url:resource.sourceUrl,...(resource.resolvedUrl?{resolvedUrl:resource.resolvedUrl}:{}),checkedAt:resource.checkedAt,...location};
    const entry=entryFromFields(fields,source,resource.courseId);if (!entry) return;
    if (entries.has(entry.id)) entries.get(entry.id).sources.push(source);else entries.set(entry.id,entry);
  };
  if ((resource.tables||[]).length>10) warnings.push('TIMETABLE_TABLE_LIMIT');
  for (const [tableIndex,table] of (resource.tables||[]).slice(0,10).entries()) {
    if (table.unsupportedLayout) {warnings.push('UNSUPPORTED_TIMETABLE_TABLE_LAYOUT');continue;}
    const rows=table.rows||[],headers=(rows[0]||[]).map(fieldFor);
    if (rows.length>101) warnings.push('TIMETABLE_ROW_LIMIT');
    if (!headers.length || headers.some(field=>!field) || new Set(headers).size!==headers.length) {warnings.push('UNSUPPORTED_TIMETABLE_TABLE_HEADERS');continue;}
    for (const [index,row] of rows.slice(1,101).entries()) {
      if (row.length!==headers.length || row.some(value=>typeof value!=='string'||value.length>500)) {warnings.push('UNSUPPORTED_TIMETABLE_ROW');continue;}
      add(Object.fromEntries(headers.map((field,i)=>[field,row[i]])),{kind:'html_table',table:tableIndex+1,row:index+2});
    }
  }
  if (resource.format==='pdf' && (resource.pages||[]).length>30) warnings.push('TIMETABLE_PAGE_LIMIT');
  const sources=resource.format==='pdf'?(resource.pages||[]).slice(0,30):[{text:resource.text||''}];
  let chars=0;
  for (const block of sources) {
    const remaining=60000-chars;if (remaining<=0) {warnings.push('TIMETABLE_TEXT_LIMIT');break;}
    const text=String(block.text).slice(0,remaining);chars+=text.length;
    if (text.length<String(block.text).length) warnings.push('TIMETABLE_TEXT_LIMIT');
    const lines=text.split('\n');if(lines.length>1000)warnings.push('TIMETABLE_LINE_LIMIT');
    for (const [lineIndex,line] of lines.slice(0,1000).entries()) {
      if (!line.includes('|')) continue;
      const fields={};let valid=true;
      for (const part of line.split('|')) {
        const match=part.trim().match(/^([^:]{1,40}):\s*(.{0,500})$/u),key=match&&fieldFor(match[1]);
        if (!key || Object.hasOwn(fields,key)) {valid=false;break;}
        fields[key]=match[2];
      }
      if (!valid) {warnings.push('UNSUPPORTED_TIMETABLE_TEXT_LINE');continue;}
      add(fields,{kind:resource.format==='pdf'?'pdf_line':'html_line',...(resource.format==='pdf'?{page:block.pageNumber}:{}),line:lineIndex+1});
    }
  }
  result.entries=[...entries.values()];
  if (warnings.includes('PARTIAL_TIMETABLE_SOURCE')) for (const entry of result.entries) {
    entry.warnings.push('PARTIAL_TIMETABLE_SOURCE');entry.status='incomplete';
  }
  for (let i=0;i<result.entries.length;i++) for (let j=i+1;j<result.entries.length;j++) {
    const a=result.entries[i],b=result.entries[j];
    if (a.group!==b.group || a.weekday!==b.weekday || a.timeZone!==b.timeZone) continue;
    const overlaps=a.dates.some(value=>b.dates.includes(value)) || (a.effectiveFrom&&a.effectiveUntil&&b.effectiveFrom&&b.effectiveUntil&&a.effectiveFrom<=b.effectiveUntil&&b.effectiveFrom<=a.effectiveUntil);
    if (overlaps && a.startTime && b.startTime && (!a.endTime || !b.endTime || (a.startTime<b.endTime&&b.startTime<a.endTime))) {
      for (const entry of [a,b]) {entry.status='incomplete';if(!entry.warnings.includes('OVERLAPPING_TIMETABLE_ENTRIES'))entry.warnings.push('OVERLAPPING_TIMETABLE_ENTRIES');}
    }
  }
  if (!result.entries.length) warnings.push('NO_SUPPORTED_TIMETABLE_ENTRIES');
  if (result.entries.some(entry=>entry.warnings.length)) warnings.push('UNRESOLVED_TIMETABLE_FIELDS');
  result.coverage.warnings=[...new Set(warnings)];result.coverage.partial=result.coverage.warnings.length>0;
  result.status=!result.entries.length?'unsupported':result.coverage.partial?'partial':'read';
  return result;
}
