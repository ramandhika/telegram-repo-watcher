import { Octokit } from "@octokit/rest";
import crypto from "crypto";

export function getOctokit(token?: string) {
  return new Octokit({ auth: token });
}

export async function getLastCommitSha(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<string | null> {
  try {
    const octokit = getOctokit(token);
    const { data } = await octokit.repos.getCommit({
      owner,
      repo,
      ref: branch,
    });
    return data.sha;
  } catch (error) {
    console.error(
      `Failed to get last commit for ${owner}/${repo}@${branch}:`,
      (error as Error).message // Cast error to Error to access message property
    );
    return null;
  }
}

export function verifyWebhookSignature(
  signature: string,
  payload: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  const digest = `sha256=${hmac.update(payload).digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}
