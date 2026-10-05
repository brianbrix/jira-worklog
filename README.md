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
- Sample mode is explicitly labeled and never makes Jira requests. Its project names and issue keys are illustrative.
- The app only reads Jira; it does not create or update worklogs.

Jira issue searches and worklogs are fully paginated, and each worklog is checked against the authenticated account and date range. Only issues and worklogs visible to that account can be included. Jira's search index may take time to reflect recent changes. Time tracking must be enabled.

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

Tests cover account/date filtering, timezone boundaries, pagination, totals, Jira errors, and local API access restrictions with mocked Jira responses. Live Jira verification requires your credentials and has not been performed.
