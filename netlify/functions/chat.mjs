export default async (req) => {
  const headers = { "Content-Type": "application/json" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405, headers
    });
  }

  try {
    const body = await req.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const history = Array.isArray(body.history) ? body.history.slice(-20) : [];
    const image = body.image || null;
    const action = body.action || "chat";
    const apiKey = Netlify.env.get("GEMINI_API_KEY");

    if (!apiKey) throw new Error("The Gemini API key is missing in Netlify environment variables.");

    if (!message && !image) {
      return new Response(JSON.stringify({
        error: "Please enter a message or attach an image."
      }), { status: 400, headers });
    }

    const validMimeTypes = ["image/jpeg", "image/png", "image/webp"];

    if (image) {
      if (!validMimeTypes.includes(image.mimeType)) {
        return new Response(JSON.stringify({
          error: "Please upload a JPG, PNG, or WEBP image."
        }), { status: 400, headers });
      }

      if (typeof image.data !== "string" || image.data.length > 7000000) {
        return new Response(JSON.stringify({
          error: "That image is too large. Please choose a smaller image."
        }), { status: 413, headers });
      }
    }

    const previousMessages = history.map(item => {
      const role = item.role === "assistant" ? "ORVEX AI" : "User";
      return `${role}: ${String(item.content || "").slice(0, 4000)}`;
    }).join("\n\n");

    const callGemini = async (model, parts, generationConfig = {}) => {
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
            generationConfig
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.log("GEMINI STATUS:", response.status);
        console.log("GEMINI RESPONSE:", JSON.stringify(data));
        throw new Error(data.error?.message || "Gemini request failed.");
      }

      return data;
    };

    if (action === "generate_image" || action === "edit_image") {

      if (action === "edit_image" && !image) {
        return new Response(JSON.stringify({
          error: "Attach the picture you want ORVEX to edit first."
        }), { status: 400, headers });
      }

      const prompt = action === "edit_image"
        ? `Edit the attached image according to these instructions. Preserve important details unless the user asks to change them.

Instructions: ${message || "Improve this image."}`
        : `Create a high-quality image based on this description. Return an image, not just instructions.

Description: ${message}`;

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

      const outputParts = data.candidates?.[0]?.content?.parts || [];

      let answer = "";
      let generatedImage = null;

      for (const part of outputParts) {
        if (part.text) answer += part.text;

        const inline = part.inlineData || part.inline_data;

        if (inline?.data) {
          generatedImage = {
            data: inline.data,
            mimeType: inline.mimeType || inline.mime_type || "image/png"
          };
        }
      }

      if (!generatedImage) {
        throw new Error(
          answer || "The image model did not return an image. Please try again."
        );
      }

      return new Response(JSON.stringify({
        answer: answer || "ORVEX has created your image.",
        image: generatedImage
      }), { status: 200, headers });
    }

    const textPrompt = `You are ORVEX AI, a helpful, intelligent, friendly conversational assistant.

CONVERSATION RULES:
- Use previous conversation to understand follow-up questions.
- Remember what the user said earlier.
- If asked what the user said earlier, identify an actual earlier message.
- Never claim this is the first message when history is supplied.
- Be accurate, clear and natural.

PREVIOUS CONVERSATION:
${previousMessages || "No earlier messages are available."}

CURRENT USER MESSAGE:
${message || "Please examine the attached image and describe or answer questions about it."}`;

    const parts = [{ text: textPrompt }];

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

    return new Response(JSON.stringify({ answer }), {
      status: 200,
      headers
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error?.message || "Something went wrong. Please try again."
    }), {
      status: 500,
      headers
    });
  }
};
