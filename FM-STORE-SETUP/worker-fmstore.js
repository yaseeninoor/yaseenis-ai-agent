// FM Store WhatsApp AI Agent integration worker
// Deploy this as a separate Worker first, then point the WhatsApp webhook to it.
// Bind D1 database as DB -> fmstore.
// Secrets: GEMINI_API_KEY, WHATSAPP_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN, INGEST_TOKEN.
// Optional: GEMINI_MODEL (default gemini-2.5-flash), WHATSAPP_API_VERSION (default v26.0).

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({ok:true, project:"FM Store WhatsApp AI Agent", status:"online"});
      }

      if (url.pathname === "/internal/ingest" && request.method === "POST") {
        requireBearer(request, env.INGEST_TOKEN);
        const body = await request.json();
        const chunks = Array.isArray(body.chunks) ? body.chunks : [];
        if (!chunks.length) return json({ok:false,error:"No chunks"},400);

        const paths = [...new Set(chunks.map(x => String(x.file_path || "")).filter(Boolean))];
        for (const path of paths) {
          await env.DB.prepare("DELETE FROM knowledge_chunks WHERE file_path = ?").bind(path).run();
          await env.DB.prepare(
            "INSERT INTO knowledge_files(path,sha,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(path) DO UPDATE SET sha=excluded.sha,updated_at=CURRENT_TIMESTAMP"
          ).bind(path, body.ref || "").run();
        }

        const statements = chunks.map(c =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO knowledge_chunks(file_path,sheet_name,page_no,chunk_no,content,content_hash) VALUES(?,?,?,?,?,?)"
          ).bind(
            String(c.file_path || ""),
            c.sheet_name == null ? null : String(c.sheet_name),
            c.page_no == null ? null : Number(c.page_no),
            Number(c.chunk_no || 0),
            String(c.content || ""),
            String(c.content_hash || "")
          )
        );
        for (let i=0;i<statements.length;i+=50) await env.DB.batch(statements.slice(i,i+50));
        return json({ok:true,indexed:chunks.length,files:paths.length});
      }

      if (url.pathname === "/webhook" && request.method === "GET") {
        const mode=url.searchParams.get("hub.mode");
        const token=url.searchParams.get("hub.verify_token");
        const challenge=url.searchParams.get("hub.challenge");
        if (mode==="subscribe" && token===env.VERIFY_TOKEN && challenge) return new Response(challenge);
        return new Response("Forbidden",{status:403});
      }

      if (url.pathname === "/webhook" && request.method === "POST") {
        const body=await request.json();
        const msg=body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!msg || msg.type!=="text") return new Response("EVENT_RECEIVED");
        const from=msg.from;
        const question=(msg.text?.body || "").trim();
        if (!question) return new Response("EVENT_RECEIVED");

        const answer=await answerFromSources(env,question);
        await sendWhatsApp(env,from,answer);
        return new Response("EVENT_RECEIVED");
      }

      return json({ok:false,error:"Not Found"},404);
    } catch (e) {
      console.error("FM_STORE_ERROR", e?.stack || e);
      return json({ok:false,error:"Internal error"},500);
    }
  }
};

function requireBearer(request, expected) {
  const value=request.headers.get("Authorization") || "";
  if (!expected || value !== "Bearer " + expected) throw new Error("Unauthorized");
}

async function searchKnowledge(env, question) {
  const terms=[...new Set((question.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(x=>x.length>=2))].slice(0,8);
  if (!terms.length) return [];
  const clauses=terms.map(()=> "LOWER(content) LIKE ?").join(" OR ");
  const binds=terms.map(t=>"%"+t+"%");
  const r=await env.DB.prepare(
    `SELECT file_path,sheet_name,page_no,content FROM knowledge_chunks WHERE ${clauses} ORDER BY indexed_at DESC LIMIT 12`
  ).bind(...binds).all();
  return r.results || [];
}

async function answerFromSources(env, question) {
  const rows = await searchKnowledge(env, question);

  if (!rows.length) {
    return "மன்னிக்கவும். இந்த கேள்விக்கான தகவல் FM Store ஆதாரங்களில் கிடைக்கவில்லை.";
  }

  const sources = rows.map((r, i) => {
    const content = String(r.content || "");
    const trimmed = content.length > 4500 ? content.slice(0, 4500) + "\\n[truncated]" : content;
    return "[S" + (i + 1) + "] File: " + r.file_path +
      (r.sheet_name ? " | Sheet: " + r.sheet_name : "") +
      (r.page_no != null ? " | Page: " + r.page_no : "") +
      (r.chunk_no != null ? " | Chunk: " + r.chunk_no : "") + "\\n" + trimmed;
  }).join("\\n\\n");

  const prompt = [
    "You are the FM Store ST26 WhatsApp AI assistant.",
    "Answer naturally like a helpful LLM, but use ONLY the supplied source excerpts.",
    "Never use outside knowledge or invent any value.",
    "For CURRENT STOCK, use only the authoritative Current Stock source.",
    "Never calculate current stock from PR, PO, reservation, gate entry, or material-document transactions.",
    "Do not copy the whole Excel row. Extract only the fields needed.",
    "If asking for stock, give material name/code, current stock quantity, UOM and storage location when available.",
    "If multiple matches exist, list them clearly instead of guessing.",
    "Answer in the same language as the user.",
    "Keep the answer concise and useful.",
    "Add [S1], [S2], etc. after factual statements.",
    "If the sources do not support the answer, reply exactly: மன்னிக்கவும். இந்த கேள்விக்கான தகவல் FM Store ஆதாரங்களில் கிடைக்கவில்லை.",
    "",
    "QUESTION:",
    question,
    "",
    "SOURCE EXCERPTS:",
    sources
  ].join("\\n");

  const models = [...new Set([env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.0-flash"].filter(Boolean))];
  let lastError = null;

  for (const model of models) {
    try {
      const answer = await callGemini(env, model, prompt);
      if (answer) return answer.trim();
    } catch (error) {
      lastError = error;
      console.error("GEMINI_MODEL_FAILED", JSON.stringify({model, error: error?.message || String(error)}));
    }
  }

  console.error("ALL_GEMINI_MODELS_FAILED", lastError?.message || "unknown");
  return "மன்னிக்கவும். AI பதில் தற்போது உருவாக்க முடியவில்லை. மீண்டும் முயற்சி செய்யவும்.";
}

async function callGemini(env, model, prompt) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(env.GEMINI_API_KEY);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: "You are a grounded FM Store assistant. Use only the source excerpts supplied in the prompt. Never invent data." }]
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
    })
  });

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }

  if (!response.ok) {
    throw new Error("Gemini " + model + ": " + (data?.error?.message || ("HTTP " + response.status)));
  }

  const text = data?.candidates?.[0]?.content?.parts?.map(p => p?.text || "").join("").trim();
  if (!text) throw new Error("Gemini " + model + ": empty response");
  return text;
}

async function sendWhatsApp(env,to,message) {
  const version=env.WHATSAPP_API_VERSION || "v26.0";
  const endpoint=`https://graph.facebook.com/${version}/${env.PHONE_NUMBER_ID}/messages`;
  const resp=await fetch(endpoint,{
    method:"POST",
    headers:{"Authorization":`Bearer ${env.WHATSAPP_TOKEN}`,"Content-Type":"application/json"},
    body:JSON.stringify({messaging_product:"whatsapp",to,type:"text",text:{preview_url:false,body:message}})
  });
  if (!resp.ok) throw new Error("WhatsApp API error "+resp.status+": "+await resp.text());
}

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json;charset=UTF-8"}});
}
