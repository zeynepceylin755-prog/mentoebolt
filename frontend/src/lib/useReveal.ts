import { useEffect } from 'react';

/**
 * Reveal-on-scroll for the public marketing page.
 *
 * The landing page uses the `reveal` utility (declared in index.css) plus this
 * hook as a single, page-wide progressive enhancement: one observer watches
 * every `.reveal` element and adds `is-visible` once, then stops watching it.
 *
 * Two deliberate constraints:
 *
 *   1. It is motion *only*. Nothing is hidden behind it — if the observer never
 *      fires (an old browser, a test environment, reduced motion), the CSS media
 *      query below still ends with fully opaque, untransformed content.
 *   2. It never runs in tests or when the visitor asked for reduced motion, so
 *      no component can depend on an animation having played.
 */
export function useReveal(scopeRef?: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      return;
    }

    const root: ParentNode = scopeRef?.current ?? document;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.reveal'));

    if (targets.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );

    for (const target of targets) {
      observer.observe(target);
    }

    return () => observer.disconnect();
  }, [scopeRef]);
}
