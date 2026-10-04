import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/users.js', () => ({
  getSelf: vi.fn(),
  updateUserRating: vi.fn(),
  getSelfRating: vi.fn(),
}));
vi.mock('../api/recipes.js', () => ({ getRecipe: vi.fn() }));

import * as usersApi from '../api/users.js';
import * as recipesApi from '../api/recipes.js';
import { setRecipeRating, resetSelfUserIdCache } from '../lib/recipe-rating.js';

const getSelf = vi.mocked(usersApi.getSelf);
const updateUserRating = vi.mocked(usersApi.updateUserRating);
const getSelfRating = vi.mocked(usersApi.getSelfRating);
const getRecipe = vi.mocked(recipesApi.getRecipe);

beforeEach(() => {
  vi.resetAllMocks();
  resetSelfUserIdCache();
  getSelf.mockResolvedValue({ id: 'user-1' });
  updateUserRating.mockResolvedValue(undefined);
  getRecipe.mockResolvedValue({ id: 'recipe-1', rating: 4 });
  getSelfRating.mockResolvedValue({ recipeId: 'recipe-1', rating: 4, isFavorite: false });
});

describe('setRecipeRating', () => {
  it('posts the rating for the self user and returns user and aggregate ratings', async () => {
    const result = await setRecipeRating({ slug: 'pasta', rating: 4 });

    expect(updateUserRating).toHaveBeenCalledWith('user-1', 'pasta', { rating: 4 });
    expect(getSelfRating).toHaveBeenCalledWith('recipe-1');
    expect(result).toEqual({
      userRating: { recipeId: 'recipe-1', rating: 4, isFavorite: false },
      recipeRating: 4,
    });
  });

  it('sends only isFavorite when rating is omitted', async () => {
    await setRecipeRating({ slug: 'pasta', isFavorite: true });
    expect(updateUserRating).toHaveBeenCalledWith('user-1', 'pasta', { isFavorite: true });
  });

  it('clears with rating 0 on null, and reports the cleared rating as null', async () => {
    getRecipe.mockResolvedValue({ id: 'recipe-1', rating: null });
    getSelfRating.mockResolvedValue({ recipeId: 'recipe-1', rating: 0, isFavorite: false });

    const result = await setRecipeRating({ slug: 'pasta', rating: null });

    expect(updateUserRating).toHaveBeenCalledWith('user-1', 'pasta', { rating: 0 });
    expect(result).toEqual({
      userRating: { recipeId: 'recipe-1', rating: null, isFavorite: false },
      recipeRating: null,
    });
  });

  it('looks up the user id once per process', async () => {
    await setRecipeRating({ slug: 'a', rating: 3 });
    await setRecipeRating({ slug: 'b', rating: 3 });
    expect(getSelf).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed user lookup', async () => {
    getSelf.mockRejectedValueOnce(new Error('boom'));
    await expect(setRecipeRating({ slug: 'a', rating: 3 })).rejects.toThrow('boom');
    await setRecipeRating({ slug: 'a', rating: 3 });
    expect(getSelf).toHaveBeenCalledTimes(2);
  });

  it.each([0, 0.25, 5.5, 6, -1])('rejects rating %s without any API call', async (rating) => {
    await expect(setRecipeRating({ slug: 'pasta', rating })).rejects.toThrow(/rating must be between/);
    expect(getSelf).not.toHaveBeenCalled();
    expect(updateUserRating).not.toHaveBeenCalled();
  });

  it('accepts the boundaries 0.5 and 5', async () => {
    await setRecipeRating({ slug: 'pasta', rating: 0.5 });
    await setRecipeRating({ slug: 'pasta', rating: 5 });
    expect(updateUserRating).toHaveBeenCalledTimes(2);
  });

  it('rejects a call with neither rating nor isFavorite without any API call', async () => {
    await expect(setRecipeRating({ slug: 'pasta' })).rejects.toThrow(/at least one/i);
    expect(getSelf).not.toHaveBeenCalled();
    expect(updateUserRating).not.toHaveBeenCalled();
  });
});
