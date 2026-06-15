import { PDFParse } from 'pdf-parse'
import { DOMMatrix } from 'canvas'

if (typeof globalThis.DOMMatrix === 'undefined') {
  // @ts-expect-error polyfill DOMMatrix for pdfjs-dist in Node.js
  globalThis.DOMMatrix = DOMMatrix
}

export async function downloadAndExtractPdf(url: string): Promise<string> {
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
