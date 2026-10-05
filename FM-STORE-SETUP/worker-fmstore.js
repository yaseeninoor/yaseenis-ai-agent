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
  const rows=await searchKnowledge(env,question);
  if (!rows.length) return "மன்னிக்கவும். இந்த கேள்விக்கான தகவல் FM Store ஆதாரங்களில் கிடைக்கவில்லை.";

  const sources=rows.map((r,i)=>
    `[S${i+1}] File: ${r.file_path}${r.sheet_name ? " | Sheet: "+r.sheet_name : ""}${r.page_no ? " | Page: "+r.page_no : ""}\n${r.content}`
  ).join("\n\n");

  const model=env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const prompt=`You are the FM Store WhatsApp AI assistant.
Use ONLY the supplied source excerpts. Do not use outside knowledge and do not invent values.
If the sources do not answer the question, say exactly:
மன்னிக்கவும். இந்த கேள்விக்கான தகவல் FM Store ஆதாரங்களில் கிடைக்கவில்லை.
For current stock, use only an authoritative current-stock source; never calculate stock from PR, PO, gate entry, reservation or material-document transactions.
Answer in the user's language. Keep it concise. Include source citations such as [S1] at the end of factual statements.

QUESTION:
${question}

SOURCE EXCERPTS:
${sources}`;

  const resp=await fetch(endpoint,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:700}})
  });
  const data=await resp.json();
  if (!resp.ok) throw new Error("Gemini error: "+JSON.stringify(data));
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "AI response கிடைக்கவில்லை.";
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
