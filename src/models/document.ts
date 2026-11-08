import { Schema, model, type InferSchemaType } from 'mongoose'

export const STATUSES = ['queued', 'processing', 'success', 'failed'] as const
export const STAGES = ['queued', 'converting', 'extracting', 'saving', 'done'] as const

export const MODES = ['fast', 'accurate'] as const

export type Stage = (typeof STAGES)[number]

const documentSchema = new Schema(
  {
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storedPath: { type: String, required: true },
    // default 'accurate': documents from before modes existed were read with gemma4:e4b
    mode: { type: String, enum: MODES, default: 'accurate' },
    model: String,
    status: { type: String, enum: STATUSES, default: 'queued', index: true },
    stage: { type: String, enum: STAGES, default: 'queued' },
    progress: {
      page: { type: Number, default: 0 },
      totalPages: { type: Number, default: 0 },
    },
    error: {
      message: String,
      stage: String,
    },
    extractRaw: String,
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    startedAt: Date,
    finishedAt: Date,
    durationMs: Number,
  },
  { timestamps: true, collection: 'documents' },
)

export type UploadedDocumentType = InferSchemaType<typeof documentSchema>
export const UploadedDocument = model('UploadedDocument', documentSchema)
