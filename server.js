const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || "dashscope").toLowerCase();
const API_URL =
  process.env.IMAGE_API_URL || "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "qwen-image-2.0-pro";
const IMAGE_SIZE = process.env.IMAGE_SIZE || "1028*720";
const CHAT_API_URL =
  process.env.CHAT_API_URL || "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";
const CHAT_MODEL = process.env.CHAT_MODEL || "qwen-plus";
const ROOT = __dirname;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

let apiKey =
  process.env.IMAGE_API_KEY ||
  "sk-ws-H.RELYRYP.GUBY.MEUCIBkVhIt5NMFyFFYtsRc25-R6cCr5ocy23nupHc4EVPDDAiEA0-W3gfoPCGmJucgeOeFa-H-sTJnfvOIh39XkgFE_lWw";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  response.end(JSON.stringify(payload));
}

function sendCorsPreflight(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  });
  response.end();
}

function getBranchMeaning(branch) {
  const meanings = {
    tiger: "tiger eye branch: guardianship, gaze, strength, spirit, dignity",
    landscape: "landscape branch: homeland, river, mist, distant mountains, flowing time",
    flower: "flower and leaf branch: growth, family affection, blessing, reunion, continuity",
  };

  return meanings[branch] || meanings.tiger;
}

function buildInterpretation(input) {
  const sentence = String(input.sentence || "").trim();
  const branchLabel = String(input.branchLabel || "Xiang embroidery").trim();
  const color = String(input.color || "moon white").trim();
  const mood = String(input.mood || "inheritance").trim();

  return `Your sentence "${sentence}" has been translated into a ${branchLabel} embroidery pattern, using ${color} as the leading thread color and ${mood} as the emotional tone.`;
}

function buildPrompt(input) {
  const sentence = String(input.sentence || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const branch = String(input.branch || "tiger");
  const branchLabel = String(input.branchLabel || "Xiang embroidery").slice(0, 30);
  const color = String(input.color || "moon white").slice(0, 30);
  const mood = String(input.mood || "inheritance").slice(0, 30);
  const branchMeaning = getBranchMeaning(branch);

  return [
    "Create one original image: a refined Xiang embroidery artwork pattern inspired by Chinese intangible cultural heritage.",
    `User sentence: ${sentence}`,
    `Theme branch: ${branchLabel}. Cultural meaning: ${branchMeaning}.`,
    `Primary traditional Chinese thread color: ${color}. Emotional tone: ${mood}.`,
    "The image must look like a completed embroidered silk artwork, not a flat digital illustration.",
    "Use visible silk threads, dense needlework, raised embroidery texture, soft ivory silk fabric, and a subtle double-sided embroidery feeling.",
    "Keep the visual style consistent with a dark ink-wash museum exhibition space, warm gold dust, soft cinematic lighting, elegant fabric folds, restrained Chinese aesthetics, and poetic composition.",
    "No text, no watermark, no logo, no UI, no frame labels.",
  ].join("\n");
}

function buildArkResponsesRequest(prompt) {
  return {
    model: IMAGE_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Generate one image from this prompt.",
              "The response should contain an image result. Do not return only text.",
              prompt,
            ].join("\n\n"),
          },
        ],
      },
    ],
  };
}

function buildDashScopeMultimodalRequest(prompt) {
  return {
    model: IMAGE_MODEL,
    input: {
      messages: [
        {
          role: "user",
          content: [
            {
              text: prompt,
            },
          ],
        },
      ],
    },
    parameters: {
      negative_prompt:
        "low resolution, low quality, deformed body, deformed fingers, oversaturated colors, waxy skin, over-smoothed details, obvious AI artifacts, chaotic composition, blurry text, distorted text",
      prompt_extend: true,
      watermark: false,
      size: IMAGE_SIZE,
    },
  };
}

function buildOpenAIImageRequest(prompt) {
  return {
    model: IMAGE_MODEL,
    prompt,
    size: IMAGE_SIZE,
  };
}

function buildImageRequest(prompt) {
  if (
    IMAGE_PROVIDER === "dashscope" ||
    API_URL.includes("dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation")
  ) {
    return buildDashScopeMultimodalRequest(prompt);
  }

  if (IMAGE_PROVIDER === "ark" || API_URL.includes("ark.cn-beijing.volces.com/api/v3/responses")) {
    return buildArkResponsesRequest(prompt);
  }

  return buildOpenAIImageRequest(prompt);
}

