/**
 * The student's mathematics path, drawn as an editorial diagram.
 *
 * It is the visual anchor of the "curriculum" section: a single vertical
 * spine with eleven grade-11 mathematics topics marked along it, styled so the
 * section reads as typographic composition rather than a feature-card grid.
 * There is no progress value, no ordering claim and no measurement here — the
 * marks exist to show the shape of the year, which is exactly what the product
 * is built around.
 */
export default function CurriculumPath() {
  const topics = [
    'Fonksiyonlarda uygulamalar',
    'İkinci dereceden fonksiyonlar',
    'Denklem ve eşitsizlik sistemleri',
    'Çember ve daire',
    'Dönüşüm geometrisi',
    'Sayı dizileri',
    'Polinomlar',
    'Logaritma',
    'Olasılık',
    'Katı cisimler',
  ];

  return (
    <div aria-hidden="true" className="select-none">
      {topics.map((topic, index) => (
        <div key={topic} className="relative flex items-baseline gap-4 pb-4 pl-7 last:pb-0">
          <span className="absolute left-[3px] top-[0.45rem] h-1.5 w-1.5 rounded-full bg-accent/70" />
          {index < topics.length - 1 && (
            <span className="absolute left-[5.5px] top-[0.85rem] h-full w-px bg-border" />
          )}
          <span className="font-sora text-[0.6875rem] tabular-nums text-muted">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="font-display text-[1.0625rem] leading-snug text-ink-soft sm:text-[1.1875rem]">
            {topic}
          </span>
        </div>
      ))}
    </div>
  );
}
