/** The close's screens, as one web module (ADR 11). */
import type { WebModule } from "@/shell/registry";
import { closeOperations } from "@lastro/close/contracts";
import { DailyCloseScreen } from "./daily-closes";

export const closeWebModule: WebModule = {
  id: "close",
  label: "Resultado",
  operations: closeOperations,
  views: [
    {
      id: "close-daily-closes",
      label: "Fechamento",
      render: ({ bookId }) => <DailyCloseScreen key={bookId} bookId={bookId} />,
    },
  ],
};
