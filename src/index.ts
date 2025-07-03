import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { staticPlugin } from "@elysiajs/static";
import { createBot } from "./bot";
import { initializeDatabase } from "./database";
import { verifyWebhookSignature, getLastCommitSha } from "./github";
import "dotenv/config"; // Pastikan .env dimuat

const PORT = process.env.PORT || 3000;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

async function main() {
  const db = await initializeDatabase();
  const bot = await createBot(db);

  // Set webhook di Telegram jika Anda ingin bot menerima update melalui webhook
  // Untuk development, polling biasanya lebih mudah. Untuk produksi, webhook direkomendasikan.
  // Pastikan URL webhook Anda dapat diakses dari internet.
  // Contoh: https://your-domain.com/telegram-webhook
  // await bot.api.setWebhook(`https://your-domain.com/telegram-webhook`);
  // console.log('Telegram webhook set.');

  // Atau gunakan polling untuk development
  bot.start();
  console.log("Telegram bot started in polling mode.");

  const app = new Elysia()
    .use(swagger())
    .use(staticPlugin({ assets: "./public", prefix: "/public" })) // Opsional, jika Anda punya file statis
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
        const ref = pushPayload.ref; // refs/heads/master
        const branchName = ref.split("/").pop(); // master
        const commits = pushPayload.commits;
        const repository = pushPayload.repository;

        if (!commits || commits.length === 0) {
          set.status = 200;
          return { message: "No new commits." };
        }

        const owner = repository.owner.name || repository.owner.login;
        const repoName = repository.name;
        const latestCommit = commits[0]; // Ambil commit terbaru

        console.log(
          `Received push event for ${owner}/${repoName} on branch ${branchName}`
        );

        // Dapatkan semua repositori yang dipantau oleh user yang terkait dengan repo ini
        const monitoredRepos: any[] = await db.all(
          "SELECT * FROM repositories WHERE owner = ? AND repo = ? AND branch = ?",
          owner,
          repoName,
          branchName
        );

        for (const monitoredRepo of monitoredRepos) {
          // Hanya kirim notifikasi jika SHA commit terakhir berbeda
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
              // Update last_commit_sha di database
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
    .listen(PORT, () => {
      console.log(`🦊 Elysia is running at http://localhost:${PORT}`);
    });
}

main().catch(console.error);
