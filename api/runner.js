import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.ASSISTANT_ID; // put your asst_xxx here

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { query } = req.body;

  try {
    // Step 1: create a thread
    const thread = await client.beta.threads.create();

    // Step 2: add user message
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: query,
    });

    // Step 3: run the assistant
    let run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    // Poll until the run completes
    while (run.status === "in_progress" || run.status === "queued") {
      await new Promise(r => setTimeout(r, 2000));
      run = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // Fetch final messages
    const messages = await client.beta.threads.messages.list(thread.id);

    return res.status(200).json({
      status: run.status,
      output: messages.data[0].content[0].text.value,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
