/**
 * Image Generation Tool Handlers
 *
 * Provides replicate_image_generate and gemini_image_generate tools
 * for AI agents to generate/edit images via external APIs.
 */

import { aiLogger } from '../../utils/logger.js';
import { dbGet, dbRun, sqlNow } from '../../database/connection.js';
import { getSecret } from '../secrets/getSecret.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const UPLOAD_BASE = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';
const BASE_URL = process.env.BASE_URL || process.env.APP_URL || 'https://crm.hltrn.cc';

// ── Replicate ──────────────────────────────────────────────

const REPLICATE_MODELS = {
  'flux-kontext-pro': {
    id: 'black-forest-labs/flux-kontext-pro',
    title: 'FLUX Kontext Pro',
    type: 'edit',
    buildInput(prompt, imageUrl, refImages, numImages) {
      const input = { prompt, output_format: 'png', safety_tolerance: 2 };
      // text-to-image when no source image: omit input_image and pick a real
      // aspect ratio ('match_input_image' is invalid without one → 422).
      if (imageUrl) { input.input_image = imageUrl; input.aspect_ratio = 'match_input_image'; }
      else { input.aspect_ratio = '1:1'; }
      return input;
    }
  },
  'flux-kontext-max': {
    id: 'black-forest-labs/flux-kontext-max',
    title: 'FLUX Kontext Max',
    type: 'edit',
    buildInput(prompt, imageUrl, refImages) {
      const input = { prompt, output_format: 'png', safety_tolerance: 2 };
      if (imageUrl) { input.input_image = imageUrl; input.aspect_ratio = 'match_input_image'; }
      else { input.aspect_ratio = '1:1'; }
      return input;
    }
  },
  'seedream-4.5': {
    id: 'bytedance/seedream-4.5',
    title: 'Seedream 4.5',
    type: 'edit',
    buildInput(prompt, imageUrl, refImages, numImages) {
      const images = [];
      if (imageUrl) images.push(imageUrl);
      if (refImages) images.push(...refImages);
      const input = { prompt, aspect_ratio: imageUrl ? 'match_input_image' : '1:1', size: '2K', max_images: numImages || 1 };
      if (images.length) input.image_input = images;
      return input;
    }
  },
  'seedream-5-lite': {
    id: 'bytedance/seedream-5-lite',
    title: 'Seedream 5 Lite',
    type: 'edit',
    buildInput(prompt, imageUrl, refImages, numImages) {
      const images = [];
      if (imageUrl) images.push(imageUrl);
      if (refImages) images.push(...refImages);
      const input = { prompt, aspect_ratio: imageUrl ? 'match_input_image' : '1:1', size: '2K', max_images: numImages || 1, output_format: 'png' };
      if (images.length) input.image_input = images;
      return input;
    }
  },
  'nano-banana-pro': {
    id: 'google/nano-banana-pro',
    title: 'Nano Banana Pro',
    type: 'edit',
    buildInput(prompt, imageUrl, refImages) {
      const images = [];
      if (imageUrl) images.push(imageUrl);
      if (refImages) images.push(...refImages);
      const input = { prompt, aspect_ratio: imageUrl ? 'match_input_image' : '1:1' };
      if (images.length) input.image_input = images;
      return input;
    }
  },
  'flux-2-pro': {
    id: 'black-forest-labs/flux-2-pro',
    title: 'FLUX 2 Pro',
    type: 'edit',
    buildInput(prompt, imageUrl, refImages) {
      const input_images = [];
      if (imageUrl) input_images.push(imageUrl);
      if (refImages) input_images.push(...refImages);
      const input = { prompt, aspect_ratio: imageUrl ? 'match_input_image' : '1:1', output_format: 'png', safety_tolerance: 2 };
      if (input_images.length) input.input_images = input_images;
      return input;
    }
  },
  'ideogram-v3-balanced': {
    id: 'ideogram-ai/ideogram-v3-balanced',
    title: 'Ideogram v3',
    type: 'edit',
    buildInput(prompt, imageUrl, refImages) {
      const input = { prompt, aspect_ratio: '1:1', magic_prompt_option: 'Auto' };
      if (imageUrl) input.image = imageUrl;
      if (refImages && refImages.length > 0) input.style_reference_images = refImages;
      return input;
    }
  },
  'recraft-v4': {
    id: 'recraft-ai/recraft-v4',
    title: 'Recraft V4',
    type: 'generate',
    buildInput(prompt) {
      return { prompt };
    }
  },
};

