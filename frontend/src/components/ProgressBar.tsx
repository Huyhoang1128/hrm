import { useEffect, useRef } from 'react';

interface ProgressBarProps {
  pct: number;
  color: string;
  height?: string;
  delay?: number;
  duration?: number;
}

export const ProgressBar = ({
  pct, color, height = 'h-1', delay = 120, duration = 700,
}: ProgressBarProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.width = '0%';
    const t = setTimeout(() => {
      if (ref.current) ref.current.style.width = `${pct}%`;
    }, delay);
    return () => clearTimeout(t);
  }, [pct, delay]);

  return (
    <div className={`${height} bg-gray-100 rounded-full overflow-hidden`}>
      <div
        ref={ref}
        className="h-full rounded-full"
        style={{ width: '0%', backgroundColor: color, transition: `width ${duration}ms ease-out` }}
      />
    </div>
  );
};
