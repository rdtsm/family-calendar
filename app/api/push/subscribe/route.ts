import { NextResponse } from "next/server";
import { newId, sql } from "@/lib/db";
import { kidByToken } from "@/lib/queries";

export async function POST(req: Request) {
  type Body = {
    token?: string;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  };

  const body = (await req.json().catch(() => null)) as Body | null;
  const token = body?.token;
  const sub = body?.subscription;

  if (!token || !sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const child = await kidByToken(token);
  if (!child) return NextResponse.json({ error: "unknown child" }, { status: 404 });

  await sql`
    insert into push_subscriptions (id, child_id, endpoint, p256dh, auth)
    values (${newId()}, ${child.id}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth})
    on conflict (endpoint) do update set child_id = excluded.child_id,
      p256dh = excluded.p256dh, auth = excluded.auth
  `;

  return NextResponse.json({ ok: true });
}
