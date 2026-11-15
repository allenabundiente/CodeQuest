export function Mascot({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role="img"
      aria-label="CodeQuest mascot"
    >
      <rect
        x="8"
        y="22"
        width="80"
        height="58"
        rx="20"
        fill="#0b1119"
        stroke="#7cf29c"
        strokeWidth="3"
      />
      <circle cx="35" cy="46" r="5" fill="#7cf29c" />
      <circle cx="61" cy="46" r="5" fill="#7cf29c" />
      <path
        d="M35 60c7 6 19 6 26 0"
        stroke="#7cf29c"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M48 22V12" stroke="#7cf29c" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="9" r="4" fill="#7fb2ff" />
    </svg>
  );
}
