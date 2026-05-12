/**
 * Build Courses Command
 *
 * Aggregates per-course `course.json` files and per-badge `badges/*.json`
 * files into platform-keyed `oss.json` and `cloud.json` indexes for the
 * interactive-learning CDN.
 *
 * Run from the interactive-tutorials repo as part of its deploy workflow.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import type { Badge } from '../../types/learning-paths.types';
import type { CoursesPlatformIndex, Course } from '../../types/courses.types';
import {
  COURSES_SCHEMA_VERSION,
  CourseDocumentSchema,
  BadgeDocumentSchema,
  CoursesPlatformIndexSchema,
} from '../../types/courses.schema';

interface BuildCoursesOptions {
  output?: string;
  validateOnly?: boolean;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function discoverCourseFiles(coursesDir: string): string[] {
  if (!fs.existsSync(coursesDir)) {
    return [];
  }
  const entries = fs.readdirSync(coursesDir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'badges') {
      continue;
    }
    const coursePath = path.join(coursesDir, entry.name, 'course.json');
    if (fs.existsSync(coursePath)) {
      out.push(coursePath);
    }
  }
  return out.sort();
}

function discoverBadgeFiles(coursesDir: string): string[] {
  const badgesDir = path.join(coursesDir, 'badges');
  if (!fs.existsSync(badgesDir)) {
    return [];
  }
  return fs
    .readdirSync(badgesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(badgesDir, f))
    .sort();
}

interface LoadedCourse {
  file: string;
  course: Course;
  guideMetadata: Record<string, { title: string; estimatedMinutes: number; url?: string }>;
}

interface LoadedBadge {
  file: string;
  badge: Badge;
}

interface BuildErrors {
  errors: string[];
}

function loadCourses(files: string[], errs: BuildErrors): LoadedCourse[] {
  const loaded: LoadedCourse[] = [];
  for (const file of files) {
    try {
      const raw = readJson(file);
      const parsed = CourseDocumentSchema.safeParse(raw);
      if (!parsed.success) {
        errs.errors.push(`${file}: ${JSON.stringify(parsed.error.issues)}`);
        continue;
      }
      const { id, title, description, guides, badgeId, targetPlatform, estimatedMinutes, icon, url, guideMetadata } =
        parsed.data;
      loaded.push({
        file,
        course: { id, title, description, guides, badgeId, targetPlatform, estimatedMinutes, icon, url },
        guideMetadata: guideMetadata ?? {},
      });
    } catch (e) {
      errs.errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return loaded;
}

function loadBadges(files: string[], errs: BuildErrors): LoadedBadge[] {
  const loaded: LoadedBadge[] = [];
  for (const file of files) {
    try {
      const raw = readJson(file);
      const parsed = BadgeDocumentSchema.safeParse(raw);
      if (!parsed.success) {
        errs.errors.push(`${file}: ${JSON.stringify(parsed.error.issues)}`);
        continue;
      }
      loaded.push({ file, badge: parsed.data.badge });
    } catch (e) {
      errs.errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return loaded;
}

function buildPlatformIndex(
  platform: 'oss' | 'cloud',
  courses: LoadedCourse[],
  badges: LoadedBadge[]
): CoursesPlatformIndex {
  const platformCourses = courses.filter((c) => !c.course.targetPlatform || c.course.targetPlatform === platform);

  const guideMetadata: Record<string, { title: string; estimatedMinutes: number; url?: string }> = {};
  for (const c of platformCourses) {
    Object.assign(guideMetadata, c.guideMetadata);
  }

  return {
    schemaVersion: COURSES_SCHEMA_VERSION,
    platform,
    generatedAt: new Date().toISOString(),
    courses: platformCourses.map((c) => c.course),
    guideMetadata,
    badges: badges.map((b) => b.badge),
  };
}

function checkIntegrity(index: CoursesPlatformIndex, errs: BuildErrors): void {
  const badgeIds = new Set(index.badges.map((b) => b.id));
  for (const course of index.courses) {
    if (!badgeIds.has(course.badgeId)) {
      errs.errors.push(`${index.platform}.json: course "${course.id}" references missing badge "${course.badgeId}"`);
    }
  }
  const courseIds = new Set(index.courses.map((c) => c.id));
  for (const badge of index.badges) {
    if (badge.trigger.type === 'path-completed' && !courseIds.has(badge.trigger.pathId)) {
      // Cross-platform: a badge may target a course that lives only on the
      // other platform. Warn but don't fail — the index still validates.
      console.warn(
        `[build-courses] ${index.platform}.json: badge "${badge.id}" targets course "${badge.trigger.pathId}" not in this platform.`
      );
    }
  }
}

export const buildCoursesCommand = new Command('build-courses')
  .description('Aggregate per-course and per-badge JSON files into platform indexes (oss.json, cloud.json)')
  .arguments('<coursesDir>')
  .option('-o, --output <dir>', 'Output directory for the aggregated files (defaults to coursesDir itself)')
  .option('--validate-only', "Validate inputs but don't write outputs")
  .action(async function (this: Command, coursesDir: string) {
    const options = this.optsWithGlobals<BuildCoursesOptions>();
    const absDir = path.resolve(coursesDir);

    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
      console.error(`Error: ${absDir} is not a directory`);
      process.exit(1);
    }

    const errs: BuildErrors = { errors: [] };
    const courses = loadCourses(discoverCourseFiles(absDir), errs);
    const badges = loadBadges(discoverBadgeFiles(absDir), errs);

    if (errs.errors.length > 0) {
      console.error('Validation errors:');
      for (const err of errs.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }

    if (courses.length === 0) {
      console.error(`Error: no course.json files found under ${absDir}`);
      process.exit(1);
    }

    const ossIndex = buildPlatformIndex('oss', courses, badges);
    const cloudIndex = buildPlatformIndex('cloud', courses, badges);

    checkIntegrity(ossIndex, errs);
    checkIntegrity(cloudIndex, errs);

    const ossParse = CoursesPlatformIndexSchema.safeParse(ossIndex);
    const cloudParse = CoursesPlatformIndexSchema.safeParse(cloudIndex);
    if (!ossParse.success || !cloudParse.success) {
      console.error('Built indexes failed final schema validation:');
      if (!ossParse.success) {
        console.error('  oss:', JSON.stringify(ossParse.error.issues));
      }
      if (!cloudParse.success) {
        console.error('  cloud:', JSON.stringify(cloudParse.error.issues));
      }
      process.exit(1);
    }

    if (options.validateOnly) {
      console.log(
        `Validated ${courses.length} courses and ${badges.length} badges. Indexes would contain ${ossIndex.courses.length} OSS and ${cloudIndex.courses.length} Cloud courses.`
      );
      return;
    }

    const outDir = path.resolve(options.output ?? absDir);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'oss.json'), JSON.stringify(ossIndex, null, 2) + '\n');
    fs.writeFileSync(path.join(outDir, 'cloud.json'), JSON.stringify(cloudIndex, null, 2) + '\n');

    console.log(`Built courses indexes in ${outDir}:`);
    console.log(`  - oss.json    (${ossIndex.courses.length} courses, ${ossIndex.badges.length} badges)`);
    console.log(`  - cloud.json  (${cloudIndex.courses.length} courses, ${cloudIndex.badges.length} badges)`);
  });
