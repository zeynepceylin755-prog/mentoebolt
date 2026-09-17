import { Sprout } from 'lucide-react'
import { Logo } from '@/components/mentora/logo'
import { NAV_ITEMS } from '@/components/dashboard/nav-items'

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-line/70 bg-cream px-4 py-6 lg:flex">
      <div className="px-2">
        <Logo />
      </div>

      <nav className="mt-8 flex flex-col gap-1" aria-label="Panel menüsü">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-current={item.active ? 'page' : undefined}
            className={
              item.active
                ? 'flex items-center gap-3 rounded-xl bg-terracotta px-3 py-2.5 text-sm font-medium text-cream'
                : 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper hover:text-ink'
            }
          >
            <item.icon className="size-4.5" strokeWidth={1.9} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-line bg-paper p-4">
        <span className="grid size-8 place-items-center rounded-lg bg-sage-tint text-sage">
          <Sprout className="size-4" strokeWidth={2} />
        </span>
        <p className="mt-3 text-[13px] leading-snug text-ink-soft">
          Matematikte bir adım daha ileri olmak için buradasın.
        </p>
      </div>
    </aside>
  )
}
