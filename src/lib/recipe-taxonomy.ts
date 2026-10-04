import * as recipesApi from '../api/recipes.js';
import * as categoriesApi from '../api/categories.js';
import * as tagsApi from '../api/tags.js';

export type TaxonomyMode = 'merge' | 'replace';
export type TaxonomyKind = 'category' | 'tag';

export interface TaxonomyItem {
  id: string;
  name: string;
  slug: string;
}

export interface TaxonomyCollectionResult {
  final: TaxonomyItem[];
  added: TaxonomyItem[];
  removed: TaxonomyItem[];
  created: TaxonomyItem[];
}

export interface TaxonomyUpdateInput {
  categories?: string[];
  tags?: string[];
  mode?: TaxonomyMode;
  createMissing?: boolean;
}

export interface RecipeTaxonomyResult {
  id: string;
  slug: string;
  categories?: TaxonomyCollectionResult;
  tags?: TaxonomyCollectionResult;
}

export interface RecipeTaxonomyBatchUpdate extends TaxonomyUpdateInput {
  slug: string;
}

export type RecipeTaxonomyBatchResult =
  | ({ slug: string; success: true } & RecipeTaxonomyResult)
  | { slug: string; success: false; error: string };

export class MissingTaxonomyItemsError extends Error {
  constructor(
    public readonly kind: TaxonomyKind,
    public readonly values: string[],
  ) {
    const label = kind === 'category' ? 'categories' : 'tags';
    super(
      `The following ${label} do not exist: ${values.join(', ')}. ` +
        `Pass createMissing: true to create ${values.length === 1 ? 'it' : 'them'} automatically, ` +
        `or correct the ${label} name(s)/slug(s)/ID(s).`,
    );
    this.name = 'MissingTaxonomyItemsError';
  }
}

function toTaxonomyItem(raw: Record<string, unknown>): TaxonomyItem {
  return {
    id: String(raw.id),
    name: String(raw.name),
    slug: String(raw.slug),
  };
}

function toTaxonomyItems(raw: unknown): TaxonomyItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => toTaxonomyItem(item as Record<string, unknown>));
}

function toApiPayloadItem(item: TaxonomyItem): Record<string, unknown> {
  return { id: item.id, name: item.name, slug: item.slug };
}

async function getAllCategories(): Promise<TaxonomyItem[]> {
  const result = await categoriesApi.getCategories({ perPage: -1 });
  return result.items.map(toTaxonomyItem);
}

async function getAllTags(): Promise<TaxonomyItem[]> {
  const result = await tagsApi.getTags({ perPage: -1 });
  return result.items.map(toTaxonomyItem);
}

interface ResolveResult {
  resolved: TaxonomyItem[];
  created: TaxonomyItem[];
  missing: string[];
}

interface TaxonomyLookup {
  find(key: string): TaxonomyItem | undefined;
  add(item: TaxonomyItem, key: string): void;
}

function createLookup(existing: TaxonomyItem[]): TaxonomyLookup {
  const byId = new Map<string, TaxonomyItem>();
  const bySlug = new Map<string, TaxonomyItem>();
  const byName = new Map<string, TaxonomyItem>();
  const byCreatedKey = new Map<string, TaxonomyItem>();
  for (const item of existing) {
    byId.set(item.id.toLowerCase(), item);
    bySlug.set(item.slug.toLowerCase(), item);
    byName.set(item.name.toLowerCase(), item);
  }
  return {
    find: (key) => byId.get(key) ?? bySlug.get(key) ?? byName.get(key) ?? byCreatedKey.get(key),
    add: (item, key) => {
      byCreatedKey.set(key, item);
      byId.set(item.id.toLowerCase(), item);
      bySlug.set(item.slug.toLowerCase(), item);
      byName.set(item.name.toLowerCase(), item);
    },
  };
}

async function resolveTaxonomyValues(
  values: string[],
  existing: TaxonomyItem[],
  createMissing: boolean,
  createFn: (name: string) => Promise<Record<string, unknown>>,
): Promise<ResolveResult> {
  const lookup = createLookup(existing);
  const resolvedMap = new Map<string, TaxonomyItem>();
  const created: TaxonomyItem[] = [];
  const missing: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    const match = lookup.find(key);
    if (match) {
      resolvedMap.set(match.id, match);
      continue;
    }

    if (!createMissing) {
      missing.push(raw);
      continue;
    }

    const createdRaw = await createFn(value);
    const item = toTaxonomyItem(createdRaw);
    lookup.add(item, key);
    resolvedMap.set(item.id, item);
    created.push(item);
  }

  return { resolved: [...resolvedMap.values()], created, missing };
}

