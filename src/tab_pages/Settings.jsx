/*5-5. Settings.jsx: App.jsx 파일에 걸림 */
import { useState } from "react";

// 헤더 우상단에 표시할 포인트 
const HEADER_POINT = 1040;

// 기본 프로필 사진 placeholder 로 사용
const DEFAULT_PROFILE_IMAGE = "/cheese/cheese_profile.jpg";

function Settings() {
  // ────────────────────────────────────────────────────────
  // [상태 정의]
  // 각 useState 는 화면 한 영역의 "현재 모습"을 기억하는 변수.
  // ────────────────────────────────────────────────────────

  // 1) 프로필 사진 미리보기 URL. null 이면 기본 이미지 사용.
  const [profileImagePreview, setProfileImagePreview] = useState(null);

  // 2) 화면에 표시되는 "현재 아이디". 저장이 끝나면 이 값이 갱신됨.
  const [userId, setUserId] = useState("cheddar_user");

  // 3) 아이디 수정 모드에서 input 에 입력 중인 값 — 임시 버퍼.
  //    저장하면 userId 로 옮기고, 취소하면 그냥 버림.
  const [editedUserId, setEditedUserId] = useState("");

  // 4) 아이디 수정 모드 토글. true 면 input 표시, false 면 일반 표시.
  const [isEditingUserId, setIsEditingUserId] = useState(false);

  // 5) 알림 4종 — 마스터(전체) + 개별 3종.
  //    마스터가 false 면 개별 토글은 disabled 처리.
  const [allNotificationsOn, setAllNotificationsOn] = useState(true);
  const [mealReminderOn, setMealReminderOn] = useState(true);
  const [rankingNotificationOn, setRankingNotificationOn] = useState(true);
  const [weeklyReportNotificationOn, setWeeklyReportNotificationOn] =
    useState(false);

  // 6) 문의하기 — 관리자 쪽지 모달 표시 여부 + 입력 버퍼.
  const [isInquiryOpen, setIsInquiryOpen] = useState(false);
  const [inquiryText, setInquiryText] = useState("");

  // ────────────────────────────────────────────────────────
  // [핸들러]
  // ────────────────────────────────────────────────────────

  // 프로필 사진 업로드 — 사용자가 갤러리에서 고른 파일을
  // FileReader 로 base64 데이터 URL 로 바꿔 미리보기에 사용.
  function handleProfileImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProfileImagePreview(reader.result);
    reader.readAsDataURL(file);
  }

  // 아이디 "변경" 버튼 — 수정 모드 진입.
  // 현재 아이디를 input 초기값으로 복사해 사용자가 바로 편집 가능.
  function handleStartEditUserId() {
    setEditedUserId(userId);
    setIsEditingUserId(true);
  }

  // 아이디 "저장" 버튼 — 빈 값 검증 후 실제 표시값(userId) 갱신.
  // ⚠ 실제 30일 제한은 서버에서 마지막 변경일 기준으로 검증 필요.
  function handleSaveUserId() {
    const next = editedUserId.trim();
    if (!next) {
      alert("아이디를 입력해주세요");
      return;
    }
    setUserId(next);
    setIsEditingUserId(false);
  }

  // 아이디 "취소" 버튼 — 임시 버퍼 비우고 수정 모드 종료.
  function handleCancelEditUserId() {
    setEditedUserId("");
    setIsEditingUserId(false);
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
  function handleSubmitInquiry() {
    const text = inquiryText.trim();
    if (!text) {
      alert("쪽지 내용을 입력해주세요");
      return;
    }
    // MVP: 실제 전송 미연결 — 추후 관리자 inbox API 연동 필요.
    alert("쪽지를 보냈습니다. 관리자가 확인 후 답변드릴게요.");
    handleCloseInquiry();
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
          <strong>{HEADER_POINT.toLocaleString()}</strong>
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
              src={profileImagePreview || DEFAULT_PROFILE_IMAGE}
              alt="프로필"
              className="profile-image"
            />
            <input
              type="file"
              accept="image/*"
              onChange={handleProfileImageChange}
              hidden
            />
          </label>
          <div className="profile-info">
            <p className="profile-info-name">{userId}</p>
            <p className="profile-info-hint">
              프로필 사진은 랭킹 화면에 표시됩니다
            </p>
          </div>
        </div>

        {/* 아이디 영역 — 수정 모드에 따라 표시가 갈림 */}
        {isEditingUserId ? (
          <div className="profile-id-edit">
            <input
              type="text"
              value={editedUserId}
              onChange={(e) => setEditedUserId(e.target.value)}
              placeholder="새 아이디"
              maxLength={20}
            />
            <div className="profile-id-edit-buttons">
              <button type="button" onClick={handleCancelEditUserId}>
                취소
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={handleSaveUserId}
              >
                저장
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-id-row">
            <span className="profile-id-row-label">아이디</span>
            <span className="profile-id-row-value">{userId}</span>
            <button
              type="button"
              className="profile-id-row-button"
              onClick={handleStartEditUserId}
            >
              변경
            </button>
          </div>
        )}

        <p className="settings-helper-text">
          아이디는 30일에 한 번만 변경할 수 있어요
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
          onClick={() => handleMockRowClick("로그아웃")}
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
              <button type="button" onClick={handleCloseInquiry}>
                취소
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={handleSubmitInquiry}
              >
                보내기
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
