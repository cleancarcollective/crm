import type { BookingConfirmationEmailContext, EmailTemplateRecord, RenderedEmail } from "@/lib/email/types";
import { renderTransactionalHtmlEmail } from "@/lib/email/transactionalTemplates";

const TEMPLATE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(
  template: EmailTemplateRecord,
  context: BookingConfirmationEmailContext
): RenderedEmail {
  const textBody = appendBookingEmailFallbackDetails(replaceTokens(template.body_template, context), context);

  return {
    subject: replaceTokens(template.subject_template, context),
    textBody,
    htmlBody: renderTransactionalHtmlEmail(context)
  };
}

function replaceTokens(templateValue: string, context: BookingConfirmationEmailContext) {
  return templateValue.replace(TEMPLATE_PATTERN, (_match, token: keyof BookingConfirmationEmailContext) => {
    return context[token] ?? "";
  });
}

export function appendBookingEmailFallbackDetails(body: string, context: BookingConfirmationEmailContext) {
  const addOnLine = context.add_ons && context.add_ons !== "None" ? `Add-ons: ${context.add_ons}` : "";
  if (!addOnLine) {
    return body;
  }

  if (body.includes("\nNotes:\n")) {
    return body.replace("\nNotes:\n", `\n${addOnLine}\n\nNotes:\n`);
  }

  if (body.includes("\nNotes:")) {
    return body.replace("\nNotes:", `\n${addOnLine}\n\nNotes:`);
  }

  return `${body}\n\n${addOnLine}`;
}
