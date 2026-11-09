import type { SVGProps } from "react";

// The norai symbol from the brand kit: outer circle, inner ring, mooring post and two waves.
// It draws in currentColor; the ring and the thin wave are a softer tone of the same color.
export function NoraiSymbol(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="100" cy="100" r="84" stroke="currentColor" strokeWidth="7" />
        <circle
          cx="100"
          cy="100"
          r="70"
          stroke="currentColor"
          strokeOpacity="0.4"
          strokeWidth="4"
        />
        <path
          d="M80 59a6 6 0 0 1 6-6h8v-5a6 6 0 0 1 12 0v5h14a6 6 0 0 1 0 12h-14v73a6 6 0 0 1-12 0V65h-8a6 6 0 0 1-6-6Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M35 129c17-9 30-9 44 0 13 8 22 9 34 4 12-5 19-14 29-11 8 3 6 10 0 12-10 5-20-2-30-2-12 0-20 6-32 12-9 5-18 8-27 10"
          stroke="currentColor"
          strokeOpacity="0.65"
          strokeWidth="5"
        />
        <path
          d="M53 153c12-6 23-8 36-6 14 2 24 11 37 8 7-1 13-5 18-4"
          stroke="currentColor"
          strokeWidth="8"
        />
      </g>
    </svg>
  );
}
