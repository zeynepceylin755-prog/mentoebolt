'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Menu, X } from 'lucide-react'
import { Logo } from '@/components/mentora/logo'

const NAV = [
  { label: 'Ürün', href: '#urun' },
  { label: 'Nasıl Çalışır?', href: '#nasil-calisir' },
  { label: 'Müfredat', href: '#mufredat' },
  { label: 'Hakkımızda', href: '#hakkimizda' },
]

export function SiteHeader() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="Mentora ana sayfa">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Ana menü">
          {NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/dashboard"
            className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper"
          >
            Giriş Yap
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-full bg-terracotta px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-terracotta-dark"
          >
            Hemen Başla
            <ArrowRight className="size-4" />
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid size-9 place-items-center rounded-md border border-line-strong text-ink md:hidden"
          aria-label={open ? 'Menüyü kapat' : 'Menüyü aç'}
          aria-expanded={open}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-line/70 bg-cream px-5 py-4 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobil menü">
            {NAV.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2.5 text-sm font-medium text-ink-soft hover:bg-paper hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2">
              <Link
                href="/dashboard"
                className="rounded-full border border-line-strong px-4 py-2.5 text-center text-sm font-medium text-ink"
              >
                Giriş Yap
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-terracotta px-4 py-2.5 text-sm font-medium text-cream"
              >
                Hemen Başla
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
