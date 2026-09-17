import { SiteHeader } from '@/components/landing/site-header'
import { Hero } from '@/components/landing/hero'
import { HowItWorks } from '@/components/landing/how-it-works'
import { AnalysisSection } from '@/components/landing/analysis-section'
import { CurriculumSection } from '@/components/landing/curriculum-section'

export default function Page() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
        <AnalysisSection />
        <CurriculumSection />
      </main>
    </div>
  )
}
