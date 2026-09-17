import { Sidebar } from '@/components/dashboard/sidebar'
import { Topbar } from '@/components/dashboard/topbar'
import { TodayFocus } from '@/components/dashboard/today-focus'
import { InsightCards } from '@/components/dashboard/insight-cards'
import { ProgressSection } from '@/components/dashboard/progress-section'
import { CurriculumJourney } from '@/components/dashboard/curriculum-journey'
import { BottomBanner } from '@/components/dashboard/bottom-banner'
import { MobileNav } from '@/components/dashboard/mobile-nav'

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen bg-cream">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />

        <main className="flex-1 px-5 pb-24 pt-6 sm:px-8 lg:pb-10">
          <div className="mx-auto max-w-4xl">
            <h1 className="font-serif text-2xl tracking-tight text-ink sm:text-3xl">
              Merhaba, Zeynep{' '}
              <span className="inline-block" aria-hidden>
                👋
              </span>
            </h1>
            <p className="mt-1.5 text-[15px] text-ink-soft">
              Bugünün çalışma planını hazırladık. Hadi başlayalım!
            </p>

            <div className="mt-6 flex flex-col gap-5">
              <TodayFocus />
              <InsightCards />
              <ProgressSection />
              <CurriculumJourney />
              <BottomBanner />
            </div>
          </div>
        </main>
      </div>

      <MobileNav />
    </div>
  )
}
