# Install the preview on an ARM64 Mac

This archive builds a native arm64 stack. It does not install itself, push an image, or change any other app. In particular it does not touch:

- https://vitavus.vercel.app or that Vercel project
- Acreline, or anything bound to 127.0.0.1:4173
- the older Common Voice preview on 127.0.0.1:4184
- host ports 8011, 27017, or 6379

## Check the archive

```bash
shasum -a 256 common-voice-vitavus-preview-runtime.tar.gz
```

Compare the digest with `common-voice-vitavus-preview-runtime.tar.gz.sha256` from the same delivery.

## Start

```bash
tar -xzf common-voice-vitavus-preview-runtime.tar.gz
cd common-voice-vitavus-preview-runtime
cp .env.example .env
# Replace both placeholder secrets. Use letters and digits so the database URL stays valid.
openssl rand -hex 24
docker compose up --build
```

Then open http://127.0.0.1:4185 on that Mac. The compose file publishes `127.0.0.1:4185:4185` only. Postgres and the API have no host ports.

Password reset and email verification stay unavailable until `SMTP_HOST` is set. Account deletion removes that person's posts, listings, reports, and uploaded files. Malware scanning stays off until `CLAMAV_HOST` is set. `scripts/backup.sh` and `scripts/restore.sh` copy the database and media directory when you run them. They are not scheduled.

For a public host, use `docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build`. That sets secure cookies, `PUBLIC_BASE_URL=https://spekup.com`, and a Caddy proxy. The API image refuses placeholder secrets when `NODE_ENV=production`. The loopback preview command is unchanged.

Reports, Polls, Marketplace, Events, and Groups use that same three-column page. On a phone, Polls, Events, and Groups are in More.

Help at `/help` uses that same three-column page for asks, offers, and causes. A phone stacks the tabs and hides the side column.

Social at `/` is a three-column page on a wide screen: section tabs, the composer and cards, then gatherings, topics, and groups that exist. A phone stacks the tabs and hides the side column. The name, speech-bubble mark, and colors stay Spekup.

The interface can be English, Brazilian Portuguese, Spanish, Japanese, Korean, or Simplified Chinese. The choice is saved on the account and in this browser. Post text, comments, listings, reports, polls, groups, events, and messages can show a translation only when a provider is configured. With nothing set, that button stays hidden and no text is sent anywhere.

To turn on LibreTranslate later, keep the existing `.env` and add:

```bash
TRANSLATE_PROVIDER=libretranslate
TRANSLATE_URL=http://libretranslate:5000
TRANSLATE_API_KEY=
```

Then start the optional service. It is not part of the default preview:

```bash
docker compose -f docker-compose.yml -f docker-compose.translate.yml --profile translate up --build
```

On a public host, the same service is in `docker-compose.prod.yml` under the `translate` profile:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile translate up --build
```

For an OpenAI-compatible endpoint instead, set `TRANSLATE_PROVIDER=openai-compatible`, `TRANSLATE_URL` to the API root such as `https://api.openai.com/v1`, `TRANSLATE_API_KEY`, and `TRANSLATE_MODEL`. Leave all of these unset to keep translation off.

The product name is Spekup. The compose project is still `common-voice-vitavus-preview`. Its volumes are `common-voice-vitavus-preview_pgdata` and `common-voice-vitavus-preview_media`. An existing `.env` keeps working. `PUBLIC_BASE_URL` defaults to `http://127.0.0.1:4185` when it is absent. Set `PUBLIC_BASE_URL=https://spekup.com` only for a public host, then rebuild the web image.

The first start compiles the web and API images for linux/arm64 and applies the SQL migration. No sample neighbors are inserted. Create an account from the Log in / Create account screen.

## Upgrade an existing preview

Use the same directory, the same `.env`, and the same compose project. Do not delete the volumes.

```bash
cd /Users/snipertrader/common-voice-vitavus-preview-runtime
# replace the files with this archive, keeping .env
docker compose up --build
```

The API applies migrations `002` through `009_digital_goods.sql` in order. All of them are additive. No sample causes, clips, or products are inserted. Existing accounts, posts, listings, photos, clips, groups, gatherings, playbooks, reports, polls, and follows stay where they are. Existing offers become `available`. The media volume is the same `common-voice-vitavus-preview_media` volume. New clip files are stored beside the old photos, under `private/` and `ready/`. Report attachments use the same private media files and are not served from the public photo route.

No sample allegations or polls are inserted. The reports list stays empty until someone submits one, and a submission stays private until a moderator publishes it. This upgrade does not grant a moderator and does not publish anything that was waiting.

## Grant a moderator

The first account is not a moderator. Profile edit cannot grant the role. Nothing is auto-published for a demo.

After the stack is up, and after that person has created an account:

```bash
docker compose exec api node dist/grant-moderator.js their_handle
```

The command prints the handle only. It does not print the email or the database error. To remove the role later, update `users.is_moderator` in the database yourself. There is no public form for that.

## Map tiles

The reports map loads tiles from `https://tile.openstreetmap.org` and shows the OpenStreetMap copyright. The Mac needs to reach that host. This archive does not proxy tiles, does not call a geocoder, and does not use Google. If the tiles fail, the report list still works.

## Roll back the app without deleting data

Stop the new containers and start the previous archive again with the same `.env` and the same compose project name. Do not run `docker compose down -v`. The previous app ignores the new columns and `post_images`. Accounts, posts, photos, clips, groups, gatherings, reports, polls, and causes remain. There is no automatic down migration, because dropping those columns would delete listing details. The archive this replaces is `797466024e0a133f4e04f661935328172f030f51cb06801bd3404cb25a9437bb` (Social feed). Digital files are `fe8134660ca2b25595ff1a8d39912afaf98419a2d42cc1f4a14988f6d7a70567`. Studio is `dd039bbcfda103c976723c9165bc87c21b277b82059b1931972653dcf95f4855`. The Mac install before those is `bddc1d622ccbb0c542ee8ca84b47af444e6180aa8c26583dfe4862aff8857688`. Rolling back keeps every row. This version adds no migration. `/studio/:id` and `/shop/new` still open the saved project or the digital draft. Do not run `docker compose down -v`. Paid files stay private because no payment provider is connected. Watch counting starts off.

## Stop and reset

```bash
docker compose stop          # keep accounts and photos
docker compose down          # remove containers, keep volumes
docker compose down -v       # delete the preview database and photos
```

Use only `docker-compose.yml` from this archive. `scripts/dev-amd64.override.yml` in the source repo is for an x86 verification machine and is not the Mac install.

## What the containers need

- Docker with Compose v2
- Outbound network during `docker compose build` (npm and the font files Next downloads at build time)
- About the disk for two Node images plus Postgres

No registry login is required. Base images are `node:22-bookworm-slim` and `postgres:16-alpine`.
