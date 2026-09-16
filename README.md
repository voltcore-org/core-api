# STALE STUB — DO NOT DEPLOY

This repository is a **leftover** from 2026-09-02 (`02a9f83`).
It is **not** the VoltCore Dual-Rail trunk.

On 2026-09-16 a README-only push here triggered a Cloudflare Git deploy because `wrangler.toml` used `name = "core-api"`. That **overwrote** the production Worker at `core-api.dominic-calandro1991.workers.dev`. The Worker name in this stub is now `core-api-stale-stub-do-not-deploy` so it cannot collide again. Restore is `workflow_dispatch` of [`dominiccalandro1991-byte/core-api` Deploy Worker](https://github.com/dominiccalandro1991-byte/core-api/actions).

## Source of truth

| Surface | Value |
|---|---|
| Production Worker | `https://core-api.dominic-calandro1991.workers.dev` |
| Canonical repo | [`dominiccalandro1991-byte/core-api`](https://github.com/dominiccalandro1991-byte/core-api) |
| Live SHA | `433928b3da5fac73a62089dbf1e187410526c066` |
| Lattice ceiling | 31 (`LATTICE`, not the 10-key heal subset `FLEET`) |
| Cron | Cloudflare `[triggers] crons = ["* * * * *"]` in the **personal** repo only |

## Agent rules

1. Do **not** `wrangler deploy` from `voltcore-org/core-api`.
2. Do **not** copy this stub over the personal trunk.
3. Do **not** add `voltcore-heartbeat.yml` minute crons. Heartbeats are Worker `pollFleet`.
4. Dual-Rail (`heal.js` / `inference.js` / `dual-rail.js`) lives only in the personal trunk.
5. Disconnect any Cloudflare Git integration on this org repo. `name` must never be `core-api`.
6. To retire this namespace, **archive** the GitHub repo.

Phosphor: `https://voltcore-phosphor.vercel.app`
