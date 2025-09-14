import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { query } = req.body;

    // 1. Create a thread
    const thread = await client.beta.threads.create();

    // 2. Add user message
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: query,
    });

    // 3. Create a run
    let run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.ASSISTANT_ID, // set this in Vercel
    });

    // 4. Poll until completed or requires_action
    while (run.status !== "completed") {
      if (run.status === "requires_action") {
        for (const toolCall of run.required_action.submit_tool_outputs.tool_calls) {
          if (toolCall.function.name === "web_search") {
            const args = JSON.parse(toolCall.function.arguments);

            // Call your search service
            const resp = await fetch(`${process.env.SEARCH_SERVICE_URL}/api/runner`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: args.query }),
            });
            const data = await resp.json();

            // Submit tool output back to OpenAI
            run = await client.beta.threads.runs.submitToolOutputs(
              thread.id,
              run.id,
              {
                tool_outputs: [
                  {
                    tool_call_id: toolCall.id,
                    output: JSON.stringify(data),
                  },
                ],
              }
            );
          }
        }
      } else {
        // Wait and poll again
        await new Promise((r) => setTimeout(r, 2000));
        run = await client.beta.threads.runs.retrieve(thread.id, run.id);
      }
    }

    // 5. Get final messages
    const messages = await client.beta.threads.messages.list(thread.id);

    res.status(200).json({
      status: "completed",
      output: messages.data[0].content[0].text.value,
    });
  } catch (err) {
    console.error("❌ Assistant API error:", err);
    res.status(500).json({ error: err.message });
  }
}
