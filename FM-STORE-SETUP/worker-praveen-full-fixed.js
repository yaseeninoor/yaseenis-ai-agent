// ============================================================
// FM STORE ST26 - FIXED WHATSAPP AI AGENT
// Cloudflare Workers + D1 + WhatsApp + Gemini
// ============================================================

const SEARCH_LIMIT = 9;
const SESSION_MINUTES = 30;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_WA_VERSION = "v23.0";


// ============================================================
// WORKER
// ============================================================

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // --------------------------------------------------------
      // HOME
      // --------------------------------------------------------

      if (path === "/") {
        return json({
          ok: true,
          service: "FM Store ST26 AI Agent",
          worker: "praveen-whatsapp-bot",
          database: "fmstore",
          status: "active"
        });
      }


      // --------------------------------------------------------
      // STATUS
      // --------------------------------------------------------

      if (path === "/status") {
        return json({
          ok: true,
          database: !!env.DB,
          whatsapp: !!env.WHATSAPP_TOKEN,
          phone_number_id: !!env.PHONE_NUMBER_ID,
          gemini: !!env.GEMINI_API_KEY
        });
      }


      // --------------------------------------------------------
      // DATABASE SETUP
      // --------------------------------------------------------

      if (path === "/setup") {
        const token =
          url.searchParams.get("token");

        checkAdmin(env, token);

        await setupDatabase(env);

        return json({
          ok: true,
          message:
            "FM Store ST26 database setup completed."
        });
      }


      // --------------------------------------------------------
      // ADMIN
      // --------------------------------------------------------

      if (
        path === "/admin" ||
        path === "/upload"
      ) {
        const token =
          url.searchParams.get("token");

        checkAdmin(env, token);

        return new Response(
          adminHTML(),
          {
            headers: {
              "content-type":
                "text/html;charset=UTF-8"
            }
          }
        );
      }


      // --------------------------------------------------------
      // EXCEL IMPORT
      // --------------------------------------------------------

      if (path === "/reports/import") {
        if (request.method !== "POST") {
          return json(
            {
              ok: false,
              error: "POST required"
            },
            405
          );
        }

        const token =
          request.headers.get(
            "x-admin-token"
          ) ||
          url.searchParams.get("token");

        checkAdmin(env, token);

        const body =
          await request.json();

        const result =
          await importWorkbook(
            env,
            body
          );

        return json({
          ok: true,
          ...result
        });
      }


      // --------------------------------------------------------
      // RESET
      // --------------------------------------------------------

      if (path === "/admin/reset") {
        const token =
          url.searchParams.get("token");

        checkAdmin(env, token);

        await resetDatabase(env);

        return json({
          ok: true,
          message:
            "FM Store report data cleared."
        });
      }


      // --------------------------------------------------------
      // WHATSAPP
      // --------------------------------------------------------

      if (path === "/webhook") {
        if (request.method === "GET") {
          return verifyWebhook(
            request,
            env
          );
        }

        if (request.method === "POST") {
          return await webhookPost(
            request,
            env
          );
        }
      }


      return json(
        {
          ok: false,
          error: "Not found"
        },
        404
      );

    } catch (error) {

      console.error(
        "WORKER ERROR:",
        error
      );

      return json(
        {
          ok: false,
          error:
            error?.message ||
            String(error)
        },
        500
      );
    }
  }
};


// ============================================================
// BASIC HELPERS
// ============================================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: {
        "content-type":
          "application/json;charset=UTF-8"
      }
    }
  );
}


function clean(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}


function lower(value) {
  return clean(value)
    .toLowerCase();
}


function upper(value) {
  return clean(value)
    .toUpperCase();
}


function normalize(value) {
  return lower(value)
    .replace(/\s+/g, " ")
    .trim();
}


function compact(value) {
  return normalize(value)
    .replace(/\s+/g, "");
}


function now() {
  return new Date().toISOString();
}


function checkAdmin(env, token) {
  if (
    !env.ADMIN_TOKEN ||
    !token ||
    token !== env.ADMIN_TOKEN
  ) {
    throw new Error("Unauthorized");
  }
}


function normalizeMaterialCode(value) {
  let v = clean(value);

  if (
    /^\d+\.0+$/.test(v)
  ) {
    v = v.replace(
      /\.0+$/,
      ""
    );
  }

  return v;
}


// ============================================================
// DATABASE SETUP
// FIXED: NO MULTI-STATEMENT EXEC()
// ============================================================

