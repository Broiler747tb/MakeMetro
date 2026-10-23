// 24x24 stroke icons, drawn for this game.
const wrap = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  select: wrap('<path d="M5 3l13 8-6 1.5L9 19z"/>'),
  track: wrap('<path d="M4 19c4-1 6-4 8-8s4-6 8-7"/><path d="M6 14.5l2 2M9.5 9.5l2 2M14 5.5l1.6 2.2"/>'),
  station: wrap('<rect x="5" y="9" width="14" height="6" rx="1"/><path d="M2 12h3M19 12h3"/>'),
  connect: wrap('<rect x="2" y="15" width="6" height="4" rx="1"/><rect x="16" y="5" width="6" height="4" rx="1"/><path d="M8 17c5 0 3-10 8-10"/>'),
  depot: wrap('<path d="M4 20V9l8-5 8 5v11"/><path d="M8 20v-6h8v6"/>'),
  route: wrap('<path d="M4 18c3 0 4-3 6-6s3-6 7-6h3"/><circle cx="4" cy="18" r="1.8"/><circle cx="12" cy="10.5" r="1.8"/><circle cx="20" cy="6" r="1.8"/>'),
  remove: wrap('<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>'),
  undo: wrap('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
  redo: wrap('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>'),
  layers: wrap('<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>'),
  xray: wrap('<path d="M3 9h18M3 9l3 11h12l3-11"/><path d="M8 14h8" stroke-dasharray="2 2"/>'),
  theme: wrap('<circle cx="12" cy="12" r="8"/><path d="M12 4v16a8 8 0 000-16z" fill="currentColor"/>'),
  menu: wrap('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  pause: wrap('<path d="M9 6v12M15 6v12"/>'),
  play1: wrap('<path d="M9 6l7 6-7 6z"/>'),
  play2: wrap('<path d="M5 6l6 6-6 6zM12 6l6 6-6 6z"/>'),
  play3: wrap('<path d="M3 6l5 6-5 6zM9 6l5 6-5 6zM15 6l5 6-5 6z"/>'),
  pitch: wrap('<path d="M4 17l8-10 8 10z"/><path d="M8 17l4-5 4 5"/>'),
};
