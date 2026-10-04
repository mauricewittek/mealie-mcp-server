import { describe, it, expect } from 'vitest';
import { resolveLastMadeTimestamp } from '../lib/last-made.js';

// Local wall-clock time, so the tests hold in any TZ the suite runs under.
const NOW = new Date(2026, 9, 4, 15, 30, 0); // 2026-10-04 15:30 local

describe('resolveLastMadeTimestamp', () => {
  it('sends a plain date as noon local time, so a TZ shift cannot move it to the previous day', () => {
    expect(resolveLastMadeTimestamp('2026-09-29', NOW)).toBe(new Date(2026, 8, 29, 12, 0, 0).toISOString());
  });

  it('clamps today to now when noon has not passed yet, instead of sending a future time', () => {
    const morning = new Date(2026, 9, 4, 8, 0, 0);
    expect(resolveLastMadeTimestamp('2026-10-04', morning)).toBe(morning.toISOString());
  });

  it('keeps the instant of an ISO date-time with offset', () => {
    expect(resolveLastMadeTimestamp('2026-09-29T18:45:00+02:00', NOW)).toBe('2026-09-29T16:45:00.000Z');
  });

  it.each(['March 5', '2026-02-30', '2026-09-29T25:00:00Z'])(
    'rejects %j, which Date would accept or silently roll over',
    (value) => {
      expect(() => resolveLastMadeTimestamp(value, NOW)).toThrow(/timestamp/i);
    },
  );

  it('rejects a future plain date and a future date-time', () => {
    expect(() => resolveLastMadeTimestamp('2026-10-05', NOW)).toThrow(/future/i);
    expect(() => resolveLastMadeTimestamp('2026-10-04T23:00:00Z', new Date('2026-10-04T12:00:00Z'))).toThrow(
      /future/i,
    );
  });
});
