# What works, and what does not

A real HEIC made with `heif-enc` is stored as JPEG. Truncated JPEGs and program files are rejected. A failed post insert deletes the unused upload. A stale CSRF check refreshes the token and does not post. Password reset stays unavailable until `SMTP_HOST` is set. Deleting an account removes that person's posts, listings, reports, and files. ClamAV is optional. The content-security policy allows this site and OpenStreetMap tiles. The preview host list stays on loopback unless `PUBLIC_BASE_URL` or `ALLOWED_HOSTS` adds another host.

The phone composer is a sheet above the bottom bar. A physical good asks for a photo before publish. A service can be text only. The listing form shows the 5% quote while the price is typed. Desktop has one search field. A public group's member names stay off the page until someone joins.

A report map click stores an approximate pin, rounded to two decimal places, and the detail page shows that pin with the OpenStreetMap disclosure. Until a pin is set, the form says “No pin added.” The author of a pending report sees “Pending. No moderator is assigned in this preview, so it won't be published yet.” when no account has the moderator role. An optional report photo uses the existing private attachment and is not published. Report post, including on a listing or a service, and Report on a comment, save one open flag per person. The confirmation is “Thanks. Saved for review. No moderator is assigned yet.” Nothing is hidden, and the profile still cannot grant a moderator. Contact seller, Request a time, and Message provider open one private thread per listing and buyer. The inbox is `/messages`, with an unread count in the header and the desktop rail, and under More on a phone. A mute does not block a message. Nothing is emailed. The line on the thread is “You'll see replies here.”

The header and the phone More menu can switch the interface among English, Brazilian Portuguese, Spanish, Japanese, Korean, and Simplified Chinese. A signed-in choice is stored on the account. A signed-out choice stays in this browser. See translation appears on posts, comments, listings, services, reports, polls, groups, events, and messages only when a translation provider is configured. The default is off, and nothing is sent out while it is off.

Reports, Polls, Marketplace, Events, and Groups use that same three-column page. The phone bar keeps Social, Help, Reports, and Market, and puts Polls, Events, and Groups in More. A closed composer opens the existing form. Close and Escape keep the draft.

Help at `/help` and `/causes` uses the same three-column page: an orange Ask & Offer and Community Causes rail, the composer and cards, and a side column of asks, offers, and active causes that exist. A phone hides that column. Close and Escape keep an unsent ask, offer, or cause.

Social is a three-column page at `/` and `/social`. The first thing on the page is a short greeting, then the post box. Signed in, the greeting uses the local time of day and the person's display name. Signed out, it is a welcome with log in and create account. Under that, the page lists real asks, open polls, and nearby groups or gatherings, then the feed. Empty sections say so and offer an action. Nothing on the home page is a stock scene or a made-up person. A 180px section rail, the cards, and a 300px column of marketplace, help, gatherings, topics, and groups follow. The right column hides on a phone. Widgets list only rows that exist. The top bar is icon pills. The phone bar keeps labels. Spekup colors and the speech-bubble mark stay.

Social is the landing page at `/` and `/social`. The house icon is labeled Social. The composer starts closed. Share, Photo, Clip, Ask, and Offer open the details in the page. Close and Escape keep the draft. A failed photo or clip upload does not publish the text alone. Photos accept HEIC when ffmpeg can read it, and clips accept MOV by converting it to H.264. Limits are 8 MB for photos and 40 MB and 0.2–30 seconds for clips.

The product name is Spekup. `PUBLIC_BASE_URL` defaults to `http://127.0.0.1:4185` for this preview. Set it to `https://spekup.com` for the public site. The compose project, database name, cookie names, and health service id are unchanged.

Command: `npm --prefix api test`

Final run: 38 passed, 0 failed, 0 skipped. The homepage greeting uses the local time of day and the display name, then the post box, then real asks, open polls, and nearby groups or gatherings. A real HEIC from `heif-enc` comes back as JPEG. A truncated JPEG and an ELF file are rejected. A forced post-insert failure deletes the unused photo. Password reset stays unavailable without `SMTP_HOST`. Deleting an account removes that person. Payments stay closed and no moderator is granted. A second flag on the same post does not add a row. A third account cannot read a listing thread or translate it. A pending report cannot be translated by someone else. An existing booking request is copied into a thread and the old inquiry row stays. Translation stays off unless a provider is set, and a repeated text is served from the cache.

Command: `npx playwright test`

Final run: 26 passed, 0 failed, 0 skipped, about 4.5 minutes. API: 38 passed. The signed-in home opens with a time-of-day greeting and the post box. The signed-out home opens with a welcome and sign-in. Spanish and Japanese change the interface and stay after reload. See translation toggles a stub and can return to the original. A map click saves an approximate pin, and the author sees that no moderator is assigned. Report post asks for a reason and leaves the post on the page. Contact seller opens one thread, the inbox shows the unread note, and a third account cannot open it. The phone composer stays above the bar. A physical good requires a photo. A service can be text only. The listing form shows the 5% quote while the price is typed. Desktop has one search field. Public group names stay hidden until join. Reports, Polls, Marketplace, Events, and Groups use the three-column page. The phone width hides the side column and leaves the composer above the bottom bar. Account says mail recovery is not available. The report map names the OpenStreetMap tile host. The earlier studio, marketplace, report, poll, and help flows passed in the same run.

