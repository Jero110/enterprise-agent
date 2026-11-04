import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 240 32" xmlns="http://www.w3.org/2000/svg">
      <text
        x="0"
        y="25"
        fill="currentColor"
        fontFamily="system-ui, sans-serif"
        fontSize="27"
        fontWeight="700"
        letterSpacing="-0.6"
      >
        Enterprise Agent
      </text>
    </svg>
  );
}
