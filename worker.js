import { runAgent } from "./agent.js";

// ============================================================
// YASEENI NOOR AI — WHATSAPP AGENT V3
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return jsonResponse({
        project: "Yaseeni Noor AI Agent",
        version: "V3",
        status: "online",
        agent: "tool-calling",
        model: env.AGENT_MODEL || "@cf/meta/llama-3.1-8b-instruct-fast",
        webhook: "/webhook"
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        status: "ok",
        ai: !!env.AI,
        whatsapp: !!env.WHATSAPP_ACCESS_TOKEN && !!env.WHATSAPP_PHONE_NUMBER_ID,
        knowledge: !!env.DB,
        emsSearch: !!env.EMS_SEARCH,
        groundedOnly: String(env.AGENT_GROUNDED_ONLY ?? "true")
      });
    }

    if (request.method === "GET" && url.pathname === "/webhook") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (
        mode === "subscribe" &&
        token === env.WHATSAPP_VERIFY_TOKEN &&
        challenge
      ) {
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }

      return new Response("Forbidden", { status: 403 });
    }

    if (request.method === "POST" && url.pathname === "/webhook") {
      try {
        const body = await request.json();
        const message =
          body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (!message) return new Response("EVENT_RECEIVED", { status: 200 });

        if (message.type !== "text") {
          return new Response("EVENT_RECEIVED", { status: 200 });
        }

        const from = message.from;
        const userText = message.text?.body?.trim() || "";

        if (!from || !userText) {
          return new Response("EVENT_RECEIVED", { status: 200 });
        }

        console.log(JSON.stringify({
          step: "AGENT_START",
          user: from,
          messageLength: userText.length
        }));

        const reply = await runAgent({
          env,
          userId: from,
          userText
        });

        await sendWhatsApp(
          from,
          reply,
          env.WHATSAPP_ACCESS_TOKEN,
          env.WHATSAPP_PHONE_NUMBER_ID
        );

        console.log(JSON.stringify({
          step: "AGENT_COMPLETE",
          user: from
        }));

        return new Response("EVENT_RECEIVED", { status: 200 });
      } catch (error) {
        console.error(JSON.stringify({
          step: "WEBHOOK_ERROR",
          message: error?.message || String(error),
          stack: error?.stack || null
        }));

        return new Response("EVENT_RECEIVED", { status: 200 });
      }
    }

    return jsonResponse({ error: "Not Found" }, 404);
  }
};

async function sendWhatsApp(to, message, accessToken, phoneNumberId) {
  if (!accessToken) throw new Error("WHATSAPP_ACCESS_TOKEN is missing");
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is missing");
  if (!message) throw new Error("WhatsApp message is empty");

  const apiUrl =
    `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: message
      }
    })
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `WhatsApp API error ${response.status}: ${responseText}`
    );
  }

  return true;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
