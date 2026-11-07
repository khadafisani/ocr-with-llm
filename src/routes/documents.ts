import { Hono } from 'hono'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { isValidObjectId, Types } from 'mongoose'
import { ALLOWED_TYPES, config } from '../config'
import { UploadedDocument } from '../models/document'
import { enqueue, removeInvoiceFor } from '../worker/queue'

export const documents = new Hono()

documents.post('/', async (c) => {
  const body = await c.req.parseBody({ all: true })
  const files = ([] as unknown[]).concat(body.files ?? []).filter((f): f is File => f instanceof File)
  if (!files.length) return c.json({ error: 'No files uploaded (field "files")' }, 400)

  await mkdir(config.uploadDir, { recursive: true })
  const created = []
  const rejected = []
  for (const file of files) {
    const mimeType = file.type.split(';')[0]!.trim().toLowerCase()
    const ext = ALLOWED_TYPES[mimeType]
    if (!ext) {
      rejected.push({ name: file.name, error: `Unsupported type ${mimeType || 'unknown'}` })
      continue
    }
    if (file.size > config.maxUploadBytes) {
      rejected.push({ name: file.name, error: 'File too large' })
      continue
    }
    const _id = new Types.ObjectId()
    const storedPath = join(config.uploadDir, `${_id}${ext}`)
    await Bun.write(storedPath, file)
    const doc = await UploadedDocument.create({
      _id,
      originalName: file.name,
      mimeType,
      size: file.size,
      storedPath,
    })
    created.push(doc)
    enqueue(String(_id))
  }
  return c.json({ documents: created, rejected }, created.length ? 202 : 400)
})

documents.get('/', async (c) => {
  // ocrText: still present on documents processed by the old two-model pipeline
  const list = await UploadedDocument.find({}, { ocrText: 0, extractRaw: 0 }).sort({ createdAt: -1 }).lean()
  return c.json(list)
})

documents.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isValidObjectId(id)) return c.json({ error: 'Invalid id' }, 400)
  const doc = await UploadedDocument.findById(id).lean()
  return doc ? c.json(doc) : c.json({ error: 'Not found' }, 404)
})

documents.get('/:id/file', async (c) => {
  const id = c.req.param('id')
  if (!isValidObjectId(id)) return c.json({ error: 'Invalid id' }, 400)
  const doc = await UploadedDocument.findById(id).lean()
  if (!doc) return c.json({ error: 'Not found' }, 404)
  const file = Bun.file(doc.storedPath)
  if (!(await file.exists())) return c.json({ error: 'File missing' }, 404)
  return new Response(file, {
    headers: {
      'content-type': doc.mimeType,
      'content-disposition': `inline; filename="${encodeURIComponent(doc.originalName)}"`,
    },
  })
})

documents.post('/:id/retry', async (c) => {
  const id = c.req.param('id')
  if (!isValidObjectId(id)) return c.json({ error: 'Invalid id' }, 400)
  const doc = await UploadedDocument.findById(id)
  if (!doc) return c.json({ error: 'Not found' }, 404)
  if (doc.status === 'processing') return c.json({ error: 'Document is being processed' }, 409)

  await removeInvoiceFor(id)
  await UploadedDocument.updateOne(
    { _id: id },
    {
      $set: { status: 'queued', stage: 'queued', error: null, invoiceId: null, progress: { page: 0, totalPages: 0 } },
    },
  )
  enqueue(id)
  return c.json({ ok: true }, 202)
})

documents.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isValidObjectId(id)) return c.json({ error: 'Invalid id' }, 400)
  const doc = await UploadedDocument.findById(id)
  if (!doc) return c.json({ error: 'Not found' }, 404)
  if (doc.status === 'processing') return c.json({ error: 'Document is being processed' }, 409)

  await removeInvoiceFor(id)
  await UploadedDocument.deleteOne({ _id: id })
  await unlink(doc.storedPath).catch(() => {})
  return c.json({ ok: true })
})
