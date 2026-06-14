import { Resend } from 'resend'

function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set')
  }
  return new Resend(process.env.RESEND_API_KEY)
}

export interface PaperEmailItem {
  arxivId: string
  title: string
  authors: string
  summaryZh: string
  pdfUrl: string
}

export async function sendDailyEmail(to: string, papers: PaperEmailItem[]) {
  if (papers.length === 0) return null

  const resend = getResend()
  const dateStr = new Date().toLocaleDateString('zh-CN')
  const subject = `[arXiv 日报] ${dateStr} 发现 ${papers.length} 篇新论文`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 0 auto; color: #1f2937;">
      <h1 style="color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">arXiv 日报 - ${dateStr}</h1>
      <p style="color: #4b5563;">今日共发现 <strong>${papers.length}</strong> 篇新论文：</p>
      ${papers
        .map(
          (p) => `
        <div style="margin-bottom: 32px; border-bottom: 1px solid #f3f4f6; padding-bottom: 24px;">
          <h2 style="font-size: 18px; margin-bottom: 6px; color: #111827;">${p.title}</h2>
          <p style="color: #6b7280; font-size: 14px; margin-top: 0; margin-bottom: 12px;">${p.authors}</p>
          <p style="line-height: 1.6; margin-bottom: 12px;">${p.summaryZh}</p>
          <p style="font-size: 14px;">
            <a href="https://arxiv.org/abs/${p.arxivId}" style="color: #2563eb; text-decoration: none; margin-right: 12px;" target="_blank">查看 arXiv</a>
            <a href="${p.pdfUrl}" style="color: #2563eb; text-decoration: none; margin-right: 12px;" target="_blank">下载 PDF</a>
            ${appUrl ? `<a href="${appUrl}/paper/${p.arxivId}" style="color: #2563eb; text-decoration: none;" target="_blank">深入分析 →</a>` : ''}
          </p>
        </div>
      `
        )
        .join('')}
      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">本邮件由 arXiv Agent 自动生成</p>
    </div>
  `

  return await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to,
    subject,
    html,
  })
}
