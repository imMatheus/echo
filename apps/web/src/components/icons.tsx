/** Echo logo mark — concentric circles in the brand violet. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="4.5" fill="#7c6cf0" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#7c6cf0" strokeWidth="2" opacity="0.55" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="#7c6cf0" strokeWidth="1.8" opacity="0.25" />
    </svg>
  );
}
