// Small stroke-icon set for AppShell sidebar nav items. Sized to match
// AppShell's own DefaultTabIcon/SignOutIcon (h-[18px] w-[18px]).

import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-[18px] w-[18px] shrink-0">
      {children}
    </svg>
  );
}

export function DashboardIcon() {
  return (
    <Svg>
      <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1" />
      <rect x="11" y="2.5" width="6.5" height="4.5" rx="1" />
      <rect x="11" y="9" width="6.5" height="8.5" rx="1" />
      <rect x="2.5" y="11" width="6.5" height="6.5" rx="1" />
    </Svg>
  );
}

export function ChartIcon() {
  return (
    <Svg>
      <path d="M3 17V3M3 17h14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 14v-4M10 14V7M13.5 14v-6" strokeLinecap="round" />
    </Svg>
  );
}

export function BoxIcon() {
  return (
    <Svg>
      <path d="M2.5 6.5 10 3l7.5 3.5L10 10 2.5 6.5Z" strokeLinejoin="round" />
      <path d="M2.5 6.5V14L10 17.5M17.5 6.5V14L10 17.5M10 10v7.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ClipboardIcon() {
  return (
    <Svg>
      <rect x="4.5" y="4" width="11" height="13" rx="1.3" />
      <path d="M7.5 4a2.5 2.5 0 0 1 5 0" strokeLinecap="round" />
      <path d="M7 9h6M7 12h6M7 15h3.5" strokeLinecap="round" />
    </Svg>
  );
}

export function BuildingIcon() {
  return (
    <Svg>
      <rect x="4" y="2.5" width="9" height="15" rx="0.6" />
      <path d="M13 8.5h3v9h-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 5.5h1.2M6.5 8.5h1.2M6.5 11.5h1.2M9.5 5.5h1.2M9.5 8.5h1.2M9.5 11.5h1.2" strokeLinecap="round" />
    </Svg>
  );
}

export function UploadIcon() {
  return (
    <Svg>
      <path d="M10 12.5V3m0 0L6.5 6.5M10 3l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 13.5v2A1.5 1.5 0 0 0 5 17h10a1.5 1.5 0 0 0 1.5-1.5v-2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PencilIcon() {
  return (
    <Svg>
      <path d="M12.5 3.5 16 7l-9 9-4 1 1-4 8.5-8.5Z" strokeLinejoin="round" />
    </Svg>
  );
}

export function ClockIcon() {
  return (
    <Svg>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CartIcon() {
  return (
    <Svg>
      <path d="M2.5 3h1.8l1.6 10.2A1.5 1.5 0 0 0 7.4 14.5h7.1a1.5 1.5 0 0 0 1.5-1.25L17 6H5.1" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="17" r="1.1" />
      <circle cx="14.5" cy="17" r="1.1" />
    </Svg>
  );
}

export function ReceiptIcon() {
  return (
    <Svg>
      <path d="M5 2.5h10v15l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3v-13.7Z" strokeLinejoin="round" />
      <path d="M7 6.5h6M7 9.5h6M7 12.5h3.5" strokeLinecap="round" />
    </Svg>
  );
}