const GEMINI_MODELS = {
  'gemini-2.0-flash': { url: 'gemini-2.0-flash-exp', title: 'Gemini 2.0 Flash' },
  'gemini-2.5-flash': { url: 'gemini-2.5-flash-preview-04-17', title: 'Gemini 2.5 Flash' },
  'gemini-2.5-pro': { url: 'gemini-2.5-pro-preview-05-06', title: 'Gemini 2.5 Pro' },
};

/**
 * Resolve API key — check agent config, operator, or env
 */
async function resolveApiKey(provider, context) {
  // 1. Check context for explicit key
  if (context?.apiKeys?.[provider]) return context.apiKeys[provider];

  // 2. Vault (ADR-0040 — was process.env.{REPLICATE,GEMINI,GOOGLE_AI}_API_KEY)
  if (provider === 'replicate') {
    const k = await getSecret('replicate_api_key', 'REPLICATE_API_KEY');
    if (k) return k;
  }
  if (provider === 'gemini') {
    const k = await getSecret('gemini_api_key', ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY']);
    if (k) return k;
  }

  // 3. Check AI API Keys table for keys tagged with provider
  try {
    const row = await dbGet(
      `SELECT data FROM table_rows WHERE table_id = (
        SELECT id FROM universal_tables WHERE name ILIKE '%API Key%' OR name ILIKE '%api_key%' LIMIT 1
      ) AND data->>'provider' = $1 AND (data->>'status' IS NULL OR data->>'status' = 'active') LIMIT 1`,
      [provider]
    );
    if (row?.data) {
      const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      if (parsed.api_key) return parsed.api_key;
    }
  } catch (e) {
    aiLogger.warn({ err: e }, `Failed to resolve ${provider} API key from DB`);
  }

  return null;
}

/**
 * Register a written-to-disk file in the `files` table so it survives the
 * ADR-0016 uploadsFileGuard. Without a row, fileGuard.lookupFileVisibility
 * returns null and every agent-generated asset 404s even though the bytes
 * exist on disk. Agent images/3D models are public by intent (set as avatars,
 * opened directly by URL, embedded externally) → visibility 'public'.
 */
async function registerGeneratedFile({ fileId, fileName, filePath, relativeUrl, size, mimeType, spaceId }) {
  const dbSpaceId = (spaceId && spaceId !== 'plugin') ? parseInt(spaceId, 10) : null;
  await dbRun(
    `INSERT INTO files (id, name, original_name, mime_type, size, path, url, storage_provider_id, space_id, uploaded_by, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, 'public', ${sqlNow()}, ${sqlNow()})`,
    [fileId, fileName, fileName, mimeType, size, filePath, relativeUrl, dbSpaceId, null]
  );
}

/**
 * Download image from URL and save to CRM uploads
 */
async function downloadAndSaveImage(imageUrl, spaceId) {
  const fileId = `file_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const fileName = `${fileId}.png`;
  const spaceDir = path.join(UPLOAD_BASE, 'spaces', String(spaceId || 'plugin'));

  // Ensure directory exists
  if (!fs.existsSync(spaceDir)) {
    fs.mkdirSync(spaceDir, { recursive: true });
  }

  const filePath = path.join(spaceDir, fileName);

  if (imageUrl.startsWith('data:')) {
    // Base64 data URI
    const base64 = imageUrl.split(',')[1];
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  } else {
    // HTTP URL
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
  }

  const stats = fs.statSync(filePath);
  const relativeUrl = `/uploads/spaces/${spaceId || 'plugin'}/${fileName}`;

  await registerGeneratedFile({
    fileId, fileName, filePath, relativeUrl, size: stats.size, mimeType: 'image/png', spaceId,
  });

  return {
    file_id: fileId,
    url: relativeUrl,
    full_url: `${BASE_URL}${relativeUrl}`,
    size: stats.size,
    mime_type: 'image/png',
  };
}

/**
 * Convert CRM file URL to accessible URL for external APIs
 */
function resolveImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  if (url.startsWith('http')) return url;
  // Relative CRM URL
  return `${BASE_URL}${url}`;
}

// T-138801: bounded polling — keep tool calls below the MCP client timeout.
// Replicate's "Prefer: wait" header already short-circuits fast cases (returns
// when ready, up to 60s), so we couple it with an in-tool poll capped at
// 25s. If the prediction is still running after that, the handler returns
// the prediction_id and the agent resumes via replicate_check_prediction.
const REPLICATE_BOUNDED_POLL_SECONDS = 25;
const REPLICATE_POLL_INTERVAL_MS = 1500;

async function pollReplicateBounded(apiKey, prediction, maxSeconds = REPLICATE_BOUNDED_POLL_SECONDS) {
  const pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;
  const deadline = Date.now() + Math.max(0, maxSeconds) * 1000;
  let current = prediction;
  while (Date.now() < deadline) {
    if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'canceled') {
      return current;
    }
    await new Promise(r => setTimeout(r, REPLICATE_POLL_INTERVAL_MS));
    const pollResponse = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResponse.ok) throw new Error(`Replicate poll error: ${pollResponse.status}`);
    current = await pollResponse.json();
  }
  return current; // may still be 'processing' / 'starting'
}

/**
 * Replicate: start an image prediction and poll briefly. Returns the latest
 * prediction object — caller decides whether to materialise outputs (when
 * succeeded) or hand back a prediction_id for asynchronous resume.
 */
async function startReplicateImagePrediction(apiKey, modelKey, prompt, imageUrl, refImages, numImages) {
  const model = REPLICATE_MODELS[modelKey];
  if (!model) {
    const available = Object.keys(REPLICATE_MODELS).join(', ');
    throw new Error(`Unknown model: ${modelKey}. Available: ${available}`);
  }

  const input = model.buildInput(prompt, imageUrl, refImages, numImages);
  const createUrl = `https://api.replicate.com/v1/models/${model.id}/predictions`;

  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait', // Replicate may stream the response back inside this call when fast
    },
    body: JSON.stringify({ input }),
  });

  if (!createResponse.ok) {
    const errData = await createResponse.json().catch(() => ({}));
    throw new Error(`Replicate error ${createResponse.status}: ${errData.detail || errData.title || JSON.stringify(errData)}`);
  }

  const initial = await createResponse.json();
  return pollReplicateBounded(apiKey, initial);
}

