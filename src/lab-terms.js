import { z } from 'zod';
import { LabPreferences, PreferenceError } from './preferences.js';
const weekdays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
export const termFields = ['weekday','startTime','endTime','room','group'];
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const token = z.string().trim().min(1).max(16).regex(/^[\p{L}\p{N}-]+$/u);
const normalize = value => value?.toUpperCase().replace(/А/g,'A').replace(/Б/g,'B').replace(/Ц/g,'C') ?? null;
export const labTermSchema = z.object({
  weekday: z.enum(weekdays).nullable().default(null),
  startTime: time.nullable().default(null), endTime: time.nullable().default(null),
  room: token.nullable().default(null), group: token.nullable().default(null),
  choiceId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
}).strict().refine(term => Object.values(term).some(value=>value!==null),'Provide at least one field, or null to reset.')
  .refine(term=>!term.endTime || (term.startTime && term.endTime>term.startTime),'End time requires an earlier start time.')
  .transform(term=>({...term,group:normalize(term.group),room:normalize(term.room)?.toLowerCase()??null}));
const describe = (courseId,record) => ({courseId,term:record?.term??null,source:record?'user_declared':'unset',updatedAt:record?.updatedAt??null,
  scope:'Private user-declared term labels only, not faculty verification, attendance, teaching dates or recurrence. Full replacement; null resets only term preferences.'});

export class LabTermPreferences extends LabPreferences {
  location(courseId) { return super.location(courseId).replace(/\.json$/,'.term.json'); }
  validateRecord(record) {
    const parsed=labTermSchema.safeParse(record?.term);
    if(!record || Object.keys(record).sort().join(',')!=='schemaVersion,term,updatedAt' || record.schemaVersion!==1 ||
      !parsed.success || JSON.stringify(parsed.data)!==JSON.stringify(record.term) ||
      typeof record.updatedAt!=='string' || !Number.isFinite(Date.parse(record.updatedAt)) || new Date(record.updatedAt).toISOString()!==record.updatedAt)
      throw new PreferenceError('INVALID_PREFERENCE_FILE');
  }
  async getTerm(courseId) {
    try {const file=this.location(courseId);await this.checkDirectories(file);return describe(courseId,await this.load(file));}
    catch(error){if(error instanceof PreferenceError)throw error;throw new PreferenceError('PREFERENCE_READ_FAILED');}
  }
  async setTerm(courseId,value) {
    const parsed=value===null?null:labTermSchema.safeParse(value);
    if(value!==null&&!parsed.success)throw new PreferenceError('INVALID_LAB_TERM');
    const term=parsed?.data??null;
    const record=await this.update(courseId,current=>term===null?null:JSON.stringify(current?.term)===JSON.stringify(term)?current:
      {schemaVersion:1,term,updatedAt:this.now()});
    return describe(courseId,record);
  }
}

export async function resolveLabTerm({manual,choices,readChoice}) {
  const term=Object.fromEntries(termFields.map(field=>[field,null]));
  const result={status:'incomplete',term,fieldSources:{},manual:manual??{term:null,source:'unset',updatedAt:null},pollSource:null,conflicts:[],warnings:[]};
  const local=manual?.term;
  const pinned=local?.choiceId;
  let selectedChoices=choices;
  if(pinned){
    selectedChoices=choices.filter(c=>Number(new URL(c.url).searchParams.get('id'))===pinned);
    if(selectedChoices.length!==1){result.status='unavailable';result.warnings.push('PINNED_CHOICE_NOT_DISCOVERED');return result;}
  }
  let poll;
  if(selectedChoices.length===1){
    try {poll=await readChoice(Number(new URL(selectedChoices[0].url).searchParams.get('id')));}
    catch{result.status='unavailable';result.warnings.push('CHOICE_READ_FAILED');return result;}
    result.pollSource={url:poll.sourceUrl,checkedAt:poll.checkedAt,status:poll.status,term:poll.term};
    // An unreadable/unknown saved label cannot silently fall back to stale manual data.
    if(!['selected','not_selected'].includes(poll.status)){result.status='unavailable';result.warnings.push('SAVED_TERM_UNRESOLVED');return result;}
  }else result.warnings.push(selectedChoices.length?'MULTIPLE_LAB_CHOICES':'NO_LAB_CHOICE');
  for(const field of termFields){
    const saved=poll?.status==='selected'?(poll.term?.[field]??null):null;
    const declared=local?.[field]??null;
    const comparable=field==='room'?normalize(saved)?.toLowerCase():field==='group'?normalize(saved):saved;
    if(comparable!==null&&declared!==null&&comparable!==declared){result.conflicts.push(field);continue;}
    term[field]=comparable??declared;
    result.fieldSources[field]=comparable!==null?(declared!==null?'poll_and_user':'poll'):declared!==null?'user_declared':'unset';
  }
  if(result.conflicts.length){result.status='conflict';result.warnings.push('MANUAL_POLL_TERM_CONFLICT');return result;}
  result.status=term.weekday&&term.startTime?'resolved':'incomplete';
  return result;
}