## Working now

- Everything in the first slice: accounts, the shared feed, photos, listings, inquiries, and the honest payments and verification panels.
- Short clips. Upload is authenticated. The file is checked by bytes, container, codec, size, and ffprobe duration. The original stays private. A separate worker transcodes with ffmpeg under a time limit and writes a poster. The feed shows preparing, failed, or a player with controls and no autoplay. Clips are not reviewed for what they show.
- Groups. Create, join, and leave. Public and private are explicit. Owners and admins are checked. A private group's posts are not visible to outsiders. Deleting a group removes its posts so they do not become public.
- Gatherings. Create, cancel, and RSVP or undo RSVP. Time is stored as an absolute instant plus an IANA zone and shown in that zone and on this device. A place or an online link is required. No email, calendar invite, repeating series, or tickets.
- Crime & Accountability reports, in the same app as the feed and profile. A signed-in person can submit, edit, and withdraw an allegation about a politician, a corporation, or a community body. Public text stays an allegation. A human moderator must publish it. Pending and withdrawn reports are hidden from other people in the list, map, search, profile, and follow routes. The author can see their own pending submission. This slice does not grant a moderator and does not publish pending reports.
- Polls, as a post type in the same composer, feed, and profile, plus a Polls lens. A poll asks for a community priority or opinion. It is not an election and not a finding. Subject filters use the same politician, corporation, and community labels as reports, and the card says they are a different kind of thing. One signed-in account holds one current choice. The person can change or withdraw it until the poll closes. Totals are respondents. Ballots are not listed for the author or the public. The author can close or cancel, and cannot change the question after a vote.
- Follow a published report, or watch a category, a subject, or an area. The Following filter reads those rows after login and reload.
- An approximate map. Leaflet draws OpenStreetMap tiles. A click on the report map drops a pin, rounded to two decimal places, and the detail page shows that pin with the tile disclosure. The form says “No pin added” until then. The named party's area is a separate field from the incident location.
- A private listing thread. Contact seller, Request a time, and Message provider start one thread per listing and buyer. The inbox is `/messages`. Replies stay on Spekup. A booking request is the first message, and the older inquiry row is kept.
- A report on someone else's post, listing, service, or comment. The reason is spam, harassment, scam or fraud, unsafe, misinformation, or other, with an optional note. One open flag is kept per person per item. A future moderator can read the queue. The post stays visible.
- Flag, dispute, and a right-of-reply request. Those are stored for a moderator. The app does not email or text anyone.
- Older playbooks remain in the database and on `/playbooks`. The nav, composer, and new-playbook form no longer offer them. Nothing in that table is deleted.
- Follows, likes, and comments were already stored and still are.
- The Ask & Offer and Community Causes controls are orange tabs. The selected tab is `#C2410C` with ivory text. The other is an orange border on `#FFF4E8` with `#9A3412` text. Both contrasts are above 4.5 to 1.
- Write a report, Write a poll, Post a clip, and Post a product use the same solid orange button (`#C2410C`, ivory text, `#9A3412` border). Logged-out visitors go to login and return to `/reports/new`, `/polls?compose=1`, `/clips?post=1`, or `/marketplace?post=1`.
- Clips have their own form on `/clips`. It accepts a dropped or chosen MP4 or WebM, shows a local preview and the real upload percent, then waits for the existing worker. Cancel before publish deletes an unattached upload and does not create a post. The server still rejects anything outside 0.2–30 seconds or 40 MB, and it still checks bytes, codec, and duration. The original stays private. The player has controls and does not autoplay. A format check is not content moderation. The owner can edit the title and caption and can delete the post. A category uses the existing topics. A group appears only when the person is already a member.
- Studio is a single picture track on top of the existing clip worker. `/studio` saves a draft, trims and reorders owned MP4 or WebM clips, and renders 0.5, 1, 1.5, or 2 times speed with pitch kept steady. The rendered length, including speed, must stay between 0.2 and 30 seconds and 40 MB. Those limits are not raised. A post is created only after the server render is ready. Browser playback is labeled approximate. Canceling a queued render does not publish anything. Voiceover is recorded only after microphone consent and is uploaded only by a separate action. Music has to be the creator's own or licensed file, with a rights confirmation, because there is no music library. Captions can be typed or imported from SRT or VTT. Automatic transcription is not connected. Captions can be a separate track or burned into the picture. The cover is one still frame plus a static headline. Cards for a product, help request, cause, group, gathering, or unreviewed community guide stay live on the post and disappear from view if the target becomes private, deleted, or archived. Sponsor, paid partnership, and AI labels are stored and shown. None of them means the platform paid anyone. A health or clinical promotion stays private until a person approves it. No reviewer is assigned in this preview, so that queue does not publish anything. Comments and a download of the prepared file can be turned off. Hiding the download is not copy protection. Remix is only a stored preference. There is no duet tool. Scheduling uses the worker, a named time zone, and a future time. It publishes the same post once, and a restart can finish a job that was interrupted.
- Marketplace has its own form on `/marketplace`. A listing can hold up to six owned photos, reordered before publish. Physical goods ask for condition (`new`, `good`, `fair`, `worn`), a whole-number quantity, and a pickup, delivery, or either preference. Delivery is a note for the inquiry. This app does not ship, reserve stock, or deliver a digital file. Price modes stay fixed, negotiable, free service, and free advice. The server quote is unchanged: 500 basis points on a fixed price, zero on a free listing, and a tampered quote is rejected. The owner can mark a listing available, unavailable, sold, or archived, and can edit or delete it. Archived listings leave the marketplace and other people's feeds. Sold and unavailable listings stay visible and do not take new inquiries. A second account can save an inquiry. Nothing is emailed. Checkout still returns 501.
- Help is one section with Ask & Offer and Community Causes. `/help` opens asks and offers. `/help?tab=causes` and `/causes` open the same causes tab. Cause pages stay at `/causes/:id`. The home feed includes visible cause cards, and `GET /api/feed?lens=causes` returns only those causes. Drafts and private-group causes follow the same visibility as the cause page. Pledge notes are not in the feed.
- Community causes. An organizer can publish a cause with a USD goal in cents, a category, an approximate locality, and a beneficiary display name. Neighbors can pledge an intention, offer time or goods, follow, and send a sponsor offer. The progress bar is pledged, not collected. Collected funds stay unavailable. Pledges are not ledger rows. The listing fee does not apply, and no cause fee is configured. Count-based group goals stay counts.
- A proposed fee preview on fixed-price listings. The server calculates list price, platform fee, seller net, and buyer total before someone can save interest. Free services, free advice, asks, polls, and reports are not charged. The 5% figure is version 1 of a proposal, not an approved price. Processor fees are omitted because no provider is connected. Saving interest, a plan request, a tip interest, or an agreed sponsor proposal does not create a charge, a balance, an entitlement, or a verification badge. Group goals track a count the organizer enters, not money raised.

