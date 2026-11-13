# Architecture

Spekup is three processes on one Docker network. Only the web process is published, and only on `127.0.0.1:4185`. `PUBLIC_BASE_URL` is the canonical origin (`https://spekup.com` in production). This preview defaults to `http://127.0.0.1:4185`, and an existing `SITE_URL` is used when `PUBLIC_BASE_URL` is unset.

```text
browser
  → web (Next.js + server.mjs) :4185
      → api (Hono) :8080   # not published
          → postgres :5432 # not published
          → media volume
      worker (same image, ffmpeg)  # not published
          → postgres
          → media volume
```

Compose project name: `common-voice-vitavus-preview`.

Volumes: `pgdata` (database) and `media` (reencoded JPEGs). Both are named under that project, so they do not attach to another app’s database or uploads.

The image platforms in `docker-compose.yml` are `linux/arm64` so a build on the ARM64 Mac is native. Official `node:22-bookworm-slim` and `postgres:16-alpine` images publish arm64 builds. Do not load an amd64 image and emulate it.

## Accounts

Passwords are hashed with scrypt (cost 16384, block size 8, parallelization 1) and stored as `scrypt$cost$block$parallel$salt$hash`. The hash is never returned. Login uses the same error text for an unknown email and a wrong password, and still runs scrypt when the email is missing.

Sessions are random 32-byte tokens. The database stores only their SHA-256. The cookie `cv_session` is HttpOnly, SameSite=Lax, and not Secure on this http://127.0.0.1 preview (`COOKIE_SECURE=0`). Logging in creates a new session. Logging out deletes that session. A person can have at most 10 sessions.

State-changing requests need a `x-csrf-token` header equal to the `cv_csrf` cookie. If a session exists, the header must also match the token stored on that session. Signup and login rotate it.

The web proxy sets `x-real-ip` and `x-real-ip-sign` (HMAC-SHA256 with `PROXY_SHARED_SECRET`). The API trusts that address only when the signature matches. The secret stays in `.env`, which is not part of the runtime archive’s filled-in form. Rate limits use that address for signup and login, and the account id after login. Limits are fixed windows in the `rate_limits` table.

JSON bodies are capped at 64 KB. Image uploads are capped at 8 MB plus a small multipart overhead, in both the proxy and the API.

## Posts

One feed holds three kinds:

- **Share** — text, optional photo, optional playbook. No price.
- **Ask** — a request for help. The amount is a fixed dollar string, negotiable, free service, or free advice.
- **Offer** — a listing: local good, digital guide, or service, with the same amount choices.

Fixed amounts are decimal strings (`12`, `12.5`, `12.50`). They are stored as integer cents from 1 to 100,000,000. JSON numbers are rejected so a binary float cannot become the price. The database check matches those rules.

Lenses on the same feed: For You (newest), Following, Groups (explicitly not enabled), and Professionals (authors who set their role to civic professional). Search, topic, kind, and price filters are query parameters. The list is the latest 50 rows, not a ranked feed.

Edit and delete apply only to the author. A second person receives 403. Missing or already deleted rows are 404. Extra JSON fields such as `authorId`, `likes`, `verified`, or `evidence` are ignored.

Comments are separate rows. A response to an ask, or an inquiry on a listing, is an `inquiries` row. It is visible to the post’s author and to the person who wrote it. Nothing is emailed or texted.

`POST /api/checkout` and `POST /api/tips` return 501. There is no ledger table. `GET /api/me/account` returns `balance: null` and verification `not_available`.

## Clips

Defaults, checked on upload and again after transcoding:

- MP4 or WebM container, recognized by file bytes and by ffprobe.
- One video track: H.264, VP8, or VP9. At most one audio track: AAC, Opus, or Vorbis.
- Duration measured by ffprobe, from 0.2 seconds through 30 seconds.
- 40 MB maximum. 8 clips a day and 6 uploads an hour per account.
- Frames from 16 to 1920 pixels on a side.

