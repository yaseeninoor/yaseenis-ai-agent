// Yaseeni PDF Library module. Bindings: PDF_BUCKET (R2), PDF_DB (D1).
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function handleLibraryHttp(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET" || !url.pathname.startsWith("/library")) return null;

  if (url.pathname === "/library/file") {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing file id", { status: 400 });
    const row = await env.PDF_DB.prepare("SELECT id,title,kind,filename,mime_type,r2_key,note_text,status FROM library_items WHERE id = ?").bind(id).first();
    if (!row || row.status !== "approved") return new Response("File not found", { status: 404 });
    if (row.kind === "note") {
      return new Response(row.note_text || "", { headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="' + safeFilename(row.filename || row.title + ".txt") + '"',
        "X-Content-Type-Options": "nosniff"
      }});
    }
    const object = await env.PDF_BUCKET.get(row.r2_key);
    if (!object) return new Response("Stored file not found", { status: 404 });
    return new Response(object.body, { headers: {
      "Content-Type": row.mime_type || object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": 'attachment; filename="' + safeFilename(row.filename || row.title) + '"',
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff"
    }});
  }

  if (url.pathname === "/library" || url.pathname === "/library/") {
    const q = (url.searchParams.get("q") || "").trim();
    const result = q
      ? await env.PDF_DB.prepare("SELECT id,title,kind,filename,created_at FROM library_items WHERE status='approved' AND (title LIKE ? OR filename LIKE ? OR note_text LIKE ?) ORDER BY created_at DESC LIMIT 100").bind("%"+q+"%","%"+q+"%","%"+q+"%").all()
      : await env.PDF_DB.prepare("SELECT id,title,kind,filename,created_at FROM library_items WHERE status='approved' ORDER BY created_at DESC LIMIT 100").all();
    const cards = (result.results || []).map(item => {
      const link = "/library/file?id=" + encodeURIComponent(item.id);
      const kind = item.kind === "pdf" ? "PDF book" : item.kind === "image" ? "Image" : "Text note";
      return '<article><strong>' + htmlEscape(item.title) + '</strong><p>' + kind + '</p><a href="' + link + '">View / Download</a></article>';
    }).join("");
    return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yaseeni PDF Library</title><style>body{font:16px system-ui;max-width:850px;margin:32px auto;padding:0 16px;background:#faf8f4;color:#202124}h1{color:#234b38}form{display:flex;gap:8px}input{flex:1;padding:12px;border:1px solid #ccc;border-radius:8px}button,a{padding:10px 14px;border-radius:8px;background:#234b38;color:white;text-decoration:none;border:0}article{background:white;border:1px solid #e5e2dc;border-radius:12px;padding:16px;margin:12px 0}article p{color:#666}</style><h1>Yaseeni PDF Library</h1><p>Search approved books, images and text notes.</p><form><input name="q" value="' + htmlEscape(q) + '" placeholder="Enter book name or keyword"><button>Search</button></form>' + (cards || "<p>No approved items found.</p>") + '</html>', { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }
  return null;
}

export async function handleLibraryMessage(message, env, origin) {
  const from = message?.from;
  if (!from) return false;
  const admin = digits(env.ADMIN_WHATSAPP_NUMBER || "");
  const isAdmin = !!admin && digits(from) === admin;

  if (message.type === "document" || message.type === "image") {
    const media = message[message.type] || {};
    const mime = String(media.mime_type || (message.type === "image" ? "image/jpeg" : "")).toLowerCase();
    const caption = String(media.caption || "").trim();
    const filename = safeFilename(media.filename || (message.type === "image" ? "whatsapp-image.jpg" : "whatsapp-document.pdf"));
    if (!ALLOWED_TYPES.has(mime)) {
      await sendText(from, "Yaseeni PDF Library: PDF, JPG, PNG, WEBP கோப்புகள் மட்டும் ஏற்கப்படும்.", env);
      return true;
    }
    if (mime === "application/pdf" && !filename.toLowerCase().endsWith(".pdf")) {
      await sendText(from, "PDF கோப்பின் பெயர் சரியாக இல்லை. PDF file ஆக மீண்டும் அனுப்பவும்.", env);
      return true;
    }
    try {
      const saved = await storeWhatsAppMedia(message, env, from, caption, filename, mime);
      await sendText(from, "உங்கள் கோப்பு தானாகச் சேமிக்கப்பட்டது.\nபெயர்: " + saved.title + "\nவகை: " + (saved.kind === "pdf" ? "PDF புத்தகம்" : "படம்") + "\nStatus: Admin approval pending.\nஅங்கீகரிக்கப்பட்ட பிறகு தேடிப் பதிவிறக்கம் செய்யலாம்.", env);
    } catch (error) {
      console.error("LIBRARY_UPLOAD_ERROR", error?.message || String(error));
      await sendText(from, "கோப்பைச் சேமிக்க முடியவில்லை. தயவுசெய்து சிறிது நேரம் கழித்து மீண்டும் அனுப்பவும்.", env);
    }
    return true;
  }

  if (message.type !== "text") return false;
  const text = String(message.text?.body || "").trim();
  if (!text) return false;

  if (isAdmin && /^PENDING$/i.test(text)) {
    const result = await env.PDF_DB.prepare("SELECT id,title,kind,uploaded_by,created_at FROM library_items WHERE status='pending' ORDER BY created_at ASC LIMIT 20").all();
    const rows = result.results || [];
    await sendText(from, rows.length ? "Approval pending:\n" + rows.map(r => r.id + " | " + r.title + " | " + r.kind + "\nApprove: APPROVE " + r.id + "\nReject: REJECT " + r.id).join("\n\n") : "Approval pending உள்ள கோப்புகள் இல்லை.", env);
    return true;
  }

  const decision = text.match(/^(APPROVE|REJECT)\s+([a-f0-9-]{8,64})$/i);
  if (isAdmin && decision) {
    const status = decision[1].toUpperCase() === "APPROVE" ? "approved" : "rejected";
    const result = await env.PDF_DB.prepare("UPDATE library_items SET status=?,reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending'").bind(status, from, new Date().toISOString(), decision[2]).run();
    if (!result.meta?.changes) {
      await sendText(from, "இந்த ID கிடைக்கவில்லை அல்லது ஏற்கனவே review செய்யப்பட்டுள்ளது.", env);
    } else {
      const item = await env.PDF_DB.prepare("SELECT title,uploaded_by FROM library_items WHERE id=?").bind(decision[2]).first();
      await sendText(from, (status === "approved" ? "Approved" : "Rejected") + ": " + (item?.title || decision[2]), env);
      if (status === "approved" && item?.uploaded_by) {
        await sendText(item.uploaded_by, "உங்கள் கோப்பு Admin மூலம் அங்கீகரிக்கப்பட்டது.\nபெயர்: " + item.title + "\nபுத்தகப் பெயரை WhatsApp-ல் அனுப்பி download link பெறலாம்.\nLibrary: " + origin + "/library", env);
      }
    }
    return true;
  }

  const note = text.match(/^(?:NOTE|TEXT NOTE|குறிப்பு)\s*:\s*([^|\n]{2,120})\s*\|\s*([\s\S]{1,12000})$/i);
  if (note) {
    const id = crypto.randomUUID();
    await env.PDF_DB.prepare("INSERT INTO library_items (id,title,kind,filename,mime_type,r2_key,note_text,uploaded_by,created_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id, note[1].trim(), "note", safeFilename(note[1].trim()+".txt"), "text/plain", null, note[2].trim(), from, new Date().toISOString(), "pending").run();
    await sendText(from, "Text note தானாகச் சேமிக்கப்பட்டது.\nபெயர்: " + note[1].trim() + "\nStatus: Admin approval pending.", env);
    return true;
  }

  const explicitSearch = /^(?:BOOK|SEARCH|புத்தகம்|தேடல்)\s*:/i.test(text);
  const query = text.replace(/^(?:BOOK|SEARCH|புத்தகம்|தேடல்)\s*:\s*/i, "").trim();
  if (query.length >= 2) {
    const result = await env.PDF_DB.prepare("SELECT id,title,kind,filename FROM library_items WHERE status='approved' AND (title LIKE ? OR filename LIKE ? OR note_text LIKE ?) ORDER BY created_at DESC LIMIT 5").bind("%"+query+"%","%"+query+"%","%"+query+"%").all();
    const rows = result.results || [];
    if (rows.length) {
      const response = "Yaseeni PDF Library - கிடைத்தவை:\n\n" + rows.map((r,i) => (i+1)+". "+r.title+" ("+(r.kind==="pdf"?"PDF புத்தகம்":r.kind==="image"?"Image":"Text note")+")\n"+origin+"/library/file?id="+encodeURIComponent(r.id)).join("\n\n") + "\n\nமேலும் புத்தகங்களுக்கு: " + origin + "/library";
      await sendText(from, response, env);
      return true;
    }
    if (explicitSearch) {
      await sendText(from, "இந்தப் பெயரில் அங்கீகரிக்கப்பட்ட புத்தகம் அல்லது கோப்பு கிடைக்கவில்லை. வேறு பெயரில் தேடவும்: " + origin + "/library", env);
      return true;
    }
  }
  return false;
}

async function storeWhatsAppMedia(message, env, from, caption, filename, mime) {
  const media = message[message.type];
  if (!media?.id) throw new Error("WhatsApp media id missing");
  const token = env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("WhatsApp access token missing");
  const metaResponse = await fetch("https://graph.facebook.com/v26.0/" + encodeURIComponent(media.id), { headers: { Authorization: "Bearer " + token }});
  if (!metaResponse.ok) throw new Error("Media metadata request failed: " + metaResponse.status);
  const metadata = await metaResponse.json();
  if (metadata.file_size && Number(metadata.file_size) > MAX_UPLOAD_BYTES) throw new Error("File exceeds 25 MB library limit");
  if (metadata.mime_type && !ALLOWED_TYPES.has(String(metadata.mime_type).toLowerCase())) throw new Error("Unsupported media MIME type");
  const fileResponse = await fetch(metadata.url, { headers: { Authorization: "Bearer " + token }});
  if (!fileResponse.ok || !fileResponse.body) throw new Error("Media download failed: " + fileResponse.status);
  const length = Number(fileResponse.headers.get("content-length") || metadata.file_size || 0);
  if (length > MAX_UPLOAD_BYTES) throw new Error("File exceeds 25 MB library limit");
  const id = crypto.randomUUID();
  const kind = mime === "application/pdf" ? "pdf" : "image";
  const title = caption || filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  const r2Key = "pending/" + id + "/" + filename;
  await env.PDF_BUCKET.put(r2Key, fileResponse.body, { httpMetadata: { contentType: mime }, customMetadata: { itemId: id, uploadedBy: digits(from) }});
  await env.PDF_DB.prepare("INSERT INTO library_items (id,title,kind,filename,mime_type,r2_key,note_text,uploaded_by,created_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id, title, kind, filename, mime, r2Key, null, from, new Date().toISOString(), "pending").run();
  return { id, title, kind };
}

async function sendText(to, body, env) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp credentials missing");
  const response = await fetch("https://graph.facebook.com/v26.0/" + env.WHATSAPP_PHONE_NUMBER_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.WHATSAPP_ACCESS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: true, body }})
  });
  if (!response.ok) throw new Error("WhatsApp send failed: " + response.status + " " + await response.text());
}
function safeFilename(value) { return String(value || "file").replace(/[\r\n"\\]/g, "_").replace(/\//g, "_").replace(/\.\./g, "_").slice(0,160) || "file"; }
function digits(value) { return String(value || "").replace(/\D/g, ""); }
function htmlEscape(value) { return String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
