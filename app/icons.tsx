const PATHS = {
  camera: "M4 8h3l1.5-2h7L17 8h3v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  image: "M4 5h16v14H4z M4 16l4.5-4.5 3.5 3.5 3-3 5 5 M9 9.5a1 1 0 1 0 0-.01",
  speaker: "M4 10v4h3l5 4V6l-5 4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11",
  stop: "M7 7h10v10H7z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 4l9 16H3z M12 10v4 M12 17v.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5v.01",
  calendar: "M5 6h14v14H5z M5 10h14 M9 4v4 M15 4v4",
  share: "M12 15V4 M8 8l4-4 4 4 M5 13v7h14v-7",
  copy: "M9 9h10v11H9z M5 15V4h10",
  home: "M4 11l8-7 8 7 M6 10v10h12V10",
  list: "M9 7h11 M9 12h11 M9 17h11 M4.5 7v.01 M4.5 12v.01 M4.5 17v.01",
  bag: "M5 8h14l-1 12H6z M9 8V6a3 3 0 0 1 6 0v2",
  card: "M4 6h16v12H4z M7 10h6 M7 14h10",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l4.5 4.5",
  phone: "M6 4h4l1.5 5-2.5 1.5a11 11 0 0 0 5 5L15.5 13l5 1.5v4A1.5 1.5 0 0 1 19 20C10.7 20 4 13.3 4 5.5A1.5 1.5 0 0 1 6 4z",
  chat: "M4 5h16v11H10l-5 4v-4H4z",
  refresh: "M19 8a8 8 0 1 0 1 6 M20 4v5h-5",
  close: "M6 6l12 12 M18 6L6 18",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  zoom: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l4.5 4.5 M8 11h6 M11 8v6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = "1.25em" }: { name: IconName; size?: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
