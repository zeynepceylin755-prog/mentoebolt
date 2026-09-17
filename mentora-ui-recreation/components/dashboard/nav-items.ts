import {
  BookMarked,
  CalendarCheck,
  LayoutList,
  Sparkles,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  label: string
  icon: LucideIcon
  active?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Bugün', icon: CalendarCheck, active: true },
  { label: 'Soru Getir', icon: Upload },
  { label: 'Tekrarlarım', icon: BookMarked },
  { label: 'Gelişim', icon: Sparkles },
  { label: 'Müfredat', icon: LayoutList },
]
