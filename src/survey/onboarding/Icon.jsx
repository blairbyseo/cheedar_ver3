/* Icon — 디자인 핸드오프의 Solar(Iconify) 아이콘 이름을 이 앱에 이미 설치된
 * lucide-react 컴포넌트로 매핑한다. (핸드오프 주의점 C: 아이콘셋은 실제 앱
 * 라이브러리로 매핑) 데이터(presentation.js)는 'solar:...' 문자열을 그대로 들고
 * 있고, 여기서 한 곳에서만 매핑하므로 나중에 아이콘 교체가 쉽다.
 */
import {
  ArrowLeft, Check, CheckCircle2, MinusCircle, Heart, User, Users, Home,
  PlusCircle, Minus, Moon, Sun, Clock, Save, Lock, X, XCircle, Leaf,
  HeartPulse, Star, BookOpen, UserCircle, HelpCircle, Stethoscope, Handshake,
  SmilePlus, Plus, Footprints, Bike, Dumbbell, Music, Utensils, Donut,
  MoonStar, NotebookPen, Cigarette, Pill,
} from "lucide-react";

// solar 이름 → lucide 컴포넌트. 없는 건 fallback(작은 점)으로.
const MAP = {
  "solar:arrow-left-linear": ArrowLeft,
  "solar:check-read-linear": Check,
  "solar:check-circle-bold": CheckCircle2,
  "solar:check-circle-linear": CheckCircle2,
  "solar:close-linear": X,
  "solar:close-circle-linear": XCircle,
  "solar:minus-circle-linear": MinusCircle,
  "solar:minus-linear": Minus,
  "solar:add-circle-linear": PlusCircle,
  "solar:men-linear": User,
  "solar:women-linear": User,
  "solar:user-linear": User,
  "solar:user-circle-linear": UserCircle,
  "solar:users-group-rounded-linear": Users,
  "solar:heart-linear": Heart,
  "solar:heart-pulse-linear": HeartPulse,
  "solar:home-smile-linear": Home,
  "solar:home-linear": Home,
  "solar:moon-stars-linear": MoonStar,
  "solar:moon-sleep-linear": Moon,
  "solar:sun-2-linear": Sun,
  "solar:clock-circle-linear": Clock,
  "solar:diskette-linear": Save,
  "solar:lock-keyhole-minimalistic-linear": Lock,
  "solar:leaf-linear": Leaf,
  "solar:star-bold": Star,
  "solar:book-linear": BookOpen,
  "solar:notebook-linear": NotebookPen,
  "solar:question-circle-linear": HelpCircle,
  "solar:stethoscope-linear": Stethoscope,
  "solar:hand-shake-linear": Handshake,
  "solar:smile-circle-linear": SmilePlus,
  "solar:plate-linear": Utensils,
  "solar:running-linear": Footprints,
  "solar:cycling-round-linear": Bike,
  "solar:dumbbell-linear": Dumbbell,
  "solar:music-note-linear": Music,
  "solar:donut-bitten-linear": Donut,
  "solar:cigarette-linear": Cigarette,
  "solar:pill-linear": Pill,
  "solar:add-linear": Plus,
};

export function Icon({ icon, size = 22, color = "currentColor", style }) {
  const Cmp = MAP[icon];
  if (!Cmp) {
    return (
      <span
        aria-hidden="true"
        style={{
          width: size * 0.5, height: size * 0.5, borderRadius: 999,
          background: color === "currentColor" ? "currentColor" : color,
          display: "inline-block", ...style,
        }}
      />
    );
  }
  // lucide: strokeWidth 1.8 정도가 solar linear 느낌과 가깝다.
  return (
    <Cmp size={size} color={color} strokeWidth={1.9}
      style={{ display: "inline-flex", flexShrink: 0, ...style }} />
  );
}

export default Icon;