## Not available

- Payments, tips, checkout, and payouts. The payment gate is closed. Those routes return 501 even if the gate flag is flipped, because no provider is connected. The financial record table stays empty. There is no balance.
- Professional verification. Roles are self-described. No badge is issued.
- Account export, account deletion, and password reset. These are not implemented. Deleting an account from the database by hand is the only removal, and it is not offered in the app.
- Notifications and mail. Report updates are only the history stored in this database.
- Recurring events, paid tickets, and external calendar or email delivery.
- Multi-choice ballots, live result streaming, and any claim that an account vote is identity verification or a representative sample.
- A Google map. There is no Google key, no Google branding, and no paid geocoding. The map needs the public OpenStreetMap tile service to be reachable. This app does not proxy tiles.
- Crowd votes as a legal verdict, auto-approval when no moderator exists, and any claim that a reviewed source means guilt was verified.
- Scraping or enriching politician or company records. The subject name is whatever the author typed.
- Ranked recommendations. Feeds are newest-first or recently-updated, capped at 50 reports or 50 posts.
- A strict content-security policy.

## Known issues

- Entering a time during a daylight-saving fallback hour can be ambiguous. The server picks one instant in the named zone.
- The prepared clip is H.264 even when the upload was VP8, VP9, or WebM.
- Rolling the app back to the previous image keeps the new tables. The older app does not show clips, groups, gatherings, reports, or polls created here, and it does not delete them.
- Poll totals change when the page loads again. The app does not stream them.
- Report map pins do not appear when OpenStreetMap tiles cannot be loaded. The list does not depend on the tiles.
- Public coordinates are approximate (two decimal places, roughly a kilometer). They are not a street address. Labels that look like a house number are rejected, but a determined person can still type a recognizable place name. Do not put a private home, a victim's identity, or a minor's identity in a report.
- This image is larger because it includes ffmpeg. A 30-second clip can take up to a minute to prepare on an ARM64 Mac. Each clip keeps the private original (up to 40 MB), the prepared MP4, and a JPEG poster. The worker is limited to 1 CPU and 512 MB.

## First slice, since superseded

- Account signup, login, logout, and editing your own name, handle, neighborhood, bio, role, and photo.
- A shared feed with Share, Ask, and Offer. Fixed prices are exact cents. Negotiable, free service, and free advice do not store an amount.
- Photo upload with signature checks, an 8 MB cap, a daily cap, reencode to JPEG, and EXIF removal.
- Edit and delete only by the author. Another account gets 403.
- Marketplace grid in the same card layout as the imported prototype: search, topic, kind, and price filters, a detail page, and links to the seller and the feed.
- A response to an ask, or an inquiry on a listing, stored in the database and shown to the people involved. No email or text is sent.
- Profile lists that person’s posts, listings, and help messages.
- Action Playbooks with a suggested span and optional link to the author’s own listing. They are labeled not reviewed.
- Account and verification panels that say payments and verification are off. Checkout and tips return 501. There is no balance.
- Sessions, scrypt passwords, CSRF, and rate limits. Clips, groups, and gatherings were added after this list.
- Docker Compose project `common-voice-vitavus-preview`, loopback port 4185, private database and API.

