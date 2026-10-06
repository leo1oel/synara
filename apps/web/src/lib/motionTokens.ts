// FILE: motionTokens.ts
// Purpose: Shared Fluid Functionalism spring presets for interactive UI motion.
// Layer: Web UI motion primitive

import type { Transition } from "motion/react";

export const fluidSpring = {
  fast: { type: "spring", duration: 0.08, bounce: 0 },
  moderate: { type: "spring", duration: 0.16, bounce: 0 },
  slow: { type: "spring", duration: 0.24, bounce: 0.12 },
} satisfies Record<string, Transition>;

export const fluidExit = {
  fast: { duration: 0.06 },
  moderate: { duration: 0.12 },
  slow: { duration: 0.16 },
} satisfies Record<string, Transition>;
