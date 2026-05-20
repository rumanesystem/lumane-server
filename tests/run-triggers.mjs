#!/usr/bin/env node
/* ============================================================
   트리거 시나리오 회귀 방지 — 단순 검증 스크립트
   사용: node tests/run-triggers.mjs [--only=ID]
   ⚠️ js/ui.js updateQuickFromText 트리거 정규식을 그대로 복사한 것 (drift 위험).
      ui.js 트리거 정규식 수정 시 이 파일도 같이 수정해야 의미 있음.
============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const FIXTURES   = path.join(__dirname, 'triggers-fixtures.md');

/* ── ui.js updateQuickFromText 와 동일한 순서로 매칭 (if-else 단락 모사) ── */
function detectTrigger(text) {
  /* isQuote 최상단 */
  if (/\[설치\s*공간\]/.test(text) && /\[금액\]/.test(text)) return 'quote';

  /* 시공 사례 */
  if (/(비슷한.*사례|시공.*사례|참고.*사례|이런.*경우)/.test(text)) return 'carousel';

  /* 도면·예시 */
  if (/(도면|예시\s*이미지|구성\s*예시|예시).*(보여\s*드릴|보여\s*줄|보여\s*드릴까|보여\s*드려|볼래|보실래|보시겠|드릴까요|원하시|받아\s*보|보내\s*드릴까)/.test(text)) return 'example';

  /* ①②③ */
  const circled = '①②③④⑤⑥⑦⑧⑨⑩';
  const choiceLines = text.split('\n').filter(l => l.trim() && circled.includes(l.trim()[0]));
  if (choiceLines.length >= 2) {
    const _shapeKW = /(한쪽\s*벽|한\s*벽|코너|두\s*벽|세\s*벽|세벽|마주|두\s*줄|양면|일\s*자|1\s*자|ㄱ\s*자|ㄷ\s*자|11\s*자|ㅁ\s*자)/;
    const _shapeChoiceHits = choiceLines.filter(l => _shapeKW.test(l)).length;
    if (_shapeChoiceHits >= 2) return 'shape';
    return 'circled';
  }

  /* 천장 (질문형) */
  if (/(천장\s*높이는?\s*[?？]|천장\s*높이.*(어떻게|얼마|되세요|되나요|알려|몇\s*(mm|cm|미터))|천장.*몇\s*(mm|cm|미터)\s*(\?|예요|인가요|되)|층고.*(어떻게|얼마|몇|되))/.test(text)) return 'ceiling';

  /* 설치지역 */
  if (/(설치\s*지역|어느\s*지역|지역.*어디|배송.*지역|어디.*거주|어디.*사세요)/.test(text)) return 'region';

  /* 형태 */
  const shapeHits = (text.match(/(일자형|1자형|ㄱ자형|ㄷ자형|11자형|ㅁ자형)/g) || []).length;
  if ((shapeHits >= 2 && /[?？]|인지|계세요|일까요|하세요|신가요|어떠세요|생각/.test(text)) ||
      /(드레스룸\s*형태|형태.*어떻게|어떤\s*형태|형태.*선택|어느\s*형태|형태로\s*생각|형태.*인지|형태.*계세요|어떤\s*형태로)/.test(text)) return 'shape';

  /* 설치 공간 */
  if (/(어느\s*공간|어떤\s*공간|공간에\s*설치|설치할\s*공간|설치하실\s*공간|어디에\s*설치)/.test(text)) return 'space';

  /* 커튼박스 */
  if (/(커튼박스|커튼\s*박스)/.test(text)) return 'curtain';

  /* 치수 */
  if (/(각\s*면\s*치수|각\s*면.*길이|면\s*길이|치수.*알려|치수.*어떻게|치수.*되|치수.*되세요|면.*치수|가로.*세로.*높이|벽\s*길이|길이.*어떻게|길이.*되세요|길이가?\s*얼마)/.test(text)) return 'dimension';

  /* 예산 */
  if (/(예산.*얼마|예산.*어느|얼마.*생각|얼마.*예산|얼마쯤|얼마 정도|희망 금액|희망금액|얼마.*까지)/.test(text)) return 'budget';

  /* 색상 좁힘 */
  const COLOR_TOKENS = ['솔리드화이트','화이트오크','샴페인골드','다크월넛','스톤그레이','진그레이','민트그린','메이플','블랙','실버','화이트'];
  let cScan = text, cPicked = [];
  for (const c of COLOR_TOKENS) {
    if (cScan.includes(c)) { cPicked.push(c); cScan = cScan.split(c).join(' '); }
  }
  if (cPicked.length >= 2 && /[?？]|어떤|좋으세요|중에|느낌|골라|선택|어울/.test(text)) return 'colorNarrow';

  /* 선반 색상 */
  if (/(선반\s*색상.*어떻게|선반\s*색상.*알려|선반\s*색상.*선택|선반\s*색상.*원하|어떤\s*선반\s*색상|선반\s*색상은)/.test(text)) return 'colorShelf';

  /* 프레임 색상 */
  if (/(프레임\s*색상.*어떻게|프레임\s*색상.*알려|프레임\s*색상.*선택|어떤\s*프레임\s*색|프레임\s*색상은)/.test(text)) return 'colorFrame';

  /* 색상 전반 */
  if (/(색상.*골라|색상.*선택|어떤\s*색|원하시는\s*색|색상은|색상\s*어떻게|선반이랑\s*프레임)/.test(text)) return 'colorGeneral';

  /* 옵션 (강건화) */
  const optHits = (text.match(/(거울장|디바이더|서랍장|바지걸이|이불장|화장대|아일랜드장)/g) || []).length;
  if (/옵션/.test(text) && /[?？]|있으세요|있을까|있나|원하|어떠세요|생각|필요|추가|넣을|넣고/.test(text)
      || (optHits >= 2 && /[?？]|있으세요|있을까|있나|생각|어떠세요|필요|추가/.test(text))
      || /(옵션.*추가|어떤\s*옵션|옵션.*뭐|옵션.*선택|옵션.*원하|원하시는?\s*옵션|옵션\s*있|옵션이?\s*있으세요|옵션.*궁금|옵션은\?|구성.*원하|뭐\s*넣|추가.*원하시는)/.test(text)) return 'option';

  /* 선반 단수 */
  if (/(선반.*몇\s*단|선반.*단수|몇\s*단으로|단수.*어떻게|단수.*선택|몇단)/.test(text)) return 'shelfCount';

  /* 동의 */
  if (/(개인정보\s*수집|동의해\s*주시겠어요)/.test(text)) return 'consent';

  /* 접수 확인 */
  if (/(맞으신가요|확인해\s*주시면\s*접수)/.test(text)) return 'confirmReceive';

  return 'none';
}

