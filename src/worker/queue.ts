import { readFile } from 'node:fs/promises'
import type { Types } from 'mongoose'
import { config } from '../config'
import { UploadedDocument, type Stage } from '../models/document'
import { Invoice } from '../models/invoice'
import { InvoiceItem } from '../models/invoiceItem'
import { extractInvoice } from '../services/extract'
import { ocrPage } from '../services/ocr'
import { pdfToPngs } from '../services/pdf'

type Job = { id: string; skipOcr: boolean }

const jobs: Job[] = []
const pending = new Set<string>()
let running = false

export function enqueue(id: string, skipOcr = false) {
  if (pending.has(id)) return
  pending.add(id)
  jobs.push({ id, skipOcr })
  void drain()
}

async function drain() {
  if (running) return
  running = true
  try {
    let job: Job | undefined
    while ((job = jobs.shift())) {
      try {
        await processDocument(job)
      } catch (err) {
        console.error(`[worker] unexpected error on ${job.id}`, err)
      } finally {
        pending.delete(job.id)
      }
    }
  } finally {
    running = false
  }
}

async function processDocument({ id, skipOcr }: Job) {
  const doc = await UploadedDocument.findById(id)
  if (!doc) return

  const startedAt = new Date()
  let stage: Stage = 'converting'
  const setStage = async (next: Stage, extra: Record<string, unknown> = {}) => {
    stage = next
    await UploadedDocument.updateOne({ _id: id }, { $set: { stage: next, ...extra } })
  }

  await setStage(skipOcr && doc.ocrText ? 'extracting' : 'converting', {
    status: 'processing',
    startedAt,
    error: null,
    finishedAt: null,
    durationMs: null,
  })
  console.log(`[worker] ${doc.originalName}: start (${stage})`)

  try {
    let ocrText = doc.ocrText ?? ''

    if (stage === 'converting') {
      ocrText = await runOcr(id, doc.storedPath, doc.mimeType, setStage)
      await setStage('extracting')
    }

    const { raw, invoice } = await extractInvoice(ocrText)
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

// converting + ocr stages: render pages, OCR them one by one (sequential on purpose: one local model).
async function runOcr(
  id: string,
  storedPath: string,
  mimeType: string,
  setStage: (next: Stage, extra?: Record<string, unknown>) => Promise<void>,
): Promise<string> {
  const file = new Uint8Array(await readFile(storedPath))
  let images: Uint8Array[] = [file]
  let totalPages = 1
  if (mimeType === 'application/pdf') {
    const rendered = pdfToPngs(file, config.maxPdfPages, config.pdfDpi)
    images = rendered.pages
    totalPages = rendered.totalPages
    if (!images.length) throw new Error('PDF has no pages')
  }

  await setStage('ocr', { progress: { page: 0, totalPages: images.length } })
  const pageTexts: string[] = []
  for (let i = 0; i < images.length; i++) {
    pageTexts.push(await ocrPage(images[i]!))
    await UploadedDocument.updateOne({ _id: id }, { $set: { 'progress.page': i + 1 } })
  }
  let ocrText = pageTexts
    .map((t, i) => (images.length > 1 ? `--- Page ${i + 1} ---\n${t}` : t))
    .join('\n\n')
  if (totalPages > images.length) {
    ocrText += `\n\n[Only the first ${images.length} of ${totalPages} pages were processed]`
  }
  await UploadedDocument.updateOne({ _id: id }, { $set: { ocrText } })
  if (!ocrText.trim()) throw new Error('OCR returned no text')
  return ocrText
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
