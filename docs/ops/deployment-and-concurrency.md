# Agent Dashboard Deployment and Concurrency

## Azure Container Apps

| Runtime | ACA name | Image | Ingress | Workflow |
| --- | --- | --- | --- | --- |
| Dashboard/web API | `escal8-agent-dashboard` | `escal8-agent:<sha>` | External, port 3000 | `.github/workflows/deploy.yml` |
| RAG worker | `escal8-agent-worker` | `escal8-agent-worker:<sha>` | None | `.github/workflows/deploy.yml` |
| Request rollover job | `escal8-agent-request-rollover-job` | `escal8-agent-job:<sha>` | Scheduled job | `.github/workflows/deploy.yml` |

`main` and `staging` pushes build immutable SHA images. Automatic ACA deployment is intentionally tied to `main` build completions only because staging ACA apps are currently not hosted.

## Current Capacity Contract

| Area | Current source | Current value |
| --- | --- | --- |
| Web replicas | deploy workflow | min 1, max 3 |
| Worker replicas | deploy workflow | min 1, max 3 |
| RAG worker concurrency | `scripts/rag-worker.ts` | `RAG_WORKER_CONCURRENCY`, default 5 |
| App DB pool | `src/server/db/client.ts` | `DB_POOL_MAX`, default 8 |
| Control DB pool | `src/server/control/db.ts` | `CONTROL_DB_POOL_MAX`, default 4 |
| Agent DB pool helper | `src/lib/db.ts` | `AGENT_DB_POOL_MAX`, default 2 |
| Redis mode | `src/lib/redis.ts` | cluster auto-detects host/password config |
| Rollover job schedule | deploy workflow | hourly |

## Guardrails

- Keep total Postgres connections under the database limit across web replicas, worker replicas, and jobs.
- Do not raise `RAG_WORKER_CONCURRENCY` without validating OpenAI/Pinecone rate limits, DB pool usage, memory, and queue visibility timeout.
- Inventory refresh must stay transactional and child-row-safe before deleting `commerce_products`.
- Redis-backed rate limiting/cache must use cluster mode for Azure clustered Redis. Do not reintroduce single-node clients for shared production Redis.
- Staging branch should continue building images even without hosted staging ACA apps, so image creation stays tested.

## Next Enterprise Phase

Add a non-blocking capacity report in the deploy workflow that calculates:

- `max_web_db_connections = web_max_replicas * DB_POOL_MAX`
- `max_worker_db_connections = worker_max_replicas * DB_POOL_MAX`
- `max_rag_jobs = worker_max_replicas * RAG_WORKER_CONCURRENCY`
- expected Redis client mode

After real database and API limits are documented, convert unsafe budgets to blocking checks.
