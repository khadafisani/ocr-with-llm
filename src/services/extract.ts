import sharp from 'sharp'
import { z } from 'zod'
import { config } from '../config'
import { chat } from './ollama'
import { cleanString, parseDate, parseNumber } from './normalize'

const str = { type: ['string', 'null'] }
// Not nullable: with null allowed, gemma4:e4b returned null for every amount on some invoices that clearly print a total.
const amount = { type: 'string' }

// Amounts are requested as printed strings; we parse them ourselves so "1.234.567,00" isn't misread by the LLM.
const JSON_FORMAT = {
  type: 'object',
  properties: {
    invoiceNo: str,
    invoiceLabel: str,
    invoiceDate: str,
    invoiceDateIso: str,
    supplierName: str,
    contact: {
      type: 'object',
      properties: { name: str, phone: str, email: str, address: str },
      required: ['name', 'phone', 'email', 'address'],
    },
    customerName: str,
    currency: amount,
    subtotal: amount,
    tax: amount,
    grandTotal: amount,
    notes: str,
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { description: str, quantity: str, unit: str, price: str, total: str },
        required: ['description', 'quantity', 'unit', 'price', 'total'],
      },
    },
  },
  required: [
    'invoiceNo', 'invoiceLabel', 'invoiceDate', 'invoiceDateIso', 'supplierName', 'contact',
    'customerName', 'currency', 'subtotal', 'tax', 'grandTotal', 'notes', 'items',
  ],
}

const SYSTEM_PROMPT = `You extract structured data from page images of an invoice (may be English or Indonesian).
Return ONLY JSON matching the schema. Rules:
- Copy values exactly as printed. Use null when a value is not present. Never invent values.
- invoiceNo: the invoice number (e.g. "INV/2026/001"). invoiceLabel: the document title as printed (e.g. "Invoice", "Tax Invoice", "Faktur", "Nota").
- invoiceDate: the invoice date exactly as printed (e.g. "15 Oktober 2026"). invoiceDateIso: the same date as YYYY-MM-DD, or null if unsure.
- supplierName: the company issuing the invoice (seller). customerName: who is billed (Bill To / Kepada).
- contact: the supplier's contact person, phone, email and address.
- currency: ISO code if you can tell (e.g. "IDR" for Rp, "USD" for $).
- subtotal, tax, grandTotal, quantity, price, total: amount strings as printed, without changing separators. For currency, subtotal, tax and grandTotal use "" when not present.
- grandTotal: the final amount due (Total / Grand Total / Jumlah / Total Bayar).
- items: every line item row. Do not include subtotal/tax/total rows as items.
  quantity is only the number, unit is the unit word (pcs, rim, kg, box...), price is the unit price, total is the line total.
  Example row "1 Kertas A4 10 rim Rp 55.000 Rp 550.000" ->
  {"description":"Kertas A4","quantity":"10","unit":"rim","price":"Rp 55.000","total":"Rp 550.000"}
- notes: any notes, remarks, terms, payment instructions or bank account info (Catatan / Keterangan / Note). Join multiple notes with newlines.`

const loose = z.union([z.string(), z.number()]).nullish()

const extractedSchema = z.object({
  invoiceNo: loose,
  invoiceLabel: loose,
  invoiceDate: loose,
  invoiceDateIso: loose,
  supplierName: loose,
  contact: z.object({ name: loose, phone: loose, email: loose, address: loose }).partial().nullish(),
  customerName: loose,
  currency: loose,
  subtotal: loose,
  tax: loose,
  grandTotal: loose,
  notes: loose,
  items: z
    .array(z.object({ description: loose, quantity: loose, unit: loose, price: loose, total: loose }).partial())
    .nullish(),
})

export type ExtractedInvoice = ReturnType<typeof normalizeExtracted>

type RawItem = NonNullable<z.infer<typeof extractedSchema>['items']>[number]

const looksLikeAmount = (s: string | null) => !!s && /\d/.test(s) && /^[\s(]*(rp\.?|idr|usd|\$)?[\s\d.,()-]*$/i.test(s)

// Small models often put "10 rim" in quantity, shifting price into unit and total into price. Undo that.
function normalizeItem(it: RawItem) {
  const qtyMatch = cleanString(it.quantity)?.match(/^([\d.,]+)\s*([^\d\s].*)?$/)
  let unit = cleanString(it.unit)
  let price = parseNumber(it.price)
  const total = parseNumber(it.total)
  if (looksLikeAmount(unit) && (price == null || price === total)) {
    price = parseNumber(unit)
    unit = null
  }
  return {
    description: cleanString(it.description),
    quantity: parseNumber(qtyMatch?.[1] ?? it.quantity),
    unit: unit ?? cleanString(qtyMatch?.[2]),
    price,
    total,
  }
}

function normalizeExtracted(data: z.infer<typeof extractedSchema>) {
  const items = (data.items ?? [])
    .map(normalizeItem)
    .filter((it) => it.description || it.total != null)
    .map((it, i) => ({ lineNo: i + 1, ...it }))

  return {
    invoiceNo: cleanString(data.invoiceNo),
    invoiceLabel: cleanString(data.invoiceLabel),
    invoiceDate: parseDate(cleanString(data.invoiceDateIso), cleanString(data.invoiceDate)),
    invoiceDateRaw: cleanString(data.invoiceDate),
    supplierName: cleanString(data.supplierName),
    contact: {
      name: cleanString(data.contact?.name),
      phone: cleanString(data.contact?.phone),
      email: cleanString(data.contact?.email),
      address: cleanString(data.contact?.address),
    },
    customerName: cleanString(data.customerName),
    currency: cleanString(data.currency),
    subtotal: parseNumber(data.subtotal),
    tax: parseNumber(data.tax),
    grandTotal: parseNumber(data.grandTotal),
    notes: cleanString(data.notes),
    items,
  }
}

// Image tokens grow with pixel count, so cap the long side. rotate() applies EXIF orientation from phone photos.
const toPngBase64 = async (image: Uint8Array) =>
  (
    await sharp(image)
      .rotate()
      .resize(config.maxImagePx, config.maxImagePx, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
  ).toString('base64')

// One vision LLM call reads the page images and returns invoice JSON (benchmark: gemma4:e4b alone beat glm-ocr → gemma4:e2b).
export async function extractInvoice(
  pages: Uint8Array[],
  totalPages = pages.length,
): Promise<{ raw: string; invoice: ExtractedInvoice }> {
  const note = totalPages > pages.length ? ` Only the first ${pages.length} of ${totalPages} pages are included.` : ''
  const raw = await chat(
    config.extractModel,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Extract the invoice from ${pages.length > 1 ? `these ${pages.length} page images, in order` : 'this image'}.${note}`,
        images: await Promise.all(pages.map(toPngBase64)),
      },
    ],
    // think: false: with thinking on, gemma4 took minutes per page and sometimes returned nothing
    { format: JSON_FORMAT, think: false, options: { temperature: 0, num_ctx: 16384 } },
  )

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Model returned invalid JSON: ${raw.slice(0, 200)}`)
  }
  const parsed = extractedSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`Model JSON did not match schema: ${parsed.error.message.slice(0, 300)}`)
  }
  return { raw, invoice: normalizeExtracted(parsed.data) }
}
