const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Pre-check: `new Date()` also accepts non-ISO input such as 'March 5'.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;

/**
 * Resolves the `timestamp` argument of `mark_recipe_last_made` to the ISO string sent to Mealie.
 *
 * - omitted: `now`
 * - `YYYY-MM-DD`: noon local time on that calendar day, so a UTC conversion cannot move it to the
 *   neighbouring day. Today is clamped to `now` when noon has not passed yet.
 * - ISO 8601 date-time: the same instant (no offset means local time).
 *
 * Throws on unparseable input and on anything in the future.
 */
export function resolveLastMadeTimestamp(input: string | undefined, now: Date = new Date()): string {
  if (input === undefined) return now.toISOString();

  const plain = PLAIN_DATE.exec(input);
  if (plain) {
    const [year, month, day] = [Number(plain[1]), Number(plain[2]), Number(plain[3])];
    const noon = new Date(year, month - 1, day, 12, 0, 0);
    if (noon.getFullYear() !== year || noon.getMonth() !== month - 1 || noon.getDate() !== day) {
      throw invalid(input);
    }
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (noon >= startOfTomorrow) throw new Error(futureMessage(input));
    return (noon > now ? now : noon).toISOString();
  }

  if (!ISO_DATE_TIME.test(input)) throw invalid(input);
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) throw invalid(input);
  if (parsed > now) throw new Error(futureMessage(input));
  return parsed.toISOString();
}

function invalid(input: string): Error {
  return new Error(
    `Invalid timestamp ${JSON.stringify(input)}: expected an ISO 8601 date-time (2026-09-29T18:45:00Z) or a date (YYYY-MM-DD).`,
  );
}

function futureMessage(input: string): string {
  return `Invalid timestamp ${JSON.stringify(input)}: last-made cannot be in the future.`;
}
