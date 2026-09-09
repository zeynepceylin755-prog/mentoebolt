import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import TimeSection from '@/components/TimeSection';
import HowItWorks from '@/components/HowItWorks';
import ProblemSection from '@/components/ProblemSection';
import ErrorAnalysisDemo from '@/components/ErrorAnalysisDemo';
import MathPath from '@/components/MathPath';
import Personalization from '@/components/Personalization';
import LearningProfile from '@/components/LearningProfile';
import DailyTests from '@/components/DailyTests';
import LearningLoop from '@/components/LearningLoop';
import ProductModules from '@/components/ProductModules';
import WhyMentora from '@/components/WhyMentora';
import CurriculumSection from '@/components/CurriculumSection';
import VisionSection from '@/components/VisionSection';
import FinalCTA from '@/components/FinalCTA';
import Footer from '@/components/Footer';

export default function App() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-ink">
      <Navbar />
      <main>
        <Hero />
        <TimeSection />
        <HowItWorks />
        <ProblemSection />
        <ErrorAnalysisDemo />
        <MathPath />
        <Personalization />
        <LearningProfile />
        <DailyTests />
        <LearningLoop />
        <ProductModules />
        <WhyMentora />
        <CurriculumSection />
        <VisionSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
