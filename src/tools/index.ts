import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withStrictInputs } from './strict-schema.js';
import { registerRecipeTools } from './recipes.js';
import { registerMealplanTools } from './mealplans.js';
import { registerCategoryTools } from './categories.js';
import { registerTagTools } from './tags.js';
import { registerShoppingListTools } from './shopping-lists.js';
import { registerFoodTools } from './foods.js';
import { registerUnitTools } from './units.js';
import { registerToolTools } from './tools.js';

export function registerAllTools(rawServer: McpServer): void {
  const server = withStrictInputs(rawServer);
  registerRecipeTools(server);
  registerMealplanTools(server);
  registerCategoryTools(server);
  registerTagTools(server);
  registerShoppingListTools(server);
  registerFoodTools(server);
  registerUnitTools(server);
  registerToolTools(server);
}
