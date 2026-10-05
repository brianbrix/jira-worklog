import express from 'express'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError } from './jira.mjs'

async function readInvoiceFonts() {
  const directories = [
    ['/System/Library/Fonts/Supplemental', 'Times New Roman.ttf', 'Times New Roman Bold.ttf'],
    [join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), 'times.ttf', 'timesbd.ttf'],
    ['/usr/share/fonts/truetype/msttcorefonts', 'Times_New_Roman.ttf', 'Times_New_Roman_Bold.ttf'],
    ['/usr/share/fonts/truetype/msttcorefonts', 'times.ttf', 'timesbd.ttf'],
  ]
  for (const [directory, regular, bold] of directories) {
    try {
      const fonts = await Promise.all([readFile(join(directory, regular)), readFile(join(directory, bold))])
      return { regular: fonts[0].toString('base64'), bold: fonts[1].toString('base64') }
    } catch { continue }
  }
  throw new Error('Times New Roman is required to match the invoice format. Install the regular and bold fonts, then try again.')
}

export function createApp({ client, configured, invoiceFonts = readInvoiceFonts }) {
  const app = express()
  app.disable('x-powered-by')
  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store')
    if (!['localhost', '127.0.0.1', '[::1]'].includes(request.hostname)) {
      return response.status(403).json({ error: 'Local access only.' })
    }
    if (request.get('origin')) {
      try {
        if (new URL(request.get('origin')).host !== request.get('host')) {
          return response.status(403).json({ error: 'Cross-origin access is not allowed.' })
        }
      } catch {
        return response.status(403).json({ error: 'Invalid origin.' })
      }
    }
    next()
  })
  app.get('/api/status', (_request, response) => response.json({ configured }))
  app.get('/api/invoice-fonts', async (_request, response) => {
    try {
      response.json(await invoiceFonts())
    } catch {
      response.status(503).json({ error: 'Times New Roman is required to match the invoice format. Install the regular and bold fonts, then try again.' })
    }
  })
  app.get('/api/worklogs', async (request, response) => {
    try {
      response.json(await client.report(request.query.from, request.query.to))
    } catch (error) {
      response.status(error instanceof ApiError ? error.status : 500).json({
        error: error instanceof ApiError ? error.message : 'Unable to load worklogs. Please try again.',
      })
    }
  })
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Endpoint not found.' }))
  return app
}