function findImageUrl(value) {
  if (!value || typeof value !== "object") return "";

  if (typeof value.url === "string" && /^https?:\/\//.test(value.url)) return value.url;
  if (typeof value.image === "string" && (/^https?:\/\//.test(value.image) || value.image.startsWith("data:image/"))) {
    return value.image;
  }
  if (typeof value.image_url === "string") return value.image_url;
  if (typeof value.output_url === "string") return value.output_url;
  if (typeof value.b64_json === "string") return `data:image/png;base64,${value.b64_json}`;

  if (typeof value.data === "string" && value.type && String(value.type).toLowerCase().includes("image")) {
    return value.data.startsWith("data:image/") ? value.data : `data:image/png;base64,${value.data}`;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item);
      if (found) return found;
    }
    return "";
  }

  for (const key of Object.keys(value)) {
    const found = findImageUrl(value[key]);
    if (found) return found;
  }

  return "";
}

function getProviderError(payload) {
  return (
    payload?.error?.message ||
    payload?.error?.code ||
    payload?.message ||
    payload?.msg ||
    "Image API request failed."
  );
}

function getProviderErrorCode(status, message) {
  const normalized = String(message || "").toLowerCase();

  if (status === 401 || normalized.includes("api key") || normalized.includes("apikey") || normalized.includes("unauthorized")) {
    return "INVALID_API_KEY";
  }

  return "PROVIDER_ERROR";
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();

  try {
    return JSON.parse(raw);
  } catch {}

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function localGuideFallback(text, pageState = {}) {
  const input = String(text || "");
  const scene = String(pageState.scene || "");
  const has = (...words) => words.some((word) => input.includes(word));

  if (has("重新开始", "重来")) return { intent: "restart", value: "", reply: "好，我们从头再入绣一次。" };
  if (has("返回", "上一")) return { intent: "back", value: "", reply: "好，我带你回到上一处。" };
  if (has("生成图样", "生成", "出图", "画出来")) return { intent: "generate_pattern", value: "", reply: "我来把这句话化成新的湘绣图样。" };
  if (scene === "double-secret" && has("传承", "一句话", "留下")) {
    return { intent: "continue", value: "", reply: "好，我们把这一针交给你，留下传承的一句话。" };
  }
  if (has("封存", "保存", "完成", "结束", "最后")) return { intent: "save_inheritance", value: "", reply: "好，这句话会被封存为你的传承绣签。" };
  if (has("重说", "重写", "清空")) return { intent: "clear_inheritance", value: "", reply: "没关系，我们把这句话重新说一遍。" };
  if (has("开始", "进入")) return { intent: "start", value: "", reply: "好，我们开始。" };

  if (has("朱砂", "红", "火", "热烈")) return { intent: "select_color", value: "朱砂", reply: "那就选朱砂，让第一针带着火一样的温度。" };
  if (has("天青", "青色", "清远", "水")) return { intent: "select_color", value: "天青", reply: "那就选天青，让丝线像湘江水雾一样展开。" };
  if (has("赤金", "金色", "光", "暖")) return { intent: "select_color", value: "赤金", reply: "那就选赤金，让针脚里有一束温光。" };
  if (has("玄青", "黑", "深", "沉")) return { intent: "select_color", value: "玄青", reply: "那就选玄青，让画面更有力量和骨气。" };
  if (has("月白", "白", "月光", "温柔")) return { intent: "select_color", value: "月白", reply: "那就选月白，让这一针像月光一样落下。" };

  if (has("虎眼", "老虎", "力量", "守护")) return { intent: "select_needle", value: "虎眼", reply: "我们让第一针落在虎眼，先唤醒这幅绣的神。" };
  if (has("山水", "山", "河", "江")) return { intent: "select_needle", value: "山水", reply: "我们让第一针落在山水，让远山和水气慢慢成形。" };
  if (has("花叶", "花", "叶", "生长")) return { intent: "select_needle", value: "花叶", reply: "我们让第一针落在花叶，让生命从枝叶里展开。" };

  if (has("威严", "锋利", "强")) return { intent: "select_tiger_mood", value: "威严", reply: "威严不是凶猛，是守住重要之物的力量。" };
  if (has("安静", "静", "柔")) return { intent: "select_tiger_mood", value: "安静", reply: "那就让虎眼沉静下来，把光收进针脚里。" };
  if (has("守护", "保护")) return { intent: "select_tiger_mood", value: "守护", reply: "那就让虎眼成为守护的目光。" };

  if (has("清远")) return { intent: "select_landscape_mood", value: "清远", reply: "清远适合远山与晨雾，我们把山水推向更深处。" };
  if (has("宁静")) return { intent: "select_landscape_mood", value: "宁静", reply: "宁静适合水面与轻舟，让时间慢下来。" };
  if (has("辽阔", "开阔", "广阔")) return { intent: "select_landscape_mood", value: "辽阔", reply: "辽阔会让江河展开，让画面有远方。" };

  if (has("团圆")) return { intent: "select_flower_mood", value: "团圆", reply: "团圆让花叶互相回应，像人与人的牵挂。" };
  if (has("清雅")) return { intent: "select_flower_mood", value: "清雅", reply: "清雅适合留白，让花枝在安静里伸展。" };
  if (has("生长")) return { intent: "select_flower_mood", value: "生长", reply: "生长让枝叶向外舒展，也把祝福带出去。" };

  if (has("双面绣", "秘密")) {
    return { intent: "continue_secret", value: "", reply: "好，我们翻到绣面的背后，看见双面绣的秘密。" };
  }

  if (has("继续", "下一步")) {
    return { intent: "continue", value: "", reply: "好，我们继续往前，看见针脚背后的另一面。" };
  }

  return { intent: "no_action", value: "", reply: "我听见了。你可以继续说想选择的颜色、图案或感觉，我会帮你接住它。" };
}

function getGuideSystemPrompt() {
  return [
    "You are a warm Chinese Xiang embroidery guide inside an interactive web artwork.",
    "Understand the user's natural Chinese speech and return one strict JSON object only.",
    "Do not control the page directly. Choose one intent and one value from the allowed list.",
    "Allowed intents: start, continue, select_color, select_needle, select_tiger_mood, select_landscape_mood, select_flower_mood, continue_secret, generate_pattern, save_inheritance, clear_inheritance, back, restart, no_action.",
    "If the user says 双面绣 or 秘密 from a completed artwork page, use continue_secret.",
    "If pageState.scene is double-secret and the user says 传承, 一句话, or 留下, use continue, not save_inheritance.",
    "If pageState.scene is inheritance and the user says 完成, 结束, 最后, 保存, or 封存, use save_inheritance.",
    "Allowed values:",
    "select_color: 朱砂, 天青, 赤金, 玄青, 月白.",
    "select_needle: 虎眼, 山水, 花叶.",
    "select_tiger_mood: 威严, 安静, 守护.",
    "select_landscape_mood: 清远, 宁静, 辽阔.",
    "select_flower_mood: 生长, 团圆, 清雅.",
    "Reply should be short, poetic, and helpful, no more than 42 Chinese characters.",
    "JSON schema: {\"intent\":\"...\",\"value\":\"...\",\"reply\":\"...\"}",
  ].join("\n");
}

function buildGuidePrompt(text, pageState) {
  return [
    getGuideSystemPrompt(),
    "",
    "Current page state JSON:",
    JSON.stringify(pageState || {}),
    "",
    "User speech:",
    text,
    "",
    "Return only one JSON object. No markdown. No explanation.",
  ].join("\n");
}

function buildGuideChatRequest(text, pageState) {
  if (CHAT_API_URL.includes("/compatible-mode/")) {
    return {
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: getGuideSystemPrompt() },
        {
          role: "user",
          content: JSON.stringify({
            text,
            pageState: pageState || {},
          }),
        },
      ],
      temperature: 0.35,
    };
  }

  return {
    model: CHAT_MODEL,
    input: {
      messages: [
        {
          role: "system",
          content: getGuideSystemPrompt(),
        },
        {
          role: "user",
          content: [
            "Current page state JSON:",
            JSON.stringify(pageState || {}),
            "",
            "User speech:",
            text,
            "",
            "Return only one JSON object. No markdown. No explanation.",
          ].join("\n"),
        },
      ],
    },
    parameters: {
      result_format: "message",
      temperature: 0.35,
      max_tokens: 240,
    },
  };
}

