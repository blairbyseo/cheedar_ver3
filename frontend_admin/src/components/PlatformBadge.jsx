// 회원이 마지막으로 접속한 기기 배지 (users.last_platform).
// 서버가 앱이 보내는 X-Client-Platform 헤더(없으면 User-Agent)로 판별해 저장한다.
const PLATFORMS = {
  ios: { label: "아이폰", title: "iOS 앱/기기에서 마지막 접속" },
  android: { label: "갤럭시", title: "Android 앱/기기에서 마지막 접속" },
  web: { label: "웹", title: "PC 웹 브라우저에서 마지막 접속" },
};

export default function PlatformBadge({ platform }) {
  const info = PLATFORMS[platform];
  if (!info) {
    return (
      <span className="platform-none" title="기기 기록 이후 아직 접속하지 않았어요">
        —
      </span>
    );
  }
  return (
    <span className={`badge-platform badge-platform-${platform}`} title={info.title}>
      {info.label}
    </span>
  );
}
