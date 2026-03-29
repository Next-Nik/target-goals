// TARGET GOALS — CHAT API
// api/chat.js
// Three modes: phase1_assess, phase2_refine, phase2_milestones
// Phase 2 carries context from previous domains.

const Anthropic = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── DOMAINS ───────────────────────────────────────────────────────────────────
const DOMAINS = {
  path:          { label: "Path",          question: "Am I walking my path — or just walking?" },
  spark:         { label: "Spark",         question: "Is the fire on?" },
  body:          { label: "Body",          question: "How is this living system doing?" },
  finances:      { label: "Finances",      question: "Do I have the agency to act on what matters?" },
  relationships: { label: "Relationships", question: "Am I truly known by anyone?" },
  inner_game:    { label: "Inner Game",    question: "Are my stories tending me, or running me?" },
  outer_game:    { label: "Outer Game",    question: "Is what I'm broadcasting aligned with who I actually am?" },
};

// ── PHASE 1: DOMAIN SELECTION RATIONALE ──────────────────────────────────────
// Called once — given the scores, recommends three domains with rationale.
async function recommendDomains(scores, hasMapData) {
  const scoreLines = Object.entries(scores).map(([id, score]) =>
    `${DOMAINS[id]?.label || id}: ${score}/10`
  ).join('\n');

  const system = `You are the Target Goals advisor for Life OS. You help people choose the three domains to focus on for the next quarter.

Your role is to surface the most catalytic domains — not just the lowest scores, but the ones where focused effort will unlock movement in others. You also watch for patterns:

BOTTLENECK RULE: Any domain scoring below 5 is an active floor for all others. If Body is at 3, it limits Path, Spark, and everything else. These must be named — though the person has the final say.

BALANCE WATCH: If the person's scores cluster in one area (e.g. all strong in output/work domains, weak in relational/inner domains), notice this gently. Don't lecture. One quiet observation is enough.

STRENGTH TRAP: People tend to train where they're already strong. If the obvious choices are all above 6, notice whether there's something lower being avoided. Offer a gentle observation — not a redirect, a question.

Return JSON only:
{
  "recommended": ["domain_id", "domain_id", "domain_id"],
  "rationale": {
    "domain_id": "one sentence — why this one, why now",
    "domain_id": "one sentence",
    "domain_id": "one sentence"
  },
  "soft_observation": "one quiet sentence if there's a balance or strength-trap pattern worth naming, or null if not"
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Domain scores${hasMapData ? ' (from The Map)' : ' (self-reported)'}:\n${scoreLines}\n\nRecommend three focus domains for the next quarter.`
    }],
    system
  });

  const raw = response.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(raw);
}

// ── PHASE 2: GOAL REFINEMENT CONVERSATION ────────────────────────────────────
function buildPhase2System(domain, domainScore, currentScore, targetDate, completedDomains) {
  const domainLabel = DOMAINS[domain]?.label || domain;
  const priorContext = completedDomains.length > 0
    ? `\n\nCONTEXT FROM PREVIOUS DOMAINS:\n${completedDomains.map(d =>
        `${DOMAINS[d.domain]?.label}: Goal — "${d.outcome_system}". What emerged: this person ${d.conversation_insight || 'is working toward meaningful change'}.`
      ).join('\n')}`
    : '';

  return `You are helping someone set a meaningful 90-day Target Goal for their ${domainLabel} domain. You are a thinking partner — warm, direct, and honest.

THEIR CURRENT STATE: ${currentScore}/10 in ${domainLabel}. ${domainScore ? `The Map shows: "${domainScore}"` : ''}
TARGET DATE: ${targetDate}
${priorContext}

YOUR JOB IN THIS CONVERSATION:
You help them arrive at a goal that is specific, honest, and reachable — but also meaningful. Not a box to tick. A direction that, when they move toward it, they actually change.

THE FOUR THINGS YOU CHECK (without lecturing):

1. SPECIFICITY — Can they tell when they've hit it? "Get fitter" is not a goal. "Complete a 5K" or "work out 4 times a week consistently" is.

2. REACHABILITY — Does this make sense from where they are? If they're at 3/10 and they write a goal that requires a 9/10 foundation, flag it. Not to say no — to ask if there's a closer milestone that builds the foundation first.

3. THE ABSOLUTE TRAP — Watch for binary/streak goals: "every day," "never miss," "zero exceptions." These feel motivating and become demoralising when one day breaks the chain. When you see this pattern, offer a reframe: not fewer days, but built-in humanity. "5 of 7 days" rather than "every day." "More often than not, trending up." Name it once, warmly, not as a correction — as a pattern you've seen.

4. THE LONGER VIEW — One light question: does this goal serve the version of them that exists in a year, or does it optimise for the next 90 days at some longer cost? Not the seventh generation check — just: is this building something or burning something?

WHAT YOU PRODUCE AT THE END:
When the goal feels solid (usually 3-5 exchanges), output this JSON:
{
  "ready": true,
  "outcome_system": "The goal as you'd state it — specific, honest, reachable, humanity built in",
  "month3": "What needs to be true at end of month 3",
  "month2": "What needs to be true at end of month 2 for month 3 to be reachable",
  "month1": "What needs to be true at end of month 1 for month 2 to be reachable",
  "weeks": ["Week 1 focus", "Week 2 focus", "Week 3 focus", "Week 4 focus"],
  "tea": {
    "thoughts": "A daily thought anchor — what to notice or return to",
    "emotions": "What emotional signal to pay attention to in this area",
    "actions": "The specific recurring action to track"
  },
  "conversation_insight": "One sentence on what emerged about this person through this conversation — carried forward to next domain"
}

For all other turns, respond as plain conversational text. Warm, direct, curious. Not a checklist. A real conversation.

TONE: Like a wise friend who has seen how this works and cares about getting it right. Never preachy. Never a lecture. One observation at a time. The person always has the last word — if they override something, accept it and move forward.`;
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { mode, scores, hasMapData, domain, domainScore, currentScore,
          targetDate, messages, completedDomains } = req.body || {};

  try {
    // ── Mode: recommend domains ───────────────────────────────────────────────
    if (mode === "recommend") {
      const result = await recommendDomains(scores, hasMapData);
      return res.json(result);
    }

    // ── Mode: goal refinement conversation ────────────────────────────────────
    if (mode === "refine") {
      const system = buildPhase2System(
        domain, domainScore, currentScore,
        targetDate, completedDomains || []
      );

      // Replace the START trigger with a proper opening prompt
      const apiMessages = (messages || []).map(m =>
        m.content === 'START'
          ? { role: 'user', content: `I'm ready to work on my ${DOMAINS[domain]?.label || domain} goal for the next quarter.` }
          : m
      );

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system,
        messages: apiMessages
      });

      const text = response.content[0].text;

      // Check if it's the final JSON output
      if (text.includes('"ready": true')) {
        try {
          const raw = text.replace(/```json|```/g, '').trim();
          const data = JSON.parse(raw);
          return res.json({ complete: true, data });
        } catch {}
      }

      return res.json({ complete: false, message: text });
    }

    return res.status(400).json({ error: "Unknown mode" });

  } catch (err) {
    console.error("[TargetGoals] API error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