The original is written to `private/<id>.bin` at mode 0600 and is never served. A worker claims one queued row at a time (`FOR UPDATE SKIP LOCKED`), retries up to 3 times, and gives ffmpeg 60 seconds, one thread, and a Docker limit of 1 CPU and 512 MB. The prepared file is H.264 in an MP4, at most 720 pixels wide, with a JPEG poster. Only a `ready` row's `ready/<id>.mp4` and poster are served, and only to someone who can see the post. There is no moderation service. Failures store a short message with filesystem paths removed.

## Groups and gatherings

Public groups can be joined by any account. Private groups show their name until an owner or admin adds someone. Owners and admins edit the group. Only the owner deletes it, changes who can see it, or names an admin. Posts and gatherings in a private group are hidden from everyone else, including the marketplace. Deleting a group removes its posts and gatherings so a private note cannot fall into the public feed.

A gathering stores an absolute `timestamptz` plus the IANA zone used to enter the wall time. The page shows that zone and the viewer's local clock. RSVP is one row per person. A second RSVP does not add another. Cancelled or already started gatherings reject new RSVPs. Nothing is emailed and no calendar file is sent.

## Photos

Accepted signatures: JPEG, PNG, WebP, GIF. Anything else, including a file whose name says `.jpg`, is rejected. An ISO BMFF `ftyp` or WebM/Matroska header is rejected on the still-image route. Short clips use `/api/videos` instead.

Sharp rotates using the orientation tag, resizes the long edge to at most 2048 pixels, and writes a baseline JPEG without metadata. EXIF is not copied back. Animated GIF input is read as a single frame. Input pixel count is capped at 20 million. Each account can store 30 images a day and 20 uploads an hour. Unattached images are visible only to the owner. An image on a live post, or used as an avatar, can be fetched by its id.

## Playbooks

A playbook has a title, objective, a suggested span of 1–52 weeks, and steps. It can link only to an offer written by the same person. The API still returns `reviewStatus: "not_reviewed"`. The nav and composer no longer create playbooks. `/playbooks` lists the rows that already exist. `003_reports.sql` does not delete them.

## Reports

Reports are their own tables, not posts. A public feed query cannot leak a pending allegation by accident.

Statuses are `pending`, `published`, `disputed`, `resolved`, and `withdrawn`. Only `published`, `disputed`, and `resolved` are public. The author can read and list their own pending rows. A moderator reads the pending queue at `/api/moderation/reports`. Everyone else gets 404 on a pending or withdrawn id, including follow.

Publishing requires at least one `http` or `https` source and `users.is_moderator`. The app does not fetch the URL. `javascript:` and URLs with userinfo are rejected. User text is returned as JSON and rendered as text.

Editing a public report stores the previous fields in `report_revisions` and sets the status back to `pending`. Withdrawal sets `withdrawn`. Flags and right-of-reply requests write `report_events`. The public history does not include flag text. No email is sent.

Coordinates are `numeric(6,2)` and must be chosen together. The map route always filters to public rows that have coordinates. A location label that starts like a street number is rejected. `subject_area` is where the named party is based. `location_label` is where the incident is alleged.

Attachments are the author's own images. The bytes are served only from `/api/reports/:id/attachments/:mediaId` to the author or a moderator, with a private cache header. `/api/media` does not serve them unless they are also attached to a public post.

`node dist/grant-moderator.js <handle>` is the operator command. `PATCH /api/me` does not accept `is_moderator`. `GET /api/reports/moderation-status` returns only whether any moderator exists. It does not name the account. The reports page says that nothing is auto-published only when that flag is false.

## Polls

A poll is a post with `kind = 'poll'`. It shows up in the composer, the main feed, the profile, and the Polls lens. It is not a report. The price columns stay null. A poll cannot carry a photo, a clip, or a playbook.

The question is the title. The context is the body. There are 2 to 6 options. A subject is politician, corporation, or community, with an optional label the author typed. An optional close time is a wall-clock value plus an IANA zone, stored as an absolute instant. `2027-06-02T18:30` in `America/New_York` is `2027-06-02T22:30:00.000Z`.

