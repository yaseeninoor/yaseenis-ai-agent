# Yaseeni PDF Library — Setup (Tamil)

## Features
- WhatsApp-ல் PDF புத்தகம் அல்லது image அனுப்பினால் R2 + D1-ல் auto-save; default status pending.
- NOTE: தலைப்பு | குறிப்பு உரை என்ற format-ல் text note சேமிக்கப்படும்.
- Admin commands: PENDING, APPROVE <id>, REJECT <id>.
- பயனர் புத்தகப் பெயரை WhatsApp-ல் அனுப்பினால் approved items-ஐத் தேடி download links அனுப்பும்.
- Website: /library; file links: /library/file?id=...
- தொடர்பில்லாத messages தற்போதைய AI-க்கு fallback ஆகும்.

## 1. Cloudflare storage
1. Cloudflare Dashboard → R2 → bucket: yaseeni-pdf-library.
2. Workers & Pages → D1 → database: yaseeni-pdf-db.
3. D1 Console-ல் pdf-library.sql உள்ள SQL-ஐ run செய்யவும்.

## 2. Worker bindings and secrets
- R2 binding variable: PDF_BUCKET → bucket yaseeni-pdf-library.
- D1 binding variable: PDF_DB → database yaseeni-pdf-db.
- Secret/variable ADMIN_WHATSAPP_NUMBER: Admin WhatsApp number, country code உடன் digits மட்டும் (எ.கா. 9715XXXXXXX; + வேண்டாம்).
- ஏற்கனவே உள்ள WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN அப்படியே இருக்க வேண்டும்.

## 3. Connect the module to worker.js
Add this import at the top:
    import { handleLibraryHttp, handleLibraryMessage } from "./pdf-library.js";

In fetch(request, env), after const url = new URL(request.url); add:
    const libraryResponse = await handleLibraryHttp(request, env);
    if (libraryResponse) return libraryResponse;

In the POST /webhook route, after the message is extracted and before the existing non-text check, add:
    if (message && await handleLibraryMessage(message, env, new URL(request.url).origin)) {
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

## 4. WhatsApp commands
Admin:
- PENDING — list pending uploads
- APPROVE <id> — approve and publish
- REJECT <id> — reject

Users:
- PDF/image-ஐ WhatsApp-ல் அனுப்பலாம்; caption-ல் புத்தகப் பெயர் எழுதவும்.
- NOTE: தலைப்பு | குறிப்பு உரை — text note upload.
- புத்தகப் பெயரை மட்டும் அனுப்பலாம்; அல்லது BOOK: தலைப்பு / SEARCH: தலைப்பு.

## Limits and safety
- MVP cap: 25 MB per file; PDF, JPG, PNG, WEBP only.
- Uploads stay pending until admin approval; only approved items are public.
- Cloudflare free quotas can change; monitor usage.
- Only upload/share files you have permission to distribute. Do not upload private documents to a public library.
- Source code only: bindings, SQL execution and deployment still require setup steps above.
