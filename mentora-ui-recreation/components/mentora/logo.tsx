import { Leaf } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="grid size-7 place-items-center rounded-md bg-sage-tint text-sage">
        <Leaf className="size-4" strokeWidth={2} />
      </span>
      <span className="font-serif text-xl font-semibold tracking-tight text-ink">
        Mentora
      </span>
    </span>
  )
}
