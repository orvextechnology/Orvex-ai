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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);

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
          console.log("Gemini error:", response.status, JSON.stringify(data));

          throw new Error(
            data.error?.message || `Gemini API error: ${response.status}`
          );
        }

        return data;
      } catch (error) {
        if (error.name === "AbortError") {
          throw new Error("Gemini took too long to respond. Please try again.");
        }

        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    if (action === "generate_image" || action === "edit_image") {
      if (action === "edit_image" && !image) {
        return new Response(JSON.stringify({
          error: "Attach the picture you want ORVEX to edit first."
        }), { status: 400, headers });
      }

      const prompt = action === "edit_image"
        ? `Edit the attached image according to these instructions: ${message}`
        : `Create an image based on this description: ${message}`;

      const parts = [{ text: prompt }];

      if (image) {
        parts.push({
          inline_data: {
            mime_type: image.mimeType,
            data: image.data
          }
        });
      }

      const data = await callGemini(
        "gemini-3.1-flash-image",
        parts,
        { responseModalities: ["TEXT", "IMAGE"] }
      );

      const output = data.candidates?.[0]?.content?.parts || [];

      let answer = "";
      let generatedImage = null;

      for (const part of output) {
        if (part.text) answer += part.text;

        const inline = part.inlineData || part.inline_data;

        if (inline?.data) {
          generatedImage = {
            data: inline.data,
            mimeType: inline.mimeType || "image/png"
          };
        }
      }

      if (!generatedImage) {
        throw new Error(answer || "The image model did not return an image.");
      }

      return new Response(JSON.stringify({
        answer: answer || "ORVEX has created your image.",
        image: generatedImage
      }), { status: 200, headers });
    }

    const prompt = `You are ORVEX AI, a helpful and intelligent conversational assistant.

Use the conversation history to understand follow-up questions.
Answer accurately, naturally and clearly.

PREVIOUS CONVERSATION:
${previousMessages || "No earlier messages."}

CURRENT MESSAGE:
${message || "Please examine the attached image."}`;

    const parts = [{ text: prompt }];

    if (image) {
      parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.data
        }
      });
    }

    const data = await callGemini(
      "gemini-3.1-flash-lite",
      parts
    );

    const answer = (data.candidates?.[0]?.content?.parts || [])
      .filter(part => part.text)
      .map(part => part.text)
      .join("")
      .trim();

    if (!answer) {
      throw new Error("Gemini returned an empty answer.");
    }

    return new Response(JSON.stringify({
      answer
    }), { status: 200, headers });

  } catch (error) {
    console.log("ORVEX FUNCTION ERROR:", error);

    return new Response(JSON.stringify({
      error: error.message || "Something went wrong. Please try again."
    }), { status: 500, headers });
  }
};
