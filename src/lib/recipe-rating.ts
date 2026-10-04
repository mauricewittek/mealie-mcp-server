import * as usersApi from '../api/users.js';
import * as recipesApi from '../api/recipes.js';

export const RECIPE_RATING_MIN = 0.5;
export const RECIPE_RATING_MAX = 5;
export const RECIPE_RATING_STEP = 0.5;

export interface SetRecipeRatingInput {
  slug: string;
  // number sets the rating; null clears it; undefined leaves it unchanged.
  rating?: number | null;
  isFavorite?: boolean;
}

// Probed live against Mealie v3.20.1 (2026-10-04):
// - The endpoint does not validate the range: 6, 5.5, 2.3 and -1 were all stored as sent.
//   The 0.5–5 / half-step range here is the UI's star scale, enforced by this tool only.
// - `rating: null` (or omitting it) is a no-op, so it cannot clear. Sending `rating: 0`
//   stores 0 and removes the caller's contribution from the recipe's aggregate `rating`
//   (aggregate reads back null), which is how "clear" is implemented.
// - `isFavorite` alone leaves the stored rating unchanged.
const CLEAR_RATING_VALUE = 0;

// The user behind the API key never changes within a process; a rejected lookup is not cached.
let selfUserId: Promise<string> | undefined;

function getSelfUserId(): Promise<string> {
  selfUserId ??= usersApi
    .getSelf()
    .then((self) => {
      if (typeof self.id !== 'string' || !self.id) {
        throw new Error('GET /api/users/self returned no user id.');
      }
      return self.id;
    })
    .catch((error) => {
      selfUserId = undefined;
      throw error;
    });
  return selfUserId;
}

export function resetSelfUserIdCache(): void {
  selfUserId = undefined;
}

export async function setRecipeRating(input: SetRecipeRatingInput): Promise<Record<string, unknown>> {
  const { slug, rating, isFavorite } = input;
  if (rating === undefined && isFavorite === undefined) {
    throw new Error('Provide at least one of rating or isFavorite.');
  }
  if (typeof rating === 'number') {
    const onStep = Number.isInteger(rating / RECIPE_RATING_STEP);
    if (!onStep || rating < RECIPE_RATING_MIN || rating > RECIPE_RATING_MAX) {
      throw new Error(
        `rating must be between ${RECIPE_RATING_MIN} and ${RECIPE_RATING_MAX} in steps of ${RECIPE_RATING_STEP}, or null to clear.`,
      );
    }
  }

  const update: usersApi.RatingUpdate = {};
  if (rating === null) update.rating = CLEAR_RATING_VALUE;
  else if (rating !== undefined) update.rating = rating;
  if (isFavorite !== undefined) update.isFavorite = isFavorite;

  const userId = await getSelfUserId();
  await usersApi.updateUserRating(userId, slug, update);

  const recipe = await recipesApi.getRecipe(slug);
  const summary = await usersApi.getSelfRating(String(recipe.id));
  const stored = summary.rating;
  return {
    userRating: {
      ...summary,
      rating: typeof stored === 'number' && stored > 0 ? stored : null,
    },
    recipeRating: recipe.rating ?? null,
  };
}
