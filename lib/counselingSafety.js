// Narrow deterministic route for explicit interpersonal violence reports.
// Never interprets the user's chart or attributes responsibility to a victim.
const REPORT = /(?:화가\s*나면|화나면|화가\s*나서).{0,20}물건.{0,8}던|(?:동거|남편|아내|애인|상대).{0,35}물건.{0,8}던|문.{0,12}막.{0,15}(?:나가|못|출입)/u;
const FICTION = /(?:영화|소설|게임|시나리오|연기|대본).{0,20}(?:장면|속|설정|캐릭터)/u;
export function buildCounselingSafetyReply({ userMessage = '', history = [] } = {}) {
  const current = String(userMessage);
  const recent = history.filter(x => x.role === 'user').slice(-6).map(x => String(x.text || ''));
  if (!REPORT.test(current) && /(?:이제|지금은).{0,15}안전.{0,30}(?:다른|사주|원국|주제)/u.test(current)) return null;
  const reports = [...recent, current];
  if (!reports.some(t => REPORT.test(t) && !FICTION.test(t))) return null;
  const boundary = '물건을 던지거나 나가지 못하게 막는 행동은 위협이며, 당신의 사주나 성격 탓이 아닙니다. 그 행동의 책임은 행동한 사람에게 있습니다.';
  const urgent = '즉시 위험하거나 나가지 못하게 막으면 한국에서는 112에 도움을 요청하세요. 짐을 챙기거나 기록을 남기려고 위험한 곳에 머물지 마세요.';
  if (/친구\s*집.{0,15}(?:갈|가|있)|챙겨|짧게\s*정리/u.test(current)) return `오늘은 안전하게 친구 집 등 도움을 받을 수 있는 곳으로 이동하는 것이 먼저입니다.\n\n1. 연락 가능한 사람에게 상황과 이동 계획을 알리세요.\n2. 안전하게 챙길 수 있을 때만 휴대전화·신분증·열쇠·필요한 약을 챙기세요.\n3. 혼자 돌아가 대면 설득하지 말고 안전한 곳에서 도움을 받으세요.\n\n${urgent}`;
  if (/설득|차분히|돌아오면/u.test(current)) return `이미 물건 투척이나 출입 방해가 있었다면, 혼자 설득해서 안전해질 것이라고 기대하며 기다리기보다 안전한 거리와 도움을 확보하는 것이 먼저입니다. 연락 가능한 친구나 믿을 수 있는 사람에게 상황을 알리고, 안전하게 이동할 수 있다면 도움을 받을 수 있는 곳으로 가세요.\n\n${urgent}`;
  if (/밖에\s*있/u.test(current) && /친구.{0,12}연락할\s*수\s*있/u.test(current)) return `상대가 밖에 있고 친구에게 연락할 수 있다고 했으니, 지금 친구에게 상황을 알리고 안전한 장소로 이동할 도움을 요청하세요. 혼자 대면해서 해결하려고 기다릴 필요는 없습니다. ${boundary}\n\n${urgent}`;
  return `${boundary}\n\n지금 같은 공간에 있거나 다시 위협할 가능성이 있다면 혼자 설득하거나 맞서기보다 안전한 거리와 연락 수단을 확보하세요. 믿을 수 있는 사람에게 상황을 알리고, 안전하게 이동할 수 있다면 도움을 받을 수 있는 곳으로 가세요. ${urgent}\n\n지금 안전한 곳에 있고, 원하면 나가거나 도움을 요청할 수 있나요?`;
}
