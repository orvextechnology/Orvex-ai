const FIREBASE_API_KEY = "AIzaSyD4oCtqtD8U1wnErSP10iu2sIr0XzaqrQs";

export async function onRequestPost({ request, env }) {
  const headers = {
    "Content-Type": "application/json"
  };

  try {
    // 1. Check Firebase login token
    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return new Response(JSON.stringify({
        error: "Please sign in to use ORVEX AI."
      }), { status: 401, headers });
    }

    // 2. Verify the token with Firebase
    const verification = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token })
      }
    );

    if (!verification.ok) {
      return new Response(JSON.stringify({
        error: "Your session is invalid. Please sign in again."
      }), { status: 401, headers });
    }

    const account = await verification.json();
    const user = account.users?.[0];

    if (!user || user.disabled === true) {
      return new Response(JSON.stringify({
        error: "Your account could not be verified."
      }), { status: 401, headers });
    }

    // 3. Check Gemini API key
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("AI service is not configured.");
    }

    // 4. Read request
    const body = await request.json();

    const message = typeof body.message === "string"
      ? body.message.trim().slice(0, 10000)
      : "";

    const history = Array.isArray(body.history)
      ? body.history.slice(-6)
      : [];

    const image = body.image || null;
    const action = body.action || "chat";

    if (!message && !image) {
      return new Response(JSON.stringify({
        error: "Please enter a message or attach an image."
      }), { status: 400, headers });
    }

    // 5. Validate uploaded image
    if (image) {
      const validTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
      ];

      if (
        typeof image !== "object" ||
        !validTypes.includes(image.mimeType) ||
        typeof image.data !== "string" ||
        image.data.length > 7000000
      ) {
        return new Response(JSON.stringify({
          error: "Invalid image or image too large. Use JPG, PNG, or WEBP."
        }), { status: 400, headers });
      }
    }

    // 6. Prepare conversation history
    const previousMessages = history.map(item => {
      const role = item.role === "assistant"
        ? "ORVEX AI"
        : "User";

      const content = String(
        item.content || item.text || ""
      ).slice(0, 1200);

      return `${role}: ${content}`;
    }).join("\n\n");

    // 7. Gemini request function
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
  const detail = data.error?.message || JSON.stringify(data);
  console.error("Gemini API Error:", response.status, detail);
  throw new Error(`Gemini error (${response.status}): ${detail}`);
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

    
    // 8. Image generation and editing
    if (action === "generate_image" || action === "edit_image") {

      if (action === "edit_image" && !image) {
        return new Response(JSON.stringify({
          error: "Attach the picture you want ORVEX to edit first."
        }), { status: 400, headers });
      }

      const prompt = action === "edit_image"
        ? `Edit the attached image according to these instructions: ${message}. Preserve the person's identity and other details unless the user specifically requests a change. Return the edited image.`
        : `Generate an actual image based on this description: ${message}. Return the generated image, not just a description or instructions.`;

      const parts = [{ text: prompt }];

      if (image) {
        parts.push({
          inline_data: {
            mime_type: image.mimeType,
            data: image.data
          }
        });
      }

      let data;

      try {
        data = await callGemini(
          "gemini-3.1-flash-image",
          parts,
          {
            responseModalities: ["TEXT", "IMAGE"]
          }
        );
      } catch (error) {
        console.warn("Primary image model failed:", error.message);

        data = await callGemini(
          "gemini-2.5-flash-image",
          parts,
          {
            responseModalities: ["TEXT", "IMAGE"]
          }
        );
      }

      const output = data.candidates?.[0]?.content?.parts || [];

      let answer = "";
      let generatedImage = null;

      for (const part of output) {
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
    

    

    // 9. Normal chat and image understanding
    const prompt = `You are ORVEX AI, a professional, intelligent and reliable conversational assistant.

Answer directly, accurately and naturally.
Use clear headings, short paragraphs, bullet points and numbered steps where useful.
Keep simple answers concise and explain difficult topics clearly.
Never invent facts or pretend to know something uncertain.
Maintain context when answering follow-up questions.

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

    async function startGeminiStream(model) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);

      let response;

      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: {
                temperature: 0.6,
                maxOutputTokens: 1200
              }
            }),
            signal: controller.signal
          }
        );
      } catch (error) {
        if (error.name === "AbortError") {
          throw new Error("Gemini took too long to respond. Please try again.");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.error?.message || "Gemini request failed.";
        console.error("Gemini streaming error:", response.status, detail);
        throw new Error(`Gemini error (${response.status}): ${detail}`);
      }

      if (!response.body) {
        throw new Error("Gemini did not provide a response stream.");
      }

      return response;
    }

    
    let streamResponse;

    async function tryModelWithRetry(model) {
      let lastError;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await startGeminiStream(model);
        } catch (error) {
          lastError = error;

          const isBusy = String(error.message).includes("503");

          if (!isBusy) {
            throw error;
          }

          console.warn(`${model} is busy. Attempt ${attempt} failed.`);

          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        }
      }

      throw lastError;
    }

    try {
      streamResponse = await tryModelWithRetry("gemini-3.5-flash-lite");

    } catch (error) {
      if (!String(error.message).includes("503")) {
        throw error;
      }

      console.warn("Primary model unavailable. Switching to backup.");

      try {
        streamResponse = await tryModelWithRetry("gemini-3.1-flash-lite");

      } catch (backupError) {
        if (!String(backupError.message).includes("503")) {
          throw backupError;
        }

        throw new Error(
          "ORVEX AI is experiencing high demand right now. Please try again shortly."
        );
      }
    }

    return new Response(streamResponse.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      }
    });
      
            
    
     
  } catch (error) {
    console.error("ORVEX API error:", error);

    return new Response(JSON.stringify({
      error: error.message || "Something went wrong. Please try again."
    }), {
      status: 500,
      headers
    });
  }
}


export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  return new Response(JSON.stringify({
    error: "Method not allowed."
  }), {
    status: 405,
    headers: { "Content-Type": "application/json" }
  });
      }