function getGuideContent(payload) {
  return (
    payload?.choices?.[0]?.message?.content ||
    payload?.output?.text ||
    payload?.output?.choices?.[0]?.message?.content ||
    payload?.output?.choices?.[0]?.text ||
    ""
  );
}

async function guideChat(request, response) {
  let voiceText = "";

  try {
    const body = JSON.parse((await readBody(request)) || "{}");
    const text = String(body.text || "").trim();
    voiceText = text;

    if (!text) {
      sendJson(response, 400, { error: "Missing voice text." });
      return;
    }

    if (!apiKey) {
      sendJson(response, 200, { ...localGuideFallback(text, body.state || {}), source: "local" });
      return;
    }

    const pageState = body.state || {};
    const apiResponse = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildGuideChatRequest(text, pageState)),
    });

    const payload = await apiResponse.json().catch(() => ({}));

    if (!apiResponse.ok) {
      sendJson(response, 200, { ...localGuideFallback(text, pageState), source: "local", modelError: getProviderError(payload) });
      return;
    }

    const content = getGuideContent(payload);
    const fallback = localGuideFallback(text, pageState);
    const parsed = extractJsonObject(content) || fallback;

    sendJson(response, 200, {
      intent: parsed.intent || "no_action",
      value: parsed.value || "",
      reply: parsed.reply || fallback.reply,
      source: "model",
    });
  } catch (error) {
    sendJson(response, 200, { ...localGuideFallback(voiceText), source: "local", modelError: error.message });
  }
}

