import express from 'express'
import { ApiError } from './jira.mjs'

export function createApp({ client, configured }) {
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