/**
 * Icon set — a single stroke-based family so icons read as one system.
 *
 * All icons share: 24x24 viewBox, 1.7 stroke, round caps/joins, currentColor.
 * Never mix in a filled or differently-weighted icon; it will look pasted in.
 */

function Icon({ size = 18, children, ...rest }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ArrowRight = (p) => (
  <Icon {...p}><path d="M4 12h15M13 6l6 6-6 6" /></Icon>
)

export const ArrowLeft = (p) => (
  <Icon {...p}><path d="M20 12H5M11 18l-6-6 6-6" /></Icon>
)

export const Check = (p) => (
  <Icon {...p}><path d="m4.5 12.5 5 5 10-11" /></Icon>
)

export const CheckCircle = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.2 2.8 2.8L16 9.6" />
  </Icon>
)

export const X = (p) => (
  <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>
)

export const AlertTriangle = (p) => (
  <Icon {...p}>
    <path d="M12 4.5 2.8 20h18.4L12 4.5Z" />
    <path d="M12 10v4M12 17.2v.1" />
  </Icon>
)

export const AlertCircle = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16.2v.1" />
  </Icon>
)

export const Info = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.8v.1" />
  </Icon>
)

export const Sparkles = (p) => (
  <Icon {...p}>
    <path d="M12 3c.6 4.4 2.9 6.7 7.3 7.3-4.4.6-6.7 2.9-7.3 7.3-.6-4.4-2.9-6.7-7.3-7.3C9.1 9.7 11.4 7.4 12 3Z" />
    <path d="M18.8 16.4c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5Z" />
  </Icon>
)

export const Shield = (p) => (
  <Icon {...p}>
    <path d="M12 3.2 5 6v5.6c0 4.2 2.8 7.6 7 9.2 4.2-1.6 7-5 7-9.2V6l-7-2.8Z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </Icon>
)

export const Layers = (p) => (
  <Icon {...p}>
    <path d="m12 3.5 8.5 4.3L12 12 3.5 7.8 12 3.5Z" />
    <path d="m3.5 12.2 8.5 4.3 8.5-4.3M3.5 16.4l8.5 4.3 8.5-4.3" />
  </Icon>
)

export const Wand = (p) => (
  <Icon {...p}>
    <path d="M4 20 15 9M13.5 5.5 18.5 10.5" />
    <path d="M17 3.5 17.6 5.4 19.5 6l-1.9.6L17 8.5l-.6-1.9L14.5 6l1.9-.6L17 3.5Z" />
  </Icon>
)

export const Rocket = (p) => (
  <Icon {...p}>
    <path d="M13.5 4.5c3.5-1.2 6 .3 6 .3s1.5 2.5.3 6c-1 3-4.2 5.6-6.5 6.8L9 13.2c1.2-2.3 3.8-5.5 6.8-6.5" />
    <path d="M9.2 13.4 6.6 16M8 18.6c-.9.9-3.4 1.5-3.4 1.5s.6-2.5 1.5-3.4" />
    <circle cx="15.2" cy="8.8" r="1.4" />
  </Icon>
)

export const Grid = (p) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
  </Icon>
)

export const FileText = (p) => (
  <Icon {...p}>
    <path d="M13.5 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V8.8l-5.3-5.3Z" />
    <path d="M13.4 3.6v5.2h5.3M8.8 13h6.4M8.8 16.4h4.2" />
  </Icon>
)

export const Search = (p) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
)

export const Plus = (p) => (
  <Icon {...p}><path d="M12 5.5v13M5.5 12h13" /></Icon>
)

export const Menu = (p) => (
  <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
)

export const Sun = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.8v2M12 19.2v2M4.4 4.4l1.4 1.4M18.2 18.2l1.4 1.4M2.8 12h2M19.2 12h2M4.4 19.6l1.4-1.4M18.2 5.8l1.4-1.4" />
  </Icon>
)

export const Moon = (p) => (
  <Icon {...p}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
  </Icon>
)

export const Download = (p) => (
  <Icon {...p}>
    <path d="M12 3.8v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 17v2.2A1.3 1.3 0 0 0 5.8 20.5h12.4a1.3 1.3 0 0 0 1.3-1.3V17" />
  </Icon>
)

export const ExternalLink = (p) => (
  <Icon {...p}>
    <path d="M13.5 4.5h6v6M19 5l-8.5 8.5" />
    <path d="M18 14.2v4.3a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.5V8.2a1.8 1.8 0 0 1 1.8-1.8h4.3" />
  </Icon>
)

export const Eye = (p) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
)

export const Lock = (p) => (
  <Icon {...p}>
    <rect x="4.8" y="10.2" width="14.4" height="10" rx="2" />
    <path d="M8.4 10.2V7.6a3.6 3.6 0 0 1 7.2 0v2.6" />
  </Icon>
)

export const Users = (p) => (
  <Icon {...p}>
    <circle cx="9.5" cy="8.5" r="3.3" />
    <path d="M3.5 19.5a6 6 0 0 1 12 0M16.5 6.2a3.3 3.3 0 0 1 0 6.4M18 19.5a5.4 5.4 0 0 0-2.6-4.6" />
  </Icon>
)

export const Zap = (p) => (
  <Icon {...p}><path d="M13.4 2.8 5.6 13.4h5.4l-.6 7.8 7.8-10.6h-5.4l.6-7.8Z" /></Icon>
)

export const GitBranch = (p) => (
  <Icon {...p}>
    <circle cx="7" cy="5.5" r="2.2" />
    <circle cx="7" cy="18.5" r="2.2" />
    <circle cx="17" cy="9.5" r="2.2" />
    <path d="M7 7.7v8.6M17 11.7c0 3-2.4 4.6-5.2 4.9" />
  </Icon>
)

export const Inbox = (p) => (
  <Icon {...p}>
    <path d="M3.5 13.5h4l1.4 2.6h6.2l1.4-2.6h4" />
    <path d="M6.2 4.5h11.6l2.7 9v5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2v-5l2.7-9Z" />
  </Icon>
)

export const Loader = (p) => (
  <Icon {...p}>
    <path d="M12 3.5v3.2M12 17.3v3.2M4.9 4.9l2.3 2.3M16.8 16.8l2.3 2.3M3.5 12h3.2M17.3 12h3.2M4.9 19.1l2.3-2.3M16.8 7.2l2.3-2.3" />
  </Icon>
)
