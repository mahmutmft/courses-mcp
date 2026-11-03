import { load } from 'cheerio';

const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
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
  $('[data-for="section"], li.section').each((_, el) => {
    // Avoid double counting nested sections.
    if ($(el).parents('[data-for="section"], li.section').length) return;
    const section = $(el);
    const title = clean(section.find('.sectionname, [data-for="section_title"], h3').first().text()) || 'Section';
    const resources = [];
    section.find('.activity, [data-for="cmitem"]').each((_, activity) => {
      if ($(activity).parentsUntil(el, '.activity, [data-for="cmitem"]').length) return;
      const item = $(activity);
      const anchor = item.find('a[href]').filter((_, a) => sourceUrl($(a).attr('href'), baseUrl)).first();
      const url = sourceUrl(anchor.attr('href'), baseUrl);
      const name = clean(anchor.find('.instancename').text() || anchor.text());
      const description = clean(item.find('.description, .contentwithoutlink, .activity-altcontent').text()).slice(0, 4000);
      if (url || description) resources.push({ name: name || 'Text', url, description });
    });
    sections.push({ name: title, summary: clean(section.find('.summary').first().text()).slice(0, 4000), resources });
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
      matches.push({ section: section.name, name: section.name, url: course.url, excerpt: section.summary });
    }
    for (const item of section.resources) {
      if (includes(`${item.name} ${item.description}`)) {
        matches.push({ section: section.name, ...item });
      }
    }
  }
  return { courseId: course.id, query, matches: matches.slice(0, limit), truncated: matches.length > limit,
    scope: 'Section headings, summaries, activity titles and descriptions only; linked files are not indexed.' };
}
