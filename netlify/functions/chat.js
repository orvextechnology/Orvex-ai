export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405
    });
  }

  try {
    const { message } = await req.json();

    if (!message) {
      return new Response(
        JSON.stringify({ error: "Please enter a message." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
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
            model: model,
            input: message
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const error = new Error(
          data.error?.message || "AI request failed."
        );
        error.status = response.status;
        throw error;
      }

      const answer = data.steps
        ?.filter(step => step.type === "model_output")
        .flatMap(step => step.content || [])
        .filter(item => item.type === "text")
        .map(item => item.text)
        .join("");

      if (!answer) {
        throw new Error("The AI returned an empty response.");
      }

      return answer;
    }

    let answer;

    try {
      answer = await askGemini("gemini-3.8-flash");
    } catch (error) {
      if (![429, 500, 503].includes(error.status)) {
        throw error;
      }

      answer = await askGemini("gemini-3.5-flash-lite");
    }

    return new Response(
      JSON.stringify({ answer }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};
