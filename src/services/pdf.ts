import * as mupdf from 'mupdf'

export type RenderedPages = { pages: Uint8Array[]; totalPages: number }

// Renders up to `maxPages` PDF pages to PNG. Ollama vision models only accept images.
export function pdfToPngs(data: Uint8Array, maxPages: number, dpi: number): RenderedPages {
  let doc: mupdf.Document
  try {
    doc = mupdf.Document.openDocument(data, 'application/pdf')
  } catch (err) {
    throw new Error(`Could not read PDF (corrupt or not a PDF): ${err instanceof Error ? err.message : err}`)
  }
  try {
    const totalPages = doc.countPages()
    const scale = dpi / 72
    const pages: Uint8Array[] = []
    for (let i = 0; i < Math.min(totalPages, maxPages); i++) {
      const page = doc.loadPage(i)
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
      pages.push(pixmap.asPNG())
      pixmap.destroy()
      page.destroy()
    }
    return { pages, totalPages }
  } finally {
    doc.destroy()
  }
}
