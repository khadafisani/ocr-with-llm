import { config } from '../config'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[] // base64, no data: prefix
}

type ChatOptions = {
  format?: 'json' | object
  think?: boolean
  options?: Record<string, unknown>
}

export async function chat(model: string, messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const res = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, ...opts }),
    signal: AbortSignal.timeout(config.ollamaTimeoutMs),
  })
  if (!res.ok) {
    throw new Error(`Ollama ${model} returned ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as { message?: { content?: string } }
  return data.message?.content ?? ''
}
