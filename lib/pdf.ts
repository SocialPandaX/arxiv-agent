import { PDFParse } from 'pdf-parse'

async function ensureDomMatrix() {
  if (typeof globalThis.DOMMatrix !== 'undefined') return

  try {
    const { DOMMatrix } = await import('@napi-rs/canvas')
    // @ts-expect-error polyfill DOMMatrix for pdfjs-dist in Node.js
    globalThis.DOMMatrix = DOMMatrix
  } catch {
    try {
      const { DOMMatrix } = await import('canvas')
      // @ts-expect-error polyfill DOMMatrix for pdfjs-dist in Node.js
      globalThis.DOMMatrix = DOMMatrix
    } catch {
      console.warn('No canvas package available, DOMMatrix polyfill skipped')
    }
  }
}

export async function downloadAndExtractPdf(url: string): Promise<string> {
  await ensureDomMatrix()

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`PDF download failed: ${res.status}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText()
  return result.text
}
