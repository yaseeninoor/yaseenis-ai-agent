import os
from flask import Flask, jsonify, request

app = Flask(__name__)

VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")


@app.get("/")
def home():
    return jsonify({
        "project": "Yaseenis AI Agent",
        "status": "online",
        "message": "Yaseenis AI Agent is running"
    })


@app.get("/health")
def health():
    return jsonify({
        "status": "healthy"
    })


@app.get("/webhook")
def verify_webhook():
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if mode == "subscribe" and token == VERIFY_TOKEN and challenge:
        return challenge, 200, {
            "Content-Type": "text/plain"
        }

    return "Forbidden", 403


@app.post("/webhook")
def receive_webhook():
    data = request.get_json(silent=True) or {}

    print(
        "WhatsApp webhook received:",
        data,
        flush=True
    )

    return jsonify({
        "status": "received"
    }), 200


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False
    )