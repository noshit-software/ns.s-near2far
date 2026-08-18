// Generated avatars, rendered fully offline (no network calls, no third-party avatar CDN —
// matches near2far's self-hosted/private-by-default posture). A member's "seed" is a random
// token assigned at creation; regenerating just picks a new seed.

import { createAvatar } from "@dicebear/core"
import { funEmoji } from "@dicebear/collection"

export function generatedAvatarDataUri(seed: string): string {
  return createAvatar(funEmoji, { seed }).toDataUri()
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

// Deterministic per-member color (pin-dot fill, photo-marker border) so a member stays
// visually identifiable across zoom levels even without a photo or generated avatar loaded.
export function memberColor(memberId: string): string {
  let hash = 0
  for (let i = 0; i < memberId.length; i++) {
    hash = (hash << 5) - hash + memberId.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 70%, 45%)`
}