function extractOutputUrls(prediction) {
  const output = prediction.output;
  if (!output) throw new Error('No output from model');
  if (typeof output === 'string') return [output];
  if (Array.isArray(output)) return output.flat().filter(item => typeof item === 'string');
  if (output.url) return [output.url];
  throw new Error('Unexpected output format: ' + JSON.stringify(output).slice(0, 200));
}

/**
 * Gemini: generate image
 */
async function geminiGenerate(apiKey, modelKey, prompt, inputImages) {
  const model = GEMINI_MODELS[modelKey];
  if (!model) {
    const available = Object.keys(GEMINI_MODELS).join(', ');
    throw new Error(`Unknown Gemini model: ${modelKey}. Available: ${available}`);
  }

  // Build image parts
  const parts = [];
  if (inputImages && inputImages.length > 0) {
    for (const img of inputImages) {
      if (img.startsWith('data:')) {
        const [meta, data] = img.split(',');
        const mimeType = meta.match(/data:([^;]+)/)?.[1] || 'image/png';
        parts.push({ inlineData: { mimeType, data } });
      } else {
        // Fetch and convert to base64
        const response = await fetch(img);
        const buffer = Buffer.from(await response.arrayBuffer());
        parts.push({ inlineData: { mimeType: 'image/png', data: buffer.toString('base64') } });
      }
    }
  }
  parts.push({ text: prompt });

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model.url}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Gemini API Error: ${response.status} — ${errorData.error?.message || JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (candidate?.content?.parts) {
    const imagePart = candidate.content.parts.find(p => p.inlineData);
    if (imagePart?.inlineData) {
      const { mimeType, data: base64Data } = imagePart.inlineData;
      return `data:${mimeType};base64,${base64Data}`;
    }
  }
  const textPart = candidate?.content?.parts?.find(p => p.text);
  throw new Error(textPart ? `Model returned text only: ${textPart.text}` : 'No image returned from Gemini');
}

