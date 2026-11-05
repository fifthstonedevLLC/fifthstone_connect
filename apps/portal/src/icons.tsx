/**
 * Line icons (24px grid, round caps), drawn inline so they take the text color. Every icon here is
 * decorative and sits beside visible text, so it is hidden from screen readers.
 */
const paths = {
  today: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  leads: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14.8c1.9.7 3.1 2.5 3.5 5.2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  templates: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9h8M8 12.5h5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  pause: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17v.01" />
    </>
  ),
  setup: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 2.5h6v3H9z" />
      <path d="M8.5 13l2.5 2.5 4.5-5" />
    </>
  ),
  signOut: (
    <>
      <path d="M15 4h4v16h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
