import { NAV_ITEMS } from '@/components/dashboard/nav-items'

export function MobileNav() {
  const items = NAV_ITEMS.slice(0, 4)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-line bg-cream px-2 py-2 lg:hidden"
      aria-label="Mobil panel menüsü"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          aria-current={item.active ? 'page' : undefined}
          className={
            item.active
              ? 'flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-terracotta'
              : 'flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-ink-soft'
          }
        >
          <item.icon className="size-5" strokeWidth={1.9} />
          <span className="text-[11px] font-medium">{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
