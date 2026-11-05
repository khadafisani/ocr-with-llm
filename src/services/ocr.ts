import sharp from 'sharp'
import { config } from '../config'
import { chat } from './ollama'

// Stage 1: glm-ocr reads one page image and returns its text (markdown, tables as HTML/markdown).
export async function ocrPage(image: Uint8Array): Promise<string> {
  // Image tokens grow with pixel count: a 300 DPI scan fills glm-ocr's context and truncates the text, so cap the long side.
  // rotate() applies EXIF orientation from phone photos.
  const png = await sharp(image)
    .rotate()
    .resize(config.maxImagePx, config.maxImagePx, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
  const text = await chat(
    config.ocrModel,
    [{ role: 'user', content: 'Text Recognition:', images: [png.toString('base64')] }],
    { options: { num_ctx: 8192 } }, // room for the image tokens plus a long page of text
  )
  return text.trim()
}
