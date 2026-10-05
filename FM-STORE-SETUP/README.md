# FM Store WhatsApp AI Agent

Architecture:
GitHub Private Source Library -> GitHub Actions -> Cloudflare Worker -> D1 fmstore -> Gemini -> WhatsApp.

Put Excel, PDF, Word, CSV and TXT/MD files under FM-STORE-SETUP/source-files/.

Excel xlsx/xlsm files are read sheet-by-sheet.

Cloudflare:
Keep the existing praveen-whatsapp-bot, its DB -> fmstore binding and existing WhatsApp/Gemini secrets. Add only INGEST_TOKEN.

Create the D1 tables with schema.sql.

Add an authenticated Worker endpoint:
POST /internal/ingest
Header: Authorization: Bearer INGEST_TOKEN

The endpoint must upsert knowledge_files and replace chunks for the affected source path.

GitHub Actions:
Create repository secrets INGEST_URL and INGEST_TOKEN.
The workflow runs automatically when files under FM-STORE-SETUP/source-files/ change.

Grounding:
WhatsApp answers retrieve relevant chunks from knowledge_chunks and send only those excerpts to Gemini. Gemini must not invent stock, PR, PO, GRN or other values. Current stock must come from the authoritative current-stock report, not inferred from transactions.

Security:
Never commit API keys, WhatsApp tokens or ingest tokens. Keep the repository private and use GitHub/Cloudflare secrets.

OCR:
The base indexer supports text PDFs. Scanned/image-only PDFs require an OCR step before indexing.