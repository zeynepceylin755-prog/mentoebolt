import { useEffect, useState } from 'react';

type ProgressBarProps = {
  value: number;
  className?: string;
  color?: string;
  height?: string;
  delay?: number;
};

export default function ProgressBar({
  value,
  className = '',
  color = '#171717',
  height = '6px',
  delay = 0,
}: ProgressBarProps) {
  const [width, setWidth] = useState(0);
  const [ref, setRef] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setWidth(value), delay);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(ref);
    return () => observer.disconnect();
  }, [ref, value, delay]);

  return (
    <div
      ref={setRef}
      className={`w-full overflow-hidden rounded-full bg-border ${className}`}
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-all duration-[1200ms] ease-out"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </div>
  );
}
