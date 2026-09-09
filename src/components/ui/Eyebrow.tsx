type EyebrowProps = {
  children: string;
  className?: string;
};

export default function Eyebrow({ children, className = '' }: EyebrowProps) {
  return (
    <span
      className={`text-xs font-medium tracking-[0.12em] uppercase text-muted ${className}`}
    >
      {children}
    </span>
  );
}
