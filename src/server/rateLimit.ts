type RateLimitConfig = {
  /** A short name for the bucket (e.g. "trpc", "upload") */
  name: string;
  /** Max requests allowed in the window */
  max: number;
  /** Window duration in ms */
  windowMs: number;
};

type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  headers: Record<string, string>;
};

type Bucket = {
  count: number;
  resetAtMs: number;
};

// In-memory fixed-window limiter.
// NOTE: This is per-process. In multi-instance/serverless deployments you should
// also enforce rate limits at the edge (Azure Front Door/APIM) or use a shared store (Redis).
const buckets = new Map<string, Bucket>();
let opsSinceSweep = 0;

function nowMs() {
  return Date.now();
}

function sweepExpired(now: number) {
  // keep this cheap
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAtMs <= now) buckets.delete(key);
  }
}

export function getClientIp(req: Request): string {
  // Prefer standard proxy headers.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // x-forwarded-for can be a comma-separated list. Take the first public-facing hop.
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  // Some platforms use these.
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  // Fallback.
  return "unknown";
}

export function checkRateLimit(req: Request, cfg: RateLimitConfig): RateLimitResult {
  const now = nowMs();

  opsSinceSweep++;
  if (opsSinceSweep >= 500) {
    opsSinceSweep = 0;
    // Opportunistic cleanup.
    sweepExpired(now);
  }

  const ip = getClientIp(req);
  const key = `${cfg.name}:${ip}`;

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAtMs <= now) {
    bucket = {
      count: 0,
      resetAtMs: now + cfg.windowMs,
    };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  const ok = bucket.count <= cfg.max;
  const remaining = Math.max(0, cfg.max - bucket.count);

  const headers: Record<string, string> = {
    // Non-standard but widely used.
    "x-ratelimit-limit": String(cfg.max),
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(Math.ceil(bucket.resetAtMs / 1000)),
  };

  return {
    ok,
    limit: cfg.max,
    remaining,
    resetAtMs: bucket.resetAtMs,
    headers,
  };
}
