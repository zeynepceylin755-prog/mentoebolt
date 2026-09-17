import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import LandingPage from '@/components/LandingPage';
import AuthScreen from '@/components/AuthScreen';
import ReadinessIntro from '@/components/ReadinessIntro';
import StudentShell, { type StudentDestinationId } from '@/components/StudentShell';
import Bugun from '@/components/Bugun';
import SoruGetir from '@/components/SoruGetir';
import Tekrarlarim from '@/components/Tekrarlarim';
import Gelisim from '@/components/Gelisim';
import Profil from '@/components/Profil';
import Loading from '@/components/ui/Loading';
import {
  clearReadinessChoice,
  readReadinessChoice,
  saveReadinessChoice,
  type ReadinessChoice,
} from '@/lib/readiness';

const STUDENT_VIEWS: readonly StudentDestinationId[] = [
  'bugun',
  'soru-getir',
  'tekrarlarim',
  'gelisim',
  'profil', // Account destination, not a primary learning destination
] as const;

function isStudentView(value: string): value is StudentDestinationId {
  return (STUDENT_VIEWS as readonly string[]).includes(value);
}

/** Resolve the initial destination from the URL hash, defaulting to Bugun. */
function readHashView(): StudentDestinationId {
  const hash = window.location.hash.replace(/^#/, '');
  return isStudentView(hash) ? hash : 'bugun';
}

/**
 * The authenticated student application.
 *
 * The main action of the product ("Soru Getir") is reachable from every screen
 * through the shell, and the student lands on "Bugun" — the page that answers
 * "what should I do now?" — rather than on a dashboard of numbers.
 */
function StudentApp({ onMeasureReadiness }: { onMeasureReadiness: () => void }) {
  const [view, setView] = useState<StudentDestinationId>(readHashView);

  const navigate = useCallback((next: StudentDestinationId) => {
    setView(next);
    if (window.location.hash !== `#${next}`) {
      window.location.hash = next;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  // Back/forward and deep links stay in sync with the rendered destination.
  useEffect(() => {
    const handleHashChange = () => setView(readHashView());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <StudentShell currentView={view} onNavigate={navigate}>
      {view === 'bugun' && (
        <Bugun onNavigate={navigate} onMeasureReadiness={onMeasureReadiness} />
      )}
      {view === 'soru-getir' && <SoruGetir onNavigate={navigate} />}
      {view === 'tekrarlarim' && <Tekrarlarim onNavigate={navigate} />}
      {view === 'gelisim' && <Gelisim onNavigate={navigate} />}
      {view === 'profil' && <Profil />}
    </StudentShell>
  );
}

/**
 * The two public screens an unauthenticated visitor can be on.
 *
 * This is deliberately a piece of component state rather than a router: the
 * product already navigates the authenticated application with hashes, and a
 * public landing page does not justify a routing dependency.
 */
type PublicView = 'landing' | 'auth';

function AppContent() {
  const { authenticated, loading, user } = useAuth();
  const [publicView, setPublicView] = useState<PublicView>('landing');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup');
  const [readinessChoice, setReadinessChoice] = useState<ReadinessChoice | null>(null);
  const [readinessResolved, setReadinessResolved] = useState(false);

  useEffect(() => {
    if (!authenticated || !user?.id) {
      setReadinessChoice(null);
      setReadinessResolved(false);
      return;
    }

    setReadinessChoice(readReadinessChoice(user.id));
    setReadinessResolved(true);
  }, [authenticated, user?.id]);

  const finishReadiness = useCallback(
    (choice: ReadinessChoice) => {
      if (!user?.id) return;
      saveReadinessChoice(user.id, choice);
      setReadinessChoice(choice);
    },
    [user?.id]
  );

  const reopenReadiness = useCallback(() => {
    if (user?.id) {
      clearReadinessChoice(user.id);
    }
    setReadinessChoice(null);
  }, [user?.id]);

  if (loading || (authenticated && !readinessResolved)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loading state="loading" message="Mentora hazırlanıyor..." />
      </div>
    );
  }

  if (!authenticated) {
    if (publicView === 'landing') {
      return (
        <LandingPage
          onGetStarted={() => {
            setAuthMode('signup');
            setPublicView('auth');
          }}
          onLogin={() => {
            setAuthMode('login');
            setPublicView('auth');
          }}
        />
      );
    }

    return (
      <AuthScreen
        initialMode={authMode}
        onBack={() => setPublicView('landing')}
        onAuthenticated={() => undefined}
      />
    );
  }

  if (readinessChoice === null) {
    return (
      <ReadinessIntro
        onStart={() => finishReadiness('completed')}
        onSkip={() => finishReadiness('skipped')}
      />
    );
  }

  return <StudentApp onMeasureReadiness={reopenReadiness} />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
