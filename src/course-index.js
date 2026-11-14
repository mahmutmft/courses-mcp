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
      const boundedText = text.slice(0, maxChunks * chunkSize * 2);
      const characters = Array.from(boundedText);
      if (boundedText.length < text.length) warnings.add('INDEX_TEXT_LIMIT');
      let end = 0;
      const wordCharacter = /[\p{L}\p{M}\p{N}]/u;
      for (let offset = 0; offset < characters.length; offset = end) {
        if (chunks.length === maxChunks) {
          warnings.add('INDEX_CHUNK_LIMIT');
          return;
        }
        end = Math.min(offset + chunkSize, characters.length);
        const splitsWord = index => wordCharacter.test(characters[index - 1] ?? '') &&
          wordCharacter.test(characters[index] ?? '');
        while (end > offset && splitsWord(end)) end--;
        if (end === offset) {
          // Skip an oversized token entirely rather than indexing its fragments.
          while (end < characters.length && wordCharacter.test(characters[end])) end++;
          warnings.add('INDEX_TOKEN_LIMIT');
          continue;
        }
        const excerpt = characters.slice(offset, end).join('');
        const completeText = end === characters.length && boundedText.length < text.length && wordCharacter.test(characters[end - 1])
          ? excerpt.replace(/[\p{L}\p{M}\p{N}]+$/u, '') : excerpt;
        const tokens = [...new Set(tokenize(completeText))];
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

export function rankCourseIndexes(indexes, query, limit) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  return indexes.flatMap(index => index.chunks.map(({ tokens, ...chunk }) => ({
    ...chunk, courseId: index.courseId, indexVersion: index.version,
    checkedAt: index.sources.find(source => source.url === chunk.url)?.checkedAt ?? null,
    score: terms.filter(term => tokens.includes(term)).length,
  }))).filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
