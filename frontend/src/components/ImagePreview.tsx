import { RefreshCw, X } from 'lucide-react';

interface ImagePreviewProps {
  src: string;
  fileName: string;
  /** Replace with a different photo. */
  onReplace: () => void;
  onRemove: () => void;
}

/**
 * The selected-photo state of "Soru Getir".
 *
 * Shown immediately after a file is chosen and before anything is sent, so the
 * student can confirm they captured the right question. The container is capped
 * so a portrait phone photo never pushes the action button off-screen.
 */
export default function ImagePreview({
  src,
  fileName,
  onReplace,
  onRemove,
}: ImagePreviewProps) {
  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-border bg-card">
        <img
          src={src}
          alt={`Seçtiğin soru fotoğrafı: ${fileName}`}
          className="mx-auto max-h-[46vh] w-full object-contain sm:max-h-[52vh]"
        />

        <button
          type="button"
          onClick={onRemove}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-bg/90 text-ink shadow-soft transition-colors hover:bg-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="Seçilen fotoğrafı kaldır"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="min-w-0 flex-1 truncate text-body-sm text-muted" title={fileName}>
          {fileName}
        </p>
        <button
          type="button"
          onClick={onReplace}
          className="inline-flex min-h-[44px] flex-shrink-0 items-center gap-1.5 text-body-sm font-medium text-ink underline decoration-border decoration-1 underline-offset-4 transition-colors hover:decoration-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Değiştir
        </button>
      </div>
    </div>
  );
}
