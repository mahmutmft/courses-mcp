import { load } from 'cheerio';
import { createHash } from 'node:crypto';

const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
const fingerprint = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function coursePageUrl(value, courseId, baseUrl) {
  try {
    const url = new URL(value, `${baseUrl}/course/view.php?id=${courseId}`);
    if (url.origin !== baseUrl || url.username || url.password) return null;
    const keys = [...url.searchParams.keys()];
    if (new Set(keys).size !== keys.length) return null;
    const id = url.searchParams.get('id');
    if (!/^[1-9]\d*$/.test(id || '') || !Number.isSafeInteger(Number(id))) return null;
    if (url.pathname === '/course/section.php' && keys.length === 1) return `${baseUrl}/course/section.php?id=${Number(id)}`;
    if (url.pathname !== '/course/view.php' || Number(id) !== courseId || keys.some(key => !['id', 'section'].includes(key))) return null;
    const section = url.searchParams.get('section');
    if (section !== null && (!/^\d+$/.test(section) || !Number.isSafeInteger(Number(section)))) return null;
    return `${baseUrl}/course/view.php?id=${courseId}${section === null ? '' : `&section=${Number(section)}`}`;
  } catch { return null; }
}
export function textFromHtml(html) {
  const $ = load(html || '');
  $('script, style, noscript').remove();
  return clean($.root().text());
}

export function sourceUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (url.origin !== baseUrl || url.username || url.password) return null;
    // Only stable read-only resource links, never sesskey-bearing actions.
    if (!/^\/(course\/view\.php|mod\/[a-z]+\/view\.php|pluginfile\.php)(\/|$)/.test(url.pathname)) return null;
    if (url.searchParams.has('sesskey')) return null;
    return url.href;
  } catch { return null; }
}

export function parseCourse(html, id, baseUrl) {
  const $ = load(html);
  $('script, style, noscript').remove();
  const sections = [];
  $('[data-for="section"], li.section').each((index, el) => {
    // Avoid double counting nested sections.
    if ($(el).parents('[data-for="section"], li.section').length) return;
    const section = $(el);
    const databaseId = section.attr('data-id');
    const number = section.attr('data-number') ?? section.attr('id')?.match(/^section-(\d+)$/)?.[1];
    const title = clean(section.find('.sectionname, [data-for="section_title"], h3').first().text()) || 'Section';
    const stableId = /^[1-9]\d*$/.test(databaseId || '') ? `db:${databaseId}`
      : /^\d+$/.test(number || '') ? `number:${Number(number)}` : `text:${fingerprint(title)}:${index}`;
    const sectionUrl = /^\d+$/.test(number || '') ? `${baseUrl}/course/view.php?id=${id}&section=${Number(number)}`
      : `${baseUrl}/course/view.php?id=${id}`;
    const resources = [];
    section.find('.activity, [data-for="cmitem"]').each((_, activity) => {
      if ($(activity).parentsUntil(el, '.activity, [data-for="cmitem"]').length) return;
      const item = $(activity);
      const anchor = item.find('a[href]').filter((_, a) => sourceUrl($(a).attr('href'), baseUrl)).first();
      const url = sourceUrl(anchor.attr('href'), baseUrl);
      const name = clean(anchor.find('.instancename').text() || anchor.text());
      const description = clean(item.find('.description, .contentwithoutlink, .activity-altcontent').text()).slice(0, 4000);
      const cmId = url && new URL(url).searchParams.get('id');
      const domId = item.attr('data-id') || item.attr('id')?.match(/^module-(\d+)$/)?.[1];
      const resourceKey = /^[1-9]\d*$/.test(domId || '') ? `cm:${domId}`
        : /^[1-9]\d*$/.test(cmId || '') ? `cm:${cmId}` : `text:${fingerprint(`${url}|${name}|${description}`)}`;
      if (url || description) resources.push({ id: `course:${id}:${resourceKey}`, name: name || 'Text', url, description });
    });
    sections.push({ id: `course:${id}:section:${stableId}`, number: /^\d+$/.test(number || '') ? Number(number) : null,
      url: sectionUrl, name: title, summary: clean(section.find('.summary').first().text()).slice(0, 4000), resources });
  });
  return { id, name: clean($('h1').first().text()), url: `${baseUrl}/course/view.php?id=${id}`, sections };
}

export function normalizeCourses(courses, baseUrl) {
  return courses.map(course => ({
    id: Number(course.id),
    name: textFromHtml(course.fullname),
    shortName: textFromHtml(course.shortname),
    url: `${baseUrl}/course/view.php?id=${Number(course.id)}`,
  })).filter(course => Number.isSafeInteger(course.id) && course.id > 0);
}

export function searchCourse(course, query, limit = 30) {
  const needle = query.normalize('NFKC').toLocaleLowerCase();
  const matches = [];
  const includes = value => value.normalize('NFKC').toLocaleLowerCase().includes(needle);
  for (const section of course.sections) {
    if (includes(`${section.name} ${section.summary}`)) {
      matches.push({ section: section.name, name: section.name, url: section.url || course.url, excerpt: section.summary });
    }
    for (const item of section.resources) {
      if (includes(`${item.name} ${item.description}`)) {
        matches.push({ section: section.name, ...item });
      }
    }
  }
  return { courseId: course.id, query, matches: matches.slice(0, limit), truncated: matches.length > limit,
    ...(course.coverage ? { coverage: course.coverage } : {}),
    scope: 'Discovered course section headings, summaries, activity titles and descriptions only; folder contents and linked files are not indexed.' };
}
