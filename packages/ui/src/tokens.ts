export const tones = {
  light: {
    name: "light",
    background: "#f5f2ea",
    surface: "#ffffff",
    surfaceMuted: "#ece8dd",
    border: "#1a1a1a",
    text: "#1a1a1a",
    textMuted: "#5a564c",
    primary: "#1a1a1a",
    primaryForeground: "#f5f2ea",
    focus: "#2563eb",
    danger: "#b3261e",
    success: "#2e7d32",
    warning: "#b26a00",
    info: "#2563eb",
  },
  dark: {
    name: "dark",
    background: "#12120f",
    surface: "#1c1c18",
    surfaceMuted: "#2a2a24",
    border: "#e8e4d8",
    text: "#e8e4d8",
    textMuted: "#a5a092",
    primary: "#e8e4d8",
    primaryForeground: "#12120f",
    focus: "#6ea8ff",
    danger: "#ef6a63",
    success: "#7ed491",
    warning: "#e0a83e",
    info: "#6ea8ff",
  },
} as const;

export type ThemeName = keyof typeof tones;

export type Tone = (typeof tones)[keyof typeof tones];

export const borders = {
  none: "none",
  pixel: "2px solid var(--lastro-border)",
  thick: "4px solid var(--lastro-border)",
} as const;

export const shadows = {
  none: "none",
  hard: "4px 4px 0 0 var(--lastro-border)",
  hardSmall: "2px 2px 0 0 var(--lastro-border)",
} as const;

export const radii = {
  none: "0",
  pixel: "0",
  small: "2px",
} as const;

export const fontFamilyMono = '"Berkeley Mono", "IBM Plex Mono", monospace';

export const fontFamilySans =
  '"Inter", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif';

export function themeVariables(theme: ThemeName): string {
  const tone = tones[theme];
  return `--lastro-background: ${tone.background};--lastro-surface: ${tone.surface};--lastro-surface-muted: ${tone.surfaceMuted};--lastro-border: ${tone.border};--lastro-text: ${tone.text};--lastro-text-muted: ${tone.textMuted};--lastro-primary: ${tone.primary};--lastro-primary-foreground: ${tone.primaryForeground};--lastro-focus: ${tone.focus};--lastro-danger: ${tone.danger};--lastro-success: ${tone.success};--lastro-warning: ${tone.warning};--lastro-info: ${tone.info};`;
}
