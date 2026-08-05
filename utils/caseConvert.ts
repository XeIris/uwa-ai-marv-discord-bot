function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function snakeToCamelJSON(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.assign({}, ...Object.entries(obj).map(([key, value]) => ({ [snakeToCamel(key)]: value })));
}

function camelToSnakeJSON(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.assign({}, ...Object.entries(obj).map(([key, value]) => ({ [camelToSnake(key)]: value })));
}

export {
  camelToSnake,
  snakeToCamel,
  snakeToCamelJSON,
  camelToSnakeJSON,
};
