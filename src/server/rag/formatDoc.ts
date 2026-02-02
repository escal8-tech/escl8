type ConversationTurn = {
  role: "user" | "agent";
  text: string;
};

const USER_LABELS = new Set([
  "user",
  "customer",
  "client",
  "buyer",
  "lead",
  "prospect",
]);

const AGENT_LABELS = new Set([
  "agent",
  "bot",
  "assistant",
  "rep",
  "support",
  "seller",
]);

function appendTurn(turns: ConversationTurn[], role: ConversationTurn["role"], text: string) {
  const last = turns[turns.length - 1];
  if (last && last.role === role) {
    last.text = `${last.text} ${text}`.trim();
    return;
  }
  turns.push({ role, text });
}

function parseConversationTurns(text: string): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let match = line.match(/^\s*(q|question)\s*[:\-–]\s*(.+)$/i);
    if (match) {
      appendTurn(turns, "user", match[2].trim());
      continue;
    }

    match = line.match(/^\s*(a|answer)\s*[:\-–]\s*(.+)$/i);
    if (match) {
      appendTurn(turns, "agent", match[2].trim());
      continue;
    }

    match = line.match(/^\s*([a-zA-Z][a-zA-Z\s]{1,20})\s*[:\-–]\s*(.+)$/);
    if (match) {
      const label = match[1].trim().toLowerCase();
      const content = match[2].trim();
      if (USER_LABELS.has(label)) {
        appendTurn(turns, "user", content);
        continue;
      }
      if (AGENT_LABELS.has(label)) {
        appendTurn(turns, "agent", content);
        continue;
      }
    }

    const inferredRole = line.endsWith("?") ? "user" : (turns[turns.length - 1]?.role || "user");
    appendTurn(turns, inferredRole, line);
  }

  return turns;
}

export function formatConversationForChunking(text: string): string {
  const turns = parseConversationTurns(text);
  if (turns.length === 0) return text.trim();

  const rows: string[] = [];
  let pendingQuestion: string | null = null;

  for (const turn of turns) {
    if (turn.role === "user") {
      if (pendingQuestion) {
        rows.push(`Q: ${pendingQuestion}`);
      }
      pendingQuestion = turn.text;
      continue;
    }

    if (pendingQuestion) {
      rows.push(`Q: ${pendingQuestion}\nA: ${turn.text}`);
      pendingQuestion = null;
    } else {
      rows.push(`A: ${turn.text}`);
    }
  }

  if (pendingQuestion) {
    rows.push(`Q: ${pendingQuestion}`);
  }

  return rows.join("\n\n");
}
