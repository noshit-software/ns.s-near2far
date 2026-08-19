// Minimal inline SVG icons, stroke="currentColor" so they inherit the app's theme colors
// (active/dim states, light/dark mode) instead of carrying their own fixed palette like emoji do.

const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
}

export function MapIcon() {
  return (
    <svg {...common} width="22" height="22" aria-hidden="true">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg {...common} width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function InfoIcon() {
  return (
    <svg {...common} width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg {...common} width="14" height="14" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export function EyeIcon() {
  return (
    <svg {...common} width="18" height="18" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function EyeOffIcon() {
  return (
    <svg {...common} width="18" height="18" aria-hidden="true">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a20.3 20.3 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

export function BellIcon() {
  return (
    <svg {...common} width="36" height="36" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function MedicalCrossIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true">
      <path d="M320-120v-200H120v-320h200v-200h320v200h200v320H640v200H320Zm80-80h160v-200h200v-160H560v-200H400v200H200v160h200v200Zm80-280Z" />
    </svg>
  )
}

export function BadgeIcon() {
  return (
    <svg {...common} width="20" height="20" aria-hidden="true">
      <path d="M12 2l2.5 2.5H18v3.5L20.5 10.5 18 13v3.5h-3.5L12 19l-2.5-2.5H6V13L3.5 10.5 6 8V4.5h3.5z" />
      <circle cx="12" cy="11" r="3" />
    </svg>
  )
}

export function LockIcon() {
  return (
    <svg {...common} width="22" height="22" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export function PhoneIcon() {
  return (
    <svg {...common} width="18" height="18" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

export function CarIcon() {
  return (
    <svg {...common} width="20" height="20" aria-hidden="true">
      <path d="M3 13l1.5-5A2 2 0 0 1 6.4 6.5h11.2A2 2 0 0 1 19.5 8L21 13" />
      <rect x="2" y="13" width="20" height="6" rx="2" />
      <circle cx="7" cy="19" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="17" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SuspiciousIcon() {
  return (
    <svg {...common} width="20" height="20" aria-hidden="true">
      <path d="M2 10c1.5-2.5 4-4 6-4s3.5 1.5 4 2c.5-.5 2-2 4-2s4.5 1.5 6 4c-1.5 2.5-4 4-6 4s-3.5-1.5-4-2c-.5.5-2 2-4 2s-4.5-1.5-6-4Z" />
      <circle cx="8" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}
