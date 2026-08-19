import os
import requests
from flask import Flask, jsonify, request
from openai import OpenAI

app = Flask(__name__)

# =========================
# ENVIRONMENT VARIABLES
# =========================

VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
WHATSAPP_ACCESS_TOKEN = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
WHATSAPP_PHONE_NUMBER_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")

# OpenAI client
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


# =========================
# HOME
# =========================

@app.get("/")
def home():
    return jsonify({
        "project": "Yaseenis AI Agent",
        "status": "online",
        "message": "Yaseenis AI Agent is running"
    })


# =========================
# HEALTH CHECK
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

    return response


# =========================
# ASK OPENAI
# =========================

def ask_ai(user_message):

    response = client.responses.create(
        model="gpt-5.6-luna",
        instructions="""
You are Yaseenis AI Agent.

Your job is to answer WhatsApp users clearly,
helpfully and politely.

Project name:
Yaseenis AI Agent

Keep answers suitable for WhatsApp.
Use simple formatting.
Do not mention internal API keys,
environment variables, servers or technical secrets.

For now, answer general questions.
Knowledge from uploaded Yaseenis books,
PDFs, text files and images will be connected later.
""",
        input=user_message
    )

    return response.output_text


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

        # Ignore status updates
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
            message.get("text", {})
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

        # Ask OpenAI
        ai_reply = ask_ai(user_message)

        print(
            f"AI reply: {ai_reply}",
            flush=True
        )

        # Send reply to WhatsApp
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