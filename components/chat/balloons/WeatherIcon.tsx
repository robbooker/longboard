// #528 Gainer Balloons: the weather readout's icon, drawn inline (no picture is downloaded).
// Seven conditions, with a moon in place of the sun at night.
import type { WeatherCondition } from "@/lib/gainerBalloons/weather";

const CLOUD = "M7.5 19.5h9.8a3.9 3.9 0 0 0 .5-7.77A5.6 5.6 0 0 0 7.1 10.4 4.6 4.6 0 0 0 7.5 19.5Z";
const SMALL_CLOUD = "M9.2 20h8.3a3.3 3.3 0 0 0 .4-6.58 4.7 4.7 0 0 0-9-1.1A3.9 3.9 0 0 0 9.2 20Z";

function Sun({ cx = 12, cy = 12, r = 4 }: { cx?: number; cy?: number; r?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return (
      <line
        key={i}
        x1={cx + Math.cos(a) * (r + 2)}
        y1={cy + Math.sin(a) * (r + 2)}
        x2={cx + Math.cos(a) * (r + 4)}
        y2={cy + Math.sin(a) * (r + 4)}
      />
    );
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="currentColor" fillOpacity="0.25" />
      {rays}
    </g>
  );
}
function Moon({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M15.5 3.8a8.3 8.3 0 1 0 4.9 12.9A7 7 0 0 1 15.5 3.8Z"
      fill="currentColor"
      fillOpacity="0.25"
    />
  );
}

export default function WeatherIcon({
  condition,
  night,
  size = 20,
}: {
  condition: WeatherCondition;
  night: boolean;
  size?: number;
}) {
  const drops = (xs: number[], dash?: string) =>
    xs.map((x) => <line key={x} x1={x} y1={20.5} x2={x - 1.2} y2={23.2} strokeDasharray={dash} />);
  let art;
  switch (condition) {
    case "clear":
      art = night ? <Moon /> : <Sun />;
      break;
    case "partly":
      art = (
        <>
          {night ? <Moon x={4} y={-1} s={0.62} /> : <Sun cx={8} cy={8} r={3} />}
          <path d={SMALL_CLOUD} fill="currentColor" fillOpacity="0.2" />
        </>
      );
      break;
    case "cloudy":
      art = <path d={CLOUD} fill="currentColor" fillOpacity="0.25" />;
      break;
    case "fog":
      art = (
        <>
          <path d={CLOUD} transform="translate(0 -5)" fill="currentColor" fillOpacity="0.2" />
          <line x1="5" y1="18.5" x2="19" y2="18.5" />
          <line x1="7" y1="22" x2="17" y2="22" />
        </>
      );
      break;
    case "drizzle":
    case "rain":
      art = (
        <>
          <path d={CLOUD} transform="translate(0 -3.5)" fill="currentColor" fillOpacity="0.25" />
          {drops(condition === "rain" ? [8.5, 12.5, 16.5] : [10, 15])}
        </>
      );
      break;
    case "snow":
      art = (
        <>
          <path d={CLOUD} transform="translate(0 -3.5)" fill="currentColor" fillOpacity="0.25" />
          {[8, 12, 16].map((x) => (
            <circle key={x} cx={x} cy={x === 12 ? 22.6 : 20.6} r="0.9" fill="currentColor" stroke="none" />
          ))}
        </>
      );
      break;
    case "thunder":
      art = (
        <>
          <path d={CLOUD} transform="translate(0 -3.5)" fill="currentColor" fillOpacity="0.25" />
          <path
            d="M12.8 16.6 10.2 20.4h2.6l-1.2 3.2 3.6-4.4h-2.6l1.3-2.6Z"
            fill="currentColor"
            stroke="none"
          />
        </>
      );
      break;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-weather-icon={`${condition}${night ? "-night" : ""}`}
    >
      {art}
    </svg>
  );
}
