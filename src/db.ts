import mongoose from 'mongoose'
import { config } from './config'

export async function connectDb() {
  await mongoose.connect(config.mongoUrl)
  console.log(`[db] connected to ${config.mongoUrl}`)
}