## What the first slice left out

- Short video, groups, and gatherings. Those are in the current app, described above.
- A live card processor, subscriptions, payouts, and any agreed final price. The preview numbers are not a decision.
- Professional verification. Roles are self-described. No badge is issued.
- Notifications, password reset, and account deletion. No mail is sent. Account export and deletion are still missing.
- Polls. They are not in this build. A later slice could add them as their own feed type, separate from sourced allegations.
- External news, civic data, or crime feeds. Nothing is scraped and no outside users are invented.
- Ranked recommendations. For You is newest-first, capped at 50.
- A content-security policy strict enough for a public site. Frame, referrer, and sniff headers are set.

## Where posting lives

A clip is edited inside the Social post, not in a separate Studio destination. Post a clip on `/social` or `/clips` can attach a file and open Edit video in that same form. Trim, speed, voiceover, captions, cards, disclosures, review, and schedule are the same controls. The post text stays when you go back. There is one publish action for an edited clip, after the server render is ready, so the plain upload button does not create a second post. `/studio` and `/studio/:id` open that same composer and keep the project id. Saved video drafts are listed in the composer. A text post does not open the video editor. Studio is not in the main navigation.

Marketplace has one Post a product button. The form asks for a physical good, a digital file, or a service before the fields. Digital files use the same private-file, preview, license, and variant fields as before. Switching type asks you to confirm and does not delete a saved draft. An existing listing stays its original type. `/shop/new` opens the marketplace form with Digital file already selected. Shop pages and the library stay where they are.

Command: `npm --prefix api test`

Final run: 26 passed, 0 failed, 0 skipped. The upgrade fixture still applied migrations `001` through `010` without dropping the kept listing, studio project, or closed payment gate. This posting change adds no migration.

Command: `npx playwright test`

Final run: 11 passed, 0 failed, 0 skipped, about 3.3 minutes. The clip test attached a video, opened Edit video, returned to the post with the title intact, reopened `/studio/:id`, rendered, and published one post. A text post still uses the ordinary composer. The marketplace test chose Physical, confirmed before switching to Digital, published from `/shop/new` with Digital already selected, and reopened the same listing as a digital file. The main navigation did not show Studio or a separate digital posting button.

## Social feed

Social at `/social` is the mixed page for posts and clips. For You and Following are the tabs. Video is a filter, not a separate module. `/clips` opens that same page with the video filter, and old clip links still resolve. Home, marketplace, reports, polls, help, and causes stay separate. `lens=for_you` without `ranking=baseline` is still newest first. `lens=following` still includes poll follows for older callers. Social Following uses `lens=creators`, which is only creator follows, newest first.

For You ranking version `social-baseline-1` uses 0.55 recency, 0.30 topic, and 0.15 substance until someone opts into watch counting. Recency falls by half about every 50 hours. Topic weight is neutral when no topics are selected. Substance is length plus a photo or a ready clip. It is not a credibility score. With watch opt-in the weights are 0.50, 0.25, 0.15, and 0.10. Repeats add at most 25 percent. Every fifth slot can show a creator you do not follow. That is not a promised audience. Health-related listings are not boosted by watch time. Why this post lists those reasons. Watch counting is off by default, stores a daily count and time for 30 days, ignores hidden, paused, and seek jumps, ignores the creator's own views, and is deleted when the person opts out or resets history. It is not fraud-proof. Nothing autoplays.

Command: `npm --prefix api test`

Final run: 26 passed, 0 failed, 0 skipped. The new case checked the fixed score, creator-follow order, a duplicate follow, hidden and muted posts, a private group post staying out of For You, watch events while opted out, and interests surviving a history reset. The upgrade fixture kept a listing and a studio project, then applied `010_social_feed.sql` with watch totals empty and the payment gate closed.

Command: `npx playwright test`

Final run: 11 passed, 0 failed, 0 skipped, about 3.1 minutes. Social showed a mixed post, the formula version, Not interested and undo, a creator follow, Following, and the watch toggle. `/clips` still opens the video filter and Post a clip. The earlier product, digital, studio, cause, and report flows passed in the same run.

## Digital files

A digital guide is still an offer. Physical goods and services are unchanged. `/shop/new` saves a draft on the server. A draft is absent from the marketplace, feed, search, profile, and Studio cards. Publish requires a type, format, learning purpose, license, origin, seller role, distribution rights, a preview image, a variant, and a file.

The public page shows up to 20 preview photos. A focal point crops the thumbnail. The full file is private, served only as an attachment with nosniff, and only to the owner or to an account that claimed a free variant. Paid variants cannot be claimed or downloaded. That stays true if the payment gate flag is opened, because no provider is connected. A claim is not a transaction and does not write `financial_records`. Replacing a file publishes a new version to claimants. The previous bytes are not given out. Archiving removes claimant access. The owner can still download.

