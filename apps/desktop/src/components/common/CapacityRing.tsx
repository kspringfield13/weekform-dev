export function CapacityRing({ value, size = 48 }: { value: number; size?: number }) {
  const strokeWidth = 4;
  const center = size / 2;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - Math.min(Math.max(value, 0), 100) / 100);

  return (
    <svg
      className="capacity-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle
        className="capacity-ring-track"
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
      />
      <circle
        className="capacity-ring-fill"
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={dashoffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}
