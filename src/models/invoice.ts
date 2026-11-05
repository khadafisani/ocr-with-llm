import { Schema, model } from 'mongoose'

const invoiceSchema = new Schema(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'UploadedDocument', required: true, index: true },
    invoiceNo: String,
    invoiceLabel: String,
    invoiceDate: Date,
    invoiceDateRaw: String,
    supplierName: String,
    contact: {
      name: String,
      phone: String,
      email: String,
      address: String,
    },
    customerName: String,
    currency: String,
    subtotal: Number,
    tax: Number,
    grandTotal: Number,
    notes: String,
  },
  { timestamps: true, collection: 'invoices' },
)

export const Invoice = model('Invoice', invoiceSchema)
