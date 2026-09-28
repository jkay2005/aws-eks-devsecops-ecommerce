# Phase 1 Dockerization

## Local architecture

Backend Express runs in a Docker container.
PostgreSQL runs in a separate container.
The backend connects to db:5432.
PostgreSQL data is stored in a named volume.
The backend is accessible at http://localhost:3000.

## Image references

Node base image: node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
PostgreSQL image: postgres@sha256:1a6ab3f5345eb6dbe04a1349529caabdb0ab09293a09590fad07b2246bfa4b54
Backend image tag: ecommerce-backend:sha-4ef943d52f13

## Verification results

| Check                       | Expected                      | Actual                                                          |
| --------------------------- | ----------------------------- | --------------------------------------------------------------- |
| Backend and database health | Healthy                       | PASS — both services healthy                                    |
| Products API                | HTTP 200                      | PASS — HTTP 200, 15 products returned                           |
| Seed data                   | 5 categories, 15 products     | PASS — 5 categories, 15 products                                |
| Backend user                | Non-root                      | PASS — uid=1000(node)                                           |
| Write to /app               | Rejected                      | PASS — Read-only file system                                    |
| DB stopped                  | Live 200, ready 503           | PASS — live 200, ready 503; backend remains running             |
| DB restored                 | Ready and products return 200 | PASS — ready and products return 200 without restarting backend |
| SIGTERM                     | Clean shutdown, exit 0        | PASS — shutdown completed, exit code 0                          |
| Container recreation        | Marker data retained          | PASS — marker row retained after down/up                        |

## Known limitations

GitHub OAuth and Stripe are disabled in the local configuration.
Database initialization uses the upstream SQL file.
Database migrations and dependency remediation remain follow-up work.

## Runtime versions

- Node.js: v22.23.3
- PostgreSQL: postgres (PostgreSQL) 16.15 (Debian 16.15-1.pgdg13+2)

## Local container images

```text
CONTAINER                    REPOSITORY          TAG                 PLATFORM            IMAGE ID            SIZE                CREATED
ecommerce-phase1-backend-1   ecommerce-backend   sha-4ef943d52f13    linux/amd64         1c08ee7013a3        82.7MB              2 hours ago
ecommerce-phase1-db-1        postgres            <none>              linux/amd64         1a6ab3f5345e        160MB               9 days ago
```
