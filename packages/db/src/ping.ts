import postgres from "postgres";

export async function pingDatabase(databaseUrl: string): Promise<boolean> {
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
  try {
    await client`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 1 });
  }
}
