/**
 * Tiny inline SVG sparkline. Stateless, no deps. Used on SR cards to show
 * the 7-day trail of the metric driving each SME's finding.
 */

type Props = {
  values: readonly number[];
  width?: number;
  height?: number;
  stroke: string;
  fill?: string;
};

export default function Sparkline({
  values,
  width = 80,
  height = 22,
  stroke,
  fill,
}: Props) {
  if (!values || values.length === 0) {
    return <span aria-hidden style={{ width, height, display: "inline-block" }} />;
  }
  const padX = 1;
  const padY = 2;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = (width - padX * 2) / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => {
    const x = padX + i * stepX;
    const y = height - padY - ((v - min) / range) * (height - padY * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const path = "M" + points.join(" L");
  const areaPath =
    fill && values.length > 1
      ? path +
        ` L${(padX + (values.length - 1) * stepX).toFixed(2)},${height - padY} ` +
        `L${padX},${height - padY} Z`
      : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{ display: "block" }}
    >
      {areaPath && <path d={areaPath} fill={fill} stroke="none" opacity={0.18} />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      {/* tiny dot on the latest point */}
      <circle
        cx={padX + (values.length - 1) * stepX}
        cy={height - padY - ((values[values.length - 1]! - min) / range) * (height - padY * 2)}
        r={1.6}
        fill={stroke}
      />
    </svg>
  );
}
