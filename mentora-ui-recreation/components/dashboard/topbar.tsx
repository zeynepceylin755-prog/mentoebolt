import { Bell } from 'lucide-react'
import { Logo } from '@/components/mentora/logo'

export function Topbar() {
  return (
    <header className="flex items-center justify-between border-b border-line/70 bg-cream px-5 py-4 sm:px-8">
      <div className="lg:hidden">
        <Logo />
      </div>
      <div className="hidden lg:block" />

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="relative grid size-9 place-items-center rounded-full border border-line text-ink-soft transition-colors hover:bg-paper hover:text-ink"
          aria-label="Bildirimler"
        >
          <Bell className="size-4.5" strokeWidth={1.9} />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-terracotta" />
        </button>

        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-terracotta text-sm font-semibold text-cream">
            Z
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-semibold text-ink">Zeynep</span>
            <span className="block text-xs text-ink-soft">11. Sınıf</span>
          </span>
        </div>
      </div>
    </header>
  )
}