function computeFinal(
  mode: TaxonomyMode,
  current: TaxonomyItem[],
  requested: TaxonomyItem[],
): { final: TaxonomyItem[]; added: TaxonomyItem[]; removed: TaxonomyItem[] } {
  if (mode === 'replace') {
    const finalMap = new Map(requested.map((item) => [item.id, item]));
    const currentIds = new Set(current.map((item) => item.id));
    const final = [...finalMap.values()];
    const added = final.filter((item) => !currentIds.has(item.id));
    const removed = current.filter((item) => !finalMap.has(item.id));
    return { final, added, removed };
  }

  const finalMap = new Map(current.map((item) => [item.id, item]));
  const added: TaxonomyItem[] = [];
  for (const item of requested) {
    if (!finalMap.has(item.id)) {
      finalMap.set(item.id, item);
      added.push(item);
    }
  }
  return { final: [...finalMap.values()], added, removed: [] };
}

/** Organizer listings fetched once for a whole batch, so per-recipe updates skip listing them again. */
export interface SharedTaxonomyListings {
  categories?: TaxonomyItem[];
  tags?: TaxonomyItem[];
}

export interface TaxonomyPatchOutcome {
  patchFields: Record<string, unknown>;
  categories?: TaxonomyCollectionResult;
  tags?: TaxonomyCollectionResult;
}

/**
 * Resolves requested categories/tags against a recipe already fetched from the API and
 * builds the partial PATCH payload fragment for the changed collection(s). Does not perform
 * any recipe update itself, so callers can merge the fragment into a larger PATCH body.
 */
export async function buildTaxonomyPatch(
  currentRecipe: Record<string, unknown>,
  input: TaxonomyUpdateInput,
  shared?: SharedTaxonomyListings,
): Promise<TaxonomyPatchOutcome> {
  const mode = input.mode ?? 'merge';
  const createMissing = input.createMissing ?? false;
  const patchFields: Record<string, unknown> = {};
  const outcome: TaxonomyPatchOutcome = { patchFields };

  if (input.categories !== undefined) {
    const current = toTaxonomyItems(currentRecipe.recipeCategory);
    const all = shared?.categories ?? (await getAllCategories());
    const { resolved, created, missing } = await resolveTaxonomyValues(
      input.categories,
      all,
      createMissing,
      categoriesApi.createCategory,
    );
    if (missing.length > 0) {
      throw new MissingTaxonomyItemsError('category', missing);
    }
    const { final, added, removed } = computeFinal(mode, current, resolved);
    outcome.categories = { final, added, removed, created };
    patchFields.recipeCategory = final.map(toApiPayloadItem);
  }

  if (input.tags !== undefined) {
    const current = toTaxonomyItems(currentRecipe.tags);
    const all = shared?.tags ?? (await getAllTags());
    const { resolved, created, missing } = await resolveTaxonomyValues(
      input.tags,
      all,
      createMissing,
      tagsApi.createTag,
    );
    if (missing.length > 0) {
      throw new MissingTaxonomyItemsError('tag', missing);
    }
    const { final, added, removed } = computeFinal(mode, current, resolved);
    outcome.tags = { final, added, removed, created };
    patchFields.tags = final.map(toApiPayloadItem);
  }

  return outcome;
}

/**
 * Fetches the current recipe, resolves the requested categories/tags, and applies the
 * change via a single PATCH request that only touches the recipeCategory/tags fields.
 * All other recipe fields (ingredients, instructions, nutrition, settings, etc.) are
 * left untouched because Mealie's PATCH endpoint merges only the fields present in the
 * request body into the existing recipe.
 */
export async function updateRecipeTaxonomy(
  slug: string,
  input: TaxonomyUpdateInput,
  shared?: SharedTaxonomyListings,
): Promise<RecipeTaxonomyResult> {
  const recipe = await recipesApi.getRecipe(slug);
  const outcome = await buildTaxonomyPatch(recipe, input, shared);

  if (Object.keys(outcome.patchFields).length > 0) {
    await recipesApi.patchRecipe(slug, outcome.patchFields);
  }

  return {
    id: String(recipe.id),
    slug: typeof recipe.slug === 'string' ? recipe.slug : slug,
    categories: outcome.categories,
    tags: outcome.tags,
  };
}