Tags are limited to 13. Titles are limited to 140 characters. Variants use at most two choices and eight combinations, each free or a whole-cent price, with a SKU. There is no copy inventory. Personalization is an inquiry, not an instant file. A shop can have named sections and four featured listings. The estimate uses the existing proposed 5% listing fee plus a cost the seller typed. Processor fees and tax are unknown. It is not a profit guarantee, and nothing is charged. There is no $0.20 listing fee and no renewal charge. An optional end date hides the listing. It does not bill anyone.

A listing demo, if uploaded, must be 15 seconds or shorter and is muted by the existing worker. ZIP files are stored as-is and are not opened. The app does not scan files for malware and does not say that it does. HTML, SVG, and programs are rejected. Health or clinical promotions stay private for a person to review. No reviewer is assigned. Automatic saving is not claimed: Save draft writes to the server, and a stale edit version is rejected.

Command: `npm --prefix api test`

Final run: 24 passed, 0 failed, 0 skipped. The new case covered a 141-character title, 14 tags, a bad focal point, an HTML upload, an unopened ZIP, a free claim that stayed one row under two simultaneous requests, a revised file reaching the claimant, a paid variant that stayed locked after the payment gate flag was opened, an inquiry personalization, an archived file the buyer could no longer download, and an empty financial ledger. The upgrade fixture kept a service listing, a studio project, a pending report, a closed gate, and no moderator, then applied `009_digital_goods.sql`.

Command: `npx playwright test`

Final run: 10 passed, 0 failed, 0 skipped, about 3.1 minutes. The digital flow saved a draft, uploaded a preview and a PDF, published the preview, and a second account claimed and downloaded it from the library. The earlier studio, product, cause, quote, poll, and report flows passed in the same run.

Not in this version: an Etsy connection, calculated shipping for digital files, tax or product-safety certificates, a refund promise, paid downloads, payouts, email delivery, a malware scanner, and a multi-lesson course player. A course bundle is a file type, not a classroom.

## Later, and not in this version

These are not buttons and not pretend features:

- More than one picture or audio track, speed ramps outside 0.5, 1, 1.5, and 2, green screen, beat detection, and automatic cuts.
- AI images or video, voice cloning, stock music, text-to-speech, stickers, and animated covers.
- A connected transcription provider. The screen says automatic transcription is not connected. Typed captions and SRT or VTT import work.
- Duet, stitch, mentions, polls inside a clip, and publishing out to another platform.
- Copy protection. A hidden download still leaves the picture playable, and a screen recording is possible.
- A reviewer for health or clinical promotions. The report moderator role is still unassigned. Nothing in this install grants it.

## Luvita, as far as a public page shows

https://luvita.com loaded as a pet-community marketing page titled “Luvita | Pet lovers community,” with a mark at https://luvita.com/luvita-mark.png. https://luvita.com/marketplace returned an empty document. The clip composer and the product form were not on the public pages. No account was created and no login was attempted. The Common Voice forms above are this app's own clip and listing flows. They are not a verified copy of Luvita's signed-in screens.

## Tests for Studio

Command: `npm --prefix api test`

Final run: 22 passed, 0 failed, 0 skipped.

- The earlier photo, clip, group, report, poll, fee, cause, product, and upgrade cases still passed.
- A two-clip edit at 1x and 2x, a voice recording, and an imported caption rendered on the server. The output stayed inside 30 seconds. A 20-second source at half speed was rejected and the message said the limit was not raised. A second account could not open the draft or attach the creator's clip. Publishing twice kept one post. A sponsor label was visible. An archived product card no longer showed its title. Comments and the download route honored the creator's settings, and the playback file still played. A health promotion was hidden, the review queue refused a normal account, a temporary reviewer flag was set only inside the test database and then cleared, and the public post came back only after that approval. Scheduling in America/New_York did nothing until the stored time had passed, published once, and a canceled job that was left half-finished was recovered by the worker without a second post. Checkout stayed 501. No moderator remained. `financial_records` stayed empty.
- Upgrade fixture: migrations `001` through `007`, one account, one $10.00 offer, and one pending report, then `008_studio.sql`. The offer, the report, the closed payment gate, and `is_moderator = false` stayed. Studio projects, causes, and financial records were zero.

Command: `npx playwright test`

Final run: 9 passed, 0 failed, 0 skipped, about 2.8 minutes. The studio flow uploaded a generated clip, waited until it was ready, changed the speed, attached a generated voice recording, saved a caption, rendered on the server, and opened one post with the sponsor disclosure. The earlier cause, quote, poll, report, clip, and product flows passed in the same run. `npm run build` in `web` completed, including the not-found page.

## Tests for clip and product posting

Command: `npm --prefix api test`

Final run: 20 passed, 0 failed, 0 skipped.

