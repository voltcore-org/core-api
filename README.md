# STALE STUB — DO NOT DEPLOY

This repository is a **3-file leftover** (`index.ts`, `package.json`, `wrangler.toml`) from 2026-09-02 (`02a9f83`).
It is **not** the VoltCore Dual-Rail trunk.

## Source of truth

| Surface | Value |
|---|---|
| Production Worker | `https://core-api.dominic-calandro1991.workers.dev` |
| Canonical repo | [`dominiccalandro1991-byte/core-api`](https://github.com/dominiccalandro1991-byte/core-api) |
| Live SHA | `433928b3da5fac73a62089dbf1e187410526c066` |
| Lattice ceiling | 31 (`LATTICE`, not the 10-key heal subset `FLEET`) |
| Cron | Cloudflare `[triggers] crons = ["* * * * *"]` in the personal repo |

## Agent rules

1. Do **not** `wrangler deploy` from `voltcore-org/core-api`.
2. Do **not** copy this stub over the personal trunk.
3. Do **not** add `voltcore-heartbeat.yml` minute crons here or elsewhere. Heartbeats are Worker `pollFleet`.
4. Dual-Rail (`heal.js` / `inference.js` / `dual-rail.js`) lives only in the personal trunk.
5. If this repo must exist for the org namespace, keep it as this tombstone. To retire it, archive the GitHub repo instead of deleting history in place.

Phosphor command center: `https://voltcore-phosphor.vercel.app`
