
const FIREBASE_API_KEY = "AIzaSyD4oCtqtD8U1wnErSP10iu2sIr0XzaqrQs";
const GEMINI_MODEL = "gemini-2.5-flash";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    
return jsonResponse({
  success: true,
  reply: env.ORVEX_GEMINI_KEY
    ? "DIAGNOSTIC RESULT: Gemini key detected."
    : "DIAGNOSTIC RESULT: Gemini key missing."
});
    

    // 1. Verify the user's Firebase login token.
    const authorization = request.headers.get("Authorization") || "";
    const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);

    if (!tokenMatch) {
      return jsonResponse({ error: "Please log in first." }, 401);
    }

    const firebaseResponse = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" +
      FIREBASE_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          idToken: tokenMatch[1]
        })
      }
    );

    if (!firebaseResponse.ok) {
      return jsonResponse({
        error: "Your login session is invalid or expired. Please log in again."
      }, 401);
    }

    const firebaseData = await firebaseResponse.json();
    const user = firebaseData.users && firebaseData.users[0];

    if (!user || user.disabled) {
      return jsonResponse({
        error: "This account is unavailable. Please log in again."
      }, 401);
    }

    // 2. Read and validate the request.
    const contentLength = Number(
      request.headers.get("Content-Length") || 0
    );

    if (contentLength > 7 * 1024 * 1024) {
      return jsonResponse({
        error: "Your request is too large. Please use a smaller image."
      }, 413);
    }

    const body = await request.json();

    const message = typeof body.message === "string"
      ? body.message.trim()
      : "";

    const mode = typeof body.mode === "string"
      ? body.mode
      : "chat";

    const image = typeof body.image === "string"
      ? body.image
      : "";

    if (!["chat", "analyze_image"].includes(mode)) {
      return jsonResponse({
        error: "This feature is not connected yet. Image generation and editing are coming in a later rebuild stage."
      }, 501);
    }

    if (!message && !image) {
      return jsonResponse({
        error: "Please enter a message or attach an image."
      }, 400);
    }

    if (message.length > 12000) {
      return jsonResponse({
        error: "Your message is too long."
      }, 413);
    }

    // 3. Prepare the conversation history.
    const parts = [];
    const contents = [];

    if (Array.isArray(body.history)) {
      const history = body.history.slice(-20);

      // The frontend includes the current message in history.
      // Remove that final copy because it will be added below.
      if (
        history.length > 0 &&
        history[history.length - 1].role === "user" &&
        history[history.length - 1].content === message
      ) {
        history.pop();
      }

      for (const item of history) {
        if (!item || typeof item.content !== "string") continue;

        const content = item.content.trim();
        if (!content || content.length > 12000) continue;

        const role = item.role === "assistant" ||
          item.role === "model"
          ? "model"
          : item.role === "user"
            ? "user"
            : null;

        if (!role) continue;

        // Skip consecutive messages with the same role.
        const previous = contents[contents.length - 1];

        if (previous && previous.role === role) continue;

        contents.push({
          role,
          parts: [{ text: content }]
        });
      }
    }

    // 4. Add the current message.
    if (image) {
      const imageMatch = image.match(
        /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/
      );

      if (!imageMatch) {
        return jsonResponse({
          error: "The attached image format is not supported."
        }, 400);
      }

      const mimeType = imageMatch[1] === "image/jpg"
        ? "image/jpeg"
        : imageMatch[1];

      const base64Data = imageMatch[2];

      if (base64Data.length > 6 * 1024 * 1024) {
        return jsonResponse({
          error: "The image is too large. Please choose a smaller image."
        }, 413);
      }

      parts.push({
        inlineData: {
          mimeType,
          data: base64Data
        }
      });
    }

    parts.push({
      text: message || "Please describe and analyze this image."
    });

    contents.push({
      role: "user",
      parts
    });

    // 5. Send the request to Gemini.
    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      GEMINI_MODEL + ":generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.ORVEX_GEMINI_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text:
                "You are ORVEX AI, a helpful, intelligent and professional AI assistant. " +
                "Give clear, accurate and useful answers. " +
                "When users provide images, examine them carefully. " +
                "Be honest when you are uncertain. " +
                "Do not claim to have performed actions you have not performed."
            }]
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1800
          }
        })
      }
    );

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      return jsonResponse({
        error: "The AI provider could not complete your request. Please try again."
      }, 502);
    }

    // 6. Extract the AI answer.
    const reply = (
      geminiData.candidates?.[0]?.content?.parts || []
    )
      .map(function(part) {
        return part.text || "";
      })
      .join("")
      .trim();

    if (!reply) {
      return jsonResponse({
        error: "ORVEX received an empty response. Please try again."
      }, 502);
    }

    return jsonResponse({
      success: true,
      reply
    });

  } catch (error) {
    return jsonResponse({
      error: "An unexpected server error occurred. Please try again."
    }, 500);
  }
        }
    