`poll_votes` has a primary key of post and user, so one account has one current choice. Changing a vote updates that row. Withdrawing deletes it. The option must belong to the same poll. The poll row is locked during the write. After the close time, an author close, or a cancel, the server rejects new votes and withdrawals. The author cannot edit the question or the options once a vote exists or the poll is no longer open. Close and cancel write `poll_events`. Those rows do not name voters.

Public responses include counts and percents. The denominator is the number of respondents. Zero respondents yields 0%, not an empty number. The author's own fetch does not include other people's choices. `viewerChoice` is set only for the account that is signed in. There is no ballot list route.

A private group's poll uses the same visibility rule as other group posts. An outsider gets 404 for the post, the vote, and the follow. Following a poll is stored in `poll_follows` and is included in the Following feed and the Polls Following filter.

## Causes

A cause is not a post and not a group goal. Group goals remain counts. A cause has a goal in integer USD cents, a category, an optional approximate locality, and a beneficiary display name plus a declaration that the organizer is acting for themselves or is authorized. Street addresses, identity numbers, and bank details are rejected. There is no verified-charity flag.

Statuses are draft, active, paused, completed, and cancelled. Drafts are visible only to the organizer. A private group's cause uses the same membership rule as its posts. Completed and cancelled causes stay in the archive; the editor is closed. The organizer can post updates and change status. History is stored in `cause_events`.

A pledge is one row per person and cause. Changing it updates that row inside a lock so two overlapping saves cannot add together. Withdrawing sets the row aside and removes it from the pledged total. Pledges are allowed only while the cause is active. The public total is the sum of current pledges in that cause's currency. There is no conversion. `collectedCents` is null. Pledge notes and amounts are not returned to anyone except the person who pledged. A public credit is a display name only, and only after an explicit opt-in.

In-kind help, volunteer offers, and sponsor offers are not payments. Accepting a sponsor offer on a cause labels it an accepted offer and records `fundsCollected: 0`. Flags are stored. With no moderator assigned, a flag does not hide the cause.

`GET /api/feed?lens=causes` returns those same visible causes and an empty post list. `lens=for_you` and `lens=following` include visible causes beside posts unless a post filter such as kind, topic, or price is set. Followed causes appear on the Following feed. `lens=help` returns asks and offers only. A cause is never copied into a post, so the two lists do not repeat each other. Drafts are included only for the organizer. Private-group causes stay hidden from non-members. Pledge notes are not selected for the feed.

`GET /api/causes/fee` says the listing fee does not apply and no cause fee is configured. Pledges do not write `financial_records`. Checkout still returns 501.

## Proposed fees

`fee_schedules` version 1 is a proposed preview: 500 basis points of a fixed listing price, rounded down to the cent. Free services, free advice, and any price that is not fixed produce a zero fee. Asks, polls, and reports are not quoted. Processor fees are null.

`GET /api/listings/:id/quote` and the listing card show list price, platform fee, seller net, and buyer total. Buyer total equals the list price in this proposal because the processor amount is unknown and is not invented. `POST /api/listings/:id/interest` stores a quote request only when the schedule version and the cents match the server. A mismatched price, fee, net, or total is rejected. The row is not an order.

## Posting

`/social` and `/clips` post clips. Edit video creates a `studio_projects` row and reuses the render and publish routes. `/studio` and `/studio/:id` render that composer. `/marketplace` posts products. The digital fields call the same `/api/digital/listings` routes. `/shop/new` is the marketplace composer with the digital choice selected. The database tables are unchanged.

## Social

`/social` is the mixed feed. `/clips` is the same page with `video=1`. `GET /api/feed?lens=for_you` stays newest first. Adding `ranking=baseline` uses `social-baseline-1`: 0.55 recency, 0.30 topic, 0.15 substance. With `feed_settings.watch_opt_in` the weights are 0.50, 0.25, 0.15, and 0.10. `lens=creators` is creator follows only, newest first. `lens=following` still includes poll follows. Watch rows live in `watch_daily` for 30 days and are deleted on opt-out, reset, and when a write notices an older day. Hides and mutes apply to the ranked and creator feeds, not to a direct post URL.

