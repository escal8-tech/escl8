# Billing And Revenue Architecture

The shared billing contract is documented in
`escal8_reservation/docs/BILLING_AND_REVENUE_ARCHITECTURE.md`.

Agent-specific rules:

- Credits exist only in the agent product.
- One credit represents one bot message.
- Monthly allocation comes from `suite_subscription_plans.limits["agent.messages.monthly"]`.
- Agent APIs and pages expose only `agent.*` features and limits.
- Successful recurring payments top up the linked business credit pool and its WhatsApp identities.
- Product access comes only from `suite_tenant_subscriptions`; legacy entitlements do not unlock the portal.
- Checkout buttons send `planCode` directly. SenangPay recurring IDs are resolved from plan metadata.
