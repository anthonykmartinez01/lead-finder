// Cloudflare Pages route for /api/leads. The logic lives in the Netlify
// function so both hosts run the same code; see lib/netlify-env.ts.
import handler from "../../netlify/functions/leads/index.mts";
import { useNetlifyEnv } from "../../lib/netlify-env";

export const onRequest = (ctx: { request: Request; env: Record<string, unknown> }) => {
  useNetlifyEnv(ctx.env);
  return handler(ctx.request, {} as never);
};
