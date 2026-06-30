/* flow — schema_json 을 "한 문항 = 한 스텝" 배열로 평탄화하고, presentation 오버레이를
 * 머지한다. 비-문항 온보딩 화면(welcome/interstitial/transition/compare/commitment/
 * loading/result)을 핸드오프 순서에 맞게 끼워 넣는다.
 *
 * 분기(show_if 등)는 원본 키를 그대로 들고 가고, 가시성은 branching.js 가 평가한다.
 */
import { PRESENTATION, STAGE } from "./presentation.js";

// 정신건강(C 전체) + 외로움/가족마찰/어릴적(E-2 그룹)은 차분(calm) 톤.
function toneFor(sectionId, qid, pres) {
  if (pres.tone) return pres.tone;
  if (sectionId === "C") return "calm";
  if (qid.startsWith("E-2")) return "calm";
  return "warm";
}

function mergeQuestion(q, section) {
  const pres = PRESENTATION[q.id] || {};

  let options = q.options;
  if (options && (pres.optionIcons || pres.optionDescs)) {
    options = options.map((o) => ({
      ...o,
      icon: pres.optionIcons?.[o.value] ?? o.icon,
      desc: pres.optionDescs?.[o.value] ?? o.desc,
    }));
  }

  let fields = pres.fields;
  if (!fields && q.fields) {
    fields = q.fields.map((f) => ({ id: f.id, label: f.label, def: f.def, unit: f.unit }));
  }

  return {
    ...q,
    kind: "question",
    section: section.id,
    stage: STAGE[section.id] || section.title,
    tone: toneFor(section.id, q.id, pres),
    options,
    fields,
    help: pres.help ?? q.help,
    placeholder: pres.placeholder ?? q.placeholder,
    def: pres.def,
    labels: pres.labels ?? q.labels,
    card: pres.card ?? false,
    sleepMascot: pres.sleepMascot ?? false,
    skipIfPrefilled: Boolean(q.skippable_if_prefilled),
  };
}

// 비-문항 온보딩 화면들(프론트 전용 — 스키마 밖). 이름은 인사 카피에 끼워 넣는다.
function screens(userName) {
  const nm = userName ? `${userName}님` : "당신";
  return {
    cheer: {
      kind: "interstitial", tone: "warm", mascot: "cheer", stage: STAGE.A,
      title: "좋아요, 첫 단계 끝!", body: "편하게 답해줘서 고마워요.\n이 속도면 금방이에요.", cta: "계속하기",
    },
    whyBody: {
      kind: "interstitial", tone: "warm", variant: "why", stage: STAGE.B, eyebrow: "다음 이야기",
      title: "몸과 마음은\n생각보다 가까이 있어요",
      body: `키·몸무게는 평가하려는 게 아니에요.\n${nm}에게 맞는 출발점을 찾으려는 거예요.`, cta: "알겠어요",
    },
    transition: {
      kind: "transition", tone: "calm", stage: STAGE.C,
      title: "잠깐, 마음에\n대해 물어볼게요",
      body: `정답도, 평가도 없어요.\n솔직하게 답해도 아무 일 없어요.\n이 답은 오직 ${nm}을 돕는 데만 쓰여요.`,
      note: "비공개 · 언제든 멈출 수 있어요", cta: "천천히 시작할게요",
    },
    love: {
      kind: "interstitial", tone: "warm", mascot: "love", stage: STAGE.C,
      title: "솔직하게 답해줘서\n정말 고마워요",
      body: "여기까지 온 것만으로 충분히 잘하고 있어요.\n이제 거의 다 왔어요.", cta: "계속하기",
    },
    whyLast: {
      kind: "interstitial", tone: "warm", variant: "why", stage: STAGE.F, eyebrow: "마지막 단계",
      title: `이제 마지막,\n${nm}에게 맞출 차례예요`,
      body: "두 가지만 더 물어볼게요.\n체다가 말투와 도와줄 방향을 정할 때 참고해요.", cta: "좋아요",
    },
    compare: {
      kind: "compare", tone: "warm",
      title: "체다와 함께면\n하루가 달라져요",
      subtitle: "작은 기록 하나가 좋은 습관으로 이어져요",
      before: { label: "지금", items: ["불규칙한 끼니", "늦게 자는 밤", "미루는 운동", "혼자 끙끙"] },
      after: { label: "체다와", items: ["규칙적인 리듬", "푹 자는 밤", "꾸준한 운동", "같이 챙기기"] },
      cta: "거의 다 왔어요",
    },
    commitment: {
      kind: "commitment", tone: "warm", stage: STAGE.F,
      title: "시작하기 전에,\n나와 약속 하나 할까요?",
      vows: ["나를 조금 더 챙겨볼래요", "큰 욕심 말고, 작은 것부터 해볼래요", "완벽하지 않아도 괜찮아요", "혼자 말고, 체다랑 같이 해볼래요"],
      placeholder: "여기에 손가락으로 싸인해보세요",
      note: "싸인은 어디에도 저장되지 않아요. 안심해요.", cta: "약속할게요",
    },
    loading: {
      kind: "loading", tone: "warm",
      title: `${nm}에게 맞는 환경을\n만드는 중...`,
      steps: ["응답을 살펴보고 있어요", "수면·식사 리듬을 맞춰요", "맞춤 첫 루틴을 골라요", "거의 다 됐어요"],
    },
    result: { kind: "result", tone: "warm", cta: "체다 시작하기" },
  };
}

export function buildFlow(schema, userName) {
  const S = screens(userName);
  const steps = [{ kind: "welcome" }];
  for (const section of schema?.sections || []) {
    if (section.id === "B") steps.push(S.whyBody);
    if (section.id === "C") steps.push(S.transition);
    if (section.id === "F") steps.push(S.whyLast);
    for (const q of section.questions || []) steps.push(mergeQuestion(q, section));
    if (section.id === "A") steps.push(S.cheer);
    if (section.id === "C") steps.push(S.love);
  }
  steps.push(S.compare, S.commitment, S.loading, S.result);
  return steps;
}
