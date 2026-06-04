import connectToDatabase from "@/lib/mongodb";
import ExternalMessage, {
  ExternalMessageSource,
  IExternalMessage,
} from "@/models/ExternalMessage";
import { sendAdminNewExternalMessageAlert } from "@/lib/notifications";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateExternalMessageInput {
  source: ExternalMessageSource;
  senderName: string;
  senderEmail: string;
  senderPhone?: string;
  message: string;
  subject?: string;
  locale?: "fr" | "en";
  metadata?: Record<string, string | undefined>;
}

/** Persists a contact/school/enterprise submission. Throws on invalid input. */
export async function createExternalMessage(
  input: CreateExternalMessageInput,
): Promise<IExternalMessage> {
  const name = input.senderName?.trim();
  const email = input.senderEmail?.trim().toLowerCase();
  const message = input.message?.trim();

  if (!name || !email || !message) {
    throw new ValidationError("Missing required fields");
  }
  if (!EMAIL_RE.test(email)) {
    throw new ValidationError("Invalid email");
  }
  if (name.length > 200 || message.length > 10_000) {
    throw new ValidationError("Field too long");
  }

  await connectToDatabase();

  const cleanMetadata: Record<string, string> | undefined = input.metadata
    ? Object.fromEntries(
        Object.entries(input.metadata)
          .filter(([, v]) => typeof v === "string" && v.trim().length > 0)
          .map(([k, v]) => [k, (v as string).trim()]),
      )
    : undefined;

  const created = await ExternalMessage.create({
    source: input.source,
    senderName: name,
    senderEmail: email,
    senderPhone: input.senderPhone?.trim() || undefined,
    message,
    subject: input.subject?.trim() || undefined,
    locale: input.locale === "en" ? "en" : "fr",
    metadata:
      cleanMetadata && Object.keys(cleanMetadata).length > 0
        ? cleanMetadata
        : undefined,
    status: "new",
  });

  // §3.2: alert the admin team by email (via the configurable adminAlertEmail)
  // so a contact/school/enterprise submission isn't missed. Non-fatal — the
  // message is already persisted; a mail failure must not fail the submission.
  try {
    await sendAdminNewExternalMessageAlert({
      source: input.source,
      senderName: name,
      senderEmail: email,
      senderPhone: input.senderPhone?.trim() || undefined,
      subject: input.subject?.trim() || undefined,
      message,
    });
  } catch (e) {
    console.error("[external-message] admin alert failed:", e);
  }

  return created;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
