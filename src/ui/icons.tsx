import type { SVGProps } from 'react'

export function BoxFeatureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="m12 2.75 8 4.5v9.5l-8 4.5-8-4.5v-9.5l8-4.5Z" />
      <path d="m4.4 7.5 7.6 4.25 7.6-4.25M12 11.75v9" />
    </svg>
  )
}

export function CylinderFeatureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <ellipse cx="12" cy="5.5" rx="7" ry="3" />
      <path d="M5 5.5v13c0 1.65 3.13 3 7 3s7-1.35 7-3v-13M5 18.5c0 1.65 3.13 3 7 3s7-1.35 7-3" />
    </svg>
  )
}

export function SphereFeatureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.4 9h17.2M3.4 15h17.2M12 3c2.2 2.45 3.4 5.45 3.4 9S14.2 18.55 12 21M12 3C9.8 5.45 8.6 8.45 8.6 12s1.2 6.55 3.4 9" />
    </svg>
  )
}

export function SketchFeatureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 19 17.8 5.2M6.5 5H19v12.5" />
      <circle cx="4" cy="19" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="5" r="1.8" fill="currentColor" stroke="none" />
      <path d="M9 19h10" strokeDasharray="2 2" />
    </svg>
  )
}

export function ExtrudeFeatureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M5 9.5 12 13l7-3.5M12 13v8M5 9.5V17l7 4 7-4V9.5" />
      <path d="M8 6h8M12 2v8M9.5 4.5 12 2l2.5 2.5" />
    </svg>
  )
}

export function FilletFeatureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M5 19V6h13" />
      <path d="M18 6a12 12 0 0 0-12 12" />
      <path d="m15.2 3.2 2.8 2.8-2.8 2.8" />
    </svg>
  )
}

export function RevolveFeatureIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 2v20M4 12c3-5 12-5 16 0-4 5-13 5-16 0Z" />
      <path d="M4 12c0 2 3.5 3.5 8 3.5s8-1.5 8-3.5" />
      <path d="M20 12v3M20 7v2" strokeDasharray="2 2" />
    </svg>
  )
}
