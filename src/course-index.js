import { createHash } from 'node:crypto';

const maxSources = 32;
const maxChunks = 96;
const chunkSize = 1000;

export function tokenize(text) {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

// Inputs are results from authorized readers for a single course.
export function buildCourseIndex(course, resources) {
  const chunks = [];
  const sources = [];
  const seen = new Set();
  const warnings = new Set();
  function add(source, blocks) {
    if (seen.has(source.url)) return;
    if (sources.length >= maxSources) {
      warnings.add('INDEX_SOURCE_LIMIT');
      return;
    }
    seen.add(source.url);
    sources.push(source);
    for (const { text, page } of blocks) {
      const characters = Array.from(text.slice(0, maxChunks * chunkSize * 2));
      if (characters.join('').length < text.length) warnings.add('INDEX_TEXT_LIMIT');
      for (let offset = 0; offset < characters.length; offset += chunkSize) {
        if (chunks.length === maxChunks) {
          warnings.add('INDEX_CHUNK_LIMIT');
          return;
        }
        const excerpt = characters.slice(offset, offset + chunkSize).join('');
        const tokens = [...new Set(tokenize(excerpt))];
        if (!tokens.length) continue;
        const id = createHash('sha256').update(JSON.stringify([course.id, source.url, page, offset])).digest('hex');
        chunks.push({ id, url: source.url, page, excerpt, tokens });
      }
    }
  }

  const sectionsByUrl = new Map();
  for (const section of course.sections) {
    const url = section.url ?? course.url;
    const text = [section.name, section.summary, ...section.resources.flatMap(item => [item.name, item.description])].join('\n');
    sectionsByUrl.set(url, [...(sectionsByUrl.get(url) ?? []), text]);
  }
  for (const [url, sections] of sectionsByUrl) {
    add({ url, status: course.coverage?.partial ? 'partial' : 'read' }, [{ text: sections.join('\n'), page: null }]);
  }

  for (const resource of resources.slice(0, maxSources)) {
    if (resource.courseId !== course.id || !resource.sourceUrl) continue;
    const blocks = !['read', 'partial'].includes(resource.status) ? [] : resource.format === 'pdf'
      ? (resource.pages ?? []).map(page => ({ text: page.text, page: page.pageNumber }))
      : [{ text: resource.text ?? '', page: null }];
    add({ url: resource.sourceUrl, status: resource.status, checkedAt: resource.checkedAt }, blocks);
  }
  if (resources.length > maxSources) warnings.add('INDEX_SOURCE_LIMIT');
  return { version: 1, courseId: course.id, sources, chunks, warnings: [...warnings] };
}
