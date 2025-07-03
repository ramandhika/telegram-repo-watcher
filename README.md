# Bot Telegram Pemantau Commit GitHub (Elysia + Bun)

## Deskripsi

Bot ini memungkinkan Anda memantau perubahan (commit) pada repositori GitHub secara real-time melalui notifikasi di Telegram. Bot dibangun menggunakan framework Elysia (Bun runtime) dan terintegrasi dengan API Telegram serta GitHub Webhook.

## Fitur Utama

- **Pantau commit GitHub**: Dapatkan notifikasi setiap ada commit baru pada repositori dan branch yang Anda pilih.
- **Dukungan repositori private**: Login dengan akun GitHub Anda untuk memantau repositori private.
- **Manajemen repositori**: Tambah, lihat, dan hapus daftar repositori yang dipantau langsung dari Telegram.
- **Integrasi Webhook GitHub**: Mendukung webhook untuk update real-time.

## Instalasi

1. **Clone repository ini**
2. **Install dependensi**
   ```bash
   bun install
   ```
3. **Buat file `.env`** dan isi dengan variabel berikut:
   ```env
   BOT_TOKEN=token_bot_telegram_anda
   GITHUB_WEBHOOK_SECRET=secret_webhook_github_anda
   PORT=3000 # opsional, default 3000
   DATABASE_PATH=./data/bot.db # opsional
   ```
4. **Jalankan server pengembangan**
   ```bash
   bun run dev
   ```
5. Buka [http://localhost:3000/](http://localhost:3000/) di browser untuk memastikan server berjalan.

## Penggunaan Bot Telegram

Setelah bot berjalan, cari bot Anda di Telegram dan gunakan perintah berikut:

- `/start` — Tampilkan bantuan dan daftar perintah.
- `/add <owner/repo> [branch]` — Tambahkan repositori untuk dipantau. Contoh: `/add ramandhika/telegram-repo-watcher`
- `/list` — Lihat daftar repositori yang sedang dipantau.
- `/delete <ID_REPO>` — Hapus repositori dari daftar pantauan (ID bisa dilihat dari /list).
- `/login <username_github> <personal_access_token>` — Login untuk memantau repositori private.

## Integrasi GitHub Webhook

Agar bot dapat menerima notifikasi commit:

1. Buka pengaturan repositori GitHub Anda > **Settings** > **Webhooks** > **Add webhook**
2. Isi URL webhook dengan: `http://<server-anda>:3000/github-webhook`
3. Pilih tipe konten: `application/json`
4. Masukkan secret sesuai `GITHUB_WEBHOOK_SECRET` di `.env`
5. Pilih event: `Just the push event.`
6. Simpan webhook

## Struktur Database

Bot menggunakan SQLite untuk menyimpan data user dan repositori:

- **users**: Menyimpan chat_id Telegram, username GitHub, dan token.
- **repositories**: Menyimpan daftar repositori yang dipantau per user.

## Teknologi yang Digunakan

- [Bun](https://bun.sh/) — Runtime JavaScript/TypeScript
- [Elysia](https://elysiajs.com/) — Web framework
- [grammY](https://grammy.dev/) — Framework bot Telegram
- [@octokit/rest](https://github.com/octokit/rest.js) — GitHub API
- [sqlite3](https://www.npmjs.com/package/sqlite3) — Database

## Lisensi

Proyek ini menggunakan lisensi MIT.
