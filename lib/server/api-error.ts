import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { code: error.code, message: error.message },
      { status: error.status },
    );
  }

  if (error instanceof Error && error.message.includes("Supabase 환경변수")) {
    return NextResponse.json(
      { code: "CONFIGURATION_REQUIRED", message: error.message },
      { status: 503 },
    );
  }

  console.error("API request failed", error);
  return NextResponse.json(
    { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." },
    { status: 500 },
  );
}
