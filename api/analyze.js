export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const SUBJECTS = { korean: '국어', math: '수학', english: '영어' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'API 키가 설정되지 않았어요.' });

  const { image, mimeType, subject, types } = req.body || {};
  if (!image || typeof image !== 'string' || image.length > 3_500_000) {
    return res.status(400).json({ error: '사진이 없거나 너무 커요. 다시 올려 주세요.' });
  }
  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ? mimeType : 'image/jpeg';
  const subj = SUBJECTS[subject] || '국어';
  const typeText = Array.isArray(types) && types.length ? types.slice(0, 6).map(String).join(', ') : '지정 안 함';

  const PROMPT = `너는 한국에서 자란 이주배경(다문화) 청소년의 ${subj} 공부를 도와주는 1:1 멘토 AI야.
학생이 푼 문제지·답안 사진이 첨부되어 있어. 학생이 고른 문제 유형: ${typeText}.

[규칙]
- 사진에서 실제로 보이는 내용만 근거로 분석해. 보이지 않는 문제 번호, 점수, 풀이 시간은 절대 지어내지 마.
- 정답지가 없으면 정답을 단정하지 말고, 표시된 오답(X, 빗금), 지운 흔적, 풀이 과정의 실수 가능성을 근거로 "~일 수 있어"처럼 말해.
- 사진이 흐리거나, 문제지·답안이 아니거나, 글씨를 읽을 수 없으면 ok를 false로 하고 reason에 이유를 쉬운 말로 써.
- 쉬운 한국어, 짧은 문장, 반말(~야, ~해). 어려운 낱말은 풀어서 써. 격려하는 말투로.
- 학생의 국적이나 배경을 짐작하지 마.

[출력] 아래 JSON만 출력해.
{
 "ok": true 또는 false,
 "reason": "ok가 false일 때만",
 "summary": "총평 2~3문장",
 "problems": [ { "qnum": "문제 번호 또는 '풀이 중'(번호를 모르면)", "type": "실수 종류(예: 계산 실수, 선지 함정, 낱말 뜻)", "title": "한 줄 제목", "desc": "왜 틀렸을 가능성이 큰지 설명", "tip": "고치는 방법" } ],
 "prescriptions": [ { "title": "연습 이름", "desc": "하루 10분 안에 할 수 있는 방법" } ]
}
problems는 1~4개, prescriptions는 정확히 3개.`;

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: image } }] }],
    generationConfig: { maxOutputTokens: 2500, temperature: 0.4, responseMimeType: 'application/json' },
  });

  const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'];
  try {
    let response;
    for (const model of MODELS) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(40000) }
        );
      } catch (e) {
        console.log('analyze attempt', model, 'timeout/error');
        continue;
      }
      console.log('analyze attempt', model, response.status);
      if (![404, 429, 500, 503].includes(response.status)) break;
    }
    if (!response) throw new Error('no response');
    if (!response.ok) {
      console.log('Gemini error', response.status, (await response.text()).slice(0, 300));
      throw new Error('upstream');
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    let out;
    try { out = JSON.parse(text.replace(/^```json\s*|```$/g, '').trim()); } catch (e) { throw new Error('parse'); }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: '지금은 분석하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
}
