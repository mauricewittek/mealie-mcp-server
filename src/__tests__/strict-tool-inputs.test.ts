import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllTools } from '../tools/index.js';

let client: Client;
let server: McpServer;
let fetchMock: Mock;

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) };
}

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  server = new McpServer({ name: 't', version: '1.0.0' });
  registerAllTools(server);
  client = new Client({ name: 'c', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
  vi.unstubAllGlobals();
});

describe('strict tool inputs', () => {
  it('rejects an undeclared top-level key on every tool without reaching the API', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      const result = await call(tool.name, { zzUnknownKey: 1 });
      expect(result.isError, tool.name).toBe(true);
      expect(result.content[0].text, tool.name).toContain('zzUnknownKey');
      expect(result.content[0].text, tool.name).toContain(tool.name);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps top-level and nested parameter descriptions in the published schema', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'update_recipe_ingredients')!;
    const props = tool.inputSchema.properties as Record<string, { items?: { properties?: Record<string, { description?: string }>; additionalProperties?: boolean } }>;
    expect(props.ingredients.items?.additionalProperties).toBe(false);
    expect(props.ingredients.items?.properties?.originalText.description).toBeTruthy();
  });

  it('rejects an undeclared key inside update_recipe_ingredients rows', async () => {
    const result = await call('update_recipe_ingredients', {
      slug: 'r',
      ingredients: [{ quantity: 1, note: 'x', referencedRecipeId: 'abc' }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('referencedRecipeId');
    expect(result.content[0].text).toContain('update_recipe_ingredients');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an undeclared key inside a patch_mealplan union variant, and accepts valid variants', async () => {
    const bad = await call('patch_mealplan', {
      actions: [{ action: 'delete', id: 'e1', date: '2026-10-05' }],
    });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('date');
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(ok({}));
    const good = await call('patch_mealplan', { actions: [{ action: 'delete', id: 'e1' }] });
    expect(good.isError).not.toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects an undeclared key inside create_shopping_list_items_bulk items and recipeReferences', async () => {
    for (const item of [
      { shoppingListId: 'l1', note: 'milk', quantiy: 2 },
      { shoppingListId: 'l1', recipeReferences: [{ recipeId: 'r1', scale: 2 }] },
    ]) {
      const result = await call('create_shopping_list_items_bulk', { items: [item] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/quantiy|scale/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still accepts valid calls in every tool family (handler reached, no validation error)', async () => {
    fetchMock.mockResolvedValue(ok({ items: [], total: 0, page: 1, size: 50, slug: 'r', recipeIngredient: [] }));
    const valid: [string, Record<string, unknown>][] = [
      ['get_recipe_concise', { slug: 'r' }],
      ['patch_recipe', { slug: 'r', description: 'd' }],
      ['update_recipe_ingredients', { slug: 'r', ingredients: [{ quantity: 1, note: 'salt' }] }],
      ['get_todays_mealplan', {}],
      ['get_categories', {}],
      ['get_tags', {}],
      ['get_shopping_lists', {}],
      ['create_shopping_list_items_bulk', { items: [{ shoppingListId: 'l1', note: 'milk', quantity: 2, recipeReferences: [{ recipeId: 'r1' }] }] }],
      ['get_foods', {}],
      ['get_units', {}],
    ];
    for (const [name, args] of valid) {
      fetchMock.mockClear();
      const result = await call(name, args);
      expect(result.content[0].text, name).not.toContain('Input validation error');
      expect(fetchMock, name).toHaveBeenCalled();
    }
  });
});
