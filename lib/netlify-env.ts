// The handlers in netlify/functions read their secrets through Netlify's global
// `Netlify.env.get()`. Cloudflare Pages passes secrets in as `env` instead.
// Installing this global lets the exact same handler code run on both hosts,
// so Netlify keeps working as a backup without a second copy of the logic.
export function useNetlifyEnv(env: Record<string, unknown>) {
  (globalThis as any).Netlify = {
    env: { get: (key: string) => env[key] as string | undefined },
  };
}
