export default async (req) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed."
    }), { status: 405, headers });
  }

  try {
    const body = await req.json();

    const message = typeof body.message === "string"
      ? body.message.trim()
      : "";

    const history = Array.isArray(body.history)
      ? body.history.slice(-12)
      : [];

    const image = body.image || null;
    const action = body.action || "chat";
    const apiKey = Netlify.env.get("GEMINI_API_KEY");

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing in Netlify.");
    }

    if (!message && !image) {
      return new Response(JSON.stringify({
        error: "Please enter a message or attach an image."
      }), { status: 400, headers });
    }

    if (image) {
      const validTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
      ];

      if (!validTypes.includes(image.mimeType)) {
        return new Response(JSON.stringify({
          error: "Please upload a JPG, PNG, or WEBP image."
        }), { status: 400, headers });
      }

      if (
        typeof image.data !== "string" ||
        image.data.length > 7000000
      ) {
        return new Response(JSON.stringify({
          error: "Image is too large. Choose a smaller image."
        }), { status: 413, headers });
      }
    }

    const previousMessages = history.map(item => {
      const role = item.role === "assistant"
        ? "ORVEX AI"
        : "User";

      return `${role}: ${String(item.content || "").slice(0, 3000)}`;
    }).join("\n\n");

    async function callGemini(model, parts, config = {}) {
      const maxAttempts = model === "gemini-3.1-flash-lite" ? 2 : 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
              },
              body: JSON.stringify({
                contents: [{
                  role: "user",
                  parts
                }],
                generationConfig: config
              }),
              signal: controller.signal
            }
          );

          const data = await response.json();

          if (!response.ok) {
            console.log(
              "Gemini error:",
              response.status,
              JSON.stringify(data)
            );

            const temporaryError = [
              429, 500, 502, 503, 504
            ].includes(response.status);

            if (temporaryError && attempt < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 800));
              continue;
            }

            throw new Error(
              temporaryError
                ? "Gemini is currently busy. Please try again shortly."
                : data.error?.message || `Gemini API error: ${response.status}`
            );
          }

          return data;

        } catch (error) {
          if (
            attempt < maxAttempts &&
            (error.name === "AbortError" || error.name === "TypeError")
          ) {
            console.log("Retrying Gemini request:", error.message);
            await new Promise(resolve => setTimeout(resolve, 800));
            continue;
          }

          if (error.name === "
