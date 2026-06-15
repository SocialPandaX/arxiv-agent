import pdfParse from 'pdf-parse'

export async function downloadAndExtractPdf(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`PDF download failed: ${res.status}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const result = await pdfParse(buffer)
  return result.text
}