// ── Replicate 3D Models ─────────────────────────────────────

const REPLICATE_3D_MODELS = {
  'hunyuan3d-2': {
    id: 'tencent/hunyuan3d-2',
    version: 'b1b9449a1277e10402781c5d41eb30c0a0683504fb23fab591ca9dfc2aabe1cb',
    title: 'Hunyuan3D 2.0',
    outputFormat: 'glb',
    useVersionEndpoint: true,
    buildInput(imageUrl, opts = {}) {
      return {
        image: imageUrl,
        steps: opts.steps || 30,
        guidance_scale: opts.guidance_scale || 5.5,
        octree_resolution: opts.octree_resolution || 256,
        remove_background: opts.remove_background !== false,
        output_format: opts.output_format || 'glb',
      };
    }
  },
};

/**
 * Download 3D model file from URL and save to CRM uploads
 */
async function downloadAndSave3DModel(fileUrl, spaceId, format = 'glb') {
  const fileId = `file_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const fileName = `${fileId}.${format}`;
  const spaceDir = path.join(UPLOAD_BASE, 'spaces', String(spaceId || 'plugin'));

  if (!fs.existsSync(spaceDir)) {
    fs.mkdirSync(spaceDir, { recursive: true });
  }

  const filePath = path.join(spaceDir, fileName);
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Failed to download 3D model: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  const stats = fs.statSync(filePath);
  const relativeUrl = `/uploads/spaces/${spaceId || 'plugin'}/${fileName}`;
  const mimeType = format === 'glb' ? 'model/gltf-binary' : format === 'obj' ? 'model/obj' : 'application/octet-stream';

  await registerGeneratedFile({
    fileId, fileName, filePath, relativeUrl, size: stats.size, mimeType, spaceId,
  });

  return {
    file_id: fileId,
    url: relativeUrl,
    full_url: `${BASE_URL}${relativeUrl}`,
    size: stats.size,
    mime_type: mimeType,
    format,
  };
}

/**
 * Replicate 3D: create prediction and return immediately. Caller polls via
 * replicate_check_prediction tool. Sync polling caused MCP "Connection closed"
 * because 3D generations exceed the MCP client timeout (T-138801).
 */
async function replicate3DStart(apiKey, modelKey, imageUrl, opts = {}) {
  const model = REPLICATE_3D_MODELS[modelKey];
  if (!model) {
    const available = Object.keys(REPLICATE_3D_MODELS).join(', ');
    throw new Error(`Unknown 3D model: ${modelKey}. Available: ${available}`);
  }

  const input = model.buildInput(imageUrl, opts);

  // Some 3D models require version-based endpoint instead of model-based
  const createUrl = model.useVersionEndpoint
    ? 'https://api.replicate.com/v1/predictions'
    : `https://api.replicate.com/v1/models/${model.id}/predictions`;

  const body = model.useVersionEndpoint
    ? { version: model.version, input }
    : { input };

  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!createResponse.ok) {
    const errData = await createResponse.json().catch(() => ({}));
    throw new Error(`Replicate error ${createResponse.status}: ${errData.detail || errData.title || JSON.stringify(errData)}`);
  }

  return await createResponse.json();
}

/**
 * Single-shot Replicate prediction status fetch. Used by both
 * replicate_check_prediction and any future webhook fallback.
 */
