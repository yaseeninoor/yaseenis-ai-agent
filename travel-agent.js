// Travel tools for the existing Yaseenis WhatsApp Worker.
// No credentials are stored in this file. Configure them as Worker secrets.
const GEMINI_MODEL = "gemini-2.5-flash";
const AMADEUS_BASE = "https://test.api.amadeus.com";

const TRAVEL_HINTS = /\b(flight|flights|airfare|air fare|ticket|tickets|travel|trip|hotel|holiday|vacation|itinerary|booking|book|fare|airport|google flights|makemytrip|amadeus)\b|விமான|டிக்கெட்|பயணம்|ஹோட்டல்|புக்கிங்|تذكرة|رحلة/i;

const SYSTEM = `You are Yaseenis Travel Agent, a multilingual travel assistant inside WhatsApp.
Help users search flights, compare returned offers, create external flight-search links, and draft itineraries.
Use the search_flights tool only when origin/destination IATA codes and departure date are known.
If any required detail is missing, ask a short follow-up instead of guessing. Dates must be YYYY-MM-DD.
Ask whether the trip is one-way or return; for return trips require a return date. Adults defaults to 1 only if the user clearly says one traveler; otherwise ask.
Never invent prices, schedules, airlines, baggage rules, booking confirmations, or ticket numbers.
Amadeus test data is a limited sample and may not match live fares. State that clearly.
External Google Flights links are search links, not proof of a fare or a booking.
Never place an order or claim a ticket was issued. Booking must be completed with a provider and explicit traveler approval.
Use the user's language (Tamil, English, or Arabic). Keep WhatsApp responses concise.`;

const DECLARATIONS = [
  {
    name: "search_flights",
    description: "Search flight offers through Amadeus. Use only after user has given airport/city IATA codes, departure date and adult count. Test API results may be limited.",
    parameters: {
      type: "OBJECT",
      properties: {
        origin: { type: "STRING", description: "Three-letter IATA origin code, e.g. AUH" },
        destination: { type: "STRING", description: "Three-letter IATA destination code, e.g. CJB" },
        departureDate: { type: "STRING", description: "Departure date YYYY-MM-DD" },
        returnDate: { type: "STRING", description: "Optional return date YYYY-MM-DD" },
        adults: { type: "INTEGER", description: "Number of adult travelers, 1-9" },
        children: { type: "INTEGER", description: "Number of child travelers, 0-8" },
        currencyCode: { type: "STRING", description: "Currency code such as AED, INR or USD" }
      },
      required: ["origin", "destination", "departureDate", "adults"]
    }
  },
  {
    name: "create_flight_search_link",
    description: "Create a Google Flights search link. This does not book a ticket and does not return a verified price.",
    parameters: {
      type: "OBJECT",
      properties: {
        origin: { type: "STRING", description: "IATA airport code or city" },
        destination: { type: "STRING", description: "IATA airport code or city" },
        departureDate: { type: "STRING", description: "Departure date YYYY-MM-DD" },
        returnDate: { type: "STRING", description: "Optional return date YYYY-MM-DD" },
        adults: { type: "INTEGER", description: "Number of adults" }
      },
      required: ["origin", "destination", "departureDate"]
    }
  }
];

