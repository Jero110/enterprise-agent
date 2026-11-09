import type { SVGProps } from "react";

// The norAi mark from the brand kit: the geometric "n" (chamfered left block, top bar, and a right
// leg ending in a diagonal wedge). It is centered in a square box and draws in currentColor.
export function NoraiSymbol(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="-1.48 -39 320 320" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        d="M0 242L0 73.81L73.81 0L167.74 0L167.74 71.02L71.27 71.02L71.27 242ZM167.74 71.02L239 71.02L239 171L317.04 171L246.04 242L167.74 242Z"
      />
    </svg>
  );
}
