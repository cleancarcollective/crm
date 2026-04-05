import { ServerClient } from "postmark";

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

  postmarkClient = new ServerClient(getRequiredEnv("POSTMARK_SERVER_TOKEN"));
  return postmarkClient;
}
