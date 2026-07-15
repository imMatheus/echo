/** Echo logo mark — concentric circles in the brand violet. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <img
      src="https://cdn.midjourney.com/f030bf52-824b-4326-9b00-3cd8a057a467/0_1_128_N.webp"
      alt=""
      width={size}
      height={size}
      className="rounded-full"
    />
  )
}
