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
    const markPartial = warning => {
      source.status = 'partial';
      warnings.add(warning);
    };
    const seenPages = new Set();
    for (const { text, page } of blocks) {
      if (page !== null && (!Number.isSafeInteger(page) || page < 1 || seenPages.has(page))) {
        markPartial('INDEX_INVALID_PAGE_REFERENCE');
        continue;
      }
      seenPages.add(page);
      const boundedText = text.slice(0, maxChunks * chunkSize * 2);
      const characters = Array.from(boundedText);
      if (boundedText.length < text.length) markPartial('INDEX_TEXT_LIMIT');
      let end = 0;
      const wordCharacter = /[\p{L}\p{M}\p{N}]/u;
      for (let offset = 0; offset < characters.length; offset = end) {
        if (chunks.length === maxChunks) {
          markPartial('INDEX_CHUNK_LIMIT');
          return;
        }
        end = Math.min(offset + chunkSize, characters.length);
        const splitsWord = index => wordCharacter.test(characters[index - 1] ?? '') &&
          wordCharacter.test(characters[index] ?? '');
        while (end > offset && splitsWord(end)) end--;
        if (end === offset) {
          // Skip an oversized token entirely rather than indexing its fragments.
          while (end < characters.length && wordCharacter.test(characters[end])) end++;
          markPartial('INDEX_TOKEN_LIMIT');
          continue;
        }
        const excerpt = characters.slice(offset, end).join('');
        const completeText = end === characters.length && boundedText.length < text.length && wordCharacter.test(characters[end - 1])
          ? excerpt.replace(/[\p{L}\p{M}\p{N}]+$/u, '') : excerpt;
        const tokens = [...new Set(tokenize(completeText))];
        if (!tokens.length) continue;
        const id = createHash('sha256').update(JSON.stringify([course.id, source.url, page, offset])).digest('hex');
        chunks.push({ id, url: source.url, page, excerpt: completeText, tokens });
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
    add({ url: resource.sourceUrl, status: resource.status, name: resource.name ?? null, checkedAt: resource.checkedAt }, blocks);
  }
  if (resources.length > maxSources) warnings.add('INDEX_SOURCE_LIMIT');
  return { version: 1, courseId: course.id, courseName: course.name ?? null, sources, chunks, warnings: [...warnings] };
}

export function rankCourseIndexes(indexes, query, limit) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  return indexes.flatMap(index => index.chunks.map(({ tokens, ...chunk }) => {
    const source = index.sources.find(item => item.url === chunk.url);
    return {
      ...chunk, courseId: index.courseId, indexVersion: index.version,
      courseName: index.courseName ?? null, sourceName: source?.name ?? null,
      checkedAt: source?.checkedAt ?? null,
      score: terms.filter(term => tokens.includes(term)).length,
    };
  })).filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Decode an index only after its cache record has passed current access checks. */
export function decodeCourseIndex(serialized, courseId, expectedSourceUrls, expectedCitations) {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 1024 * 1024) return null;
  let index;
  try { index = JSON.parse(serialized); } catch { return null; }
  if (index?.version !== 1 || index.courseId !== courseId ||
      !Array.isArray(index.sources) || index.sources.length > maxSources ||
      !Array.isArray(index.chunks) || index.chunks.length > maxChunks ||
      !Array.isArray(index.warnings) || !index.warnings.every(value => typeof value === 'string')) return null;

  const allowedFields = (value, fields) => Object.keys(value).every(key => fields.includes(key));
  const optionalText = value => value === undefined || value === null || typeof value === 'string';
  if (!allowedFields(index, ['version', 'courseId', 'courseName', 'sources', 'chunks', 'warnings']) ||
      !optionalText(index.courseName)) return null;
  const urls = new Set();
  for (const source of index.sources) {
    if (!source || !allowedFields(source, ['url', 'status', 'name', 'checkedAt']) ||
        !optionalText(source.name) || !optionalText(source.checkedAt) || typeof source.url !== 'string' || urls.has(source.url) ||
        (expectedSourceUrls && !expectedSourceUrls.has(source.url)) ||
        !['read', 'partial', 'unsupported'].includes(source.status)) return null;
    urls.add(source.url);
  }
  const ids = new Set();
  for (const chunk of index.chunks) {
    if (!chunk || !allowedFields(chunk, ['id', 'url', 'page', 'excerpt', 'tokens']) || typeof chunk.id !== 'string' || !/^[a-f0-9]{64}$/.test(chunk.id) ||
        ids.has(chunk.id) || !urls.has(chunk.url) ||
        (expectedCitations && !expectedCitations.has(JSON.stringify([chunk.url, chunk.page]))) ||
        (chunk.page !== null && (!Number.isSafeInteger(chunk.page) || chunk.page < 1)) ||
        typeof chunk.excerpt !== 'string' || Array.from(chunk.excerpt).length > chunkSize ||
        !Array.isArray(chunk.tokens) || chunk.tokens.length > chunkSize ||
        !chunk.tokens.every(token => typeof token === 'string' && token.length > 0)) return null;
    ids.add(chunk.id);
    const source = index.sources.find(item => item.url === chunk.url);
    if (source.status === 'unsupported') return null;
    const expectedTokens = [...new Set(tokenize(chunk.excerpt))];
    if (expectedTokens.length !== chunk.tokens.length ||
        expectedTokens.some((token, position) => token !== chunk.tokens[position])) return null;
  }
  return index;
}
