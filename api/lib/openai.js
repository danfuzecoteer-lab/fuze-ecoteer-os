function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function generateAutomationEmail(automation, runDate) {
  const model = process.env.OPENAI_MODEL || "gpt-5.4";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: "You write concise, practical Fuze Ecoteer automation emails. Be clear about uncertainty and do not invent private facts.",
        },
        {
          role: "user",
          content: `${automation.prompt}\n\nRun date in Kuala Lumpur: ${runDate}\n\nReturn only the email body.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI generation failed: ${await response.text()}`);
  }

  const data = await response.json();
  if (data.output_text) return data.output_text;

  const text = (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("OpenAI response did not include output text");
  }

  return text;
}

module.exports = {
  generateAutomationEmail,
};
