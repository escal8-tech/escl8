# Escal8 Agent Dashboard Rules

Read `docs/BILLING_AND_REVENUE_ARCHITECTURE.md` before changing subscriptions,
credits, plans, SenangPay callbacks, access guards, or revenue reporting.

- Credits are agent-only and one credit equals one bot message.
- The control database is the subscription source of truth.
- No active subscription means the portal is blocked.
- Partner/demo access requires an explicit subscription row.
- Do not restore legacy entitlement bypasses.
- Do not query control-schema columns that are not defined in
  `src/server/control/schema.ts`.
