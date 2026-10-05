import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import express from 'express'
import dotenv from 'dotenv'
import { createApp } from './app.mjs'
import { createJiraClient } from './jira.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
dotenv.config({ path: `${root}.env`, quiet: true })
const configured = Boolean(process.env.JIRA_EMAIL?.trim() && process.env.JIRA_API_TOKEN?.trim())
const client = createJiraClient({ email: process.env.JIRA_EMAIL?.trim(), token: process.env.JIRA_API_TOKEN?.trim() })
const app = createApp({ client, configured })
const server = createServer(app)
let vite

if (process.argv.includes('--production')) {
  app.use(express.static(`${root}dist`))
  app.get('/{*path}', (_request, response) => response.sendFile(`${root}dist/index.html`))
} else {
  const { createServer: createViteServer } = await import('vite')
  vite = await createViteServer({ root, server: { middlewareMode: true, hmr: { server } } })
  app.use(vite.middlewares)
}

let port = Number(process.env.PORT || 5173)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.')
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && port < 65535) {
    port += 1
    server.listen(port, '127.0.0.1')
  } else {
    console.error(error.message)
    process.exit(1)
  }
})
server.on('listening', () => console.log(`Jira Worklog: http://127.0.0.1:${port}`))
server.listen(port, '127.0.0.1')

async function close() {
  await vite?.close()
  server.close(() => process.exit(0))
}
process.on('SIGINT', close)
process.on('SIGTERM', close)