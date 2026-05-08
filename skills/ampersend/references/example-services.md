# Example services

Curated services the agent can call with `ampersend fetch`, organized by the capability categories listed in
[`SKILL.md`](../SKILL.md). Use this file when the user is exploring, names a capability without naming a provider, or
already has a service from the list below in mind.

Two ground rules before suggesting any service:

- **Always check the price first.** Run `ampersend fetch --inspect <url>` before paying. Prices on third-party services
  drift; this file deliberately lists none.
- **Don't recommend providers from training.** If a capability the user wants isn't covered below, say so — don't fill
  the gap with a service from training data, since it may not be reachable from ampersend or may have moved.

Some services expose their own paid endpoints; others (Apollo, Hunter, FlightAware, RentCast) are reached through
StableEnrich, an aggregator gateway that fronts several upstream APIs behind one paid surface. The URL in each entry is
what the agent actually calls.

Each entry below gives the endpoint, body shape, and one runnable `ampersend fetch` invocation. Read the upstream docs
linked in each entry before relying on field semantics — this file captures the shape of the call, not full schemas.

There is also one **response pattern** at the end of the file (Pinata) — that's a service the agent doesn't suggest
proactively but should know how to handle when the user pastes a specific URL shape.

## Contents

- [Web search](#web-search)
- [Email](#email)
- [Email lookup and verification](#email-lookup-and-verification)
- [Voice calls](#voice-calls)
- [Flight tracking](#flight-tracking)
- [Property valuation](#property-valuation)
- [Domain registration](#domain-registration)
- [File hosting](#file-hosting)
- [Image and video generation](#image-and-video-generation)
- [LLM inference](#llm-inference)
- [Social data](#social-data)
- [News and market data](#news-and-market-data)
- [Job search](#job-search)
- [Travel search](#travel-search)
- [Physical mail](#physical-mail)
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
  ampersend fetch -X POST -H "Content-Type: application/json" \
    -d '{"query":"premier league fixtures 2025/26","limit":3,"scrapeOptions":{"formats":["markdown"],"onlyMainContent":true}}' \
    https://api.firecrawl.dev/v1/x402/search
  ```
- Docs: <https://docs.firecrawl.dev/x402/search>

## Email

### AgentMail

Giving the agent its own working email address — create an inbox, send mail, receive mail. Suggest when the user wants
the agent to handle a back-and-forth conversation by email.

- Base URL for paid endpoints: `https://x402.api.agentmail.to` (this replaces the standard base URL; payment is
  negotiated automatically on each request).
- Endpoints follow AgentMail's public API (e.g. inbox creation, message send). Check the upstream docs for the path and
  body shape for the action you want.
- Inspect first against the specific endpoint to confirm price.
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
  ampersend fetch -X POST -H "Content-Type: application/json" \
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
  ampersend fetch -X POST -H "Content-Type: application/json" \
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
  ampersend fetch -X POST -H "Content-Type: application/json" \
    -d '{"phone_number":"+14155551234","task":"Confirm our 2pm reservation tomorrow."}' \
    https://stablephone.dev/api/call
  ```
- Docs: <https://stablephone.dev/>

## Flight tracking

### FlightAware (via StableEnrich)

Checking whether a flight is on time, delayed, or cancelled — including history for past flights. Suggest when the user
mentions a specific flight and wants the actual outcome, not the airline's cheerful estimate.

- StableEnrich exposes FlightAware data behind `https://stableenrich.dev/api/flightaware/...` paths covering live
  status, history, and airport routes. The exact path depends on the lookup; consult the upstream docs.
- Body shape mirrors the underlying FlightAware AeroAPI (typically a flight identifier or airport pair).
- Inspect first to confirm the path and price for the specific lookup type.
- Docs: <https://stableenrich.dev/> and <https://www.flightaware.com/aeroapi/portal>

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
  ampersend fetch \
    "https://stableenrich.dev/api/rentcast/avm/value?address=742%20Evergreen%20Terrace%2C%20Springfield%2C%20IL%2062701"
  ```
- Use the response's `value`, `rangeLow`, `rangeHigh`, and the `comparables` array. Estimates are model output, not
  appraisals — flag that to the user.
- Docs: <https://developers.rentcast.io/reference/value-estimate>

## Domain registration

### Bloomfilter

Searching, registering, renewing, and configuring DNS for domains. Suggest when the user wants the agent to acquire a
domain end-to-end without setting up a registrar account.

- Endpoints cover availability search, registration, renewal, and DNS management across 400+ TLDs. Auth is wallet-based
  (SIWE); no signup.
- Inspect the specific endpoint to confirm price before registering — registration is a real, non-refundable purchase.
- Docs: <https://bloomfilter.xyz/>

## File hosting

### StableUpload

Uploading a file and getting back a shareable link. Suggest when the user wants to drop a file somewhere quickly without
provisioning storage.

- `POST https://stableupload.dev/api/upload` to mint an upload session; the response includes the actual upload command.
- Two-step shape: first call mints the session (paid), second call uploads bytes against the returned URL.
- Docs: <https://stableupload.dev/>

## Image and video generation

### StableStudio

Making an image or short video to a prompt, across multiple models. Suggest when the user wants a one-off image or clip
without standing up a generation account.

- Models range from fast and cheap to slow and expensive — `--inspect` matters more here than usual.
- Endpoint paths and body shapes are model-specific; consult upstream docs before composing the request.
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
  ampersend fetch -X POST -H "Content-Type: application/json" \
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
  ampersend fetch -X POST -H "Content-Type: application/json" \
    -d '{"keywords":"ampersend","max_page_size":10}' \
    https://stablesocial.dev/api/facebook/search
  ```
- Docs: <https://stablesocial.dev/openapi.json>

## News and market data

### Gloria

Getting real-time news and market intelligence feeds (crypto, macro, AI). Suggest when the user wants up-to-the-minute
news as input to a downstream task.

- Endpoints include `/news`, `/recaps`, `/news-by-keyword`. Request shape is documented upstream; inspect first to
  confirm both the path and the price.
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

- One endpoint covers all four trip-element types; check the Swagger UI for the exact path and body.
- This is a _search_ endpoint — booking is not part of the call.
- Docs: <https://stabletravel.dev/docs>

## Physical mail

### PostalForm

Printing a letter and mailing it through USPS. Suggest when the user wants to send a real piece of paper to someone —
greeting cards, formal letters, opt-out notices — without going to a printer or post office.

- `POST https://postalform.com/api/machine/orders` is the order endpoint. Body includes `request_id` (UUID), buyer info,
  sender and recipient details, and a `pdf` field referencing an `upload_token` from a prior upload step.
- Sending a letter is two calls: first upload the PDF to get an `upload_token`, then submit the order referencing that
  token. The upload endpoint and full body schema aren't captured here — consult upstream docs before composing.
- Once submitted, the letter cannot be cancelled. Show the user the full submission and get explicit confirmation before
  calling.
- Docs: <https://postalform.com/developers>

## Real-world purchases

These services produce a redeemable artifact (a card, a code, an eSIM activation), not a service response. Before
calling, confirm with the user that they want the agent to make the purchase — the funds leave the agent's account and
the artifact is the only thing returned.

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

### Bitrefill

Buying gift cards, mobile top-ups, and eSIMs. Suggest when the user explicitly wants the agent to acquire a redeemable
code (e.g. an OpenAI gift card to renew a subscription).

- The Bitrefill Agents SDK exposes the purchase flow; endpoint shapes follow Bitrefill's standard purchase API. The
  redemption code is returned in the response — capture it carefully, it's the entire value of the call.
- Docs: <https://github.com/bitrefill/awesome-agentic-payments>

## Response patterns

Services the agent doesn't suggest proactively but should know how to handle when the user provides a specific URL.

### Pinata x402 gateway

If the user pastes a URL of the shape `https://<gateway>.mypinata.cloud/x402/cid/<cid>`, that's a paywalled file on
IPFS. The agent fetches it like any other URL — the gateway returns 402, ampersend pays, and the file streams back.

- `GET https://<gateway>.mypinata.cloud/x402/cid/<cid>`
- Example (use the user's actual gateway and CID):
  ```bash
  ampersend fetch https://your-gateway.mypinata.cloud/x402/cid/bafybei...
  ```
- Don't suggest this category unprompted — it only applies when the user already has a gateway URL.
- Docs: <https://docs.pinata.cloud/files/x402/intro>
