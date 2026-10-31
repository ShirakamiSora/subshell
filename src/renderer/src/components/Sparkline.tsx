import { useId } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  max?: number;
  area?: boolean;
  className?: string;
}

/** 轻量 SVG 折线图，用于指标卡与监控视图。 */
export function Sparkline({
  data,
  width = 240,
  height = 48,
  color = '#2dd4bf',
  max,
  area = true,
  className,
}: SparklineProps) {
  const gradientId = useId();
  const values = data.filter((value) => Number.isFinite(value));
  if (values.length < 2) {
    return <div className={className} style={{ width, height }} />;
  }

  const upper = max ?? (Math.max(...values) * 1.15 || 1);
  const lower = 0;
  const stepX = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = height - ((value - lower) / (upper - lower)) * (height - 2) - 1;
    return [x, Math.max(1, Math.min(height - 1, y))] as const;
  });

  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {area && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