/* ── 픽스처 파싱 ── */
const VALID_IDS = new Set(['quote','carousel','example','circled','ceiling','region','shape','space','curtain','dimension','budget','colorNarrow','colorShelf','colorFrame','colorGeneral','option','shelfCount','consent','confirmReceive','none']);

function parseFixtures(md) {
  const cases = [];
  /* ``` 또는 ```lang 양쪽 허용 */
  const codeBlock = /```[^\n]*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = codeBlock.exec(md)) !== null) {
    const block = m[1];
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split('|').map(s => s.trim());
      if (parts.length < 2) continue;
      const expected = parts[0];
      /* 트리거 ID 화이트리스트 외 라인은 픽스처가 아님 (테이블·예시 등 무시) */
      if (!VALID_IDS.has(expected)) continue;
      let utter = parts[1];
      utter = utter.replace(/\\n/g, '\n');  /* \n → 실제 개행 */
      const note = parts[2] || '';
      cases.push({ expected, utter, note });
    }
  }
  return cases;
}

/* ── 실행 ── */
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
const md = fs.readFileSync(FIXTURES, 'utf8');
const cases = parseFixtures(md).filter(c => !only || c.expected === only);

let pass = 0, fail = 0;
const failures = [];
for (const { expected, utter, note } of cases) {
  const got = detectTrigger(utter);
  if (got === expected) pass++;
  else { fail++; failures.push({ expected, got, utter: utter.replace(/\n/g, ' ⏎ '), note }); }
}

console.log(`\n트리거 회귀 테스트: ${pass} ✅  /  ${fail} ❌  (총 ${cases.length})`);
if (fail > 0) {
  console.log('\n❌ 실패 케이스:');
  for (const f of failures) {
    console.log(`  expected=${f.expected.padEnd(15)} got=${f.got.padEnd(15)} | ${f.utter}${f.note ? '   // ' + f.note : ''}`);
  }
  process.exit(1);
}
process.exit(0);