async function setupDatabase(env) {

  if (!env.DB) {
    throw new Error(
      "D1 binding DB is missing."
    );
  }


  // ----------------------------------------------------------
  // BATCH TABLE
  // ----------------------------------------------------------

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS report_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT,
      sheet_name TEXT,
      file_name TEXT,
      imported_at TEXT,
      row_count INTEGER DEFAULT 0
    )
  `).run();


  // ----------------------------------------------------------
  // REPORT ROWS
  // ----------------------------------------------------------

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS report_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      batch_id INTEGER,

      report_type TEXT,
      sheet_name TEXT,

      material_code TEXT,
      material_name TEXT,
      storage_location TEXT,
      uom TEXT,
      current_stock TEXT,

      reservation_no TEXT,
      reservation_status TEXT,
      reservation_qty TEXT,
      reservation_date TEXT,

      pr_no TEXT,
      pr_status TEXT,
      pr_qty TEXT,
      pr_date TEXT,

      po_no TEXT,
      po_status TEXT,
      po_qty TEXT,
      po_date TEXT,

      gate_entry_no TEXT,
      gate_qty TEXT,
      gate_date TEXT,

      material_doc_no TEXT,
      movement_type TEXT,
      material_doc_qty TEXT,
      posting_date TEXT,

      raw_json TEXT,
      created_at TEXT
    )
  `).run();


  // ----------------------------------------------------------
  // SESSIONS
  // ----------------------------------------------------------

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      phone TEXT PRIMARY KEY,
      mode TEXT,
      search_query TEXT,
      search_page INTEGER DEFAULT 0,
      material_code TEXT,
      material_name TEXT,
      updated_at TEXT
    )
  `).run();


  // ----------------------------------------------------------
  // INDEXES
  // ----------------------------------------------------------

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS
    idx_rows_material_code
    ON report_rows(material_code)
  `).run();


  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS
    idx_rows_material_name
    ON report_rows(material_name)
  `).run();


  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS
    idx_rows_storage
    ON report_rows(storage_location)
  `).run();


  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS
    idx_rows_type
    ON report_rows(report_type)
  `).run();


  return true;
}


// ============================================================
// RESET
// ============================================================

async function resetDatabase(env) {

  await setupDatabase(env);

  await env.DB.prepare(
    "DELETE FROM report_rows"
  ).run();

  await env.DB.prepare(
    "DELETE FROM report_batches"
  ).run();

  await env.DB.prepare(
    "DELETE FROM agent_sessions"
  ).run();
}


// ============================================================
// WHATSAPP VERIFY
// ============================================================

function verifyWebhook(
  request,
  env
) {
  const url =
    new URL(request.url);

  const mode =
    url.searchParams.get(
      "hub.mode"
    );

  const token =
    url.searchParams.get(
      "hub.verify_token"
    );

  const challenge =
    url.searchParams.get(
      "hub.challenge"
    );


  if (
    mode === "subscribe" &&
    token === env.VERIFY_TOKEN
  ) {
    return new Response(
      challenge,
      {
        status: 200
      }
    );
  }


  return new Response(
    "Forbidden",
    {
      status: 403
    }
  );
}


// ============================================================
// WHATSAPP POST
// ============================================================

async function webhookPost(
  request,
  env
) {

  let body;

  try {
    body =
      await request.json();
  } catch {
    return new Response(
      "Invalid JSON",
      {
        status: 400
      }
    );
  }


  try {

    const value =
      body?.entry?.[0]
        ?.changes?.[0]
        ?.value;

    const messages =
      value?.messages || [];


    for (
      const message of messages
    ) {

      try {

        await processMessage(
          message,
          env
        );

      } catch (error) {

        console.error(
          "MESSAGE ERROR:",
          error
        );

        if (message?.from) {

          await sendText(
            env,
            message.from,
            "மன்னிக்கவும். Technical error ஏற்பட்டுள்ளது. மீண்டும் முயற்சி செய்யவும்."
          );
        }
      }
    }

  } catch (error) {

    console.error(error);
  }


  return new Response(
    "EVENT_RECEIVED",
    {
      status: 200
    }
  );
}


// ============================================================
// PROCESS MESSAGE
// ============================================================

async function processMessage(
  message,
  env
) {

  const phone =
    message?.from;

  if (!phone) {
    return;
  }


  // ----------------------------------------------------------
  // TEXT
  // ----------------------------------------------------------

  if (
    message.type === "text"
  ) {

    const text =
      message.text?.body || "";

    await handleText(
      env,
      phone,
      text
    );

    return;
  }


  // ----------------------------------------------------------
  // INTERACTIVE
  // ----------------------------------------------------------

  if (
    message.type ===
    "interactive"
  ) {

    const button =
      message.interactive
        ?.button_reply;

    const list =
      message.interactive
        ?.list_reply;


    const id =
      button?.id ||
      list?.id;


    if (id) {

      await handleAction(
        env,
        phone,
        id
      );
    }
  }
}


// ============================================================
// TEXT HANDLER
// ============================================================

async function handleText(
  env,
  phone,
  raw
) {

  const text =
    clean(raw);

  const n =
    normalize(text);


  if (!text) {
    return;
  }


  // ----------------------------------------------------------
  // MENU
  // ----------------------------------------------------------

  if (
    [
      "hi",
      "hello",
      "hey",
      "start",
      "menu",
      "home",
      "help"
    ].includes(n)
  ) {

    await clearSession(
      env,
      phone
    );

    await mainMenu(
      env,
      phone
    );

    return;
  }


  // ----------------------------------------------------------
  // NEXT
  // ----------------------------------------------------------

  if (
    n === "next" ||
    n === "next page" ||
    n === "அடுத்து"
  ) {

    const session =
      await getSession(
        env,
        phone
      );


    if (
      session?.mode ===
      "search"
    ) {

      await materialSearch(
        env,
        phone,
        session.search_query,
        Number(
          session.search_page || 0
        ) + 1
      );

      return;
    }
  }


  // ----------------------------------------------------------
  // PREVIOUS
  // ----------------------------------------------------------

  if (
    n === "previous" ||
    n === "prev" ||
    n === "முந்தைய"
  ) {

    const session =
      await getSession(
        env,
        phone
      );


    if (
      session?.mode ===
      "search"
    ) {

      await materialSearch(
        env,
        phone,
        session.search_query,
        Math.max(
          0,
          Number(
            session.search_page || 0
          ) - 1
        )
      );

      return;
    }
  }


  // ----------------------------------------------------------
  // ALWAYS TRY MATERIAL SEARCH
  // ----------------------------------------------------------

  const result =
    await findMaterials(
      env,
      text,
      0
    );


  if (
    result.results.length
  ) {

    await materialSearch(
      env,
      phone,
      text,
      0
    );

    return;
  }


  // ----------------------------------------------------------
  // GEMINI
  // ----------------------------------------------------------

  const answer =
    await askGemini(
      env,
      text
    );


  await sendText(
    env,
    phone,
    answer
  );
}


// ============================================================
// MAIN MENU
// ============================================================

async function mainMenu(
  env,
  phone
) {

  await sendList(
    env,
    phone,

    "FM Store ST26",

    "Select",

    "Material Search / Reports",

    [
      {
        id: "SEARCH",
        title: "Material Search",
        description:
          "Search material name or code"
      },

      {
        id: "REPORTS",
        title: "Reports",
        description:
          "PR / PO / Stock / GRN"
      },

      {
        id: "HELP",
        title: "Help",
        description:
          "How to use the agent"
      }
    ]
  );
}


// ============================================================
// ACTION HANDLER
// ============================================================

async function handleAction(
  env,
  phone,
  id
) {

  // ----------------------------------------------------------
  // SEARCH
  // ----------------------------------------------------------

  if (id === "SEARCH") {

    await setSession(
      env,
      phone,
      {
        mode: "search",
        search_query: "",
        search_page: 0
      }
    );


    await sendText(
      env,
      phone,
      "🔎 Material Search\n\nMaterial name அல்லது material code அனுப்பவும்.\n\nExample:\nWetmop\nWet Mop\n180001458"
    );

    return;
  }


  // ----------------------------------------------------------
  // REPORTS
  // ----------------------------------------------------------

  if (id === "REPORTS") {

    await reportsMenu(
      env,
      phone
    );

    return;
  }


  // ----------------------------------------------------------
  // HELP
  // ----------------------------------------------------------

  if (id === "HELP") {

    await sendText(
      env,
      phone,
      "📘 FM Store ST26\n\n" +
      "Material name அல்லது code அனுப்பவும்.\n\n" +
      "Example:\n" +
      "Wetmop\n" +
      "Wet Mop\n" +
      "180001458\n\n" +
      "Duplicate material codes search result-ல் காட்டப்படாது."
    );

    return;
  }


  // ----------------------------------------------------------
  // SEARCH NEXT
  // ----------------------------------------------------------

  if (id === "NEXT") {

    const session =
      await getSession(
        env,
        phone
      );


    if (
      session?.search_query
    ) {

      await materialSearch(
        env,
        phone,
        session.search_query,
        Number(
          session.search_page || 0
        ) + 1
      );
    }

    return;
  }


  // ----------------------------------------------------------
  // SEARCH PREVIOUS
  // ----------------------------------------------------------

  if (id === "PREVIOUS") {

    const session =
      await getSession(
        env,
        phone
      );


    if (
      session?.search_query
    ) {

      await materialSearch(
        env,
        phone,
        session.search_query,
        Math.max(
          0,
          Number(
            session.search_page || 0
          ) - 1