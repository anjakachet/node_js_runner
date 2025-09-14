// api/runner.js
import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    // 1. Create a thread
    const thread = await client.beta.threads.create();

    // 2. Add user message
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: query,
    });

    // 3. Start a run
    let run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.ASSISTANT_ID,
    });

    // 4. Handle tool calls if required
    if (run.status === "requires_action") {
      const toolCalls = run.required_action.submit_tool_outputs.tool_calls;

      const toolOutputs = await Promise.all(
        toolCalls.map(async (tool) => {
          if (tool.function.name === "web_search") {
            const searchQuery = JSON.parse(tool.function.arguments).query;

            // Call your search-service
            const resp = await fetch("https://search-service.vercel.app/api/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: searchQuery }),
            });
            const results = await resp.json();

            return {
              tool_call_id: tool.id,
              output: JSON.stringify(results),
            };
          }
        })
      );

      // Submit results back to Assistant
      run = await client.beta.threads.runs.submitToolOutputs(
        thread.id,
        run.id,
        { tool_outputs: toolOutputs }
      );
    }

    // 5. Poll until run completes
    while (run.status !== "completed") {
      await new Promise((r) => setTimeout(r, 1000));
      run = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // 6. Retrieve final messages
    const messages = await client.beta.threads.messages.list(thread.id);

    // 7. Extract the latest assistant response
    const output = messages.data[0].content[0].text.value;

    res.json({ status: run.status, output });
  } catch (err) {
    console.error("Runner error:", err);
    res.status(500).json({ error: err.message });
  }
}
