/** Small inline SVG icons (16px, stroke = currentColor). */

interface IconProps {
  size?: number;
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

/** Echo logo mark — concentric circles. */
export function LogoMark({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="4.5" fill="var(--accent)" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="var(--accent)" strokeWidth="2" opacity="0.55" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="var(--accent)" strokeWidth="1.8" opacity="0.25" />
    </svg>
  );
}

export function IconMemories({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M8 1.8 14.2 5.3 8 8.8 1.8 5.3Z" />
      <path d="m1.8 8.3 6.2 3.5 6.2-3.5" />
      <path d="m1.8 11.3 6.2 3.5 6.2-3.5" />
    </svg>
  );
}

export function IconKey({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <circle cx="5.2" cy="10.8" r="3.2" />
      <path d="M7.5 8.5 13.8 2.2" />
      <path d="m10.8 5.2 2.2 2.2" />
    </svg>
  );
}

export function IconAudit({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M2.5 3.5h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 12.5h6.5" />
      <circle cx="12.8" cy="12.5" r="0.4" fill="currentColor" />
    </svg>
  );
}

export function IconOrgs({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <rect x="2.5" y="4.5" width="7" height="9" rx="0.5" />
      <path d="M9.5 7.5h4v6h-4" />
      <path d="M5 7.2h2M5 9.7h2M11.5 9.7h.5" />
      <path d="M4.5 4.5V2.2h3v2.3" />
    </svg>
  );
}

export function IconConnect({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M8.9 1.5 3.4 9h3.8l-.9 5.5L11.8 7H8Z" />
    </svg>
  );
}

export function IconLogout({ size = 15 }: IconProps) {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6" />
      <path d="M10.5 11 13.5 8l-3-3" />
      <path d="M13.5 8H6" />
    </svg>
  );
}

export function IconSearch({ size = 15 }: IconProps) {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

export function IconPlus({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" />
    </svg>
  );
}

/** Larger outline icons for empty states (36px). */
export function EmptyMemoriesIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.8 14.2 5.3 8 8.8 1.8 5.3Z" />
      <path d="m1.8 8.3 6.2 3.5 6.2-3.5" />
      <path d="m1.8 11.3 6.2 3.5 6.2-3.5" />
    </svg>
  );
}

export function EmptyKeyIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5.2" cy="10.8" r="3.2" />
      <path d="M7.5 8.5 13.8 2.2" />
      <path d="m10.8 5.2 2.2 2.2" />
    </svg>
  );
}

export function EmptyOrgIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="4.5" width="7" height="9" rx="0.5" />
      <path d="M9.5 7.5h4v6h-4" />
      <path d="M5 7.2h2M5 9.7h2M11.5 9.7h.5" />
      <path d="M4.5 4.5V2.2h3v2.3" />
    </svg>
  );
}

export function EmptyAuditIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h6.5" />
    </svg>
  );
}
