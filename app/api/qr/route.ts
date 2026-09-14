import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { getPublicJoinUrl } from "@/lib/server/public-app-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const joinUrl = getPublicJoinUrl(request.nextUrl.origin);
  const svg = await QRCode.toString(joinUrl, {
    color: {
      dark: "#103f35ff",
      light: "#fffef9ff",
    },
    errorCorrectionLevel: "M",
    margin: 2,
    type: "svg",
    width: 720,
  });

  return new NextResponse(svg, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Goldenbell-Join-Url": joinUrl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
