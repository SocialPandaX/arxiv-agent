import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

export function verifyPassword(password: string): boolean {
  return password === (ADMIN_PASSWORD || '')
}

export function createAuthToken(): string {
  return Buffer.from(ADMIN_PASSWORD || '').toString('base64')
}

export async function requireAuth() {
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_token')
  if (!token || token.value !== createAuthToken()) {
    redirect('/login')
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_token')
  return token?.value === createAuthToken()
}
