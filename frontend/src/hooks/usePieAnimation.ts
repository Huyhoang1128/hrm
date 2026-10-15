import { useState, useEffect } from 'react';

export function usePieAnimation(ready = true, delay = 80, duration = 1600) {
  const [endAngle, setEndAngle] = useState(90);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setEndAngle(90 - 360), delay);
    return () => clearTimeout(t);
  }, [ready, delay]);

  return { endAngle, startAngle: 90, animationDuration: duration };
}
