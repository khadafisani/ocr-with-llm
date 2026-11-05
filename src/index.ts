import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { logger } from 'hono/logger'
import { config } from './config'
import { connectDb } from './db'
import { documents } from './routes/documents'
import { invoices } from './routes/invoices'
import { startWorker } from './worker/queue'

await connectDb()
await startWorker()

const app = new Hono()

app.use('/api/*', logger())
app.route('/api/documents', documents)
app.route('/api/invoices', invoices)
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message }, 500)
})
app.use('/*', serveStatic({ root: './public' }))

export default {
  port: config.port,
  fetch: app.fetch,
  maxRequestBodySize: config.maxUploadBytes * 20,
}
