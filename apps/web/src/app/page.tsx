import { Dashboard } from "../components/dashboard";
import { ExpenseWorkflow } from "../components/expense-workflow";

export const dynamic = "force-dynamic";

const API_URL = process.env.LASTRO_API_URL ?? "http://127.0.0.1:3001";
const API_TOKEN = process.env.LASTRO_API_TOKEN ?? "";

export default function HomePage() {
  return (
    <div style={{ display: "grid", gap: "1.5rem" }}>
      <Dashboard apiUrl={API_URL} token={API_TOKEN} />
      <ExpenseWorkflow apiUrl={API_URL} token={API_TOKEN} bookId="1" />
    </div>
  );
}
