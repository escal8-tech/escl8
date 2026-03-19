# Release Environments

`feature/*` branches are development work. `staging` is the shared pre-production branch. `main` is production.

## Branch flow

1. Build and test on a feature branch.
2. Open a PR into `staging`.
3. Let GitHub Actions build the `staging` image using the `staging` GitHub environment values.
4. Deploy that image to the staging agent dashboard and point it at staging databases.
5. Merge `staging` into `main` only after staging is validated.
6. Let GitHub Actions build the production image using the `production` GitHub environment values.

## GitHub environments

Create two GitHub environments:

- `staging`
- `production`

Set the same key names in both environments, but with environment-specific values.

### Build-time values

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`
- `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_RELEASE`
- `NEXT_PUBLIC_SENTRY_ENABLE_LOGS`
- `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_ENVIRONMENT`
- `NEXT_PUBLIC_GRAFANA_BROWSER_LOGS_ENABLED`

Notes:

- `NEXT_PUBLIC_SENTRY_RELEASE` should be set automatically to the commit SHA by CI.
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are Sentry build settings for source-map upload, not client/business slugs.

### Runtime Azure values

- `DATABASE_URL`
- `CONTROL_PLANE_DATABASE_URL`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_ENABLE_LOGS`
- `SENTRY_TRACES_SAMPLE_RATE`
- `SENTRY_MIN_LOG_LEVEL`
- `OTEL_SERVICE_NAME`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_PROTOCOL`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `OTEL_RESOURCE_ATTRIBUTES`
- `OTEL_TRACES_EXPORTER`
- `OTEL_NODE_RESOURCE_DETECTORS`
- `GRAFANA_LOGS_ENDPOINT`
- `GRAFANA_LOGS_USER`
- `GRAFANA_LOGS_API_KEY`
- all existing WhatsApp, OpenAI, Pinecone, PubSub, and Storage env vars

## Database separation

Do not reuse production databases in staging.

- `DATABASE_URL`: use `agent_staging` for local development and the staging app.
- `CONTROL_PLANE_DATABASE_URL`: use `control_staging` for local development and the staging app.
- `main`/production must point only at production databases.

## Sentry separation

The browser bundle uses build-time values. That means `NEXT_PUBLIC_SENTRY_DSN` and the `SENTRY_ENVIRONMENT` label used during the build must come from the GitHub environment for that branch.

- `staging`: use the staging agent dashboard Sentry project or a staging environment label.
- `production`: use the production agent dashboard Sentry project or a production environment label.

## Health endpoints

Deploy probes against these routes:

- `/api/health`: liveness only
- `/api/ready`: readiness, including app + database checks

Use `/api/ready` for readiness gating before sending traffic to a revision.

## Grafana separation

Keep staging and production in separate Grafana environments, stacks, or at minimum separate `OTEL_RESOURCE_ATTRIBUTES`.

- `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` control trace export.
- `GRAFANA_LOGS_ENDPOINT`, `GRAFANA_LOGS_USER`, and `GRAFANA_LOGS_API_KEY` control Loki log export.
- Browser logs stay off by default. Only enable `NEXT_PUBLIC_GRAFANA_BROWSER_LOGS_ENABLED=true` once server-side Grafana log forwarding is already working.
