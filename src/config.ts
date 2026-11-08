export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/invoice_ocr',
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
  extractModel: process.env.EXTRACT_MODEL ?? 'gemma4:e4b',
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
  maxPdfPages: Number(process.env.MAX_PDF_PAGES ?? 5),
  pdfDpi: Number(process.env.PDF_DPI ?? 150),
  // 1024: 1500 px was 32-36% slower with no accuracy gain for gemma4:e4b (benchmark round 3); at 720 small lines (invoice no) were missed on A4 scans
  maxImagePx: Number(process.env.MAX_IMAGE_PX ?? 1024),
  ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 10 * 60 * 1000),
}

export const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
}
