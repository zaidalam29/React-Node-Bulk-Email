# Bulk Mailer (React + Node.js + Gmail)

Send personalized emails to every contact in an Excel sheet through your Gmail account (using an App Password).

- Upload an `.xlsx` file — every row with an email address gets one email
- Attachments (PDF, images, documents…)
- Personalization with placeholders like `{{Name}}` and `{{Company}}`, taken from your Excel headers
- Plain text or HTML body, with a live preview
- Live progress: see each email being sent, one by one
- Pause, resume and cancel at any time
- The same Excel file is updated with ✔ Sent / ✘ Failed / ⚠ Skipped for every row — download it when done
- Re-upload the updated file to retry only the failed / remaining rows

## Tech stack

| Part | Stack |
|---|---|
| Frontend | React 19, Vite |
| Backend | Node.js, Express 5, Nodemailer, ExcelJS |
| Live updates | Server-Sent Events (SSE) |

## Requirements

- Node.js **22 or newer** (`node -v`)
- A Gmail account with **2-Step Verification** turned on

## 1. Create a Gmail App Password

Gmail does not allow your regular password for SMTP. Create an App Password instead:

1. Open your Google Account → **Security** → turn on **2-Step Verification**.
2. Go to <https://myaccount.google.com/apppasswords>.
3. Enter an app name (e.g. `Bulk Mailer`) and click **Create**.
4. Copy the 16-character password. You'll paste it in the app or in `server/.env`.

## 2. Install

```bash
git clone https://github.com/zaidalam29/React-Node-Bulk-Email.git
cd React-Node-Bulk-Email
npm install
```

`npm install` at the root installs both the `server` and `client` workspaces.

## 3. Configure (optional)

```bash
cp server/.env.example server/.env
```

Then edit `server/.env`:

```env
GMAIL_USER=yourname@gmail.com
GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
FROM_NAME=Your Name
```

If you set these, you can leave the Gmail fields empty in the UI. If you don't, just type your Gmail address and App Password into the UI each time — credentials entered in the UI are never stored.

All available settings:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | Backend port |
| `GMAIL_USER` | — | Default Gmail address |
| `GMAIL_APP_PASSWORD` | — | Default App Password |
| `FROM_NAME` | — | Default sender name |
| `ACCESS_TOKEN` | — | If set, users must enter this token to use the app. **Always set this on a public server.** |
| `TRUST_PROXY` | — | Set to `1` behind a reverse proxy (Nginx, Render, Railway…) |
| `TIMEZONE` | system | Timezone for the "Sent At" column, e.g. `Asia/Kolkata` |
| `MAX_EXCEL_SIZE_MB` | `10` | Max Excel upload size |
| `MAX_ATTACHMENT_TOTAL_MB` | `18` | Max total attachment size (Gmail's limit is 25 MB after encoding) |
| `MAX_ATTACHMENTS` | `10` | Max number of attachments |
| `MAX_RECIPIENTS` | `2000` | Max recipients per run |
| `DEFAULT_DELAY_MS` | `1500` | Default delay between emails |
| `SESSION_TTL_HOURS` | `24` | Uploaded files are deleted after this many hours |

## 4. Run in development

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend API: <http://localhost:5000>

## 5. Run in production

```bash
npm run build     # builds the React app into client/dist
npm start         # serves the UI and the API on http://localhost:5000
```

Or with Docker:

```bash
docker build -t bulk-mailer .
docker run -p 5000:5000 --env-file server/.env bulk-mailer
```

## How to use

1. **Gmail Account** — enter your Gmail address and App Password, then click **Verify connection**.
2. **Recipients Excel** — drag & drop your `.xlsx` file. Click **Download sample Excel** for a ready-made template.
3. **Email Compose** — write the subject and body, click the header chips to insert placeholders, add attachments, and check the **Preview** tab.
4. **Send & Track** — click **Start Sending**. Watch the live log and the recipients table, then click **Download updated Excel**.

### Excel format

| Name | Email | Company |
|---|---|---|
| Rahul Sharma | rahul@example.com | Acme Pvt Ltd |
| Priya Verma | priya@example.com | Globex |

- The **first row must be headers**. The email column is detected by its name (`Email`, `E-mail`, `Mail ID`…) or by its contents.
- One cell can hold multiple emails separated by `,` or `;` — they all receive the same email.
- Every header can be used as a placeholder: `{{Name}}`, `{{Company}}`… (case-insensitive).
- Only `.xlsx` is supported. Convert `.xls` / `.csv` files with Excel → **Save As .xlsx**.

### What gets written to the Excel file

The app adds three columns and saves the file after **every** email, so progress is never lost:

| Email Status | Sent At | Email Error |
|---|---|---|
| ✔ Sent | 22 Nov 2026, 12:41:33 pm | |
| ✘ Failed | | Recipient address rejected: … |
| ⚠ Skipped | | Duplicate email (already in an earlier row) |

Rows are skipped when the email is empty, invalid, or a duplicate of an earlier row. Upload the updated file again and click **Start** to send only to rows that are not yet ✔ Sent.

## Gmail limits & tips

- Personal Gmail: about **500 emails/day**. Google Workspace: about **2,000/day**.
- If the daily limit is reached or the login fails, sending stops automatically and the remaining rows stay pending — fix the issue and click Start again later.
- Keep a delay of 1–2 seconds between emails to avoid being rate-limited.
- Test with 2–3 of your own addresses first.

## Project structure

```
├── client/                 React frontend (Vite)
│   └── src/
│       ├── App.jsx
│       ├── components/     GmailCard, UploadCard, ComposeCard, ProgressPanel, RecipientsTable
│       └── hooks/          useJobStream (live SSE updates)
├── server/                 Express backend
│   └── src/
│       ├── routes.js       API endpoints
│       ├── jobRunner.js    Sending queue, pause / resume / cancel, retries
│       ├── excel.js        Excel parsing and status marking
│       └── mailer.js       Gmail SMTP transport and error handling
└── Dockerfile
```

## Security notes

- Never commit `server/.env` (it is already in `.gitignore`).
- Set `ACCESS_TOKEN` before deploying anywhere public, otherwise anyone with the URL can send email from your account.
- App Passwords entered in the UI are kept in memory only while a job is running.
- To revoke access, delete the App Password at <https://myaccount.google.com/apppasswords>.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Gmail login failed" | Make sure 2-Step Verification is on and use a fresh 16-character App Password, not your regular password. |
| "No email column found" | Add a header named `Email` in the first row. |
| "Daily sending limit reached" | Wait 24 hours, then re-upload the updated Excel and click Start. |
| "Session expired" | The server restarted or 24 hours passed — upload the Excel file again. |
| Frontend says it can't connect | Make sure `npm run dev` is running and port 5000 is free. |
