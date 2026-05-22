/**
 * Inline SVGs traced from the Tabler outline set.
 *
 * Why inline and not `@tabler/icons-react`: the rest of this codebase uses
 * inline SVG (Sparkle, KindIcon, ChipIcon, etc.) so a 280KB icon dependency
 * for ~8 icons would be inconsistent and wasteful. Each icon is a
 * `currentColor`-stroked SVG so callers control color via the `style` /
 * `className` prop.
 *
 * Mapping (Loom name → Tabler outline icon name):
 *   settings-cog   → IconSettings
 *   broadcast      → IconBroadcast
 *   target         → IconTarget
 *   truck-delivery → IconTruckDelivery
 *   tool           → IconTool
 *   shield-check   → IconShieldCheck
 *   alert-triangle → IconAlertTriangle
 *   command        → IconCommand
 */
import type { CSSProperties } from "react";
import type { SMEIconName } from "./types";

type IconProps = {
  size?: number;
  className?: string;
  style?: CSSProperties;
  "aria-hidden"?: boolean;
};

function base(props: IconProps, children: React.ReactNode) {
  const size = props.size ?? 18;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      style={props.style}
      aria-hidden={props["aria-hidden"] ?? true}
    >
      {children}
    </svg>
  );
}

export function SettingsCogIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  );
}

export function BroadcastIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="12" r="1" />
      <path d="M14.83 9.17a4 4 0 0 1 0 5.66" />
      <path d="M9.17 14.83a4 4 0 0 1 0-5.66" />
      <path d="M17.66 6.34a8 8 0 0 1 0 11.32" />
      <path d="M6.34 17.66a8 8 0 0 1 0-11.32" />
    </>,
  );
}

export function TargetIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>,
  );
}

export function TruckDeliveryIcon(props: IconProps) {
  return base(
    props,
    <>
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M5 17H3V6a1 1 0 0 1 1-1h9v12" />
      <path d="M13 9h4l3 4v4h-2" />
      <path d="M9 17h6" />
    </>,
  );
}

export function ToolIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M14.7 6.3a4.95 4.95 0 0 0-7 7l-6.6 6.6a1 1 0 1 0 1.4 1.4l6.6-6.6a4.95 4.95 0 0 0 7-7l-3.2 3.2-2.2-2.2 3.2-3.2" />
    </>,
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </>,
  );
}

export function AlertTriangleIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M12 3.5l9.5 16.5h-19L12 3.5z" />
      <path d="M12 10v5" />
      <path d="M12 18.5v.01" />
    </>,
  );
}

export function CommandIcon(props: IconProps) {
  return base(
    props,
    <>
      <path d="M6 9a3 3 0 1 1 3-3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3H6z" />
    </>,
  );
}

export function SME_ICONS(): Record<
  SMEIconName,
  (p: IconProps) => React.ReactElement
> {
  return {
    "settings-cog": SettingsCogIcon,
    broadcast: BroadcastIcon,
    target: TargetIcon,
    "truck-delivery": TruckDeliveryIcon,
    tool: ToolIcon,
    "shield-check": ShieldCheckIcon,
  };
}

export function SMEIcon({
  name,
  ...rest
}: IconProps & { name: SMEIconName }) {
  const C = SME_ICONS()[name];
  return <C {...rest} />;
}
