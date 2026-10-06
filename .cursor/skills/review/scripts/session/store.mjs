import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import { foldEvents, sha256 } from './model.mjs';

const EVENTS = 'events.jsonl';
const SNAPSHOT = 'session.json';
const LOCK = '.writer.lock';

export function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  const fd = openSync(temporary, 'w');
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function acquireLock(dir) {
  const path = join(dir, LOCK);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(path, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      const holder = Number(readFileSync(path, 'utf8'));
      if (Number.isInteger(holder) && holder > 0 && processAlive(holder)) {
        throw new Error(
          `session ${dir} has a live writer (pid ${holder}). One supervisor writes a session; workers return results to it`
        );
      }
      rmSync(path, { force: true });
    }
  }
  throw new Error(`could not acquire the session writer lock in ${dir}`);
}

export function readEvents(dir) {
  const path = join(dir, EVENTS);
  if (!existsSync(path)) {
    throw new Error(`${dir} is not a review session: ${EVENTS} is missing`);
  }
  const lines = readFileSync(path, 'utf8').split('\n');
  const torn = lines.pop();
  if (torn.length > 0) {
    process.stderr.write(`review-session: ignoring a torn trailing event in ${path}\n`);
  }
  return lines.filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`event line ${index + 1} in ${path} is not valid JSON; the log is damaged`);
    }
  });
}

export function loadSession(dir) {
  return foldEvents(readEvents(dir));
}

export function appendEvents(dir, expectedRevision, events) {
  if (events.length === 0) {
    return;
  }
  const current = readEvents(dir);
  if (current.length !== expectedRevision) {
    throw new Error(
      `session revision moved from ${expectedRevision} to ${current.length} under this writer; reload and retry`
    );
  }
  const path = join(dir, EVENTS);
  const raw = readFileSync(path, 'utf8');
  if (raw.length > 0 && !raw.endsWith('\n')) {
    atomicWrite(path, current.map((event) => `${JSON.stringify(event)}\n`).join(''));
  }
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, events.map((event) => `${JSON.stringify(event)}\n`).join(''));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function writeSnapshot(dir, state) {
  atomicWrite(join(dir, SNAPSHOT), `${JSON.stringify(state, null, 2)}\n`);
}

export function createSessionDir(dir) {
  mkdirSync(join(dir, 'artifacts'), { recursive: true });
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  if (!existsSync(join(dir, EVENTS))) {
    writeFileSync(join(dir, EVENTS), '');
  }
}

export function storeArtifact(dir, content, extension = 'txt') {
  const digest = sha256(content);
  const name = `${digest}.${extension}`;
  const path = join(dir, 'artifacts', name);
  if (!existsSync(path)) {
    atomicWrite(path, content);
  }
  return { ref: `artifacts/${name}`, sha256: digest, bytes: Buffer.byteLength(content) };
}

export function withSession(dir, operation) {
  const release = acquireLock(dir);
  try {
    const state = loadSession(dir);
    const { events = [], output } = operation(state) ?? {};
    appendEvents(dir, state.revision, events);
    const next = events.length > 0 ? loadSession(dir) : state;
    writeSnapshot(dir, next);
    return { state: next, output };
  } finally {
    release();
  }
}
