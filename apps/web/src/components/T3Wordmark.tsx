import type { SVGProps } from "react";

// The norai wordmark: lowercase, bold geometric sans with tight tracking (brand kit).
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 70 32" overflow="visible" xmlns="http://www.w3.org/2000/svg">
      <text
        x="0"
        y="25"
        fill="currentColor"
        fontFamily="'Inter Variable', Inter, Arial, Helvetica, sans-serif"
        fontSize="28"
        fontWeight="700"
        letterSpacing="-1.1"
      >
        norai
      </text>
    </svg>
  );
}
