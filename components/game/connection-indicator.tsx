type ConnectionIndicatorProps = {
  status: "not_configured" | "connecting" | "connected" | "error";
};

const labels = {
  not_configured: "설정 필요",
  connecting: "연결 중",
  connected: "실시간 연결",
  error: "연결 불안정",
};

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  return (
    <span className={`connection-badge connection-${status}`}>
      <span aria-hidden="true" /> {labels[status]}
    </span>
  );
}
