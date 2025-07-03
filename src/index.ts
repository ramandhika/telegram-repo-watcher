import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { staticPlugin } from "@elysiajs/static";
import { createBot } from "./bot";
import { initializeDatabase } from "./database";
import { verifyWebhookSignature, getLastCommitSha, getOctokit } from "./github"; // Tambahkan getOctokit
import "dotenv/config";

const PORT = process.env.PORT || 3000;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

async function main() {
  const db = await initializeDatabase();
  const bot = await createBot(db);

  bot.start();
  console.log("Telegram bot started in polling mode.");

  const app = new Elysia()
    .use(swagger())
    .use(staticPlugin({ assets: "./public", prefix: "/public" }))
    .get("/", () => "GitHub Commit Bot is running!")
    .post("/github-webhook", async ({ request, body, set }) => {
      const signature = request.headers.get("x-hub-signature-256");
      const event = request.headers.get("x-github-event");

      if (!signature || !event || !GITHUB_WEBHOOK_SECRET) {
        set.status = 400;
        return { message: "Missing headers or secret not configured." };
      }

      const payload = JSON.stringify(body);

      if (!verifyWebhookSignature(signature, payload, GITHUB_WEBHOOK_SECRET)) {
        set.status = 401;
        return { message: "Invalid signature." };
      }

      if (event === "push") {
        const pushPayload = body as any;
        const ref = pushPayload.ref;
        const branchName = ref.split("/").pop();
        const commits = pushPayload.commits;
        const repository = pushPayload.repository;

        if (!commits || commits.length === 0) {
          set.status = 200;
          return { message: "No new commits." };
        }

        const owner = repository.owner.name || repository.owner.login;
        const repoName = repository.name;
        const latestCommit = commits[0];

        console.log(
          `Received push event for ${owner}/${repoName} on branch ${branchName}`
        );

        const monitoredRepos: any[] = await db.all(
          "SELECT * FROM repositories WHERE owner = ? AND repo = ? AND branch = ?",
          owner,
          repoName,
          branchName
        );

        for (const monitoredRepo of monitoredRepos) {
          if (monitoredRepo.last_commit_sha !== latestCommit.id) {
            const commitMessage = latestCommit.message.split("\n")[0];
            const commitAuthor = latestCommit.author.name;
            const commitUrl = latestCommit.url;

            const message =
              `🚨 *New commit on ${owner}/${repoName}@${branchName}*\n` +
              `*Author:* ${commitAuthor}\n` +
              `*Message:* ${commitMessage}\n` +
              `*Commit:* [${latestCommit.id.substring(0, 7)}](${commitUrl})`;

            try {
              await bot.api.sendMessage(monitoredRepo.chat_id, message, {
                parse_mode: "Markdown",
              });
              await db.run(
                "UPDATE repositories SET last_commit_sha = ? WHERE id = ?",
                latestCommit.id,
                monitoredRepo.id
              );
              console.log(
                `Notified chat ${monitoredRepo.chat_id} about new commit.`
              );
            } catch (error) {
              console.error(
                `Failed to send message to chat ${monitoredRepo.chat_id}:`,
                error
              );
            }
          }
        }
      }

      set.status = 200;
      return { message: "Webhook received." };
    })
    // --- Tambahkan endpoint /update di sini ---
    .get("/update", async ({ set }) => {
      console.log("Manual /update triggered.");
      const allMonitoredRepos: any[] = await db.all(
        "SELECT * FROM repositories"
      );
      let updatedCount = 0;
      let notificationSentCount = 0;

      for (const repo of allMonitoredRepos) {
        const chatId = repo.chat_id;
        const owner = repo.owner;
        const repoName = repo.repo;
        const branch = repo.branch;
        const storedSha = repo.last_commit_sha;

        let githubToken: string | undefined = undefined;
        const user: any = await db.get(
          "SELECT github_token FROM users WHERE chat_id = ?",
          chatId
        );
        if (user && user.github_token) {
          githubToken = user.github_token;
        }

        try {
          const latestSha = await getLastCommitSha(
            owner,
            repoName,
            branch,
            githubToken
          );

          if (latestSha && latestSha !== storedSha) {
            console.log(
              `Update detected for ${owner}/${repoName}@${branch}. Stored: ${storedSha}, Latest: ${latestSha}`
            );
            updatedCount++;

            // Dapatkan detail commit lengkap untuk pesan notifikasi
            const octokit = getOctokit(githubToken);
            const { data: commitData } = await octokit.repos.getCommit({
              owner,
              repo: repoName,
              ref: latestSha,
            });

            const commitMessage = commitData.commit.message.split("\n")[0];
            const commitAuthor = commitData.commit.author?.name || "Unknown";
            const commitUrl = commitData.html_url;

            const message =
              `✨ *Update detected on ${owner}/${repoName}@${branch}*\n` +
              `*Author:* ${commitAuthor}\n` +
              `*Message:* ${commitMessage}\n` +
              `*Commit:* [${latestSha.substring(0, 7)}](${commitUrl})`;

            try {
              await bot.api.sendMessage(chatId, message, {
                parse_mode: "Markdown",
              });
              notificationSentCount++;
              // Update SHA di database
              await db.run(
                "UPDATE repositories SET last_commit_sha = ? WHERE id = ?",
                latestSha,
                repo.id
              );
              console.log(
                `Notified chat ${chatId} about manual update for ${owner}/${repoName}.`
              );
            } catch (telegramError) {
              console.error(
                `Failed to send Telegram message for ${owner}/${repoName} to chat ${chatId}:`,
                telegramError
              );
            }
          } else if (!latestSha) {
            console.warn(
              `Could not fetch latest SHA for ${owner}/${repoName}@${branch}. Skipping.`
            );
          } else {
            console.log(
              `No new commit for ${owner}/${repoName}@${branch}. SHA: ${latestSha}`
            );
          }
        } catch (githubError) {
          console.error(
            `Error checking GitHub for ${owner}/${repoName}@${branch}:`,
            githubError
          );
          // Opsional: kirim pesan error ke chat_id jika ada masalah dengan akses GitHub
          try {
            await bot.api.sendMessage(
              chatId,
              `⚠️ Gagal memeriksa *${owner}/${repoName}* (${branch}). Pastikan repositori dan token GitHub Anda valid.`,
              { parse_mode: "Markdown" }
            );
          } catch (e) {
            console.error(`Failed to send error message to chat ${chatId}:`, e);
          }
        }
      }

      set.status = 200;
      return {
        message: `Pengecekan manual selesai. ${updatedCount} repositori memiliki update. ${notificationSentCount} notifikasi terkirim.`,
      };
    })
    .listen(PORT, () => {
      console.log(`🦊 Elysia is running at http://localhost:${PORT}`);
    });
}

main().catch(console.error);
