import { initTRPC } from '@trpc/server';
const t = initTRPC.create();
const cacheMiddleware = t.middleware(async ({ next }) => {
  return { ok: true, data: "cached", marker: "middlewareMarker" as any };
});