export async function handleTravelMessage(userText, env) {
  if (!TRAVEL_HINTS.test(userText)) return null;

  if (!env.GEMINI_API_KEY) {
    return "I can help with flights and trip planning, but the travel AI is not configured yet. Please add the GEMINI_API_KEY Worker secret.\n\nTo search fares now: https://www.google.com/travel/flights";
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const contents = [{ role: "user", parts: [{ text: userText }] }];

  let response = await callGemini(url, contents);
  let parts = response?.candidates?.[0]?.content?.parts || [];
  const functionCalls = parts.filter(p => p.functionCall);

  if (functionCalls.length) {
    const functionResponses = [];
    for (const part of functionCalls) {
      const { name, args = {} } = part.functionCall;
      let result;
      try {
        if (name === "search_flights") result = await searchFlights(args, env);
        else if (name === "create_flight_search_link") result = { url: createGoogleFlightsLink(args), note: "Search link only; fare is not verified and no booking was made." };
        else result = { error: "Unsupported tool" };
      } catch (e) {
        result = { error: safeError(e) };
      }
      functionResponses.push({ functionResponse: { name, response: result } });
    }
    contents.push({ role: "model", parts });
    contents.push({ role: "user", parts: functionResponses });
    response = await callGemini(url, contents);
    parts = response?.candidates?.[0]?.content?.parts || [];
  }

  const text = parts.filter(p => p.text).map(p => p.text).join("\n").trim();
  if (text) return text.slice(0, 3800);

  // Safe fallback if model produced no user-facing text.
  return "I can help plan your trip. Please send: origin, destination, departure date, one-way or return, and number of adults/children. Example: AUH to CJB, 2026-11-20, one-way, 1 adult.";
}

async function callGemini(url, contents) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents,
      tools: [{ functionDeclarations: DECLARATIONS }],
      tool_config: { function_calling_config: { mode: "AUTO" } },
      generationConfig: { temperature: 0.2, maxOutputTokens: 900 }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini request failed (${res.status})`);
  return data;
}

function createGoogleFlightsLink(args) {
  const origin = cleanLocation(args.origin);
  const destination = cleanLocation(args.destination);
  const date = validDate(args.departureDate);
  const ret = args.returnDate ? validDate(args.returnDate) : "";
  const pax = Number.isInteger(args.adults) && args.adults > 0 ? args.adults : 1;
  const query = ret
    ? `Flights from ${origin} to ${destination} departing ${date} returning ${ret} for ${pax} adults`
    : `Flights from ${origin} to ${destination} on ${date} for ${pax} adults`;
  return "https://www.google.com/travel/flights?q=" + encodeURIComponent(query);
}

async function searchFlights(args, env) {
  const origin = String(args.origin || "").toUpperCase();
  const destination = String(args.destination || "").toUpperCase();
  const departureDate = validDate(args.departureDate);
  const returnDate = args.returnDate ? validDate(args.returnDate) : "";
  const adults = Number(args.adults);
  const children = Math.max(0, Math.min(8, Number(args.children || 0)));
  const currencyCode = /^[A-Z]{3}$/.test(String(args.currencyCode || "").toUpperCase())
    ? String(args.currencyCode || "AED").toUpperCase() : "AED";

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
    return { error: "Use valid three-letter IATA airport codes. Ask the traveler to clarify city/airport." };
  }
  if (origin === destination) return { error: "Origin and destination must be different." };
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) return { error: "Adults must be between 1 and 9." };
  if (returnDate && returnDate < departureDate) return { error: "Return date must be on or after departure date." };

  const googleFlightsUrl = createGoogleFlightsLink({ ...args, origin, destination, departureDate, returnDate, adults });
  if (!env.AMADEUS_API_KEY || !env.AMADEUS_API_SECRET) {
    return {
      provider: "Google Flights link",
      liveOffersAvailable: false,
      googleFlightsUrl,
      message: "Amadeus credentials are not configured. No live fares were retrieved. Open the Google Flights link to check current prices."
    };
  }

  const tokenRes = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.AMADEUS_API_KEY,
      client_secret: env.AMADEUS_API_SECRET
    })
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    return { provider: "Amadeus", liveOffersAvailable: false, googleFlightsUrl, message: "Amadeus authentication failed. Open Google Flights to check current fares." };
  }

  const params = new URLSearchParams({
    originLocationCode: origin,
    destinationLocationCode: destination,
    departureDate,
    adults: String(adults),
    children: String(children),
    currencyCode,
    max: "5"
  });
  if (returnDate) params.set("returnDate", returnDate);

  const offerRes = await fetch(`${AMADEUS_BASE}/v2/shopping/flight-offers?${params}`, {
    headers: { authorization: `Bearer ${tokenData.access_token}` }
  });
  const offersData = await offerRes.json().catch(() => ({}));
  if (!offerRes.ok) {
    return { provider: "Amadeus test API", liveOffersAvailable: false, googleFlightsUrl, message: "The Amadeus API returned no usable offers for this request. Its test environment has limited sample data. Check Google Flights for current fares." };
  }

  const carriers = offersData.dictionaries?.carriers || {};
  const offers = (offersData.data || []).slice(0, 5).map((offer) => {
    const itineraries = (offer.itineraries || []).map((itinerary) => ({
      duration: itinerary.duration,
      segments: (itinerary.segments || []).map((seg) => ({
        from: seg.departure?.iataCode,
        departure: seg.departure?.at,
        to: seg.arrival?.iataCode,
        arrival: seg.arrival?.at,
        airline: carriers[seg.carrierCode] || seg.carrierCode,
        flightNumber: `${seg.carrierCode || ""}${seg.number || ""}`
      }))
    }));
    return {
      total: offer.price?.grandTotal || offer.price?.total,
      currency: offer.price?.currency || currencyCode,
      itineraries,
      validatingAirlineCodes: offer.validatingAirlineCodes || [],
      baggage: offer.travelerPricings?.[0]?.fareDetailsBySegment?.map(x => x.includedCheckedBags || null) || []
    };
  });

  return {
    provider: "Amadeus test API",
    environment: "TEST — limited sample data; not guaranteed live or bookable",
    liveOffersAvailable: offers.length > 0,
    offerCount: offers.length,
    offers,
    googleFlightsUrl,
    nextStep: "Recheck the selected fare with the pricing API before any booking. No ticket has been booked."
  };
}

function validDate(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z"))) {
    throw new Error("Please provide a valid date in YYYY-MM-DD format.");
  }
  return date;
}
function cleanLocation(value) {
  return String(value || "").trim().replace(/[<>\r\n]/g, "").slice(0, 60) || "Unknown";
}
function safeError(error) {
  const msg = String(error?.message || error || "Unknown error");
  return msg.slice(0, 180);
}
