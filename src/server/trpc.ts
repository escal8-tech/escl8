import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import * as Sentry from "@sentry/nextjs";
import superjson from "superjson";
import {
  buildMonitoringAttributes,
  captureSentryException,
  getMonitoringDomainFromPath,
  recordSentryMetric,
} from "@/lib/sentry-monitoring";
import { recordBusinessEvent } from "@/lib/business-monitoring";

export type Context = {
  userEmail?: string | null;
  firebaseUid?: string | null;
  userId?: string | null;
  businessId?: string | null;
};

type AuthedContext = Context & { firebaseUid: string; userEmail: string };
type BusinessContext = AuthedContext & { businessId: string };

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;

function shouldCaptureTrpcCode(code: TRPCError["code"]): boolean {
  return code === "INTERNAL_SERVER_ERROR";
}

const EXPECTED_CONFLICT_PATTERNS = [/already exists/i, /duplicate/i, /slug already/i, /already connected/i];
const EXPECTED_NOT_FOUND_PATTERNS = [/not found/i, /missing .* identity/i];
const EXPECTED_BAD_REQUEST_PATTERNS = [/invalid/i, /missing /i, /required/i, /unsupported/i];
const EXPECTED_FORBIDDEN_PATTERNS = [/unauthorized/i, /forbidden/i, /email mismatch/i, /scope mismatch/i];

type MonitoringErrorClassification = {
  code: TRPCError["code"];
  level: "warning" | "error";
  shouldCapture: boolean;
};

function classifyMonitoringError(error: unknown): MonitoringErrorClassification {
  if (error instanceof TRPCError) {
    return {
      code: error.code,
      level: error.code === "INTERNAL_SERVER_ERROR" ? "error" : "warning",
      shouldCapture: shouldCaptureTrpcCode(error.code),
    };
  }

  const message = error instanceof Error ? error.message : "";

  if (EXPECTED_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(message))) {
    return { code: "FORBIDDEN", level: "warning", shouldCapture: false };
  }
  if (EXPECTED_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(message))) {
    return { code: "NOT_FOUND", level: "warning", shouldCapture: false };
  }
  if (EXPECTED_CONFLICT_PATTERNS.some((pattern) => pattern.test(message))) {
    return { code: "CONFLICT", level: "warning", shouldCapture: false };
  }
  if (EXPECTED_BAD_REQUEST_PATTERNS.some((pattern) => pattern.test(message))) {
    return { code: "BAD_REQUEST", level: "warning", shouldCapture: false };
  }

  return { code: "INTERNAL_SERVER_ERROR", level: "error", shouldCapture: true };
}

const sentryProcedure = t.procedure.use(async (opts) => {
  const procedurePath = opts.path || "unknown";
  const domain = getMonitoringDomainFromPath(procedurePath);
  const inputBusinessId = extractRawBusinessId(await opts.getRawInput());
  const scopedBusinessId = opts.ctx.businessId ?? null;
  const startedAt = Date.now();
  const businessId = inputBusinessId ?? scopedBusinessId;
  const shouldLogMutationSuccess = false;

  return Sentry.startSpan(
    {
      name: `trpc.${opts.type}.${procedurePath}`,
      op: `trpc.${opts.type}`,
      attributes: buildMonitoringAttributes({
        action: procedurePath,
        area: domain,
        trpc_type: opts.type,
      }),
    },
    async () => {
      try {
        const result = await opts.next();
        recordSentryMetric(
          "distribution",
          "escl8.trpc.duration_ms",
          Date.now() - startedAt,
          {
            action: procedurePath,
            area: domain,
            outcome: "ok",
            trpc_type: opts.type,
          },
          "millisecond",
        );
        if (shouldLogMutationSuccess && opts.type === "mutation") {
          recordBusinessEvent({
            event: "trpc.mutation.succeeded",
            action: procedurePath,
            area: domain,
            businessId,
            outcome: "success",
            source: "trpc",
            status: "ok",
            attributes: {
              duration_ms: Date.now() - startedAt,
              trpc_path: procedurePath,
              trpc_type: opts.type,
            },
          });
        }
        return result;
      } catch (error) {
        const classification = classifyMonitoringError(error);
        const code = classification.code;
        const durationMs = Date.now() - startedAt;
        const errorMessage = error instanceof Error ? error.message : String(error);
        recordSentryMetric("count", "escl8.trpc.errors", 1, {
          action: procedurePath,
          area: domain,
          trpc_code: code,
          trpc_type: opts.type,
        });
        recordSentryMetric(
          "distribution",
          "escl8.trpc.duration_ms",
          durationMs,
          {
            action: procedurePath,
            area: domain,
            outcome: "error",
            trpc_code: code,
            trpc_type: opts.type,
          },
          "millisecond",
        );
        recordBusinessEvent({
          event: `trpc.${opts.type}.failed`,
          level: classification.level === "error" ? "error" : "warn",
          action: procedurePath,
          area: domain,
          businessId,
          outcome: classification.shouldCapture ? "unexpected_failure" : "handled_failure",
          source: "trpc",
          status: code,
          attributes: {
            capture_in_sentry: classification.shouldCapture,
            duration_ms: durationMs,
            error_message: errorMessage,
            error_name: error instanceof Error ? error.name : typeof error,
            expected: !classification.shouldCapture,
            trpc_code: code,
            trpc_path: procedurePath,
            trpc_type: opts.type,
          },
        });
        if (classification.shouldCapture) {
          captureSentryException(error, {
            action: procedurePath,
            area: domain,
            contexts: {
              trpc: {
                businessId: scopedBusinessId,
                code,
                inputBusinessId,
                path: procedurePath,
                type: opts.type,
              },
            },
            level: classification.level,
            tags: {
              "escal8.business_id": businessId,
              "trpc.code": code,
              "trpc.path": procedurePath,
              "trpc.type": opts.type,
            },
          });
        }
        throw error;
      }
    },
  );
});

export const publicProcedure = sentryProcedure;

const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.firebaseUid || !ctx.userEmail) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({ ctx: { ...ctx, firebaseUid: ctx.firebaseUid, userEmail: ctx.userEmail } as AuthedContext });
});

const requireBusiness = t.middleware(({ ctx, next }) => {
  if (!ctx.businessId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing businessId" });
  }
  return next({ ctx: { ...ctx, businessId: ctx.businessId } as BusinessContext });
});

export const protectedProcedure = sentryProcedure.use(requireAuth);
export const businessProcedure = protectedProcedure.use(requireBusiness);

function extractRawBusinessId(rawInput: unknown): string | null {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return null;
  const value = (rawInput as Record<string, unknown>).businessId;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
