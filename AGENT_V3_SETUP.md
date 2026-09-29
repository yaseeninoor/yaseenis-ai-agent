# Yaseeni Noor AI Agent V3

This branch introduces a tool-calling agent layer while keeping WhatsApp and the existing Cloudflare Workers AI binding.

## Agent flow

WhatsApp -> Worker -> LLM Agent -> tool calls -> Knowledge / EMS / Memory -> LLM -> WhatsApp

## Tools

- search_knowledge
- search_ems
- get_memory
- save_memory

## Current state

The Worker already has the `AI` binding. The agent is configured for EMS/approved-source grounding by default:

`AGENT_GROUNDED_ONLY=true`

For source-grounded answers to work, configure the `DB` and `EMS_SEARCH` bindings.

## D1

Use `knowledge/agent-schema.sql` to create:

- knowledge
- conversation_memory

Then add the D1 binding in `wrangler.jsonc`.

## EMS Search

The agent supports an `EMS_SEARCH` binding exposing a `search()` method. It sends:

- retrieval_type: vector
- match_threshold: 0.0
- max_num_results: 8
- context_expansion: 1

## WhatsApp

Keep these secrets configured in Cloudflare:

- WHATSAPP_ACCESS_TOKEN
- WHATSAPP_PHONE_NUMBER_ID
- WHATSAPP_VERIFY_TOKEN

## Test

After deployment:

- GET /health
- GET /
- Configure the WhatsApp webhook to /webhook

Do not commit API keys or WhatsApp tokens.
