# Third Party Notices

This file records MIT-licensed source copied from third-party registries into
this repository. Copied source lives in `apps/web/src/components/ui/`; only the
components the app actually uses are pulled in.

Dependencies installed from npm carry their own license metadata and are not
repeated here.

## Format
- Project: <name>
- License: MIT
- Source revision: <commit or tag>
- Copied components: <list>

## Current

- Project: shadcn/ui (https://ui.shadcn.com)
License: MIT
Source revision: registry `@shadcn`, retrieved 2026-09-07 with shadcn CLI 4.21.0
Copied components: alert, badge, button, card, dialog, input, label, select, skeleton, table, tabs
Modifications: the `cn` helper is imported from the local `@/lib/utils` instead of the standalone `cn` npm package the CLI wired in, which is the documented shadcn convention and removes an unnecessary dependency.
