# Example services

Curated services the agent can call with `ampersend fetch`, organized by the capability categories listed in
[`SKILL.md`](../SKILL.md). Use this file when the user is exploring, names a capability without naming a provider, or
already has a service from the list below in mind.

Two ground rules before suggesting any service:

- **Always check the price first.** Run `ampersend fetch --inspect <url>` before paying. Prices on third-party services
  drift; this file deliberately lists none.
- **Don't recommend providers from training.** If a capability the user wants isn't covered below, say so — don't fill
  the gap with a service from training data, since it may not be reachable from ampersend or may have moved.

Some services expose their own paid endpoints; others (Apollo, Hunter, RentCast) are reached through StableEnrich, an
aggregator gateway that fronts several upstream APIs behind one paid surface. The URL in each entry is what the agent
actually calls.

Each entry below gives the endpoint, body shape, and one runnable `ampersend fetch` invocation. Read the upstream docs
linked in each entry before relying on field semantics — this file captures the shape of the call, not full schemas.

There is also one **response pattern** at the end of the file (Pinata) — that's a service the agent doesn't suggest
proactively but should know how to handle when the user pastes a specific URL shape.

## Contents

- [Web search](#web-search)
- [Email](#email)
- [Email lookup and verification](#email-lookup-and-verification)
- [Voice calls](#voice-calls)
- [Property valuation](#property-valuation)
- [Domain registration](#domain-registration)
- [File hosting](#file-hosting)
- [Image and video generation](#image-and-video-generation)
- [LLM inference](#llm-inference)
- [Social data](#social-data)
- [News and market data](#news-and-market-data)
- [Job search](#job-search)
- [Travel search](#travel-search)
- [Real-world purchases](#real-world-purchases)
- [Response patterns](#response-patterns)

## Web search

### Firecrawl on-demand search

Searching the web and getting back the actual page content, not just links. Suggest for research, fact-checking, or
feeding results into a downstream prompt.

- `POST https://api.firecrawl.dev/v1/x402/search`
- Body: `query` (string, required), `limit` (integer, capped at 10), optional `scrapeOptions`.
- Example:
  ```bash
  ampersend fetch --pay -X POST -H "Content-Type: application/json" \
    -d '{"query":"premier league fixtures 2025/26","limit":3,"scrapeOptions":{"formats":["markdown"],"onlyMainContent":true}}' \
    https://api.firecrawl.dev/v1/x402/search
  ```
- Docs: <https://docs.firecrawl.dev/x402/search>

## Email

### AgentMail

Giving the agent its own working email address — create an inbox, send mail, receive mail. Suggest when the user wants
the agent to handle a back-and-forth conversation by email.

- Base URL for x402 endpoints: `https://x402.api.agentmail.to`. This replaces AgentMail's standard host; x402 payment on
  each request is the entire authentication, no API key needed.
- Two-call flow: create an inbox, then send from it.
- Create an inbox: `POST https://x402.api.agentmail.to/inboxes`
- Send a message: `POST https://x402.api.agentmail.to/inboxes/<inbox_id>/messages/send` with body fields `to`,
  `subject`, `text` (required) and optional `html`, `cc`, `bcc`, `reply_to`, `attachments`.
- Example send:
  ```bash
  ampersend fetch --pay -X POST -H "Content-Type: application/json" \
    -d '{"to":"jane@example.com","subject":"Hello","text":"Sent by my agent."}' \
    https://x402.api.agentmail.to/inboxes/<inbox_id>/messages/send
  ```
- Docs: <https://docs.agentmail.to/integrations/x402>

## Email lookup and verification

The natural flow is lookup → verify: enriched emails aren't guaranteed to deliver, so when the user wants to actually
send something, run both calls.

### Apollo people-enrich (via StableEnrich)

Finding a work email from a name and company domain. Suggest when the user has someone's name and employer and wants the
agent to find their email.

- `POST https://stableenrich.dev/api/apollo/people-enrich`
- Body: `first_name`, `last_name`, `domain` (the company's web domain).
- Example:
  ```bash
  ampersend fetch --pay -X POST -H "Content-Type: application/json" \
    -d '{"first_name":"Jane","last_name":"Smith","domain":"acme.com"}' \
    https://stableenrich.dev/api/apollo/people-enrich
  ```
- Don't trust the returned email blindly — chain the verifier call below before using it.
- Docs: <https://stableenrich.dev/>

### Hunter email-verifier (via StableEnrich)

Checking whether an email actually delivers. Suggest when the user has an email (their own, one Apollo just returned, or
one from elsewhere) and wants to know it's real before sending.

- `POST https://stableenrich.dev/api/hunter/email-verifier`
- Body: `{"email": "..."}`. Response includes `status` (`valid`/`invalid`/`accept_all`), `mx_records` and `smtp_check`
  booleans, and a numeric score.
- Example:
  ```bash
  ampersend fetch --pay -X POST -H "Content-Type: application/json" \
    -d '{"email":"jane@acme.com"}' \
    https://stableenrich.dev/api/hunter/email-verifier
  ```
- An `accept_all: true` response means the domain accepts every address — deliverability is unverifiable. Tell the user
  before they rely on the result.
- Docs: <https://stableenrich.dev/>

## Voice calls

### StablePhone

Making an AI-driven phone call to a number with a task description. Suggest for outbound calls like booking, reminders,
or quick info-gathering — but warn the user that the called party may detect the AI voice and hang up.

- `POST https://stablephone.dev/api/call`
- Body: `phone_number` (E.164 string), `task` (string describing what to say).
- Example:
  ```bash
  ampersend fetch --pay -X POST -H "Content-Type: application/json" \
    -d '{"phone_number":"+14155551234","task":"Confirm our 2pm reservation tomorrow."}' \
    https://stablephone.dev/api/call
  ```
- Docs: <https://stablephone.dev/>

## Property valuation

### RentCast (via StableEnrich)

Looking up an estimated sale value, market rent, and comparable nearby sales for a US residential address. Suggest when
the user is considering renting or buying a place and wants a reality check on the asking price.

- `GET https://api.rentcast.io/v1/avm/value` is the underlying RentCast endpoint; access via StableEnrich with the same
  path semantics.
- Required: `address` (or `latitude`/`longitude`). Optional: `propertyType`, `bedrooms`, `bathrooms`, `squareFootage`,
  `compCount`.
- Example (URL-encode the address):
  ```bash
  ampersend fetch --pay \
    "https://stableenrich.dev/api/rentcast/avm/value?address=742%20Evergreen%20Terrace%2C%20Springfield%2C%20IL%2062701"
  ```
- Use the response's `value`, `rangeLow`, `rangeHigh`, and the `comparables` array. Estimates are model output, not
  appraisals — flag that to the user.
- Docs: <https://developers.rentcast.io/reference/value-estimate>

## Domain registration

### Bloomfilter

Searching, registering, renewing, and configuring DNS for domains. Suggest when the user wants the agent to acquire a
domain end-to-end without setting up a registrar account.

- Search availability: `GET https://api.bloomfilter.xyz/domains/search?query=<name>&tlds=<csv>`
- Register: `POST https://api.bloomfilter.xyz/domains/register` with body `{"domain": "acme.io", "years": 1}`.
- Example search:
  ```bash
  ampersend fetch --pay \
    "https://api.bloomfilter.xyz/domains/search?query=acme&tlds=com,io"
  ```
- Inspect the register endpoint before calling — registration is a real, non-refundable purchase.
- Docs: <https://bloomfilter.xyz/>

## File hosting

### StableUpload

Uploading a file and getting back a shareable link. Suggest when the user wants to drop a file somewhere quickly without
provisioning storage.

- `POST https://stableupload.dev/api/upload` mints an upload session (paid). The response includes a dynamic URL and
  curl example for the actual byte upload — the upload URL is per-session, not a fixed path.
- Example (mint the session):
  ```bash
  ampersend fetch --pay -X POST https://stableupload.dev/api/upload
  ```
- Then `ampersend fetch --pay` the URL returned in the response with the file body.
- Docs: <https://stableupload.dev/>

## Image and video generation

### StableStudio

Making an image or short video to a prompt, across multiple models. Suggest when the user wants a one-off image or clip
without standing up a generation account.

- Generate an image: `POST https://stablestudio.dev/api/generate/<model>/generate`. Default-recommended model is
  `gpt-image-2`. Body: `prompt` (required), optional `quality` (`low`/`medium`/`high`), `size`, `output_format`.
- Example:
  ```bash
  ampersend fetch --pay -X POST -H "Content-Type: application/json" \
    -d '{"prompt":"a watercolor of a fox in autumn leaves","size":"1024x1024","output_format":"png"}' \
    https://stablestudio.dev/api/generate/gpt-image-2/generate
  ```
- The response includes a `jobId`. Poll `GET https://stablestudio.dev/api/jobs/<jobId>` until completion. Cost varies
  wildly by model — `--inspect` matters more here than usual.
- Docs: <https://stablestudio.dev/>

## LLM inference

### BlockRun

Calling models like GPT, Claude, or DeepSeek without an account at each provider. Suggest when the user wants quick LLM
access for a one-off task or comparison across models.

- `POST https://blockrun.ai/api/v1/chat/completions`
- Body: `model` (e.g. `openai/gpt-5.5`), `messages` (array of `{role, content}`), optional `max_tokens`, `temperature`,
  `top_p`.
- Example:
  ```bash
  ampersend fetch --pay -X POST -H "Content-Type: application/json" \
    -d '{"model":"openai/gpt-5.5","messages":[{"role":"user","content":"Summarize x402 in one sentence."}]}' \
    https://blockrun.ai/api/v1/chat/completions
  ```
- Docs: <https://blockrun.ai/docs>

## Social data

### StableSocial

Looking up profiles, posts, comments, or running searches on TikTok, Instagram, Facebook, and Reddit. 36 endpoints, all
POST, flat per-request price.

- Example endpoints: `POST /api/tiktok/followers`, `POST /api/facebook/search`, `POST /api/tiktok/search-profiles`.
- Bodies typically take `keywords` or `handle` plus optional pagination (`max_page_size`, `cursor`).
- Example:
  ```bash
  ampersend fetch --pay -X POST -H "Content-Type: application/json" \
    -d '{"keywords":"ampersend","max_page_size":10}' \
    https://stablesocial.dev/api/facebook/search
  ```
- Docs: <https://stablesocial.dev/openapi.json>

## News and market data

### Gloria

Getting real-time news and market intelligence feeds (crypto, macro, AI). Suggest when the user wants up-to-the-minute
news as input to a downstream task.

- Base URL: `https://api.itsgloria.ai`.
- `GET /news?feed_categories=<csv>` — latest headlines by category. Optional `from_date`, `to_date` (`YYYY-MM-DD`).
- `GET /recaps?feed_category=<one>` — 12–24h recap. Optional `timeframe` (`12h` or `24h`).
- `GET /news-by-keyword?keyword=<term>` — keyword search.
- Example:
  ```bash
  ampersend fetch --pay "https://api.itsgloria.ai/news?feed_categories=crypto,macro"
  ```
- Docs: <https://gloriaai.gitbook.io/gloria/gloria-data-platform/x402-integration>

## Job search

### StableJobs

Querying live job openings with structured filters and normalized output. Wraps Coresignal data behind a per-request
paywall.

- `POST https://stablejobs.dev/api/coresignal/job-search`
- Body shape isn't fully documented on the landing page — `--inspect` and the upstream Coresignal docs are your best
  reference.
- Docs: <https://stablejobs.dev/>

## Travel search

### StableTravel

Searching flights, hotels, activities, and transfers via Amadeus's distribution system, no signup. Suggest for trip
planning when the user wants live availability, not a booking.

- Flight search: `GET https://stabletravel.dev/api/flights/search` with required `originLocationCode`,
  `destinationLocationCode`, `departureDate` (`YYYY-MM-DD`), `adults`. Optional `returnDate`, `travelClass`, `nonStop`,
  `currencyCode`, `maxPrice`.
- Hotel search: `GET https://stabletravel.dev/api/hotels/list` with `cityCode` (e.g. `SFO`).
- Example:
  ```bash
  ampersend fetch --pay \
    "https://stabletravel.dev/api/flights/search?originLocationCode=SFO&destinationLocationCode=JFK&departureDate=2026-08-15&adults=1"
  ```
- StableTravel also exposes flight `price`, `book`, and `cancel` endpoints — those are real spend; `--inspect` and
  user-confirm before calling.
- Docs: <https://stabletravel.dev/docs>

## Real-world purchases

Services in this category produce a redeemable artifact (today, a prepaid card), not a service response. Before calling,
confirm with the user that they want the agent to make the purchase — the funds leave the agent's account and the
artifact is the only thing returned.

### Laso

Ordering a prepaid virtual Visa card the agent can then use for online purchases. Three calls total: pay for an auth
token, order the card, then poll for the card details once it's ready.

- `GET https://laso.finance/auth` — pays a tiny x402 cost, returns an `id_token` (1-hour Bearer) plus a refresh token.
- `GET https://laso.finance/get-card?amount=<usd>` — pays via x402, returns a `card_id` with `status: "pending"`.
  `amount` is in USD, $5–$1000.
- `GET https://laso.finance/get-card-data?card_id=<id>` — uses the Bearer token from `/auth`, free, poll every 2–3
  seconds until `status: "ready"` to get the card number, CVV, and expiry.
- US-only (IP-locked) and non-reloadable today. `--inspect` before ordering — `get-card` is the real spend.
- Docs: <https://laso.finance/>

## Response patterns

Services the agent doesn't suggest proactively but should know how to handle when the user provides a specific URL.

### Pinata x402 gateway

If the user pastes a URL of the shape `https://<gateway>.mypinata.cloud/x402/cid/<cid>`, that's a paywalled file on
IPFS. The agent fetches it like any other URL — the gateway returns 402, ampersend pays, and the file streams back.

- `GET https://<gateway>.mypinata.cloud/x402/cid/<cid>`
- Example (use the user's actual gateway and CID):
  ```bash
  ampersend fetch --pay https://your-gateway.mypinata.cloud/x402/cid/bafybei...
  ```
- Don't suggest this category unprompted — it only applies when the user already has a gateway URL.
- Docs: <https://docs.pinata.cloud/files/x402/intro>
