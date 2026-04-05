import type { BookingConfirmationEmailContext, EmailTemplateRecord, RenderedEmail } from "@/lib/email/types";
import { renderTransactionalHtmlEmail } from "@/lib/email/transactionalTemplates";

const TEMPLATE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(
  template: EmailTemplateRecord,
  context: BookingConfirmationEmailContext
): RenderedEmail {
  return {
    subject: replaceTokens(template.subject_template, context),
    textBody: replaceTokens(template.body_template, context),
    htmlBody: renderTransactionalHtmlEmail(context)
  };
}

function replaceTokens(templateValue: string, context: BookingConfirmationEmailContext) {
  return templateValue.replace(TEMPLATE_PATTERN, (_match, token: keyof BookingConfirmationEmailContext) => {
    return context[token] ?? "";
  });
}
