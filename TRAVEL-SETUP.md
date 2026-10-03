# Yaseeni Travel AI — MVP setup

This branch adds a flight-search page and WhatsApp travel-agent routing to the existing Cloudflare Worker. It does not replace the EMS/Yaseenis assistant: non-travel messages continue through the current Workers AI path.

## Routes

- `/` — existing Worker health response
- `/webhook` — existing Meta WhatsApp webhook
- `/travel` — new responsive flight-search page
- `/api/flights` — flight search endpoint used by the page

## 1. Configure secrets in Cloudflare

Keep all keys out of GitHub. In the Cloudflare Worker settings, add these as encrypted secrets:

- `WHATSAPP_ACCESS_TOKEN` — existing Meta token
- `WHATSAPP_PHONE_NUMBER_ID` — existing WhatsApp phone number ID
- `WHATSAPP_VERIFY_TOKEN` — existing webhook verification token
- `GEMINI_API_KEY` — Google AI Studio API key, used for travel intent/tool calling
- `AMADEUS_API_KEY` — optional Amadeus for Developers API key
- `AMADEUS_API_SECRET` — optional Amadeus API secret

With Wrangler CLI, from the repository root:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put AMADEUS_API_KEY
npx wrangler secret put AMADEUS_API_SECRET
npx wrangler deploy
```

Paste each value only into the CLI prompt. Do not commit secrets to `wrangler.jsonc` or any source file. Do not re-enter the existing WhatsApp secrets if they are already configured in the Worker.

## 2. Amadeus flight-search setup

1. Register at https://developers.amadeus.com/ and create a Self-Service app.
2. Copy the API key and secret into Cloudflare Worker secrets above.
3. The initial implementation calls the Amadeus **test** environment. Its dataset is limited and its fares must not be represented as guaranteed live availability.
4. If Amadeus credentials are not configured, the agent still creates a Google Flights search link, but it does not claim to have retrieved prices.

Google Flights is used as an external search destination, not scraped. Google Flights does not provide a general public flight-search API for arbitrary apps.

## 3. Test the website

After deployment, open:

`https://YOUR-WORKER-DOMAIN/travel`

Example request to test the endpoint (use a future date):

```bash
curl -X POST 'https://YOUR-WORKER-DOMAIN/api/flights' \
  -H 'content-type: application/json' \
  -d '{
    "origin": "AUH",
    "destination": "CJB",
    "departureDate": "2026-11-20",
    "adults": 1,
    "children": 0,
    "currencyCode": "AED"
  }'
```

The response may include limited Amadeus test offers and a Google Flights link. Check the link and provider details yourself before using it with customers.

## 4. Test WhatsApp

Send a message to the existing WhatsApp Business number, for example:

`Find a flight AUH to CJB on 2026-11-20 for 1 adult, one way`

The AI should ask for missing details, call flight search when it has enough information, and show a Google Flights link. The existing non-travel assistant remains the fallback for unrelated messages.

If the message is not detected as travel-related, try words like “flight”, “ticket”, “fare”, “trip”, “hotel”, “விமானம்”, or “டிக்கெட்”.

## 5. Booking limitations — important

This MVP searches and links out; it does **not** charge a card, create a confirmed airline order, or issue an e-ticket.

For real in-chat booking, implement the provider's supported price-confirmation and order-creation flow, secure passenger data collection, payment processing, cancellation/refund handling, idempotency, and an explicit final customer approval. Amadeus notes that ticket issuance through its Self-Service flow requires an airline consolidator; its Enterprise booking options have additional requirements. See https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/faq/ and https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/pricing/.

Until a booking partner and production access are configured, describe the WhatsApp flow as flight search and booking assistance—not as a ticket-booking system that can issue tickets.

## 6. Recommended next phases

1. Add persistent trip sessions in D1 so users can resume searches.
2. Add a booking-provider adapter only after choosing a provider that supports your target markets (India, UAE, international).
3. Add a payment provider and secure passenger-details form; do not collect card details in WhatsApp chat.
4. Add hotels and itinerary tools from providers with terms that allow your use case.
5. Add logging/redaction, request limits, webhook signature validation, and tests before public launch.

## Data protection

Never log full WhatsApp messages containing passport details or payment data. Collect only data needed for the current trip, protect it, and set a retention/deletion policy before launch.
