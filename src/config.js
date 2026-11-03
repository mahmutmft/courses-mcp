import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class UserError extends Error {}

export function isCasLogin(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://cas.finki.ukim.mk' && !url.username && !url.password &&
      /^\/cas\/login(?:;jsessionid=[A-Za-z0-9._-]+)?$/.test(url.pathname);
  } catch { return false; }
}

export function loadConfig(env = process.env) {
  const baseUrl = env.MOODLE_BASE_URL || 'https://courses.finki.ukim.mk';
  // Credentials may only be sent to the faculty's known services.
  if (!/^https:\/\/courses\.finki\.ukim\.mk\/?$/.test(baseUrl)) {
    throw new UserError('MOODLE_BASE_URL must be https://courses.finki.ukim.mk.');
  }
  return {
    baseUrl: 'https://courses.finki.ukim.mk',
    username: env.MOODLE_USERNAME || '',
    password: env.MOODLE_PASSWORD || '',
  };
}

export function loadLocalEnv() {
  // Resolve relative to this project, independent of the MCP client's cwd.
  const path = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

export function safeError(error) {
  return error instanceof UserError ? error.message
    : 'Moodle request failed. Check connectivity and try again. No diagnostic secrets were logged.';
}
