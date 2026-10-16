import { execFileSync } from 'child_process';
import * as path from 'path';

// Jest pins TZ=UTC, which has no DST, so run the module in a child process with a real zone.
function streakAt(timeZone: string, nowIso: string, lastActivityDate: string) {
  const modulePath = path.join(__dirname, 'streak-tracker.ts');
  const script = `
    const { getTodayDateString, getYesterdayDateString, calculateUpdatedStreak } = await import(${JSON.stringify(modulePath)});
    const RealDate = Date;
    const now = RealDate.parse(${JSON.stringify(nowIso)});
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    };
    console.log(JSON.stringify({
      today: getTodayDateString(),
      yesterday: getYesterdayDateString(),
      streak: calculateUpdatedStreak(5, ${JSON.stringify(lastActivityDate)}),
    }));
  `;
  const output = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
    env: { ...process.env, TZ: timeZone },
    encoding: 'utf8',
  });
  return JSON.parse(output) as { today: string; yesterday: string; streak: number };
}

describe('streak dates across DST transitions', () => {
  it('continues the streak on the evening clocks spring forward', () => {
    expect(streakAt('America/New_York', '2025-03-09T23:30:00Z', '2025-03-08')).toEqual({
      today: '2025-03-09',
      yesterday: '2025-03-08',
      streak: 6,
    });
  });

  it('continues the streak on the evening clocks fall back', () => {
    expect(streakAt('America/New_York', '2025-11-03T00:30:00Z', '2025-11-02')).toEqual({
      today: '2025-11-03',
      yesterday: '2025-11-02',
      streak: 6,
    });
  });

  it('resets the streak after a missed day on the evening clocks fall back', () => {
    expect(streakAt('America/New_York', '2025-11-03T00:30:00Z', '2025-11-01').streak).toBe(1);
  });
});
