/**
 * Vertex AI REST クライアント（テキスト生成・画像生成）。
 * kaifukuhonpo-syllabus/scripts/fetch-news.mjs のパターン（依存パッケージなし・
 * location==='global' 時のホスト切替・role 必須・responseSchema 構造化出力）を踏襲。
 *
 * 認証: GEMINI_ACCESS_TOKEN 環境変数に OAuth アクセストークンを渡す
 *   (CI は WIF、ローカルは `gcloud auth print-access-token` で取得。API キーは使わない)
 */

const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-lite-image'; // Nano Banana 2 Lite。locations/global のみ対応
const DEFAULT_LOCATION = 'global';
const MAX_RETRY = 3;
const INITIAL_DELAY_MS = 10000;

function endpoint(project, location, model) {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function requireToken() {
  const token = process.env.GEMINI_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'GEMINI_ACCESS_TOKEN が未設定です。`gcloud auth print-access-token --account=hy.unimail.11@gmail.com` の出力を渡してください。',
    );
  }
  return token;
}

function requireProject() {
  const project = process.env.GCP_PROJECT || 'ai-notebot-yh';
  return project;
}

async function callGenerateContent(url, token, body) {
  let delay = INITIAL_DELAY_MS;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();

    const text = await res.text();
    if (res.status === 429 || res.status === 503) {
      lastErr = new Error(`Vertex AI エラー: HTTP ${res.status} ${text.slice(0, 300)}`);
      if (attempt < MAX_RETRY) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
    } else {
      throw new Error(`Vertex AI エラー: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
  }
  throw lastErr;
}

/**
 * テキスト生成。responseSchema を渡すと構造化 JSON 出力を強制できる。
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {object} [opts.responseSchema]
 * @param {number} [opts.temperature]
 * @param {string} [opts.model]
 * @returns {Promise<string>} 生成テキスト（responseSchema 指定時は JSON 文字列）
 */
export async function generateText({ prompt, responseSchema, temperature = 0.3, model }) {
  const token = requireToken();
  const project = requireProject();
  const usedModel = model || process.env.GEMINI_MODEL || DEFAULT_TEXT_MODEL;
  const url = endpoint(project, DEFAULT_LOCATION, usedModel);

  const generationConfig = { temperature };
  if (responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseSchema;
  }

  const data = await callGenerateContent(url, token, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  });

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('');
  if (!text) throw new Error(`Vertex AI の応答形式が想定外です: ${JSON.stringify(data).slice(0, 300)}`);
  return text;
}

/**
 * Google 検索によるグラウンディング付きテキスト生成（介護版記事の出典収集専用）。
 * responseSchema による構造化出力とは併用できない（Vertex AI公式ドキュメントで確認済み:
 * "Search Grounding can't be used with JSON/YAML/XML mode"）ため、responseSchema は受け付けない。
 * 構造化が必要な記事本文の生成は、この関数で収集した検証済み出典だけを材料に
 * generateText（グラウンディングなし）で別途行う（2段階設計。docs/adr/ 参照）。
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model]
 * @param {number} [opts.temperature] 公式推奨値は1.0（グラウンディング利用時の最適値）
 * @returns {Promise<{
 *   text: string,
 *   groundingChunks: Array<{web?: {uri: string, title: string}}>,
 *   webSearchQueries: string[],
 *   searchEntryPointHtml: string | null,
 * }>}
 */
export async function generateGroundedText({ prompt, model, temperature = 1.0 }) {
  const token = requireToken();
  const project = requireProject();
  const usedModel = model || process.env.GEMINI_MODEL || DEFAULT_TEXT_MODEL;
  const url = endpoint(project, DEFAULT_LOCATION, usedModel);

  const data = await callGenerateContent(url, token, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature },
  });

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join('');
  if (!text) throw new Error(`Vertex AI の応答形式が想定外です: ${JSON.stringify(data).slice(0, 300)}`);

  const metadata = candidate.groundingMetadata ?? {};
  return {
    text,
    groundingChunks: metadata.groundingChunks ?? [],
    webSearchQueries: metadata.webSearchQueries ?? [],
    searchEntryPointHtml: metadata.searchEntryPoint?.renderedContent ?? null,
  };
}

/**
 * 画像生成。gemini-3.1-flash-lite-image は locations/global のみ対応。
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {'1:1'|'16:9'|'9:16'|'3:4'|'4:3'} [opts.aspectRatio]
 * @param {string} [opts.model]
 * @returns {Promise<{bytes: Buffer, mimeType: string}>}
 */
export async function generateImage({ prompt, aspectRatio = '16:9', model }) {
  const token = requireToken();
  const project = requireProject();
  const usedModel = model || process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const url = endpoint(project, DEFAULT_LOCATION, usedModel);

  const data = await callGenerateContent(url, token, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio },
    },
  });

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) throw new Error(`画像データが返されませんでした（ポリシー違反の可能性）: ${JSON.stringify(data).slice(0, 300)}`);

  return {
    bytes: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType || 'image/jpeg',
  };
}
