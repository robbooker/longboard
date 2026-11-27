// #528 Gainer Balloons: a thunderstorm's glow. No three.js here, so it can be tested on its own.

/**
 * How bright the storm's glow is at a moment, 0..1. One soft pulse in every 9-second slot, starting
 * within the slot's first 2 seconds: so never less than 7 seconds apart. It rises over a fifth of a
 * second and fades over one second: a glow, never a flash or a strobe.
 */
export function lightningPulse(elapsedSec: number): number {
  const period = 9;
  const slot = Math.floor(elapsedSec / period);
  const jitter = Math.abs((Math.sin(slot * 91.7) * 43758.5453) % 1);
  const t = elapsedSec - (slot * period + jitter * 2);
  if (t < 0 || t > 1.2) return 0;
  return t < 0.2 ? t / 0.2 : Math.pow(1 - (t - 0.2) / 1.0, 2);
}
