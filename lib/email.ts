import { EmailDeliveryError } from "./errors";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailClient {
  send(message: EmailMessage): Promise<{ id: string }>;
}

export interface ResendOptions {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Minimal Resend REST client (POST /emails) with a hard timeout. */
export function createResendClient(options: ResendOptions): EmailClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async send(message: EmailMessage) {
      let response: Response;
      try {
        response = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new EmailDeliveryError(
          `Resend request failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error instanceof Error ? error.name : undefined },
        );
      }

      const raw = await response.text();
      if (!response.ok) {
        throw new EmailDeliveryError(
          `Resend returned HTTP ${response.status}: ${raw.slice(0, 300)}`,
          { status: response.status },
        );
      }

      let id = "";
      try {
        const payload = JSON.parse(raw) as { id?: string };
        id = payload.id ?? "";
      } catch {
        // A 2xx without a parseable body still means the email was queued.
      }
      return { id };
    },
  };
}

export function emailClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EmailClient | null {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  const from = (env.RESEND_FROM ?? "").trim();
  if (!apiKey || !from) return null;
  return createResendClient({ apiKey, from });
}

export interface StreakEmailInput {
  name: string | null;
  streak: number;
  appUrl: string;
  lesson: { id: string; title: string } | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderStreakEmail(input: StreakEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const baseUrl = input.appUrl.replace(/\/$/, "");
  const target = input.lesson
    ? `${baseUrl}/lessons/${input.lesson.id}`
    : `${baseUrl}/new`;
  const name = input.name?.split(" ")[0] || "there";
  const streakLabel = `${input.streak}-day streak`;
  const subject = `🔥 ${streakLabel} — keep the quest going`;

  const lessonLine = input.lesson
    ? `Pick up "${input.lesson.title}" where you left off.`
    : "Build a new lesson from your own code, a PDF, or a GitHub repo.";

  const text = [
    `Hi ${name},`,
    "",
    `You are on a ${streakLabel}. That is ${input.streak} days in a row of writing and testing code.`,
    lessonLine,
    "",
    `Continue: ${target}`,
    "",
    "Small steps, every day. — CodeQuest",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0b0f14;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#e6edf3;">
    <div style="max-width:520px;margin:0 auto;background:#121821;border:1px solid #1f2a37;border-radius:16px;padding:28px;">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#7cf29c;">CodeQuest</p>
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;">Hi ${escapeHtml(name)} — ${escapeHtml(streakLabel)} 🔥</h1>
      <p style="margin:0 0 12px;color:#c3d0de;line-height:1.6;">
        That is ${input.streak} days in a row of writing and testing code. Streaks are not about perfection — they are about showing up.
      </p>
      <p style="margin:0 0 24px;color:#c3d0de;line-height:1.6;">${escapeHtml(lessonLine)}</p>
      <a href="${escapeHtml(target)}" style="display:inline-block;background:#7cf29c;color:#05311a;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:10px;">Continue your streak</a>
      <p style="margin:24px 0 0;font-size:12px;color:#7f8ea3;line-height:1.5;">
        You get this note on days when you have an active streak. Small steps, every day.
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}
