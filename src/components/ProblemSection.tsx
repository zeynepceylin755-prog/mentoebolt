import { ArrowUpRight } from 'lucide-react';
import Reveal from '@/components/ui/Reveal';
import Eyebrow from '@/components/ui/Eyebrow';

const problems = [
  {
    num: '01',
    title: 'Tek bir yanlışı anlamak yetmez.',
    text: 'Bir soruyu yanlış yapmak birçok farklı nedenden kaynaklanabilir. Önemli olan, aynı zorluğun başka sorularda da ortaya çıkıp çıkmadığını görebilmektir.',
  },
  {
    num: '02',
    title: 'Hatalar zaman içinde anlam kazanır.',
    text: 'Bugünkü bir hata tek başına çok şey söylemeyebilir. Ancak benzer hatalar tekrar ediyorsa, orada daha güçlü bir öğrenme sinyali olabilir.',
  },
  {
    num: '03',
    title: 'Çalışma yolun sabit kalmamalı.',
    text: 'Dün zorlandığın şey bugün güçlenmiş olabilir. Yeni bir konu ise beklenmedik bir zorluk ortaya çıkarabilir. Rehberin de bunlarla birlikte değişmelidir.',
  },
];

export default function ProblemSection() {
  return (
    <section className="border-y border-border bg-surface px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-content">
        <Reveal className="max-w-2xl">
          <Eyebrow>Asıl Soru</Eyebrow>
          <h2 className="mt-4 font-sora text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[44px]">
            Matematikte asıl sorun her zaman yanlış yapmak değil.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">
            Bazen sorun, hangi yanlışın önemli olduğunu ve sırada neye ihtiyacın
            olduğunu görememektir.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          {problems.map((problem, index) => (
            <Reveal key={problem.num} delay={(index + 1) as 1 | 2 | 3} className="h-full bg-surface">
              <article className="group flex h-full flex-col p-6 transition-colors duration-300 hover:bg-card sm:p-8">
                <div className="flex items-start justify-between">
                  <span className="font-sora text-2xl font-semibold text-border">
                    {problem.num}
                  </span>
                  <ArrowUpRight className="h-5 w-5 text-border transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-accent" />
                </div>
                <h3 className="mt-12 font-sora text-lg font-semibold leading-snug text-ink">
                  {problem.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {problem.text}
                </p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-12" delay={2}>
          <p className="max-w-2xl font-sora text-lg font-medium leading-relaxed text-ink sm:text-xl">
            Mentora'nın amacı seni daha fazla çalıştırmak değil; seni daha iyi
            tanıyarak neye çalışabileceğini daha anlamlı hale getirmek.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
