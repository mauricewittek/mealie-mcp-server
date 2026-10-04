import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return { ...actual, apiGet: vi.fn() };
});

import { apiGet } from '../api/client.js';
import { getMealplans } from '../api/mealplans.js';

const mockGet = vi.mocked(apiGet);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMealplans', () => {
  it('sends the date range as snake_case start_date/end_date', async () => {
    await getMealplans({ startDate: '2026-10-08', endDate: '2026-10-09', page: 2, perPage: 50 });

    const [path, params] = mockGet.mock.calls[0];
    expect(path).toBe('/api/households/mealplans');
    expect(params).toEqual({ start_date: '2026-10-08', end_date: '2026-10-09', page: '2', perPage: '50' });
  });
});
