import { UserError } from './config.js';

export const maxToolResultBytes = 1024 * 1024;

export function encodeToolResult(value) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') throw new Error('Tool did not return serializable data.');
  if (Buffer.byteLength(text, 'utf8') > maxToolResultBytes) {
    throw new UserError('[TOOL_OUTPUT_LIMIT] The result is too large. Use a more targeted tool or narrow the selected courses, resources, date range or result limit. No partial JSON was returned.');
  }
  return { content: [{ type: 'text', text }] };
}
