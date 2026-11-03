import { loadLocalEnv, loadConfig, safeError } from './config.js';
import { Moodle } from './moodle.js';

let moodle;
try {
  loadLocalEnv();
  moodle = new Moodle(loadConfig());
  const { courses, truncated } = await moodle.run(() => moodle.listCourses());
  // Only aggregate counts; no personal/course content in diagnostics.
  console.log(`Login successful. Enrolled courses: ${courses.length}. Truncated: ${truncated}.`);
  if (courses.length) {
    const course = await moodle.run(() => moodle.getCourse(courses[0].id));
    console.log(`First course parsed. Sections: ${course.sections.length}. Resources: ${course.sections.reduce((sum, section) => sum + section.resources.length, 0)}.`);
  }
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
} finally {
  await moodle?.close();
}
