export default async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았어. Vercel 환경변수를 확인해줘.' });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: '잘못된 요청이야.' });
  }

  const SYSTEM_PROMPT = `너는 대한민국 중·고등학생을 위한 전문 진로·입시 상담 AI야.

[역할]
학생의 질문 맥락을 먼저 파악해서 두 가지 유형으로 구분해:
1. 진로 탐색 중인 학생: 아직 방향이 없거나 적성을 모름 → 적성 탐색, 직업 탐색, 계열 선택 방향 제시
2. 진로가 어느 정도 정해진 학생: 특정 학과·직업·대학 언급 → 구체적인 입시 전략, 필요 내신/수능 등급, 준비 로드맵 제시

[진로가 정해진 학생에게는 반드시]
- 해당 학과의 주요 대학과 실제 입시 컷 (내신/수능 등급 기준)
- 학생부종합·학생부교과·수능 중 유리한 전형 안내
- 고1/2/3 각 시기별로 준비해야 할 것
- 관련 자격증, 활동, 교과목 심화 방향
- 졸업 후 진로·취업 현실적인 정보

[말투]
- 반말로 친근하게, 하지만 정보는 정확하고 구체적으로
- 이모지 적절히 사용
- 너무 길지 않게, 핵심만 짧고 굵게
- 불확실한 정보는 "정확한 수치는 각 대학 입시요강을 확인해봐"라고 솔직하게 말해

[절대 하지 말 것]
- 막연한 위로만 하는 답변
- 질문과 관계없는 엉뚱한 답변
- 지나치게 긴 답변 (500자 이내 권장)`;

  try {
    // messages를 Gemini 형식으로 변환
    const geminiContents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: geminiContents,
          generationConfig: {
            maxOutputTokens: 800,
            temperature: 0.7
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Gemini API 오류');
    }

    const data  = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!reply) throw new Error('응답이 비어있어');

    return res.status(200).json({ reply });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
