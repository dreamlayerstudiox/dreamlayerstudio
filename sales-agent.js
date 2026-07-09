// ============================================================
// DREAM LAYER WEBSITES — SALES / LEAD-INTAKE AGENT
// Netlify Function · calls the Anthropic API server-side
// The API key lives in a Netlify env variable, never in the browser.
// ============================================================

const AGENT_NAME = "Nova"; // rename to match your Command Center agent

const SYSTEM_PROMPT = `You are ${AGENT_NAME}, the sales and lead-intake agent for Dream Layer Websites — a luxury, AI-managed digital agency that designs and builds premium websites for businesses.

Your job:
1. Greet visitors warmly and professionally. Keep replies short (2-4 sentences) — this is a chat widget, not email.
2. Learn what they need: type of business, what the site is for, timeline, and rough budget comfort.
3. Collect their name and email naturally in conversation — never as a form-like demand.
4. When you have name + email + project type, confirm the details back to them and tell them the team will follow up within 24 hours.

Tone: confident, polished, warm. You represent a premium brand — no slang, no over-eagerness, no walls of text.

Rules:
- Never quote exact prices. Say pricing is tailored to the project and the follow-up will include a proposal.
- Never make up capabilities. Dream Layer Websites builds custom websites, branding, and AI-powered site features.
- If asked something off-topic, politely steer back to how DLW can help their business.

IMPORTANT — lead capture:
When (and only when) you have collected the visitor's name, email, and project description, end your reply with this exact block on its own lines:

<<LEAD>>
{"name":"...","email":"...","project":"...","budget":"...","timeline":"..."}
<<END_LEAD>>

Use "unknown" for any field they didn't share. The visitor never sees this block — the website strips it out and saves the lead automatically.`;

exports.handler = async (event) => {
  // CORS + method handling
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };
  }

  try {
    const { messages } = JSON.parse(event.body || "{}");

    if (!Array.isArray(messages) || messages.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "messages array required" }) };
    }

    // Basic guardrails: cap history length and message size
    const trimmed = messages.slice(-20).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content).slice(0, 2000),
    }));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Agent temporarily unavailable" }) };
    }

    const data = await response.json();
    let reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // ---- Lead extraction ----
    let lead = null;
    const leadMatch = reply.match(/<<LEAD>>([\s\S]*?)<<END_LEAD>>/);
    if (leadMatch) {
      try {
        lead = JSON.parse(leadMatch[1].trim());
      } catch (e) {
        console.error("Lead parse failed:", e);
      }
      // Strip the block so the visitor never sees it
      reply = reply.replace(/<<LEAD>>[\s\S]*?<<END_LEAD>>/, "").trim();
    }

    // Save the lead to Netlify Forms (shows up in your Netlify dashboard + email notifications)
    if (lead && process.env.URL) {
      try {
        await fetch(process.env.URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            "form-name": "agent-leads",
            name: lead.name || "unknown",
            email: lead.email || "unknown",
            project: lead.project || "unknown",
            budget: lead.budget || "unknown",
            timeline: lead.timeline || "unknown",
          }).toString(),
        });
      } catch (e) {
        console.error("Lead save failed:", e);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply, leadCaptured: Boolean(lead) }),
    };
  } catch (err) {
    console.error("Function error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong" }) };
  }
};