- The earlier photo, clip, group, report, poll, fee, cause, and upgrade cases still passed.
- A generated clip was posted, appeared on the video feed and the owner's profile, kept its private original, and rejected a stranger's edit, delete, and video delete. The owner edited the title and deleted the post. Deleting an upload before it was attached left no post.
- A listing with two photos kept their order, then the owner reversed it and changed condition, quantity, and handoff. A stranger's photo, a negative price, and a negative quantity were rejected. The $10.00 quote stayed a 50 cent proposed fee and a $10.00 buyer total, with `charged: false`. A second account saved an inquiry. After the listing was sold, another inquiry returned 409. Archiving hid it from the marketplace and left it on the owner's listings. A free listing quoted a zero fee. Checkout returned 501. `financial_records` stayed empty and the payment gate stayed closed.
- Upgrade fixture: migrations `001` through `006`, one account, one $10.00 offer, and one pending report, then `007_listing_details.sql`. The offer body and price stayed, availability defaulted to available, the report stayed pending, `is_moderator` stayed false, the gate stayed closed, and causes, listing photos, and financial records were zero.

Command: `npx playwright test`

Final run: 8 passed, 0 failed, 0 skipped, about 2.5 minutes, one worker. The new flow opened the orange report, poll, clip, and product actions, submitted a report form and a poll composer, uploaded a generated clip until the player was ready, edited it, removed it, published a two-photo listing, saved an inquiry from a second account, marked the listing sold, and archived it off the marketplace. The cause, Help tab, quote, poll, report, group, and listing flows passed in the same run. `npm run build` in `web` completed, including the not-found page.

## Tests for causes

Command: `npm --prefix api test`

Final run: 18 passed, 0 failed, 0 skipped.

- A cause goal must be integer cents in USD. A decimal, a euro amount, and a street address were rejected. The organizer is not a verified charity. Collected funds are null. The pledged percent is 0 before anyone pledges. The listing fee does not apply.
- A draft is hidden from other people. After it is active, two overlapping pledges leave one row and do not add together. A private note is absent from the organizer's view and from a stranger's view. An opt-in credit shows the display name only. Following survives login. A stranger cannot accept a sponsor offer. The organizer's acceptance is an accepted offer with `fundsCollected: 0`. Pausing rejects a new pledge. Withdrawing removes it from the pledged total. Cancelling archives the cause and blocks edits. A private-group cause stays off the public list. A new report stayed pending. Checkout returned 501. `financial_records` stayed empty. No count-goal rows were created for the cause.
- Upgrade fixture: migrations `001` through `005`, one account, one fixed-price post, and one pending report, then `006_causes.sql`. Those rows stayed. `is_moderator` stayed false. The payment gate stayed closed. Causes, pledges, and financial records were zero.

Command: `npx playwright test e2e/causes.spec.ts e2e/money.spec.ts e2e/polls.spec.ts e2e/reports.spec.ts e2e/community.spec.ts e2e/flow.spec.ts`

Final run: 6 passed, 0 failed, 0 skipped, about 72 seconds. The same six files passed again after Help was given Ask & Offer and Community Causes tabs and the home feed learned `lens=causes`. The cause flow published a fictional library-table cause, saw it on the home feed and in the Causes filter, opened it from the Help causes tab, and a second account pledged $25, followed it, and sent a sponsor offer. The organizer posted an update, accepted the offer, paused pledges, and cancelled the cause into the archive. Desktop and mobile screenshots were saved. The quote, poll, report, group, clip, and listing flows passed in the same run. After the Help tabs were recolored, `e2e/help-tabs.spec.ts` and `e2e/causes.spec.ts` passed: 2 passed, 0 failed. The tab test checked both routes, keyboard focus, and a contrast of at least 4.5 to 1. `npm run build` in `web` completed, including the not-found page.

## Tests for the fee preview

Command: `npm --prefix api test`

Final run: 16 passed, 0 failed, 0 skipped.

- A $10.00 listing quoted a 50 cent platform fee, a $9.50 seller net, and a $10.00 buyer total. A one-cent price floored the fee to zero. Free advice quoted no fee. A poll had no quote, and a pending report stayed out of the public report list.
- A tampered price, schedule version, or fee was rejected. After the seller changed the price, the old quote was rejected. Booking a service returned no appointment and no payment. A digital guide could not take a booking request. Supporter interest did not create an entitlement, a verification, or a moderator role. A goal rejected a money field and kept a progress count. A stranger could not agree a sponsor proposal. The organizer's agreement was labeled Sponsored and `paid: false`. Checkout, tips, and payments returned 501, including after the gate flag was opened in the database. `financial_records` and `entitlements` stayed at zero rows. The buyer's private money view did not appear on the seller's account.
- Upgrade fixture: `001` through `004`, then `005_money_preview.sql`. The post, the pending report, and `is_moderator = false` remained. The gate was closed, and there were no financial records, quote requests, or entitlements.

Command: `npx playwright test e2e/money.spec.ts e2e/polls.spec.ts e2e/reports.spec.ts e2e/community.spec.ts e2e/flow.spec.ts`

Final run: 5 passed, 0 failed, 0 skipped, about 60 seconds. The new flow showed a $10.00 quote with a $0.50 proposed fee and a $9.50 net, saved interest, confirmed payments are not configured, recorded zero transactions, agreed a sponsor proposal without a payment, and saved Supporter interest without a membership. The poll, report, clip, group, and listing flows passed in the same run.

## Tests for the polls slice

Command: `npm --prefix api test`

Final run: 14 passed, 0 failed, 0 skipped.