## Digital files

A digital guide remains an offer with `listing_kind = digital_guide`. Drafts use `listing_status = draft` and are excluded from feeds, search, profiles, and Studio cards. Preview images are the existing JPEG pipeline plus a focal point. Deliverable bytes live under `deliverables/` and are not served by a public media URL. `GET /api/digital/listings/:id/variants/:variantId/file` checks the account. A paid variant returns 403 even when `payment_settings.gate_open` is true. A free claim writes `library_grants`, not `financial_records`. Replacing a file marks the previous row not current. ZIP files are not extracted. No malware scan is recorded.

## Studio

A studio project is a draft owned by one account. It is not a post. Segments point at that account's uploaded clips. The worker renders one job at a time with a fixed filter graph: trim, one of four speeds, `atempo` for pitch, a volume mix for the original and an optional voiceover, then optional burned-in words from a font on the server. The creator does not supply ffmpeg arguments. The rendered file is a new private original plus a prepared MP4. `POST /api/studio/projects/:id/publish` inserts one share, and a second publish updates that same row. Health or clinical promotions set `held_for_review` and stay out of other people's feeds until `is_moderator` is already true for a reviewer. This install does not grant that role. `publishDue()` in the worker publishes a scheduled project once the stored instant has passed, the render still matches the edit, and any required review is still approved. A project left in `publishing` is picked up again after two minutes.

`GET /api/studio/transcription` returns `connected: false`. `POST /api/studio/transcription` returns 501. There is no provider key in this app.

## Clip posts and product listings

`007_listing_details.sql` adds `item_condition`, `quantity`, `availability`, and `handoff` on `posts`, plus `post_images` for up to six photos in order. Existing offers default to `available`. The first photo is also `posts.media_id`, so older cards still have a cover.

`POST /api/videos` is unchanged: authenticated, 40 MB, 0.2–30 seconds, MP4 or WebM, byte and ffprobe checks, private original. `DELETE /api/videos/:id` removes an upload only when the owner has not attached it to a live post. `POST /api/posts` with `kind: "share"` and `videoId` is the clip. The Clips page posts that itself. It does not reuse the generic composer, so a poll draft cannot become a clip.

`POST /api/posts` with `kind: "offer"` accepts `imageIds`, and for `local_good` a condition, an integer quantity from 0 to 10000, and `handoff` of pickup, delivery, or either. Price is still a decimal string such as `"12.00"`. Negative, non-finite, and non-cent amounts are rejected by the existing parser. Archived listings are omitted from the marketplace and from other people's feeds. The author still sees an archived listing on their own profile. Inquiries require `availability = available`. Checkout, tips, and payments stay 501. The fee schedule is not applied to causes or clips.

`payment_settings.gate_open` defaults to false and `provider` is null. `POST /api/checkout`, `POST /api/tips`, and `POST /api/payments` read that row and still return 501, and they do not write `financial_records`. That table has amount, currency, status, source, and a unique idempotency key for a later provider. It ships empty.

Plan interest (`supporter`, `pro`, `organizer`) is `requested` or `withdrawn`. It does not create an `entitlements` row. The Pro commercial label is shown only when that entitlement is active, which this preview never sets. Verification stays `not_available`. A booking request is an inquiry on a service listing with `appointment: null` and `paid: false`.

A group owner or admin can create a goal whose progress is a count. Sponsor and partner proposals are inquiries. `Sponsored` appears only after the organizer marks one agreed, and the response says no payment was collected. Nobody else's quote or plan interest is returned from `/api/me/money`.

## Migrations

`api/migrations/*.sql` runs on API startup inside a transaction, recorded in `schema_migrations`, under a Postgres advisory lock. The first migration does not insert people or posts. `003_reports.sql` adds the moderator flag and the report tables. It does not insert allegations.

## Why this shape

Supabase is not used. The database and files live in Docker volumes on the machine running the preview. There is no hosted project and no shared quota.
