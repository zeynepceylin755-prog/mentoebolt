import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import AppShell from './components/AppShell';
import ProtectedRoute from './components/ProtectedRoute';
import TodayPage from './pages/app/TodayPage';
import QuestionPage from './pages/app/QuestionPage';
import MistakesPage from './pages/app/MistakesPage';
import MathPathPage from './pages/app/MathPathPage';
import ProgressPage from './pages/app/ProgressPage';
import ProfilePage from './pages/app/ProfilePage';
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

function MarketingSite() {
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

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MarketingSite />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/app/today" replace />} />
            <Route path="today" element={<TodayPage />} />
            <Route path="question" element={<QuestionPage />} />
            <Route path="mistakes" element={<MistakesPage />} />
            <Route path="path" element={<MathPathPage />} />
            <Route path="progress" element={<ProgressPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
