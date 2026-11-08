export default async (req) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed." }),
      { status: 405, headers }
    );
  }

  try {
    const { message, history = [] } = await req.json();
    console.log("ORVEX HISTORY RECEIVED:", history.length);

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Please enter a message." }),
        { status: 400, headers }
      );
    }

    const apiKey = Netlify.env.get("GEMINI_API_KEY");

    if (!apiKey) {
      throw new Error("Gemini API key is missing.");
    }

    const previousMessages = Array.isArray(history)
      ? history.slice(-20).map(item => {
          const role =
            item.role === "assistant" ? "ORVEX AI" : "User";

          return `${role}: ${String(item.content || "")}`;
        }).join("\n\n")
      : "";

    const prompt = `
You are ORVEX AI, an intelligent conversational assistant.

IMPORTANT CONVERSATION MEMORY RULES:
- Read the entire conversation history below.
- Remember what the user said earlier in this conversation.
- When asked what the user previously asked, identify their actual earlier question.
- Never claim this is the first message if previous messages are provided.
- Use previous messages to understand follow-up questions.
- Answer naturally and accurately.

PREVIOUS CONVERSATION:
${previousMessages || "There are no previous messages."}

CURRENT USER MESSAGE:
${message}

ORVEX AI RESPONSE:
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          model: "gemini-3.5-flash-lite",
          input: prompt
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.log("GEMINI STATUS:", response.status);
console.log("GEMINI RESPONSE:", JSON.stringify(data));
      throw new Error(
        data.error?.message || "Gemini request failed."
      );
    }

    const answer =
      data.steps
        ?.filter(step => step.type === "model_output")
        .flatMap(step => step.content || [])
        .filter(item => item.type === "text")
        .map(item => item.text)
        .join("") ||
      data.output_text ||
      "";

    if (!answer.trim()) {
      throw new Error("Gemini returned an empty answer.");
    }

    return new Response(
      JSON.stringify({ answer }),
      { status: 200, headers }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message || "Something went wrong."
      }),
      { status: 500, headers }
    );
  }
};