- The earlier photo, clip, group, event, report, and upgrade cases still passed.
- Upgrade fixture: a database with `001`, `002`, and `003`, two accounts, a follow, a photo row, a post, a playbook, a pending report, a group, and an event, then `004_polls.sql`. Those rows stayed. `is_moderator` stayed false. `polls` had zero rows.
- A community poll about "Example Harbor" stored `2027-06-02T18:30` in `America/New_York` as `2027-06-02T22:30:00.000Z`. A price, one option, seven options, a duplicate option, and an 81-character option were rejected. Another account could not edit it. An option from a different poll was rejected. Two overlapping votes left one row. Changing, repeating, and withdrawing a vote kept the respondent count honest, including 0% when nobody had voted. The author and the profile payload did not contain the voter's id. Closing and a passed close time rejected further votes. Cancel did too. A private-group poll was hidden from an outsider and votable after that person was added. No moderator role was granted.

Command: `npx playwright test e2e/polls.spec.ts e2e/reports.spec.ts e2e/community.spec.ts e2e/flow.spec.ts`

Final run: 4 passed, 0 failed, 0 skipped, about 66 seconds. The poll flow created a community poll, a second account voted and saw one respondent and its own choice, followed it, and the author closed it. Desktop and mobile screenshots were saved. The report, clip, group, gathering, signup, photo, and listing flows passed in the same run. Subjects were fictional.

## Tests for the reports slice

Command: `npm --prefix api test`

Final run after `003_reports.sql`: 12 passed, 0 failed, 0 skipped.

- The clips, groups, events, photo, ownership, and playbook cases still passed.
- Upgrade fixture: a database with `001` and `002`, one account, one playbook, and one post, then `003_reports.sql`. The account stayed, `is_moderator` defaulted to false, the playbook title remained, the post body remained, and `reports` had zero rows.
- A report about "Example Civic Board" in "Example Harbor" stayed out of the public list, map, profile, search, and follow routes while pending. The author could read it. A stranger received 404 on the detail and follow routes. Publishing required a source and a moderator flag set in the database, not by editing a profile. Coordinates 40.7128, -74.006 were stored as 40.71, -74.01. A bounding box around that point included the pin; a box around 10,10 did not. Follow survived logout and login. Editing a published report returned it to pending and removed it from the public map. Withdrawal removed it from the public list, map, and profile. `javascript:` links were rejected. `PATCH /api/me` with `isModerator` did not grant the role.

Command: `npx playwright test e2e/reports.spec.ts e2e/community.spec.ts e2e/flow.spec.ts`

Final run: 3 passed, 0 failed, about 42 seconds. The report test signed up three fictional accounts, submitted an allegation about "Example Civic Board", confirmed a second account could not see it, granted moderator in the database, published it, followed it, flagged it, requested a reply, edited it back to pending, published again, and withdrew it. Desktop and mobile screenshots were saved. The group, RSVP, and clip test passed again, including a player with `autoplay` false. The signup, photo, ask, listing, and archived-playbook test passed again.

No real person, company, or agency was used as a subject. No test was skipped.

## Tests for the clips slice

Command: `npm --prefix api test`

Final run: 10 passed, 0 failed, 0 skipped. About 7.6 seconds.

- Upgrade fixture: a database with only `001_init.sql`, one account, one post, and one media file, then `002_video_groups_events.sql`. The account, post body, null group and video columns, and file bytes remained. `videos`, `groups`, `events`, and `event_rsvps` existed.
- Time zone: `2026-01-15T15:00` in `America/New_York` is `2026-01-15T20:00:00.000Z`.
- The first-slice API cases still passed, including photo rejection of a video file on the still-image route.
- A 1-second generated H.264 MP4 became `ready`, the served file starts with `ftyp`, the original URL 404s, and another account cannot fetch it before it is posted. A 35-second generated clip and a text file named `.mp4` were rejected. A queued clip whose private file was replaced failed once (`VIDEO_MAX_ATTEMPTS=1`) and the error did not contain the media directory.
- Public group join, outsider edit rejected, private join and post rejected, then an added member. Two RSVPs left a count of 1. A non-organizer could not cancel. After cancel, RSVP returned 400. The gathering instant matched the New York offset.

Command: `npx playwright test e2e/community.spec.ts e2e/flow.spec.ts`

Final run: 2 passed, 0 failed. About 31 seconds. The community test created a group, a second account joined, a group post was visible there, an RSVP stuck, and a generated clip became a player with `autoplay` false. The earlier signup, photo, ask, listing, and profile test passed again.

No test was skipped.

## Tests recorded for the first slice

Imported Vitavus source, clean `npx next build` on Next 14.2.15: compiled successfully. Routes were static `/`, icon, Open Graph image, robots, and sitemap. That build is the reproduction, not the running product. The product uses Next 14.2.35 because 14.2.15 is flagged by npm.

API suite (`npm --prefix api test`), against local Postgres, final run:

