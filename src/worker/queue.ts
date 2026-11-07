import { readFile } from 'node:fs/promises'
import type { Types } from 'mongoose'
import { config } from '../config'
import { UploadedDocument, type Stage } from '../models/document'
import { Invoice } from '../models/invoice'
import { InvoiceItem } from '../models/invoiceItem'
import { extractInvoice } from '../services/extract'
import { pdfToPngs } from '../services/pdf'

const jobs: string[] = []
const pending = new Set<string>()
let running = false

export function enqueue(id: string) {
  if (pending.has(id)) return
  pending.add(id)
  jobs.push(id)
  void drain()
}

async function drain() {
  if (running) return
  running = true
  try {
    let id: string | undefined
    while ((id = jobs.shift())) {
      try {
        await processDocument(id)
      } catch (err) {
        console.error(`[worker] unexpected error on ${id}`, err)
      } finally {
        pending.delete(id)
      }
    }
  } finally {
    running = false
  }
}

async function processDocument(id: string) {
  const doc = await UploadedDocument.findById(id)
  if (!doc) return

  const startedAt = new Date()
  let stage: Stage = 'converting'
  const setStage = async (next: Stage, extra: Record<string, unknown> = {}) => {
    stage = next
    await UploadedDocument.updateOne({ _id: id }, { $set: { stage: next, ...extra } })
  }

  await setStage('converting', {
    status: 'processing',
    startedAt,
    error: null,
    finishedAt: null,
    durationMs: null,
  })
  console.log(`[worker] ${doc.originalName}: start`)

  try {
    const { pages, totalPages } = await loadPages(doc.storedPath, doc.mimeType)
    await setStage('extracting', { progress: { page: pages.length, totalPages } })

    const { raw, invoice } = await extractInvoice(pages, totalPages)
    await UploadedDocument.updateOne({ _id: id }, { $set: { extractRaw: raw } })
    const { items, ...header } = invoice
    if (!header.invoiceNo && !header.supplierName && header.grandTotal == null && !items.length) {
      throw new Error('No invoice data found in document')
    }

    await setStage('saving')
    await removeInvoiceFor(id)
    const saved = await Invoice.create({ documentId: id, ...header })
    if (items.length) {
      await InvoiceItem.insertMany(items.map((it) => ({ invoiceId: saved._id, ...it })))
    }

    const finishedAt = new Date()
    await setStage('done', {
      status: 'success',
      invoiceId: saved._id,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    })
    console.log(`[worker] ${doc.originalName}: done in ${finishedAt.getTime() - startedAt.getTime()}ms`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const finishedAt = new Date()
    await UploadedDocument.updateOne(
      { _id: id },
      {
        $set: {
          status: 'failed',
          error: { message, stage },
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        },
      },
    )
    console.error(`[worker] ${doc.originalName}: failed at ${stage}: ${message}`)
  }
}

// converting stage: PDFs become PNG pages (up to MAX_PDF_PAGES); images pass through as one page.
async function loadPages(storedPath: string, mimeType: string): Promise<{ pages: Uint8Array[]; totalPages: number }> {
  const file = new Uint8Array(await readFile(storedPath))
  if (mimeType !== 'application/pdf') return { pages: [file], totalPages: 1 }
  const rendered = pdfToPngs(file, config.maxPdfPages, config.pdfDpi)
  if (!rendered.pages.length) throw new Error('PDF has no pages')
  return rendered
}

export async function removeInvoiceFor(documentId: string) {
  const ids = (await Invoice.distinct('_id', { documentId })) as Types.ObjectId[]
  if (!ids.length) return
  await InvoiceItem.deleteMany({ invoiceId: { $in: ids } })
  await Invoice.deleteMany({ _id: { $in: ids } })
}

// Re-queue work interrupted by a restart.
export async function startWorker() {
  await UploadedDocument.updateMany(
    { status: 'processing' },
    { $set: { status: 'queued', stage: 'queued' } },
  )
  const queued = await UploadedDocument.find({ status: 'queued' }, { _id: 1 }).sort({ createdAt: 1 })
  queued.forEach((d) => enqueue(String(d._id)))
  console.log(`[worker] started, ${queued.length} document(s) queued`)
}
