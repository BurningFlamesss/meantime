# Verifying a MeanTime deployment

The stack is small enough to check by hand in a few minutes. Each section lists
the command and the answer that means "working".

Anything marked **needs Docker** is part of `docker-compose.yml` and cannot be
checked on a machine without a Docker daemon.

## 1. Postgres

```bash
docker compose up -d postgres          # needs Docker
pnpm db:migrate                        # applies apps/api/drizzle
pnpm db:seed                           # demo advertiser + 2 campaigns
```

Expected: `Migrations applied.` then `Seeded demo advertiser and 2 campaigns.`
(repeated seed runs print `Seed already applied.`).

Sanity query:

```bash
psql "$DATABASE_URL" -c 'select count(*) from campaigns;'
```

## 2. Redis (optional)

```bash
docker compose up -d redis             # needs Docker
redis-cli ping                         # PONG
```

The API works without Redis: lease single-use enforcement is a conditional
`UPDATE` in Postgres, and the helper falls back to the DB. A missing Redis must
never change a payment outcome.

## 3. Object storage (task-proof storage)

Compose runs Adobe's `s3mock`, which implements the S3 subset the API uses.
MinIO's community images are no longer published (`docker.io/minio/minio` says
the repository does not exist; `quay.io/minio/minio` answers 401), so the local
stack no longer depends on them.

```bash
docker compose up -d s3mock            # needs Docker
curl -s http://localhost:9000/ | head -c 200
```

Expected: an S3 `ListAllMyBucketsResult` XML listing a `meantime` bucket, which
is created on boot from `COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS`. Any
credentials work; the values in `apps/api/.env.example` just satisfy the SDK.

The image ships no shell, so it has no healthcheck; `docker compose ps` reports
it as `Up` without a health column.

Task proofs are validated at submit time (object exists, PNG/JPEG/WebP, ≤5 MB),
so a misconfigured bucket shows up as `proof_storage_unavailable` on
`POST /tasks/submit`. A full check is one presigned `PUT`, then a submit:

```bash
KEY=$(curl -s -X POST http://localhost:3001/tasks/presign \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"contentType":"image/png"}')
# PUT the returned uploadUrl, then POST /tasks/submit with the returned key.
```

## 4. Laya classifier

Docker path (**needs Docker**, first build is a ~10 GB PyTorch CPU image and the
first run downloads the English checkpoint):

```bash
docker compose up -d laya
curl -s http://127.0.0.1:8000/health
```

No Docker path:

```bash
./infra/laya-host.sh
curl -s http://127.0.0.1:8000/health
```

Expected: `{"status":"ok","loaded":["english"],...}`. The first request after a
cold start can take a few seconds; the API's classifier timeout is 4s, so a
cold model fails closed to `needs_review` rather than approving anything.

Offline loop: `docker compose --profile stub up -d` (or
`node infra/laya-stub/server.mjs`) and set `LAYA_ENDPOINT=http://localhost:8080`.
The stub answers the same protocol but is **not** a model.

## 5. API

```bash
pnpm --filter @meantime/api dev         # or: node apps/api/dist/index.js
curl -s http://localhost:3001/health   # {"ok":true,"service":"meantime-api"}
```

Full surface check:

```bash
ADMIN_API_KEY=... pnpm smoke
```

`scripts/smoke.mjs` covers advertiser register/login/refresh/logout, token
scoping, campaign creation through moderation, a verified 5-second view paying
55%, and referral attribution plus vesting. It exits non-zero on the first
failing group and prints a pass count.

Referral attribution requires two distinct client IPs, because a signup that
shares the referrer's IP is refused as a self-referral. On one machine the
script binds a different loopback source address for the referred user
(`SMOKE_LOCAL_ADDRESS`, default `127.0.0.2`), so the API sees a genuinely
different origin. A plain request to `127.0.0.2` is not enough: the kernel still
picks `127.0.0.1` as the source, which is why the script sets `localAddress`.
This exercises the real rule instead of disabling it.

## 6. Web app

```bash
pnpm --filter @meantime/web dev         # http://localhost:3000
pnpm --filter @meantime/web build && pnpm --filter @meantime/web start
```

Check: `/` 200, `/sign-up` renders and creates an account, `/sign-in` restores
it, `/dashboard` shows the balance, `/r/<code>` redirects to
`/sign-up?ref=<code>`, and `/advertiser` asks for advertiser credentials before
showing campaign tools.

## 7. Extension

```bash
pnpm --filter @meantime/extension exec wxt prepare
pnpm --filter @meantime/extension build
```

Load `apps/extension/.output/chrome-mv3` unpacked, click the toolbar icon, and
create an account in the popup. Submit a prompt on a supported AI site: one
labelled ad appears under the prompt, the 5-second progress bar completes, and
the balance increases. Signing out clears the cache and stops ads.

## 8. Money invariants

```bash
psql "$DATABASE_URL" -c \
  "select txn_id from ledger_entries group by txn_id having sum(amount_micro) <> 0;"
```

Expected: zero rows. Every credit has a matching debit, so a non-empty result is
a bug. Balances are sums over `ledger_entries`, never mutable columns. Check the
real column name with `\d ledger_entries` first; the query only needs the
transaction key and the signed amount.

## 9. Privacy invariants

```bash
psql "$DATABASE_URL" -c 'select count(*) from impressions where geo_cluster is null;'
```

Expected: `0` — impressions store only a coarse cluster. Raw IPs are not stored
for impressions, clicks, or telemetry. One legacy exception remains
(`users.signup_ip`, tracked as T-07 in `TASKS.md`).