- 6 passed, 0 failed
- dollars and cents parsing
- signup, login, logout, profile, ignored `verified` field
- post ownership, price rules, inquiries, checkout 501, no ledger tables
- photo reencode, EXIF strip, wrong file type, video rejection, other people’s media, size cap, daily cap
- playbooks stay `not_reviewed` and cannot be edited by someone else
- login rate limit returns 429

End-to-end (`npx playwright test`) against the dev server on 127.0.0.1:4185, final run:

- 1 passed (21.2s): signup, text post, photo post, ask, offer at $12.50, playbook, profile edit, second account responds and inquires, the second account has no Edit control, logout, and login
- Earlier attempts in the same session failed in the test script, not in the product: strict mode matched several Share buttons, and a visibility check ran while the composer was still open. The assertions were narrowed. The run above is the one that passed.

Screenshots from that signed-in preview are the PNG files delivered with this note: desktop feed, marketplace, listing, playbook, profile, and account; mobile feed, composer, marketplace, and profile.

The names in those shots (Ada Neighbor, Bo Rivera) are accounts the test created. They are not seeded residents and they are not in the migration.

## Docker verification on this machine

`docker compose build` of `docker/api.Dockerfile` and `docker/web.Dockerfile` completed. The Mac file pins `linux/arm64`. This cloud machine is x86_64, so the containers that were actually started here also passed `scripts/dev-amd64.override.yml`. That override is not the Mac install.

After the images were up:

- `GET http://127.0.0.1:4185/api/health` returned `{"ok":true,"service":"common-voice"}`.
- Signup through that port returned 201 for `docker_neighbor`, with verification `not_available` and no badge.
- A share post returned 201 and was attributed to that account.
- The HTML title/page contains Common Voice and does not contain Vitavus or `vitavus.vercel.app`.
- `GET /api/me/account` returned payments disabled, `balance: null`, verification `not_available`.
- Published ports: web `127.0.0.1:4185` only. API target 8080 and Postgres target 5432 have published port 0 (not reachable on the host). Host port 5432 is a separate local Postgres used for the API test suite, not the compose database.

This VM’s Docker bridge initially dropped container-to-container packets because an old iptables-legacy FORWARD policy was DROP while Docker had programmed the nftables rules. That was fixed on this VM only (`iptables-legacy` accept for the compose bridge). It is not part of the app and is not something the Mac install needs. Docker Desktop on the Mac programs its own network.

## Docker verification for the reports slice

The same compose project was rebuilt and started again on the existing volumes. `schema_migrations` contains `001_init.sql`, `002_video_groups_events.sql`, and `003_reports.sql`. The account `docker_neighbor` and its one post were still there. `is_moderator` was false. `reports` had zero rows. `GET /api/reports` returned `{"reports":[]}`. Health on `127.0.0.1:4185` returned `{"ok":true,"service":"common-voice"}`. The HTML contained Common Voice and did not contain Vitavus. Web is published on `127.0.0.1:4185` only. API, worker, and Postgres have no host port. `dist/grant-moderator.js` is in the API image.

This cloud machine is x86_64, so the containers started here used `scripts/dev-amd64.override.yml`. That file is not in the runtime archive. The archive’s `docker-compose.yml` still pins `linux/arm64`.

## Docker verification for the Help feed

This update does not add a migration. On the existing volume, `schema_migrations` still ends at `006_causes.sql`. `docker_neighbor`, the one post, and zero causes are unchanged. `is_moderator` is false. `GET /api/feed?lens=causes` returned 200 with `posts` and `causes` arrays. `GET /api/feed?lens=nope` returned 400. Web remains `127.0.0.1:4185` only.

## Docker verification for causes

The same compose project was rebuilt on the existing volumes. `schema_migrations` contains `001_init.sql` through `006_causes.sql`. `docker_neighbor` is still there, `is_moderator` is false, and the one post remains. Causes, pledges, and financial records are zero. The payment gate is closed. `GET /api/causes` returned an empty list. `GET /api/causes/fee` says the listing fee does not apply and no cause fee is configured. Web is published on `127.0.0.1:4185` only. API, worker, and Postgres have no host port. No moderator was granted and no cause was seeded.

## Docker verification for the fee preview

The same compose project was rebuilt on the existing volumes. `schema_migrations` contains `001_init.sql` through `005_money_preview.sql`. `docker_neighbor` is still there, `is_moderator` is false, and the one post remains. Polls, reports, financial records, and quote requests are zero. `payment_settings.gate_open` is false and the provider is empty. Fee schedule version 1 is 500 basis points. `GET /api/plans` says `finalPricing` is false. Web is published on `127.0.0.1:4185` only. API, worker, and Postgres have no host port. No moderator was granted.

## Docker verification for the polls slice

The same compose project was rebuilt and started again on the existing volumes. `schema_migrations` contains `001_init.sql` through `004_polls.sql`. `docker_neighbor` and its one post were still there. `is_moderator` was false. `reports` and `polls` had zero rows. `GET /api/feed?lens=polls` returned `{"posts":[],"notice":null}`. Health on `127.0.0.1:4185` returned `{"ok":true,"service":"common-voice"}`. Web is published on `127.0.0.1:4185` only. API, worker, and Postgres have no host port. No moderator was granted.
