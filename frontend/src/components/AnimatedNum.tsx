import { useCountUpRef } from '@/hooks/useCountUpRef';

const fmt = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const AnimatedNum = ({ value, suffix }: { value: number; suffix?: string }) => {
  const ref = useCountUpRef(value);
  return <span ref={ref}>{fmt(0)}{suffix}</span>;
};
