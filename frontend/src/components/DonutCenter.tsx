import React from 'react';
import { useCountUpRef } from '@/hooks/useCountUpRef';

const fmt = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

interface DonutCenterProps {
  value: number;
  label: string;
  subtitle?: string;
  cx: number;
  cy: number;
  fontSize?: number;
}

export const DonutCenter: React.FC<DonutCenterProps> = ({
  value, label, subtitle, cx, cy, fontSize = 20,
}) => {
  const ref = useCountUpRef<SVGTSpanElement>(value);
  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
      <tspan
        ref={ref}
        x={cx} dy={subtitle ? '-1.1em' : '-0.4em'}
        fontSize={fontSize} fontWeight="800" fill="#111827"
        fontFamily="Plus Jakarta Sans, system-ui, sans-serif"
      >
        {fmt(0)}
      </tspan>
      <tspan
        x={cx} dy="1.5em"
        fontSize={subtitle ? 12 : 9} fontWeight={subtitle ? '600' : '400'} fill="#6b7280"
        fontFamily="Plus Jakarta Sans, system-ui, sans-serif"
      >
        {label}
      </tspan>
      {subtitle && (
        <tspan
          x={cx} dy="1.3em"
          fontSize="10" fill="#9ca3af"
          fontFamily="Plus Jakarta Sans, system-ui, sans-serif"
        >
          {subtitle}
        </tspan>
      )}
    </text>
  );
};
