import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { UserError } from '../src/config.js';
import { exportLabCalendar, calendarInstant, escapeCalendarText, foldCalendarLine } from '../src/lab-ics.js';

const now = '2026-11-26T10:00:00.000Z';
const id = 'a'.repeat(24);
const source = 'https://courses.finki.ukim.mk/mod/resource/view.php?id=7';
const event = { id, courseId: 42, date: '2026-11-24', startTime: '14:00', endTime: '15:00',
  timeZone: 'Europe/Skopje', room: '200', group: 'A', status: 'timetable', uncertain: false,
  checkedAt: now, sources: [{ url: source }], changeEvidence: [] };
const calendar = (events = [event]) => ({ range: { from: '2026-11-23', through: '2026-11-29' }, events, warnings: [] });
const export_ = (events = [event], options = {}) => exportLabCalendar(calendar(events), { eventIds: [id], now, ...options });
const parsedEvents = content => new ICAL.Component(ICAL.parse(content)).getAllSubcomponents('vevent');

test('independent iCalendar parser reads private UTC events with stable UID and safe sources', () => {
  const result = export_();
  assert.equal(result.status, 'ready');
  assert.equal(result.exportedCount, 1);
  assert.equal(result.suggestedFilename, 'labs-2026-11-23-2026-11-29.ics');
  assert.ok(result.content.endsWith('\r\n'));
  assert.doesNotMatch(result.content.replaceAll('\r\n', ''), /[\r\n]/);
  const [parsed] = parsedEvents(result.content);
  assert.equal(parsed.getFirstPropertyValue('uid'), `${id}@courses-mcp.local`);
  assert.equal(parsed.getFirstPropertyValue('dtstart').toString(), '2026-11-24T13:00:00Z');
  assert.equal(parsed.getFirstPropertyValue('dtend').toString(), '2026-11-24T14:00:00Z');
  assert.equal(parsed.getFirstPropertyValue('class'), 'PRIVATE');
  assert.equal(parsed.getFirstPropertyValue('url'), source);
  assert.equal(parsed.getAllSubcomponents('valarm').length, 0);
  assert.match(parsed.getFirstPropertyValue('description'), /Source checked: 2026-11-26/);
});

test('moves/cancellations preserve reviewed UID and do not create external invitations', () => {
  const first = parsedEvents(export_().content)[0];
  const moved = parsedEvents(export_([{ ...event, status: 'moved', date: '2026-11-25', startTime: '16:00', endTime: '17:00' }]).content)[0];
  assert.equal(moved.getFirstPropertyValue('uid'), first.getFirstPropertyValue('uid'));
  assert.equal(moved.getFirstPropertyValue('dtstart').toString(), '2026-11-25T15:00:00Z');
  const cancelled = parsedEvents(export_([{ ...event, status: 'cancelled' }]).content)[0];
  assert.equal(cancelled.getFirstPropertyValue('uid'), first.getFirstPropertyValue('uid'));
  assert.equal(cancelled.getFirstPropertyValue('status'), 'CANCELLED');
  for (const item of [first, moved, cancelled]) {
    assert.equal(item.getFirstProperty('organizer'), null);
    assert.equal(item.getAllProperties('attendee').length, 0);
  }
});

test('Skopje DST conversion preserves wall time and rejects repeated or nonexistent times', () => {
  assert.equal(new Date(calendarInstant('2026-03-24','14:00','Europe/Skopje')).toISOString(), '2026-03-24T13:00:00.000Z');
  assert.equal(new Date(calendarInstant('2026-03-31','14:00','Europe/Skopje')).toISOString(), '2026-03-31T12:00:00.000Z');
  assert.equal(new Date(calendarInstant('2027-01-05','14:00','Europe/Skopje')).toISOString(), '2027-01-05T13:00:00.000Z');
  assert.equal(calendarInstant('2026-03-29','02:30','Europe/Skopje'), null);
  assert.equal(calendarInstant('2026-10-25','02:30','Europe/Skopje'), null);
  for (const date of ['2026-03-29','2026-10-25']) {
    const result = exportLabCalendar(calendar([{ ...event, date, startTime: '02:30', endTime: '03:30' }]),
      { eventIds: [id], now });
    assert.equal(result.content, null);
    assert.equal(result.skipped[0].reason, 'UNKNOWN_INVALID_OR_AMBIGUOUS_TIME');
  }
  for (const args of [['2026-02-30','14:00','UTC'],['2026-11-24','25:00','UTC'],['2026-11-24','14:00',null],['1969-11-24','14:00','UTC']]) {
    assert.equal(calendarInstant(...args), null);
  }
});

