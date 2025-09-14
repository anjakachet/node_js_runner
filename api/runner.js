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
    console.log("➡️ Incoming query:", query);

    // Start a thread
    const thread = await client.beta.threads.create();
    console.log("🧵 Thread created:", thread.id);

    // Add user message
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: query,
    });

    // Kick off the run
    let run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.ASSISTANT_ID,
    });
    console.log("🚀 Run started:", run.id, "status:", run.status);

    // Poll until done
    while (run.status !== "completed" && run.status !== "failed") {
      console.log("⏳ Polling run status:", run.status);

      if (run.status === "requires_action") {
        console.log("⚡ Requires action payload:", JSON.stringify(run.required_action, null, 2));

        const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
        console.log("🔧 Tool calls found:", toolCalls.length);

        const outputs = await Promise.all(
          toolCalls.map(async (tool) => {
            console.log("👉 Tool call detail:", JSON.stringify(tool, null, 2));

            if (tool.function.name === "web_search") {
              const searchQuery = JSON.parse(tool.function.arguments).query;
              console.log("🌍 Web search triggered with query:", searchQuery);

              try {
                const resp = await fetch(
                  `https://api.searchapi.io/api/v1/search?q=${encodeURIComponent(searchQuery)}&engine=google`,
                  {
                    headers: {
                      "Authorization": `Bearer ${process.env.SEARCHAPI_API_KEY}`,
                    },
                  }
                );

                const data = await resp.json();
                console.log("🔎 Raw search response:", JSON.stringify(data, null, 2));

                let results = [];

                // Prefer answer box if present
                if (data.answer_box) {
                  results.push({
                    title: data.answer_box.title || "Answer Box",
                    snippet: data.answer_box.answer || data.answer_box.snippet || "",
                    url: data.answer_box.link || "",
                  });
                }

                // Organic results
                if (data.organic_results) {
                  results = results.concat(
                    data.organic_results.map((r) => ({
                      title: r.title,
                      snippet: r.snippet,
                      url: r.link,
                    }))
                  );
                }

                return {
                  tool_call_id: tool.id,
                  output: JSON.stringify(results),
                };
              } catch (err) {
                console.error("❌ Search API error:", err);
                return {
                  tool_call_id: tool.id,
                  output: JSON.stringify([{ title: "Error", snippet: err.message, url: "" }]),
                };
              }
            }

            return { tool_call_id: tool.id, output: "{}" };
          })
        );

        console.log("📤 Submitting tool outputs:", JSON.stringify(outputs, null, 2));

        run = await client.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
          tool_outputs: outputs,
        });

        console.log("✅ Submitted tool outputs, new status:", run.status);
      }

      // Poll again
      await new Promise((r) => setTimeout(r, 2000));
      run = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    console.log("🏁 Final run status:", run.status);

    if (run.status === "completed") {
      const messages = await client.beta.threads.messages.list(thread.id);
      const last = messages.data[0];
      console.log("💬 Assistant reply:", last.content[0].text.value);

      return res.status(200).json({
        status: "completed",
        output: last.content[0].text.value,
      });
    } else {
      return res.status(500).json({ status: "failed", run });
    }
  } catch (err) {
    console.error("❌ Runner error:", err);
    return res.status(500).json({ error: err.message });
  }
}
