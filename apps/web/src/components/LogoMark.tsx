// The logo's glyph: three people joined into one shape, the app's idea of live editing.
// White on whatever accent fill its container paints, sized by that container.
export function LogoMark() {
  return (
    <svg viewBox="7 7 38 38" width="100%" height="100%" aria-hidden="true" focusable="false">
      <path
        d="M16 34 L26 17 L36 34 Z"
        fill="none"
        stroke="#fff"
        strokeWidth="2.75"
        strokeLinejoin="round"
      />
      <circle cx="26" cy="17" r="4.75" fill="#fff" />
      <circle cx="16" cy="34" r="4.75" fill="#fff" />
      <circle cx="36" cy="34" r="4.75" fill="#fff" />
    </svg>
  )
}
