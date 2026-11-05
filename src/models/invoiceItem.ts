import { Schema, model } from 'mongoose'

const invoiceItemSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    lineNo: Number,
    description: String,
    quantity: Number,
    unit: String,
    price: Number,
    total: Number,
  },
  { timestamps: true, collection: 'invoice_items' },
)

export const InvoiceItem = model('InvoiceItem', invoiceItemSchema)
