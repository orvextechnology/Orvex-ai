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
    const { message } = await req.json();

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

    async function askGemini(model) {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            model,
            input: message
          }),
          signal: AbortSignal.timeout(10000)
        }
      );

      const raw = await response.text();

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        const error = new Error(
          `Gemini returned an invalid response (HTTP ${response.status}).`
        );
        error.status = response.status;
        throw error;
      }

      if (!response.ok) {
        const error = new Error(
  JSON.stringify(data)
);

error.status = response.status;
throw error;

        error.status = response.status;
        throw error;
      }

      const answer =
        data.steps
          ?.filter(step => step.type === "model_output")
          .flatMap(step => step.content || [])
          .filter(item => item.type === "text")
          .map(item => item.text)
          .join("") ||
        data.output_text ||
        data.outputs?.map(item => item.text || "").join("") ||
        "";

      if (!answer.trim()) {
        throw new Error("Gemini returned an empty answer.");
      }

      return answer;
    }

    let answer;

    try {
      answer = await askGemini("gemini-3.8-flash");

    } catch (error) {
      const retryable = [
        429, 500, 502, 503, 504
      ].includes(error.status);

      if (!retryable && error.name !== "TimeoutError") {
        throw error;
      }

      answer = await askGemini("gemini-3.5-flash-lite");
    }

    return new Response(
      JSON.stringify({ answer }),
      { status: 200, headers }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message || "An unexpected error occurred."
      }),
      { status: 500, headers }
    );
  }
};
