import { Bot, GrammyError, HttpError } from "grammy";
import { Database } from "sqlite";
import { initializeDatabase } from "./database";
import { getLastCommitSha, getOctokit } from "./github";

interface Repository {
  id: number;
  chat_id: number;
  owner: string;
  repo: string;
  branch: string;
  last_commit_sha: string | null;
}

interface User {
  chat_id: number;
  github_username: string | null;
  github_token: string | null;
}

export async function createBot(db: Database) {
  const bot = new Bot(process.env.BOT_TOKEN || "");

  // --- Middleware untuk menyimpan dan mengambil data user/repo ---
  // Ini akan menambahkan objek `db` ke `ctx` (konteks Grammys)
  // sehingga Anda bisa mengakses database di setiap handler perintah.
  bot.use(async (ctx, next) => {
    ctx.db = db;
    await next(); // Penting: panggil next() untuk melanjutkan ke handler berikutnya
  });

  // --- Commands ---

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Halo! Saya adalah bot pemantau commit GitHub. Gunakan perintah berikut:\n" +
        "/add <owner/repo> [branch] - Tambahkan repositori untuk dipantau.\n" +
        "/list - Lihat daftar repositori yang dipantau.\n" +
        "/delete <ID_REPO> - Hapus repositori dari pantauan.\n" +
        "/login <username> <token> - Login dengan akun GitHub untuk memantau repositori private."
    );
  });

  bot.command("add", async (ctx) => {
    const args = ctx.match.split(" ");
    if (args.length < 1 || !args[0].includes("/")) {
      return ctx.reply(
        "Format salah. Gunakan: `/add <owner/repo> [branch]`. Contoh: `/add ramandhika/telegram-repo-watcher`"
      );
    }

    const [owner, repo] = args[0].split("/");
    const branch = args[1] || "master"; // Default branch ke 'master' jika tidak disediakan

    if (!owner || !repo) {
      return ctx.reply("Owner atau nama repositori tidak valid.");
    }

    const chatId = ctx.chat.id;

    // Cek apakah user sudah login untuk repo private
    const user: User | undefined = await ctx.db.get(
      "SELECT * FROM users WHERE chat_id = ?",
      chatId
    );
    let githubToken: string | undefined = undefined;
    if (user && user.github_token) {
      githubToken = user.github_token;
    }

    // Dapatkan SHA commit terakhir
    const lastCommitSha = await getLastCommitSha(
      owner,
      repo,
      branch,
      githubToken
    );
    if (!lastCommitSha) {
      return ctx.reply(
        `Gagal mendapatkan commit terakhir untuk *${owner}/${repo}@${branch}*. Pastikan nama repositori dan branch benar, dan jika repositori private, pastikan Anda sudah login dengan /login.`
      );
    }

    try {
      await ctx.db.run(
        "INSERT INTO repositories (chat_id, owner, repo, branch, last_commit_sha) VALUES (?, ?, ?, ?, ?)",
        chatId,
        owner,
        repo,
        branch,
        lastCommitSha
      );
      await ctx.reply(
        `Repositori *${owner}/${repo}* (branch: ${branch}) berhasil ditambahkan untuk dipantau.`
      );
    } catch (error: any) {
      // Menggunakan 'any' untuk error agar bisa mengakses properti message
      if (error.message.includes("UNIQUE constraint failed")) {
        return ctx.reply(
          `Repositori *${owner}/${repo}* (branch: ${branch}) sudah ada dalam daftar pantauan Anda.`
        );
      }
      console.error("Error adding repository:", error);
      await ctx.reply("Terjadi kesalahan saat menambahkan repositori.");
    }
  });

  bot.command("list", async (ctx) => {
    const chatId = ctx.chat.id;
    const repos: Repository[] = await ctx.db.all(
      "SELECT * FROM repositories WHERE chat_id = ?",
      chatId
    );

    if (repos.length === 0) {
      return ctx.reply(
        "Anda belum memantau repositori apa pun. Gunakan /add untuk menambahkan."
      );
    }

    let message = "Repositori yang Anda pantau:\n\n";
    repos.forEach((r) => {
      message += `*ID:* \`${r.id}\`\n`;
      message += `*Repo:* \`${r.owner}/${r.repo}\`\n`;
      message += `*Branch:* \`${r.branch}\`\n`;
      message += `*Last SHA:* \`${
        r.last_commit_sha ? r.last_commit_sha.substring(0, 7) : "N/A"
      }\`\n`;
      message += "---\n";
    });

    await ctx.reply(message, { parse_mode: "Markdown" });
  });

  bot.command("delete", async (ctx) => {
    const repoId = parseInt(ctx.match.trim());
    if (isNaN(repoId)) {
      return ctx.reply(
        "Format salah. Gunakan: `/delete <ID_REPO>`. Gunakan /list untuk melihat ID."
      );
    }

    const chatId = ctx.chat.id;

    try {
      const result = await ctx.db.run(
        "DELETE FROM repositories WHERE id = ? AND chat_id = ?",
        repoId,
        chatId
      );
      if (result.changes && result.changes > 0) {
        await ctx.reply(`Repositori dengan ID \`${repoId}\` berhasil dihapus.`);
      } else {
        await ctx.reply(
          `Repositori dengan ID \`${repoId}\` tidak ditemukan atau Anda tidak memiliki akses untuk menghapusnya.`
        );
      }
    } catch (error) {
      console.error("Error deleting repository:", error);
      await ctx.reply("Terjadi kesalahan saat menghapus repositori.");
    }
  });

  bot.command("login", async (ctx) => {
    const args = ctx.match.split(" ");
    if (args.length !== 2) {
      return ctx.reply(
        "Format salah. Gunakan: `/login <username_github> <personal_access_token>`"
      );
    }

    const [username, token] = args;
    const chatId = ctx.chat.id;

    try {
      // Coba validasi token dengan mengambil data user
      const octokit = getOctokit(token);
      await octokit.users.getAuthenticated(); // Ini akan throw error jika token tidak valid

      await ctx.db.run(
        "INSERT OR REPLACE INTO users (chat_id, github_username, github_token) VALUES (?, ?, ?)",
        chatId,
        username,
        token
      );
      await ctx.reply(
        `Anda berhasil login sebagai *${username}*. Anda sekarang dapat menambahkan repositori private.`
      );
    } catch (error) {
      console.error("Error logging in:", error);
      await ctx.reply(
        "Gagal login. Pastikan username dan Personal Access Token (PAT) Anda benar dan memiliki scope yang cukup (misalnya `repo`)."
      );
    }
  });

  // --- Error Handling ---
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("Error in request:", e.description);
    } else if (e instanceof HttpError) {
      console.error("Could not contact Telegram:", e);
    } else {
      console.error("Unknown error:", e);
    }
  });

  console.log("Bot Telegram started.");
  return bot;
}

// Tambahkan deklarasi ke tipe `Context` Grammys
declare module "grammy" {
  interface Context {
    db: Database;
  }
}
