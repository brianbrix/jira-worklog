# Jira Worklog

A local React app for your worklogs on https://devgateway.atlassian.net.

## Connect Jira

1. Open `.env` in this project and set `JIRA_EMAIL` to your Atlassian account email.
2. Create an **API token without scopes** at https://id.atlassian.com/manage-profile/security/api-tokens and set `JIRA_API_TOKEN` in `.env`. Scoped tokens require Atlassian's API gateway and are not supported by this app.
3. Run `npm run dev` from this folder. Restart the command after changing `.env`.
4. Open the local URL printed in the terminal, normally http://127.0.0.1:5173.

Do not share the token in chat. `.env` is ignored by Git. Credentials are read only by the local Node server, never returned to React, stored in browser storage, or bundled into the frontend.

## Reports

- Select an inclusive date range or use the week/month presets.
- "Current user" is the account identified by the configured email and token, not your browser's Jira session.
- Dates are calculated in that account's Jira profile timezone; quick presets use your computer's calendar.
- Total time, project totals, daily activity, and individual worklogs are shown with project and issue links.
- Project and text filters apply to the displayed totals and CSV export.
- Choose **Entries** or **Work items** above the table. Work items combines logs for each Jira issue into one row with its date span and total time; expand the worklog count to see individual dates, durations, and comments.
- Filters apply before grouping, and CSV export follows the selected view. Grouping does not change invoice hours or amounts.
- Sample mode is explicitly labeled and never makes Jira requests. Its project names and issue keys are illustrative.
- The app only reads Jira; it does not create or update worklogs.

Jira issue searches and worklogs are fully paginated, and each worklog is checked against the authenticated account and date range. Only issues and worklogs visible to that account can be included. Jira's search index may take time to reflect recent changes. Time tracking must be enabled.

## Invoice PDF

The **Invoice** tab downloads a PDF with sender/contact information, billing recipient, payment details, billable work grouped by project, primary tasks, hours, the daily-rate calculation, reimbursable expenses, and the final USD total. The **Worklogs** tab contains the report and its filters. Changing tabs keeps the current invoice draft intact.

The PDF reproduces the reference invoice's US Letter page size, 7.8-point Times New Roman text, left-aligned contact and billing blocks, measured table columns and row spacing, formula row, expense continuation, and gray final-total row. Regular and bold Times New Roman must be installed locally; the server reads and embeds those fonts at download time. Font files and the original invoice are not distributed with this repository. Restart the local server after updating backend code.

- Load the desired date range and apply any project or text filters before downloading. The invoice uses the same selected worklogs as the report and CSV export.
- Enter the sender details, billing recipient, payment details, daily rate in USD, and hours per day (default: 8). Project codes can be edited to match the client's billing codes.
- Add approved expense reports with their summaries and USD costs when applicable.
- Choose **Download PDF**. Monthly filenames follow `sender_name_mar_2026_invoice.pdf`; ranges spanning months include both dates. The browser saves the file to its configured download location.
- Details are session-only by default. Opt in with **Remember invoice details** to save the sender, contact, billing recipient, payment details, rate, hours per day, and project codes in this browser's `localStorage`. Edits are saved while the option is enabled. Expense rows are not saved across reloads.
- **Clear saved details**, or turning off the checkbox, removes the saved copy without erasing the current draft. Reloading then clears unsaved details. Invoice details are never sent to the server or included in the repository.
- Sample-mode PDFs are marked **SAMPLE INVOICE - NOT FOR PAYMENT** and use a `sample_` filename prefix.

Totals are computed from the actual worklog seconds, not rounded displayed hours. Work and individual expense amounts are rounded to cents before calculating the final total. Long task lists continue onto additional PDF pages.

### Browser Storage Safety

Saved details are **not encrypted or password-protected by this app**. Other people using the same browser profile, extensions with access to this site, or malicious JavaScript running on the same origin could read them. Use a trusted personal browser profile; avoid saving bank details on shared computers. Clearing browser/site data deletes the saved copy.

Storage is specific to the browser profile and exact app origin, including the port. Use the same local URL to retrieve saved details. Jira API tokens are never stored in browser storage.

## Commands

Requires Node.js 22.12+ (tested with 22.22) and npm.

```sh
npm install
npm run dev
npm test
npm run lint
npm run build
npm start
```

`npm start` serves the production build and API together; run `npm run build` first. Both development and production listen only on `127.0.0.1`. If `PORT` is busy, the app tries the next available port and prints its URL. This is a single-user local tool, not a publicly deployable multi-user service.

Tests cover account/date filtering, timezone boundaries, pagination, totals, work-item grouping and CSV export, invoice calculations and layout, Jira errors, and local API access restrictions with mocked Jira responses. Live Jira verification requires your credentials and has not been performed.
