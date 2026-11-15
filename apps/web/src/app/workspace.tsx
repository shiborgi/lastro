"use client";

/*
 * The registered modules carry render functions, which cannot cross from a
 * server component to a client one. Importing the registry here, on the
 * client side, keeps the page a server component and the shell module-free.
 */
import { webModules } from "@/modules";
import { Shell } from "@/shell/shell";

export function Workspace() {
  return <Shell modules={webModules} />;
}
