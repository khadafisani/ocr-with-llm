import { Hono } from 'hono'
import { isValidObjectId, Types, type PipelineStage } from 'mongoose'
import { Invoice } from '../models/invoice'

export const invoices = new Hono()

const withItems: PipelineStage[] = [
  {
    $lookup: {
      from: 'invoice_items',
      localField: '_id',
      foreignField: 'invoiceId',
      as: 'items',
      pipeline: [{ $sort: { lineNo: 1 } }],
    },
  },
  {
    $lookup: {
      from: 'documents',
      localField: 'documentId',
      foreignField: '_id',
      as: 'document',
      pipeline: [{ $project: { originalName: 1, mimeType: 1 } }],
    },
  },
  { $set: { document: { $first: '$document' } } },
]

invoices.get('/', async (c) => {
  const list = await Invoice.aggregate([{ $sort: { createdAt: -1 } }, ...withItems])
  return c.json(list)
})

invoices.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isValidObjectId(id)) return c.json({ error: 'Invalid id' }, 400)
  const [invoice] = await Invoice.aggregate([{ $match: { _id: new Types.ObjectId(id) } }, ...withItems])
  return invoice ? c.json(invoice) : c.json({ error: 'Not found' }, 404)
})
