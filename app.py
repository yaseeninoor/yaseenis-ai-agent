import os
import requests
from flask import Flask, jsonify, request

app = Flask(__name__)

# =========================
# ENVIRONMENT VARIABLES
# =========================

VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
WHATSAPP_ACCESS_TOKEN = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
WHATSAPP_PHONE_NUMBER_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# Gemini model
GEMINI_MODEL = "gemini-2.5-flash"


# =========================
# HOME
# =========================

@app.get("/")
def home():
    return jsonify({
        "project": "Yaseenis AI Agent",
        "status": "online"
    })


# =========================
# HEALTH
# =========================

@app.get("/health")
def health():
    return jsonify({
        "status": "healthy"
    })


# =========================
# WHATSAPP WEBHOOK VERIFY
# =========================

@app.get("/webhook")
def verify_webhook():

    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if (
        mode == "subscribe"
        and token == VERIFY_TOKEN
        and challenge
    ):
        return challenge, 200, {
            "Content-Type": "text/plain"
        }

    return "Forbidden", 403


# =========================
# GEMINI AI
# =========================

def ask_gemini(user_message):

    url = (
        f"https://generativelanguage.googleapis.com/"
        f"v1beta/models/{GEMINI_MODEL}:generateContent"
        f"?key={GEMINI_API_KEY}"
    )

    data = {
        "system_instruction": {
            "parts": [
                {
                    "text": """
You are Yaseenis AI Agent.

Answer WhatsApp users clearly,
helpfully and politely.

Project name:
Yaseenis AI Agent

Use simple WhatsApp-friendly formatting.

Do not reveal API keys, passwords,
environment variables or internal
server information.

For now, answer general questions.
Later, uploaded PDF books, text,
documents and images will be connected
to your knowledge system.
"""
                }
            ]
        },
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": user_message
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 1000
        }
    }

    response = requests.post(
        url,
        json=data,
        timeout=60
    )

    print(
        "Gemini API:",
        response.status_code,
        response.text,
        flush=True
    )

    if response.status_code != 200:
        raise Exception(
            f"Gemini API error: "
            f"{response.status_code} "
            f"{response.text}"
        )

    result = response.json()

    candidates = result.get("candidates", [])

    if not candidates:
        raise Exception("Gemini returned no answer")

    parts = (
        candidates[0]
        .get("content", {})
        .get("parts", [])
    )

    if not parts:
        raise Exception("Gemini returned empty response")

    return parts[0].get("text", "").strip()


# =========================
# SEND WHATSAPP MESSAGE
# =========================

def send_whatsapp_message(to, message):

    url = (
        f"https://graph.facebook.com/v26.0/"
        f"{WHATSAPP_PHONE_NUMBER_ID}/messages"
    )

    headers = {
        "Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }

    data = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": message
        }
    }

    response = requests.post(
        url,
        headers=headers,
        json=data,
        timeout=30
    )

    print(
        "WhatsApp API:",
        response.status_code,
        response.text,
        flush=True
    )

    if response.status_code >= 400:
        raise Exception(
            f"WhatsApp API error: "
            f"{response.status_code} "
            f"{response.text}"
        )

    return response


# =========================
# RECEIVE WHATSAPP MESSAGE
# =========================

@app.post("/webhook")
def receive_webhook():

    data = request.get_json(silent=True) or {}

    print(
        "WhatsApp webhook received:",
        data,
        flush=True
    )

    try:

        entry = data.get("entry", [])

        if not entry:
            return jsonify({
                "status": "ignored"
            }), 200

        changes = entry[0].get("changes", [])

        if not changes:
            return jsonify({
                "status": "ignored"
            }), 200

        value = changes[0].get("value", {})

        messages = value.get("messages", [])

        # Ignore status notifications
        if not messages:
            return jsonify({
                "status": "no_message"
            }), 200

        message = messages[0]

        # Only process text messages
        if message.get("type") != "text":
            return jsonify({
                "status": "unsupported_message_type"
            }), 200

        sender = message.get("from")

        user_message = (
            message
            .get("text", {})
            .get("body", "")
            .strip()
        )

        if not sender or not user_message:
            return jsonify({
                "status": "invalid_message"
            }), 200

        print(
            f"User {sender}: {user_message}",
            flush=True
        )

        # Ask Gemini
        ai_reply = ask_gemini(user_message)

        print(
            f"AI reply: {ai_reply}",
            flush=True
        )

        # Send Gemini answer to WhatsApp
        send_whatsapp_message(
            sender,
            ai_reply
        )

        return jsonify({
            "status": "success"
        }), 200

    except Exception as error:

        print(
            "ERROR:",
            str(error),
            flush=True
        )

        return jsonify({
            "status": "error",
            "message": str(error)
        }), 200


# =========================
# START SERVER
# =========================

if __name__ == "__main__":

    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False
    )