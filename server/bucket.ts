import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const ROOT = 'maps/materials'
const BUCKET = process.env.AWS_S3_BUCKET_NAME
const s3 = BUCKET ? new S3Client({
  region: process.env.AWS_REGION || 'auto',
  endpoint: process.env.AWS_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  forcePathStyle: false,
}) : null

function diskPath(key: string) {
  return join(ROOT, key)
}

export async function storeGet(key: string): Promise<Buffer> {
  if (s3) {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key })).catch(e => {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null
      throw e
    })
    if (!out) return null
    const chunks = []
    for await (const c of out.Body as any) chunks.push(c)
    return Buffer.concat(chunks)
  }
  const p = diskPath(key)
  if (!existsSync(p)) return null
  return readFileSync(p)
}

export async function storePut(key: string, body: Buffer, type: string) {
  if (s3) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: type }))
    return
  }
  const p = diskPath(key)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, body)
}