test('unknown/conflicting/stale times are skipped explicitly, never given default durations', () => {
  for (const patch of [{ endTime: null }, { startTime: null }, { timeZone: null }, { endTime: '13:00' },
    { status: 'conflict' }, { collidesWith: ['b'.repeat(24)] }, { endTimeProposals: ['15:00','16:00'] }, { checkedAt: '2000-01-01T00:00:00Z' }]) {
    const result = export_([{ ...event, ...patch }], { includeUncertain: true });
    assert.equal(result.status, 'empty');
    assert.equal(result.content, null);
    assert.equal(result.skipped.length, 1);
  }
  const partial = export_([event, { ...event, id: 'b'.repeat(24), endTime: null }], { eventIds: [id, 'b'.repeat(24)] });
  assert.equal(partial.status, 'partial');
  assert.equal(parsedEvents(partial.content).length, 1);
  assert.equal(partial.skipped[0].reason, 'UNKNOWN_END_TIME');
});

test('tentative entries need opt-in and uncertain cancellations cannot become confirmed exports', () => {
  assert.equal(export_([{ ...event, uncertain: true }]).content, null);
  const tentative = export_([{ ...event, uncertain: true }], { includeUncertain: true });
  assert.equal(parsedEvents(tentative.content)[0].getFirstPropertyValue('status'), 'TENTATIVE');
  assert.equal(export_([{ ...event, uncertain: true, status: 'cancelled' }], { includeUncertain: true }).content, null);
});

test('TEXT escaping, UTF-8 folding and injected event properties survive independent parsing as plain text', () => {
  const injected = 'Соба, A; \\ пример\r\nBEGIN:VEVENT\nATTENDEE:mailto:bad@example.org ' + 'Ѓ'.repeat(50);
  const result = export_([{ ...event, room: injected, group: 'A, B; \\ C\nBEGIN:VEVENT' }]);
  assert.equal(parsedEvents(result.content).length, 1);
  const [parsed] = parsedEvents(result.content);
  assert.equal(parsed.getFirstPropertyValue('location'), injected.replaceAll('\r\n', '\n'));
  assert.equal(parsed.getAllProperties('attendee').length, 0);
  assert.ok(result.content.split('\r\n').every(line => Buffer.byteLength(line,'utf8') <= 75));
  assert.equal(escapeCalendarText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  assert.throws(() => escapeCalendarText('bad\u0000text'), /ICS_INVALID_TEXT/);
  assert.equal(foldCalendarLine('Ѓ'.repeat(50)).replace(/\r\n /g, ''), 'Ѓ'.repeat(50));
});

test('selection and source guards reject unreviewed or unsafe event data', () => {
  for (const eventIds of [[], [id,id], ['../path'], Array(101).fill(id)]) assert.throws(() => export_([event], { eventIds }), /ICS_INVALID_SELECTION/);
  assert.equal(export_([], { eventIds: [id] }).skipped[0].reason, 'EVENT_NOT_CURRENT_OR_NOT_UNIQUE');
  for (const url of ['https://outside.example/view.php?id=7', source+'&sesskey=PRIVATE', source+'\r\nATTENDEE:bad', source+'&id=8']) {
    const result = export_([{ ...event, sources: [{ url }] }]);
    assert.equal(result.content, null);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|ATTENDEE/);
  }
  const sources = Array.from({ length: 17 }, (_, i) => ({ url: source.replace('id=7', `id=${1111111111111100 + i}`) }));
  assert.equal(export_([{ ...event, sources }]).skipped[0].reason, 'SOURCE_LIMIT');
  const large = Array.from({ length: 100 }, (_, i) => ({ ...event, id: i.toString(16).padStart(24,'0'),
    group: '界'.repeat(200), room: '界'.repeat(200), sources: sources.slice(0,16) }));
  assert.throws(() => export_(large, { eventIds: large.map(item => item.id) }), /ICS_OUTPUT_LIMIT/);
  assert.throws(() => export_([event], { now: 'invalid' }), /ICS_INVALID_CLOCK/);
});

test('actual MCP export rereads reviewed calendar and validates selection before any adapter call', async () => {
  let reads = 0, revoked = false;
  const server = createServer({ run: action => action(), getLabCalendar: async () => {
    if (revoked) throw new UserError('A selected course is not in your enrolled course list.');
    reads++; return calendar([{ ...event, checkedAt: new Date().toISOString() }]);
  } });
  const client = new Client({ name: 'ics-test', version: '1.0.0' });
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const args = { courseIds: [42], range: calendar().range, eventIds: [id] };
    const invalid = await client.callTool({ name: 'export_lab_calendar', arguments: { ...args, eventIds: [id,id] } });
    assert.equal(invalid.isError, true); assert.equal(reads, 0);
    const response = await client.callTool({ name: 'export_lab_calendar', arguments: args });
    assert.equal(response.isError, undefined); assert.equal(reads, 1);
    const result = JSON.parse(response.content[0].text);
    assert.equal(parsedEvents(result.content).length, 1);
    revoked = true;
    const denied = await client.callTool({ name: 'export_lab_calendar', arguments: args });
    assert.equal(denied.isError, true);
    assert.doesNotMatch(denied.content[0].text, /BEGIN:VCALENDAR/);
  } finally { await client.close(); await server.close(); }
});
