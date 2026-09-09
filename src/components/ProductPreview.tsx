import { ArrowRight, Clock, Target } from 'lucide-react';
import ProgressBar from '@/components/ui/ProgressBar';

export default function ProductPreview() {
  return (
    <div className="relative w-full">
      <div className="rounded-lg border border-border bg-card p-6 shadow-[0_2px_24px_rgba(23,23,23,0.06)] sm:p-7">
        <div className="mb-5 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
            Matematik Rehberin
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Bugünkü önerin
          </span>
        </div>

        <div className="mb-5">
          <h3 className="font-sora text-xl font-semibold text-ink">
            Grafik yorumlama
          </h3>
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar value={61} color="#FF8A80" className="flex-1" height="6px" />
            <span className="text-sm font-semibold text-ink">61%</span>
          </div>
          <p className="mt-2 text-[11px] text-muted">Mevcut görünüm — öncelikli beceri</p>
        </div>

        <div className="mb-5 rounded-lg border border-border bg-bg p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10">
              <Target className="h-4 w-4 text-accent" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                Neden bu öneri?
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink">
                Son 3 testinde ve getirdiğin 2 soruda benzer bir hata örüntüsü gördük.
              </p>
            </div>
          </div>
        </div>

        <div className="mb-5 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[13px] text-muted">
            <Clock className="h-3.5 w-3.5" />
            <span>14 dk</span>
          </div>
          <div className="h-3 w-px bg-border" />
          <span className="text-[13px] text-muted">Doğrulama önerisi</span>
        </div>

        <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-3 text-sm font-medium text-bg transition-colors duration-200 hover:bg-accent hover:text-ink">
          Bu beceriyi birlikte kontrol et
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 pl-2 text-[11px] text-muted">
        <span className="h-1 w-1 rounded-full bg-success" />
        Profil güncellendi · Yeni verilerden öğrenildi
      </div>
    </div>
  );
}
