import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const LEAF_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'literal',
  'enum',
  'unknown',
  'any',
  'null',
  'date',
]);

type SchemaDef = Record<string, unknown> & { type: string };

function defOf(schema: z.ZodType): SchemaDef {
  return (schema as unknown as { _zod: { def: SchemaDef } })._zod.def;
}

/**
 * Returns a copy of `schema` in which every object schema reachable from it is strict
 * (unknown keys are rejected instead of stripped). Zod 4 fixes an object's unknown-key
 * policy when the schema is constructed, so objects cannot be switched in place; each
 * container on the path is cloned with its original checks and description metadata.
 * Open-ended `z.record` / `z.unknown` values stay open on purpose; only object schemas
 * nested inside them become strict. Only the zod types the tools use are handled; any other
 * container type throws at registration instead of silently staying non-strict.
 */
export function strictify<T extends z.ZodType>(schema: T): T {
  const def = defOf(schema);
  const sub = (child: unknown): unknown =>
    child && typeof child === 'object' ? strictify(child as z.ZodType) : child;
  let next: SchemaDef | undefined;

  switch (def.type) {
    case 'object': {
      const shape: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(def.shape as Record<string, unknown>)) {
        shape[key] = sub(field);
      }
      next = { ...def, shape, catchall: def.catchall ?? z.never() };
      break;
    }
    case 'array':
      next = { ...def, element: sub(def.element) };
      break;
    case 'optional':
    case 'nullable':
    case 'default':
      next = { ...def, innerType: sub(def.innerType) };
      break;
    case 'union':
      next = { ...def, options: (def.options as unknown[]).map(sub) };
      break;
    case 'record':
      next = { ...def, valueType: sub(def.valueType) };
      break;
    default:
      if (!LEAF_TYPES.has(def.type)) {
        throw new Error(
          `strictify does not know how to descend into zod type "${def.type}"; add it to strict-schema.ts`,
        );
      }
      return schema;
  }

  const clone = schema.clone(next as never);
  const meta = z.globalRegistry.get(schema);
  if (meta) z.globalRegistry.add(clone, meta);
  return clone;
}

/**
 * Returns a view of `server` whose `tool(name, description, shape, [annotations,] handler)` registers
 * the tool with a strict input object, so an undeclared argument (top level or nested)
 * fails validation with an error result naming the key, and the handler never runs.
 *
 * The MCP SDK wraps a raw `tool()` shape in a non-strict zod object, which silently
 * drops unknown keys. `registerTool` accepts a full schema, so it is used here.
 */
export function withStrictInputs(server: McpServer): McpServer {
  const strictTool = (...args: unknown[]): unknown => {
    const handler = args.at(-1);
    const [name, description, shape] = args;
    const annotations = args.length === 5 ? args[3] : undefined;
    if (
      (args.length !== 4 && args.length !== 5) ||
      typeof name !== 'string' ||
      typeof description !== 'string' ||
      typeof shape !== 'object' ||
      shape === null ||
      (args.length === 5 && (typeof annotations !== 'object' || annotations === null)) ||
      typeof handler !== 'function'
    ) {
      throw new Error(
        `Tool registration must use tool(name, description, shape, [annotations,] handler); got ${String(name)}`,
      );
    }
    const inputSchema = strictify(z.object(shape as z.ZodRawShape));
    return (server.registerTool as (n: string, c: unknown, cb: unknown) => unknown).call(
      server,
      name,
      { description, inputSchema, ...(annotations ? { annotations } : {}) },
      handler,
    );
  };
  return new Proxy(server, {
    get(target, prop) {
      if (prop === 'tool') return strictTool;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
