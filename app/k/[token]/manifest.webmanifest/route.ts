import { NextResponse } from "next/server";
import { kidByToken } from "@/lib/queries";

/**
 * Per-child manifest so "Add to home screen" installs an app that is named
 * after the child and opens straight into their own day.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const child = await kidByToken(token);
  if (!child) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(
    {
      name: `${child.name}'s Day`,
      short_name: child.name,
      /*
       * Identity, and deliberately free of the token. Chrome keys an installed
       * app on `id`; with none it falls back to `start_url`, so replacing a link
       * minted a second app and left the old icon pointing at a dead address. A
       * stable id means the browser updates the installation in place instead,
       * `start_url` included.
       *
       * Two limits worth knowing. Apps installed before this shipped are still
       * keyed to their old start_url, so the next replacement duplicates once
       * more and is stable from then on. And Safari does not implement manifest
       * id, so an iPhone keeps producing a separate icon.
       */
      id: `/k/id/${child.id}`,
      start_url: `/k/${token}`,
      scope: `/k/${token}`,
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      orientation: "portrait",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
