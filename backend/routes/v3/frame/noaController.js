/**
 * frame/noaController.js — POST /noa endpoint + TTS optimization + multer error handler
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../../../middleware/auth.js';
import { dbGet, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, badRequest } from '../../../utils/response.js';
import { detectProvider as sharedDetectProvider } from '../../../services/chat/agent-execution-shared.js';
import { getSecret } from '../../../services/secrets/getSecret.js';
import { upload, transcribeAudio, cleanupTempFile, sanitizeText } from './helpers.js';
import { callFrameAI } from './aiProviders.js';

const router = Router();

// ─── POST /noa — Main endpoint ─────────────────────────────────

/**
 * @swagger
 * /api/v3/frame/noa:
 *   post:
 *     summary: Process Frame smart glasses input (audio + image)
 *     description: >
 *       Receives audio (WAV) and/or image (JPEG) from Brilliant Frame smart glasses,
 *       transcribes speech via Whisper, sends to AI with vision context, and returns response.
 *     tags: [Frame]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *               image:
 *                 type: string
 *                 format: binary
 *               messages:
 *                 type: string
 *               location:
 *                 type: string
 *               time:
 *                 type: string
 *     responses:
 *       200:
 *         description: AI response for Frame display
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/noa', authenticate, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'image', maxCount: 1 }
]), async (req, res) => {
  const tempFiles = [];

  try {
    const audioFile = req.files?.audio?.[0] || null;
    const imageFile = req.files?.image?.[0] || null;

    // Track temp files for cleanup
    if (audioFile?.path) tempFiles.push(audioFile.path);
    if (imageFile?.path) tempFiles.push(imageFile.path);

    // Validate: at least one input required
    if (!audioFile && !imageFile) {
      return badRequest(res, 'At least one of "audio" or "image" must be provided.');
    }

    // Enforce file size limits
    if (audioFile && audioFile.size > 10 * 1024 * 1024) {
      return badRequest(res, 'Audio file exceeds 10 MB limit.');
    }
    if (imageFile && imageFile.size > 5 * 1024 * 1024) {
      return badRequest(res, 'Image file exceeds 5 MB limit.');
    }

    // Parse text fields
    let chatHistory = [];
    if (req.body.messages) {
      try {
        const parsed = JSON.parse(req.body.messages);
        if (Array.isArray(parsed)) {
          chatHistory = parsed.filter(m =>
            m && typeof m === 'object' &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string'
          ).map(m => ({
            role: m.role,
            content: sanitizeText(m.content, 10000)
          }));
        }
      } catch {
        apiLogger.warn({ messages: req.body.messages?.substring?.(0, 100) }, 'Frame: invalid messages JSON, ignoring');
      }
    }

    const location = sanitizeText(req.body.location || '', 500);
    const time = sanitizeText(req.body.time || '', 100);

    // ── Step 1: Transcribe audio (or use pre-transcribed text) ──

    let userPrompt = '';

    if (audioFile) {
      const audioBuffer = fs.readFileSync(audioFile.path);

      const ext = path.extname(audioFile.originalname).replace('.', '').toLowerCase() || 'wav';
      const formatMap = {
        wav: 'wav', wave: 'wav',
        webm: 'webm', mp3: 'mp3',
        m4a: 'm4a', ogg: 'ogg',
        flac: 'flac'
      };
      const format = formatMap[ext] || 'wav';

      apiLogger.info({
        context: 'Frame',
        audioSize: audioBuffer.length,
        format,
        userId: req.user?.id
      }, 'Transcribing Frame audio');

      userPrompt = await transcribeAudio(audioBuffer, format);
    } else if (req.body.text && typeof req.body.text === 'string' && req.body.text.trim().length > 0) {
      userPrompt = sanitizeText(req.body.text.trim(), 2000);
      apiLogger.info({
        context: 'Frame',
        textLength: userPrompt.length,
        source: 'local_stt',
        userId: req.user?.id
      }, 'Using pre-transcribed text from local STT');
    }

    // ── Step 2: Read image into buffer ───────────────────────────

    let imageBuffer = null;
    if (imageFile) {
      imageBuffer = fs.readFileSync(imageFile.path);

      apiLogger.info({
        context: 'Frame',
        imageSize: imageBuffer.length,
        userId: req.user?.id
      }, 'Processing Frame image');
    }

    // ── Step 3: Call AI ──────────────────────────────────────────

    apiLogger.info({
      context: 'Frame',
      hasAudio: !!audioFile,
      hasImage: !!imageFile,
      userPromptLength: userPrompt.length,
      historyLength: chatHistory.length,
      location: location || null,
      userId: req.user?.id
    }, 'Calling Frame AI');

    const aiResult = await callFrameAI({
      userText: userPrompt,
      imageBuffer,
      chatHistory,
      location,
      time
    });

    // ── Step 4: Build response ───────────────────────────────────

    const responsePayload = {
      user_prompt: userPrompt,
      message: aiResult.message,
      image: null,
      audio: null,
      debug: {
        topic_changed: aiResult.topicChanged || false
      }
    };

    apiLogger.info({
      context: 'Frame',
      responseLength: aiResult.message.length,
      userId: req.user?.id
    }, 'Frame response sent');

    return res.status(200).json(responsePayload);

  } catch (err) {
    apiLogger.error({ err, context: 'Frame /noa', userId: req.user?.id }, 'Frame endpoint error');

    if (err.message?.includes('No OpenAI API key') || err.message?.includes('No AI API key')) {
      return error(res, 'NO_API_KEY', err.message, 503);
    }
    if (err.message?.includes('Whisper transcription failed')) {
      return error(res, 'TRANSCRIPTION_ERROR', err.message, 502);
    }
    if (err.message?.includes('API error')) {
      return error(res, 'AI_API_ERROR', err.message, 502);
    }

    return error(res, 'FRAME_ERROR', 'Failed to process Frame request', 500);
  } finally {
    for (const filePath of tempFiles) {
      cleanupTempFile(filePath);
    }
  }
});

// ─── TTS Optimization Endpoint ──────────────────────────────────

router.post('/tts-optimize', authenticate, async (req, res) => {
  try {
    const { text, agent_name, prompt, conversation_id } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return badRequest(res, 'Missing or empty "text" field.');
    }

    const userId = req.user?.id;
    const agentName = agent_name || 'voice-optimizer';
    const optimizationPrompt = prompt ||
      'Optimize this text for voice reading. ' +
      'Remove markdown formatting, tables, code blocks. ' +
      'Spell out abbreviations. Make it natural for spoken delivery. ' +
      'Keep it concise. Return ONLY the optimized text, nothing else.';

    apiLogger.info({
      context: 'Frame TTS',
      textLength: text.length,
      agentName,
      userId,
    }, 'TTS optimization request');

    // Try to find agent configuration
    let agentConfig = null;
    try {
      agentConfig = await dbGet(
        isPostgres()
          ? `SELECT * FROM agent_configs WHERE LOWER(name) = LOWER($1) LIMIT 1`
          : `SELECT * FROM agent_configs WHERE LOWER(name) = LOWER(?) LIMIT 1`,
        [agentName]
      );
    } catch {
      // Agent not found — use default prompt
    }

    // Build the optimization prompt
    const systemPrompt = agentConfig?.system_prompt || optimizationPrompt;
    const fullPrompt = `${systemPrompt}\n\n---\n\nText to optimize:\n${text.substring(0, 4000)}`;

    // Detect AI provider
    const provider = sharedDetectProvider();

    let optimizedText = text;

    if (provider === 'anthropic') {
      const apiKey = await getSecret('anthropic_api_key', 'ANTHROPIC_API_KEY');
      if (apiKey) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: [{ role: 'user', content: fullPrompt }],
          }),
        });
        const data = await response.json();
        if (data.content?.[0]?.text) {
          optimizedText = data.content[0].text;
        }
      }
    } else if (provider === 'openai') {
      const apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
      if (apiKey) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 1024,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: text.substring(0, 4000) },
            ],
          }),
        });
        const data = await response.json();
        if (data.choices?.[0]?.message?.content) {
          optimizedText = data.choices[0].message.content;
        }
      }
    }

    apiLogger.info({
      context: 'Frame TTS',
      originalLength: text.length,
      optimizedLength: optimizedText.length,
      userId,
    }, 'TTS optimization complete');

    return success(res, {
      optimized_text: optimizedText,
      original_length: text.length,
      optimized_length: optimizedText.length,
    });
  } catch (err) {
    apiLogger.error({ err, context: 'Frame TTS' }, 'TTS optimization failed');
    return error(res, 'TTS_ERROR', 'Failed to optimize text for TTS', 500);
  }
});

// ─── Multer error handler ──────────────────────────────────────

router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return badRequest(res, 'File too large. Audio max: 10 MB, Image max: 5 MB.');
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return badRequest(res, 'Too many files. Send at most 1 audio and 1 image.');
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return badRequest(res, 'Unexpected file field. Use "audio" and/or "image".');
    }
    return badRequest(res, `Upload error: ${err.message}`);
  }
  if (err?.message?.includes('Invalid audio type') || err?.message?.includes('Invalid image type') || err?.message?.includes('Unexpected file field')) {
    return badRequest(res, err.message);
  }
  next(err);
});

export default router;
