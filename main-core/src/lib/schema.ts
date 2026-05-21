import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function schema(zodSchema: z.ZodTypeAny) {
  return {
    schema: {
      // `as any` avoids the TS version mismatch; JSON Schema output is correct at runtime
      body: zodToJsonSchema(zodSchema as any, { target: "openApi3" }),
    },
  };
}