async function replicateFetchPrediction(apiKey, predictionId) {
  const url = `https://api.replicate.com/v1/predictions/${predictionId}`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Replicate poll error ${response.status}: ${errData.detail || JSON.stringify(errData)}`);
  }
  return await response.json();
}

// ── Tool Handlers ──────────────────────────────────────────

export const imageToolHandlers = {

  /**
   * replicate_image_generate — Start an image prediction and either return
   * the final images (fast path, ≤25s wait) or hand back the prediction_id
   * for asynchronous resume via replicate_check_prediction (T-138801).
   */
  async replicate_image_generate(args, userId, context) {
    const { model, prompt, image_url, reference_urls, num_images, space_id } = args;

    if (!prompt) return { error: 'prompt is required' };
    if (!model) return { error: 'model is required. Available: ' + Object.keys(REPLICATE_MODELS).join(', ') };

    const apiKey = await resolveApiKey('replicate', context);
    if (!apiKey) return { error: 'No Replicate API key configured. Set REPLICATE_API_KEY env var or add to AI API Keys table.' };

    try {
      const resolvedImage = resolveImageUrl(image_url);
      const resolvedRefs = reference_urls?.map(resolveImageUrl).filter(Boolean) || null;

      aiLogger.info({ model, prompt: prompt.slice(0, 100), hasImage: !!resolvedImage }, 'Replicate image generation started');

      const prediction = await startReplicateImagePrediction(apiKey, model, prompt, resolvedImage, resolvedRefs, num_images || 1);

      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        return {
          success: false,
          model,
          status: prediction.status,
          prediction_id: prediction.id,
          error: prediction.error || `Prediction ${prediction.status}`,
        };
      }

      if (prediction.status !== 'succeeded') {
        // Still running after bounded wait — return id so the agent can poll.
        aiLogger.info({ model, prediction_id: prediction.id, status: prediction.status }, 'Image prediction pending — returning id for async resume');
        return {
          success: true,
          async: true,
          model,
          prediction_id: prediction.id,
          kind: 'image',
          status: prediction.status,
          space_id: space_id || 35,
          message: `Image prediction still ${prediction.status} after ${REPLICATE_BOUNDED_POLL_SECONDS}s. Poll with replicate_check_prediction({prediction_id, kind:'image', space_id:${space_id || 35}}).`,
        };
      }

      // Fast path — succeeded inside the bounded wait. Materialise to CRM.
      const outputUrls = extractOutputUrls(prediction);
      const savedFiles = [];
      for (const url of outputUrls) {
        const saved = await downloadAndSaveImage(url, space_id || 35);
        savedFiles.push(saved);
      }

      aiLogger.info({ model, count: savedFiles.length }, 'Replicate image generation completed inline');

      return {
        success: true,
        status: 'succeeded',
        model,
        prediction_id: prediction.id,
        images: savedFiles.map(f => ({
          url: f.full_url,
          relative_url: f.url,
          file_id: f.file_id,
          size: f.size,
        })),
      };
    } catch (error) {
      aiLogger.error({ err: error, model }, 'Replicate image generation failed');
      return { error: error.message };
    }
  },

  /**
   * gemini_image_generate — Generate/edit images via Google Gemini API
   */
  async gemini_image_generate(args, userId, context) {
    const { model, prompt, image_urls, space_id } = args;

    if (!prompt) return { error: 'prompt is required' };
    const modelKey = model || 'gemini-2.0-flash';

    const apiKey = await resolveApiKey('gemini', context);
    if (!apiKey) return { error: 'No Gemini API key configured. Set GEMINI_API_KEY env var or add to AI API Keys table.' };

    try {
      const resolvedImages = image_urls?.map(resolveImageUrl).filter(Boolean) || [];

      aiLogger.info({ model: modelKey, prompt: prompt.slice(0, 100), imageCount: resolvedImages.length }, 'Gemini image generation started');

      const resultDataUri = await geminiGenerate(apiKey, modelKey, prompt, resolvedImages);

      // Save to CRM
      const saved = await downloadAndSaveImage(resultDataUri, space_id || 35);

      aiLogger.info({ model: modelKey }, 'Gemini image generation completed');

      return {
        success: true,
        model: modelKey,
        images: [{
          url: saved.full_url,
          relative_url: saved.url,
          file_id: saved.file_id,
          size: saved.size,
        }],
      };
    } catch (error) {
      aiLogger.error({ err: error, model: modelKey }, 'Gemini image generation failed');
      return { error: error.message };
    }
  },

  /**
   * replicate_3d_generate — Start a Hunyuan3D 2.0 prediction and return its
   * id immediately. Caller polls via replicate_check_prediction (T-138801).
   * 3D generations take 2-5 minutes — far longer than MCP client timeouts.
   */
  async replicate_3d_generate(args, userId, context) {
    const { model, image_url, steps, guidance_scale, octree_resolution, remove_background, output_format, space_id } = args;

    if (!image_url) return { error: 'image_url is required — provide a reference image for 3D generation' };

    const modelKey = model || 'hunyuan3d-2';
    const apiKey = await resolveApiKey('replicate', context);
    if (!apiKey) return { error: 'No Replicate API key configured. Set REPLICATE_API_KEY env var or add to AI API Keys table.' };

    try {
      const resolvedImage = resolveImageUrl(image_url);
      const format = output_format || 'glb';

      const prediction = await replicate3DStart(apiKey, modelKey, resolvedImage, {
        steps, guidance_scale, octree_resolution, remove_background, output_format: format,
      });

      aiLogger.info({ model: modelKey, prediction_id: prediction.id, status: prediction.status }, '3D prediction started');

      return {
        success: true,
        async: true,
        prediction_id: prediction.id,
        kind: '3d',
        model: modelKey,
        format,
        status: prediction.status, // 'starting' | 'processing' | 'succeeded' | 'failed'
        space_id: space_id || 35,
        message: `3D prediction started (id=${prediction.id}). Poll with replicate_check_prediction({prediction_id, kind:'3d', space_id:${space_id || 35}, format:'${format}'}). Typical wait 2-5 min.`,
      };
    } catch (error) {
      aiLogger.error({ err: error, model: modelKey }, '3D generation start failed');
      return { error: error.message };
    }
  },

  /**
   * replicate_check_prediction — Poll a Replicate prediction once. When the
   * prediction has succeeded, downloads the output and saves into CRM file
   * storage; on processing/starting returns status only; on failure returns
   * the error. T-138801: replaces inline polling that exceeded MCP timeout.
   */
  async replicate_check_prediction(args, userId, context) {
    const { prediction_id, kind = '3d', space_id, format } = args;
    if (!prediction_id) return { error: 'prediction_id is required' };
    if (!['3d', 'image'].includes(kind)) return { error: `Unknown kind: ${kind}. Expected '3d' or 'image'.` };

    const apiKey = await resolveApiKey('replicate', context);
    if (!apiKey) return { error: 'No Replicate API key configured.' };

    try {
      const prediction = await replicateFetchPrediction(apiKey, prediction_id);

      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        return {
          success: false,
          status: prediction.status,
          prediction_id,
          error: prediction.error || `Prediction ${prediction.status}`,
        };
      }

      if (prediction.status !== 'succeeded') {
        return {
          success: true,
          async: true,
          status: prediction.status, // 'starting' | 'processing'
          prediction_id,
          message: `Still ${prediction.status}. Poll again in 5-15s.`,
        };
      }

      // Succeeded — materialise output into CRM storage so the agent gets a
      // stable URL even after Replicate clears the temporary CDN link.
      if (kind === '3d') {
        const output = prediction.output;
        const meshUrl = typeof output === 'string' ? output : output?.mesh || output?.url || (Array.isArray(output) ? output[0] : null);
        if (!meshUrl) return { error: 'Prediction succeeded but no mesh URL found in output.' };
        const saved = await downloadAndSave3DModel(meshUrl, space_id || 35, format || 'glb');
        return {
          success: true,
          status: 'succeeded',
          prediction_id,
          kind: '3d',
          mesh: {
            url: saved.full_url,
            relative_url: saved.url,
            file_id: saved.file_id,
            size: saved.size,
            mime_type: saved.mime_type,
          },
        };
      }

      // kind === 'image'
      const outputUrls = extractOutputUrls(prediction);
      const savedFiles = [];
      for (const url of outputUrls) {
        savedFiles.push(await downloadAndSaveImage(url, space_id || 35));
      }
      return {
        success: true,
        status: 'succeeded',
        prediction_id,
        kind: 'image',
        images: savedFiles.map(f => ({
          url: f.full_url,
          relative_url: f.url,
          file_id: f.file_id,
          size: f.size,
        })),
      };
    } catch (error) {
      aiLogger.error({ err: error, prediction_id }, 'replicate_check_prediction failed');
      return { error: error.message };
    }
  },
};

// Export model registries for API endpoints
export { REPLICATE_MODELS, REPLICATE_3D_MODELS, GEMINI_MODELS };

// Exported for tests (ADR-0016 file registration regression guard).
export { downloadAndSaveImage, downloadAndSave3DModel };
