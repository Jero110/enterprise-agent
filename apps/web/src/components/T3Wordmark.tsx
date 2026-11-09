import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 150 32" xmlns="http://www.w3.org/2000/svg">
      <text
        x="0"
        y="25"
        fill="currentColor"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="27"
        fontWeight="400"
        letterSpacing="-0.4"
      >
        sequoia ai
      </text>
    </svg>
  );
}