const BATCH_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

interface KindPlan {
  /** Organizers as listed, plus those created for the batch. */
  listing?: TaxonomyItem[];
  /** Organizers as listed, before the batch created any. */
  existing?: TaxonomyItem[];
  listingError?: Error;
  createErrors: Map<string, Error>;
  /** Organizers created for the batch, in creation order. */
  created: TaxonomyItem[];
}

interface KindRequest {
  values: string[];
  createMissing: boolean;
}

/**
 * Lists the organizers of one kind once and creates every value that createMissing updates
 * need and that does not exist yet, one at a time. Failures are recorded per value so only
 * the updates that need that value fail.
 */
async function prepareKind(
  requests: KindRequest[],
  getAll: () => Promise<TaxonomyItem[]>,
  createFn: (name: string) => Promise<Record<string, unknown>>,
): Promise<KindPlan | undefined> {
  if (requests.length === 0) return undefined;

  const plan: KindPlan = { createErrors: new Map(), created: [] };
  try {
    plan.listing = await getAll();
    plan.existing = [...plan.listing];
  } catch (error) {
    plan.listingError = toError(error);
    return plan;
  }

  const lookup = createLookup(plan.listing);
  for (const request of requests) {
    if (!request.createMissing) continue;
    for (const raw of request.values) {
      const value = raw.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (lookup.find(key) || plan.createErrors.has(key)) continue;
      try {
        const item = toTaxonomyItem(await createFn(value));
        lookup.add(item, key);
        plan.listing.push(item);
        plan.created.push(item);
      } catch (error) {
        plan.createErrors.set(key, toError(error));
      }
    }
  }
  return plan;
}

function assertKindUsable(
  plan: KindPlan | undefined,
  update: RecipeTaxonomyBatchUpdate,
  values: string[] | undefined,
): void {
  if (!plan || values === undefined) return;
  if (plan.listingError) throw plan.listingError;
  if (!update.createMissing) return;
  for (const raw of values) {
    const error = plan.createErrors.get(raw.trim().toLowerCase());
    if (error) throw error;
  }
}

/**
 * Applies several taxonomy updates with bounded concurrency. Organizers are listed once per
 * kind and missing ones are created up front, so concurrent recipes that need the same new
 * organizer cannot race to create it. Each created organizer is reported on the first successful
 * update that ends up using it.
 */
export async function updateRecipeTaxonomyBatch(
  updates: RecipeTaxonomyBatchUpdate[],
): Promise<RecipeTaxonomyBatchResult[]> {
  const requestsFor = (pick: (update: RecipeTaxonomyBatchUpdate) => string[] | undefined): KindRequest[] =>
    updates.flatMap((update) => {
      const values = pick(update);
      return values === undefined ? [] : [{ values, createMissing: update.createMissing ?? false }];
    });

  const categoryPlan = await prepareKind(
    requestsFor((update) => update.categories),
    getAllCategories,
    categoriesApi.createCategory,
  );
  const tagPlan = await prepareKind(
    requestsFor((update) => update.tags),
    getAllTags,
    tagsApi.createTag,
  );

  const results = await mapWithConcurrency(updates, BATCH_CONCURRENCY, async (update) => {
    try {
      assertKindUsable(categoryPlan, update, update.categories);
      assertKindUsable(tagPlan, update, update.tags);
      // Updates without createMissing must not resolve values another update created.
      const pick = (plan: KindPlan | undefined) => (update.createMissing ? plan?.listing : plan?.existing);
      const result = await updateRecipeTaxonomy(update.slug, update, {
        categories: pick(categoryPlan),
        tags: pick(tagPlan),
      });
      if (result.categories) result.categories.created = [];
      if (result.tags) result.tags.created = [];
      return { success: true as const, ...result };
    } catch (error) {
      return {
        slug: update.slug,
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  reportCreated(results, 'categories', categoryPlan?.created ?? []);
  reportCreated(results, 'tags', tagPlan?.created ?? []);
  return results;
}

/** Lists each created organizer on the first successful result that ended up using it. */
function reportCreated(
  results: RecipeTaxonomyBatchResult[],
  kind: 'categories' | 'tags',
  created: TaxonomyItem[],
): void {
  for (const item of created) {
    for (const result of results) {
      const collection = result.success ? result[kind] : undefined;
      if (collection?.final.some((final) => final.id === item.id)) {
        collection.created.push(item);
        break;
      }
    }
  }
}
