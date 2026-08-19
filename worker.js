export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({
          project: "Yaseenis AI Agent",
          status: "online"
        }),
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response("Yaseenis AI Agent", {
      status: 200
    });
  }
};