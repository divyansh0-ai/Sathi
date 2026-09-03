export interface JSONSchema {
  type: "object";
  properties: Record<string, PropSchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface PropSchema {
  type: "string" | "number" | "integer" | "boolean";
  description?: string;
  enum?: string[];
  default?: unknown;
}

export class ToolInputError extends Error {}

/**
 * Deliberately small: enough to give an agent a useful error message without
 * pulling in a full JSON Schema implementation.
 */
export function validate(schema: JSONSchema, input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ToolInputError("arguments must be an object");
  }
  const args = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      throw new ToolInputError(`missing required argument "${key}"`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop) continue; // ignore unknown keys rather than failing the call
    if (value === undefined || value === null) continue;

    if (prop.type === "string") {
      if (typeof value !== "string") throw new ToolInputError(`"${key}" must be a string`);
      if (prop.enum && !prop.enum.includes(value)) {
        throw new ToolInputError(`"${key}" must be one of: ${prop.enum.join(", ")}`);
      }
    } else if (prop.type === "number" || prop.type === "integer") {
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || Number.isNaN(n)) throw new ToolInputError(`"${key}" must be a number`);
      out[key] = prop.type === "integer" ? Math.trunc(n) : n;
      continue;
    } else if (prop.type === "boolean") {
      if (typeof value !== "boolean") throw new ToolInputError(`"${key}" must be a boolean`);
    }
    out[key] = value;
  }

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (out[key] === undefined && prop.default !== undefined) out[key] = prop.default;
  }

  return out;
}
