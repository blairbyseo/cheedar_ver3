/*5-5. Settings.jsx: App.jsx 파일에 걸림 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { usePoints } from "../usePoints";

// 기본 프로필 사진 placeholder 로 사용
const DEFAULT_PROFILE_IMAGE = "/cheese/cheese_profile.jpg";

// 아이디 규칙 — 서버(app/routers/auth.py)와 반드시 동일하게 유지할 것
const USER_ID_MIN = 3;
const USER_ID_MAX = 15;
const USER_ID_REGEX = /^[가-힣a-zA-Z0-9_]+$/;
// 아이디 변경 제한 — 첫 변경 시점부터 30일간 최대 2번
const USER_ID_CHANGE_WINDOW_DAYS = 30;
const USER_ID_MAX_CHANGES = 2;

// 서버에 보내기 전 1차 검증. 통과하면 null, 실패하면 에러 메시지를 돌려준다.
// (중복·30일 제한은 서버만 알 수 있으니 거기서 최종 검증)
function validateUserId(value) {
  if (value.length < USER_ID_MIN || value.length > USER_ID_MAX) {
    return `아이디는 ${USER_ID_MIN}~${USER_ID_MAX}자로 입력해주세요.`;
  }
  if (!USER_ID_REGEX.test(value)) {
    return "아이디는 한글, 영문, 숫자, 밑줄(_)만 쓸 수 있어요.";
  }
  return null;
}

// 아이디 변경 가능 상태 계산.
// 서버가 준 윈도우 시작 시각(windowStartRaw)과 변경 횟수(count)로
// "이번 30일에 몇 번 남았는지"와, 다 썼다면 "언제 다시 가능한지"를 구한다.
function getUserIdChangeInfo(windowStartRaw, count) {
  // 윈도우가 아예 없으면 한 번도 안 바꾼 것 → 2번 다 가능
  if (!windowStartRaw) {
    return { changesLeft: USER_ID_MAX_CHANGES, unlockDate: null };
  }
  const windowEnd = new Date(windowStartRaw);
  windowEnd.setDate(windowEnd.getDate() + USER_ID_CHANGE_WINDOW_DAYS);
  // 30일이 지나 윈도우가 만료됐으면 횟수가 리셋되어 다시 2번 가능
  if (windowEnd.getTime() <= Date.now()) {
    return { changesLeft: USER_ID_MAX_CHANGES, unlockDate: null };
  }
  const changesLeft = Math.max(0, USER_ID_MAX_CHANGES - (count ?? 0));
  return {
    changesLeft,
    unlockDate: changesLeft === 0 ? windowEnd : null,
  };
}

function Settings() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();

  // 헤더 우상단 포인트 — 현재 로그인한 환자의 CP
  const headerPoint = usePoints()?.cp ?? 0;

  // ────────────────────────────────────────────────────────
  // [상태 정의]
  // 각 useState 는 화면 한 영역의 "현재 모습"을 기억하는 변수.
  // ────────────────────────────────────────────────────────

  // 1) 프로필 사진 업로드 진행 상태 + 에러 메시지.
  //    현재 사진의 단일 출처(source of truth)는 AuthContext 의 user.profile_image_path.
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageError, setImageError] = useState("");

  // 2) 아이디 수정 모드에서 input 에 입력 중인 값 — 임시 버퍼.
  //    "현재 아이디"의 단일 출처(source of truth)는 AuthContext 의 user.user_id.
  const [editedUserId, setEditedUserId] = useState("");

  // 3) 아이디 수정 모드 토글. true 면 input 표시, false 면 일반 표시.
  const [isEditingUserId, setIsEditingUserId] = useState(false);

  // 4) 아이디 검증 에러 메시지 + 서버 저장 중 여부.
  const [userIdError, setUserIdError] = useState("");
  const [isSavingUserId, setIsSavingUserId] = useState(false);

  // 5) 알림 4종 — 마스터(전체) + 개별 3종.
  //    마스터가 false 면 개별 토글은 disabled 처리.
  const [allNotificationsOn, setAllNotificationsOn] = useState(true);
  const [mealReminderOn, setMealReminderOn] = useState(true);
  const [rankingNotificationOn, setRankingNotificationOn] = useState(true);
  const [weeklyReportNotificationOn, setWeeklyReportNotificationOn] =
    useState(false);

  // 6) 문의하기 — 관리자 쪽지 모달 표시 여부 + 입력 버퍼 + 전송 중 여부.
  const [isInquiryOpen, setIsInquiryOpen] = useState(false);
  const [inquiryText, setInquiryText] = useState("");
  const [isSubmittingInquiry, setIsSubmittingInquiry] = useState(false);

  // ── 아이디 관련 파생값 (state 가 아니라 user 로부터 매 렌더 계산) ──
  const currentUserId = user?.user_id ?? "";
  const { changesLeft: userIdChangesLeft, unlockDate: userIdUnlockDate } =
    getUserIdChangeInfo(
      user?.user_id_change_window_start,
      user?.user_id_change_count,
    );
  const isUserIdLocked = userIdChangesLeft === 0;

  // ────────────────────────────────────────────────────────
  // [핸들러]
  // ────────────────────────────────────────────────────────

  // 프로필 사진 업로드 — 고른 파일을 서버에 보내 저장하고, 갱신된 user 를 반영.
  async function handleProfileImageChange(e) {
    const file = e.target.files?.[0];
    if (!file || isUploadingImage) return;

    setImageError("");
    setIsUploadingImage(true);
    try {
      // multipart/form-data 로 전송 — Content-Type 헤더는 브라우저가 자동으로 채운다
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/auth/me/profile-image", {
        method: "PATCH",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `사진 업로드에 실패했어요 (${res.status})`);
      }
      const updatedUser = await res.json();
      setUser(updatedUser); // 앱 전역 user 갱신 → 사진이 곧바로 반영됨
    } catch (err) {
      console.error("[Settings] 프로필 사진 변경 실패:", err);
      setImageError(err.message);
    } finally {
      setIsUploadingImage(false);
      e.target.value = ""; // 같은 파일을 다시 골라도 onChange 가 또 일어나도록 초기화
    }
  }

  // 아이디 "변경" 버튼 — 수정 모드 진입.
  // 현재 아이디를 input 초기값으로 복사해 사용자가 바로 편집 가능.
  function handleStartEditUserId() {
    setEditedUserId(currentUserId);
    setUserIdError("");
    setIsEditingUserId(true);
  }

  // 아이디 "취소" 버튼 — 임시 버퍼/에러 비우고 수정 모드 종료.
  function handleCancelEditUserId() {
    setEditedUserId("");
    setUserIdError("");
    setIsEditingUserId(false);
  }

  // 아이디 "저장" 버튼 — 1차 검증 후 서버에 PATCH.
  // 중복·30일 제한 같은 최종 판정은 서버가 하고, 사유는 응답 detail 로 받는다.
  async function handleSaveUserId() {
    const next = editedUserId.trim();

    const localError = validateUserId(next);
    if (localError) {
      setUserIdError(localError);
      return;
    }
    // 기존과 같으면 서버 호출/30일 소모 없이 그냥 닫기
    if (next === currentUserId) {
      handleCancelEditUserId();
      return;
    }

    setIsSavingUserId(true);
    setUserIdError("");
    try {
      const res = await fetch("/api/auth/me/user-id", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: next }),
      });
      if (!res.ok) {
        // 서버가 detail 에 한국어 사유를 담아 보냄 (중복/30일 제한 등)
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `요청에 실패했어요 (${res.status})`);
      }
      const updatedUser = await res.json();
      setUser(updatedUser); // 앱 전역 상태 갱신 → 화면 곳곳의 아이디가 함께 바뀜
      setEditedUserId("");
      setIsEditingUserId(false);
    } catch (err) {
      console.error("[Settings] 아이디 변경 실패:", err);
      setUserIdError(err.message);
    } finally {
      setIsSavingUserId(false);
    }
  }

  // 마스터(전체 알림) 토글 — 개별 토글 상태는 그대로 유지하고
  // 표시만 비활성화처럼 보이게 함 (allNotificationsOn 으로 opacity 처리).
  function handleToggleAllNotifications() {
    setAllNotificationsOn((prev) => !prev);
  }

  // 계정/앱 설정 row 클릭 — 아직 라우팅이 없어서 mock 처리.
  function handleMockRowClick(label) {
    // eslint-disable-next-line no-console
    console.log(`[Settings] "${label}" 클릭 — 추후 라우팅 연결 필요`);
  }

  // 개별 알림 토글의 헬퍼: 마스터가 off 면 클릭 무시.
  function makeNotificationToggle(setter) {
    return () => {
      if (!allNotificationsOn) return;
      setter((prev) => !prev);
    };
  }

  // 문의하기 — 모달 열기/닫기/전송.
  // 추후 관리자 inbox API 연동 지점.
  function handleOpenInquiry() {
    setIsInquiryOpen(true);
  }
  function handleCloseInquiry() {
    setIsInquiryOpen(false);
    setInquiryText("");
  }
  async function handleSubmitInquiry() {
    const text = inquiryText.trim();
    if (!text) {
      alert("쪽지 내용을 입력해주세요");
      return;
    }
    setIsSubmittingInquiry(true);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `전송에 실패했어요 (${res.status})`);
      }
      alert("쪽지를 보냈습니다. 관리자가 확인 후 답변드릴게요.");
      handleCloseInquiry();
    } catch (err) {
      console.error("[Settings] 문의 전송 실패:", err);
      alert(err.message);
    } finally {
      setIsSubmittingInquiry(false);
    }
  }

  // TODO: 추후 브라우저 Notification API 또는 앱 푸시 연동 필요.
  //       현재는 UI 토글 상태만 메모리에 보관.

  return (
    <div className="settings-page">
      {/* 홈과 동일한 헤더 — 로고 + 포인트 요약 */}
      <header className="home-header">
        <h1 className="home-logo">Cheddar</h1>
        <div className="point-summary">
          <span className="point-badge">P</span>
          <strong>{headerPoint.toLocaleString()}</strong>
        </div>
      </header>

      {/* 페이지 제목 영역 */}
      <section className="settings-page-title">
        <h2>설정</h2>
        <p>개인 프로필과 알림을 설정하세요</p>
      </section>

      {/* ───────── 1. 프로필 카드 ───────── */}
      <section className="settings-card settings-profile-card">
        <h3 className="settings-card-title">프로필</h3>

        <div className="profile-image-area">
          {/* label 로 input 을 감싸 클릭 시 파일 선택 다이얼로그가 뜨게 함 */}
          <label className="profile-image-upload" aria-label="프로필 사진 변경">
            <img
              src={user?.profile_image_path || DEFAULT_PROFILE_IMAGE}
              alt="프로필"
              className="profile-image"
            />
            <input
              type="file"
              accept="image/*"
              onChange={handleProfileImageChange}
              disabled={isUploadingImage}
              hidden
            />
          </label>
          <div className="profile-info">
            <p className="profile-info-name">{currentUserId}</p>
            <p className="profile-info-hint">
              {isUploadingImage
                ? "사진 업로드 중..."
                : "프로필 사진은 랭킹 화면에 표시됩니다"}
            </p>
            {imageError && (
              <p style={{ margin: "4px 0 0", color: "#c0392b", fontSize: 13 }}>
                {imageError}
              </p>
            )}
          </div>
        </div>

        {/* 아이디 영역 — 수정 모드에 따라 표시가 갈림 */}
        {isEditingUserId ? (
          <div className="profile-id-edit">
            <input
              type="text"
              value={editedUserId}
              onChange={(e) => {
                setEditedUserId(e.target.value);
                if (userIdError) setUserIdError("");
              }}
              placeholder={`새 아이디 (${USER_ID_MIN}~${USER_ID_MAX}자)`}
              maxLength={USER_ID_MAX}
              disabled={isSavingUserId}
              autoFocus
            />
            {/* 글자수 제한을 항상 빨강 주의글로 안내.
                실제 검증 에러가 생기면 그 메시지로 바뀐다(둘 다 빨강). */}
            <p style={{ margin: "6px 2px 0", color: "#c0392b", fontSize: 13 }}>
              {userIdError || `아이디는 ${USER_ID_MIN}~${USER_ID_MAX}자로 입력해주세요`}
            </p>
            <div className="profile-id-edit-buttons">
              <button
                type="button"
                onClick={handleCancelEditUserId}
                disabled={isSavingUserId}
              >
                취소
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={handleSaveUserId}
                disabled={isSavingUserId}
              >
                {isSavingUserId ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-id-row">
            <span className="profile-id-row-label">아이디</span>
            <span className="profile-id-row-value">{currentUserId}</span>
            <button
              type="button"
              className="profile-id-row-button"
              onClick={handleStartEditUserId}
              disabled={isUserIdLocked}
            >
              변경
            </button>
          </div>
        )}

        <p className="settings-helper-text">
          {isUserIdLocked
            ? `${userIdUnlockDate.toLocaleDateString("ko-KR")}부터 다시 변경할 수 있어요`
            : `아이디는 ${USER_ID_CHANGE_WINDOW_DAYS}일에 ${USER_ID_MAX_CHANGES}번까지 변경할 수 있어요 (${userIdChangesLeft}번 남음)`}
        </p>
      </section>

      {/* ───────── 2. 알림 설정 카드 ───────── */}
      <section className="settings-card settings-alarm-card">
        <h3 className="settings-card-title">알림</h3>

        {/* 마스터 토글 — 다른 row 의 활성/비활성을 결정 */}
        <div className="notification-row is-master">
          <div className="notification-row-info">
            <p className="notification-row-title">모든 알림</p>
            <p className="notification-row-desc">
              꺼두면 아래 개별 알림도 함께 비활성화돼요
            </p>
          </div>
          <ToggleSwitch
            isOn={allNotificationsOn}
            onClick={handleToggleAllNotifications}
            label="모든 알림"
          />
        </div>

        {/* 개별 알림 3종 — 마스터의 하위 항목임을 좌측 라인 + 들여쓰기로 시각화 */}
        <div
          className={`notification-children ${
            !allNotificationsOn ? "notification-children-off" : ""
          }`}
        >
        {/* 식단 기록 알림 */}
        <div
          className={`notification-row ${
            !allNotificationsOn ? "notification-row-disabled" : ""
          }`}
        >
          <div className="notification-row-info">
            <p className="notification-row-title">식단 기록 알림</p>
            <p className="notification-row-desc">
              아침 7시, 점심 12시, 저녁 6시에 기록 알림을 드려요
            </p>
          </div>
          <ToggleSwitch
            isOn={mealReminderOn && allNotificationsOn}
            onClick={makeNotificationToggle(setMealReminderOn)}
            disabled={!allNotificationsOn}
            label="식단 기록 알림"
          />
        </div>

        {/* 랭킹 알림 */}
        <div
          className={`notification-row ${
            !allNotificationsOn ? "notification-row-disabled" : ""
          }`}
        >
          <div className="notification-row-info">
            <p className="notification-row-title">랭킹 알림</p>
            <p className="notification-row-desc">
              랭킹이 올라가면 알려드려요
            </p>
          </div>
          <ToggleSwitch
            isOn={rankingNotificationOn && allNotificationsOn}
            onClick={makeNotificationToggle(setRankingNotificationOn)}
            disabled={!allNotificationsOn}
            label="랭킹 알림"
          />
        </div>

        {/* 주간 리포트 알림 */}
        <div
          className={`notification-row ${
            !allNotificationsOn ? "notification-row-disabled" : ""
          }`}
        >
          <div className="notification-row-info">
            <p className="notification-row-title">주간 리포트 알림</p>
            <p className="notification-row-desc">
              주간 피드백 리포트가 준비되면 알려드려요
            </p>
          </div>
          <ToggleSwitch
            isOn={weeklyReportNotificationOn && allNotificationsOn}
            onClick={makeNotificationToggle(setWeeklyReportNotificationOn)}
            disabled={!allNotificationsOn}
            label="주간 리포트 알림"
          />
        </div>
        </div>
      </section>

      {/* ───────── 3. 계정/앱 설정 카드 ───────── */}
      <section className="settings-card settings-account-card">
        <h3 className="settings-card-title">기타</h3>


        <button
          type="button"
          className="settings-list-row"
          onClick={handleOpenInquiry}
        >
          문의하기
          <span className="settings-list-row-arrow">›</span>
        </button>
        <button
          type="button"
          className="settings-list-row settings-list-danger"
          onClick={async () => {
            const ok = window.confirm("로그아웃 하시겠어요?");
            if (!ok) return;
            await logout();
            navigate("/login", { replace: true });
          }}
        >
          로그아웃
          <span className="settings-list-row-arrow">›</span>
        </button>
      </section>

      {/* ───────── 문의하기 모달 ───────── */}
      {isInquiryOpen && (
        <div
          className="inquiry-modal-backdrop"
          onClick={handleCloseInquiry}
          role="presentation"
        >
          <div
            className="inquiry-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="관리자에게 쪽지"
          >
            <h3 className="inquiry-modal-title">문의 남기기</h3>
            <p className="inquiry-modal-desc">
              궁금한 점이나 불편 사항을 적어주세요.
            </p>
            <textarea
              className="inquiry-modal-textarea"
              value={inquiryText}
              onChange={(e) => setInquiryText(e.target.value)}
              placeholder="내용을 입력해주세요"
              rows={5}
              autoFocus
            />
            <div className="inquiry-modal-buttons">
              <button
                type="button"
                onClick={handleCloseInquiry}
                disabled={isSubmittingInquiry}
              >
                취소
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={handleSubmitInquiry}
                disabled={isSubmittingInquiry}
              >
                {isSubmittingInquiry ? "보내는 중…" : "보내기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// 작은 토글 스위치 컴포넌트 — 4곳에서 재사용되어 함수로 분리.
// 외부 라이브러리 없이 button + 두 div 만으로 구현.
// ────────────────────────────────────────────────────────
function ToggleSwitch({ isOn, onClick, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      className={`toggle-switch ${isOn ? "toggle-switch-on" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

export default Settings;
