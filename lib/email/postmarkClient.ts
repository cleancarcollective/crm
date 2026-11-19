import { ServerClient } from "postmark";

import { sanitizeEmailFields } from "@/lib/email/stripEmDashes";

let postmarkClient: ServerClient | null = null;

function getRequiredEnv(name: "POSTMARK_SERVER_TOKEN") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getPostmarkClient() {
  if (postmarkClient) {
    return postmarkClient;
  }

  const client = new ServerClient(getRequiredEnv("POSTMARK_SERVER_TOKEN"));

  // Wrap sendEmail so every Postmark message (staff notifications, digests,
  // approval pings) has em dashes stripped from its subject + body. House
  // rule: no em dashes in any outbound CCC email.
  const originalSendEmail = client.sendEmail.bind(client);
  client.sendEmail = ((message: Parameters<typeof originalSendEmail>[0]) =>
    originalSendEmail(sanitizeEmailFields(message))) as typeof client.sendEmail;

  postmarkClient = client;
  return postmarkClient;
}
