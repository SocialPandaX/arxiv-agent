'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FileText, Settings, History, LogOut } from 'lucide-react'

export default function Nav() {
  const pathname = usePathname()

  if (pathname === '/login') return null

  const links = [
    { href: '/', label: '仪表盘', icon: LayoutDashboard },
    { href: '/papers', label: '论文', icon: FileText },
    { href: '/config', label: '配置', icon: Settings },
    { href: '/tasks', label: '任务日志', icon: History },
  ]

  async function handleLogout() {
    await fetch('/api/auth/login', { method: 'DELETE' })
    window.location.href = '/login'
  }

  return (
    <nav className="bg-slate-900 text-white w-64 min-h-screen p-4 flex flex-col">
      <h1 className="text-xl font-bold mb-8 px-2">arXiv Agent</h1>
      <div className="space-y-1 flex-1">
        {links.map((link) => {
          const Icon = link.icon
          const active = pathname === link.href || pathname.startsWith(link.href + '/')
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                active ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon size={18} />
              {link.label}
            </Link>
          )
        })}
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
      >
        <LogOut size={18} />
        退出登录
      </button>
    </nav>
  )
}