async function generateEmbroidery(request, response) {
  if (!apiKey) {
    sendJson(response, 500, {
      code: "MISSING_API_KEY",
      error: "Missing image API key. Please enter the DashScope API key in the web page.",
    });
    return;
  }

  try {
    const body = JSON.parse((await readBody(request)) || "{}");
    const sentence = String(body.sentence || "").replace(/\s+/g, " ").trim();

    if (!sentence) {
      sendJson(response, 400, { error: "Please enter one sentence first." });
      return;
    }

    const prompt = buildPrompt(body);
    const apiResponse = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildImageRequest(prompt)),
    });

    const payload = await apiResponse.json().catch(() => ({}));

    if (!apiResponse.ok) {
      const message = getProviderError(payload);
      sendJson(response, apiResponse.status, {
        code: getProviderErrorCode(apiResponse.status, message),
        error: message,
        provider: IMAGE_PROVIDER,
      });
      return;
    }

    const imageUrl = findImageUrl(payload);

    if (!imageUrl) {
      sendJson(response, 502, {
        error: "The provider returned no displayable image. Confirm that this Qwen Image model supports image generation through DashScope multimodal generation.",
        provider: IMAGE_PROVIDER,
        providerPayload: payload,
      });
      return;
    }

    sendJson(response, 200, {
      imageUrl,
      prompt,
      provider: IMAGE_PROVIDER,
      interpretation: buildInterpretation(body),
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || "Server generation failed.",
      provider: IMAGE_PROVIDER,
    });
  }
}

async function configureApiKey(request, response) {
  try {
    const body = JSON.parse((await readBody(request)) || "{}");
    const nextKey = String(body.apiKey || "").trim();

    if (!nextKey) {
      sendJson(response, 400, { error: "API key cannot be empty." });
      return;
    }

    apiKey = nextKey;
    sendJson(response, 200, { ok: true, hasKey: true, provider: IMAGE_PROVIDER });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Failed to save API key." });
  }
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const safePath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Access-Control-Allow-Origin": CORS_ORIGIN,
    });
    response.end(data);
  });
}

function handleRequest(request, response) {
  if (request.method === "OPTIONS") {
    sendCorsPreflight(response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/generate-embroidery") {
    generateEmbroidery(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/guide-chat") {
    guideChat(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/configure-key") {
    configureApiKey(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/api/status") {
    sendJson(response, 200, {
      ok: true,
      hasKey: Boolean(apiKey),
      provider: IMAGE_PROVIDER,
      apiUrl: API_URL,
      model: IMAGE_MODEL,
      chatApiUrl: CHAT_API_URL,
      chatModel: CHAT_MODEL,
      size: IMAGE_SIZE,
    });
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log(`Xiang embroidery web server: http://${HOST}:${PORT}/`);
    console.log(`Image provider: ${IMAGE_PROVIDER}`);
    console.log(`Image model: ${IMAGE_MODEL}`);
    console.log("Image API: POST /api/generate-embroidery");
  });
}

module.exports = handleRequest;
