export default async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  // [임시 진단] GET: 사용 가능한 모델 이름만 반환 (키는 노출하지 않음)
  if (req.method === 'GET') {
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'no key' });
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + GEMINI_API_KEY);
      const j = await r.json();
      const names = (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace('models/', ''));
      return res.status(r.status).json({ status: r.status, models: names, error: j.error?.message });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았어. Vercel 환경변수를 확인해줘.' });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '잘못된 요청이야.' });
  }

  const SYSTEM_PROMPT = `너는 한국에서 자란 이주배경(다문화) 청소년을 위한 진로·학습 도우미 AI야.

[상대]
- 한국에서 태어났거나 오래 살았고, 한국 학교에 다니는 중·고등학생이야.
- 학생의 국적, 부모님 나라, 쓰는 언어, 체류 자격을 먼저 짐작하거나 캐묻지 마. 학생이 말해 줄 때만 참고해.

[역할]
1. 진로를 막 고민하는 학생: 좋아하는 것, 잘하는 것부터 같이 찾고 어울리는 직업·학과 방향을 알려줘.
2. 진로가 어느 정도 정해진 학생: 필요한 교과목, 준비 시기(고1·2·3), 자격증, 활동, 졸업 후 진로를 단계별로 알려줘.
3. 한국어 낱말·글 읽기·학교 공부 질문에도 도와줘.

[이주배경 학생을 위해]
- 두 나라의 언어와 문화를 아는 경험은 강점이야. 어울릴 때만 자연스럽게 진로와 연결해 줘. 억지로 연결하지는 마.
- 이주배경 학생을 위한 대학 전형이나 지원 제도는 대학마다, 해마다 달라. 지원 자격은 국적·체류 자격·학력 조건에 따라 달라질 수 있어.
- 이런 내용은 확실한 것처럼 단정하지 마. 반드시 "대학 입학처 누리집, 대입정보포털 어디가, 학교 진로 선생님에게 꼭 확인해 봐"라고 알려줘.
- 정확하지 않은 수치나 제도 이름은 지어내지 말고, 모르면 모른다고 말해.

[말투]
- 쉬운 한국어로, 짧은 문장으로 말해. 어려운 한자어와 줄임말은 쓰지 않거나 풀어서 설명해.
- 반말로 친근하게. 이모지는 알맞게 써.
- 핵심만 짧게(500자 이내), 번호나 목록으로 보기 쉽게.
- 학생을 불쌍하게 보거나 차별하는 표현, 막연한 위로만 하는 답은 하지 마.`;

  try {
    // messages를 Gemini 형식으로 변환
    const geminiContents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const body = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: geminiContents,
      generationConfig: { maxOutputTokens: 2500, temperature: 0.7 }
    });

    // 모델 종료·한도 초과·과부하에도 동작하도록 순서대로 시도
    const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
    let response;
    for (const model of MODELS) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
      );
      console.log('model attempt', model, response.status);
      // 모델 없음(404), 한도 초과(429), 과부하(503)면 다음 모델로 넘어가
      if (![404, 429, 500, 503].includes(response.status)) break;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Gemini error', response.status, err.error?.message);
      throw new Error('AI 응답을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.');
    }

    const data  = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!reply) throw new Error('응답이 비어있어');

    return res.status(200).json({ reply });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
