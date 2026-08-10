/**
 * LiveKit call, recording, and transcription routes.
 */

import {
  dbRun, dbGet, dbAll, isPostgres, apiLogger,
  jwt,
  success, error, badRequest, forbidden,
  requireAuth,
} from './chatShared.js';
import {
  getCallsLimits,
  livekitTwirpHost,
  CONCURRENT_CAP_ERROR_CODE,
} from '../../../services/livekit/callsLimits.js';
import { getSecret } from '../../../services/secrets/getSecret.js';

// Helper: format seconds to MM:SS
function _fmtTime(seconds) {
  const m = Math.floor((seconds || 0) / 60);
  const s = Math.floor((seconds || 0) % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Helper: format duration to human-readable
function _fmtDuration(seconds) {
  const m = Math.floor((seconds || 0) / 60);
  const s = Math.floor((seconds || 0) % 60);
  if (m > 0) return `${m} мин ${s > 0 ? s + ' сек' : ''}`.trim();
  return `${s} сек`;
}

export default function registerCallRoutes(router) {

  // POST /conversations/:id/call/token - Generate LiveKit token
  router.post('/conversations/:id/call/token', requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!conversationId) return badRequest(res, 'Invalid conversation ID');

    try {
      const participant = await dbGet(
        isPostgres() ? 'SELECT cp.* FROM conversation_participants cp WHERE cp.conversation_id = $1 AND cp.user_id = $2' : 'SELECT cp.* FROM conversation_participants cp WHERE cp.conversation_id = ? AND cp.user_id = ?',
        [conversationId, req.user.userId || req.user.id]
      );
      if (!participant) return forbidden(res, 'Not a participant in this conversation');

      const LK_API_KEY = await getSecret('livekit_api_key', 'LIVEKIT_API_KEY');
      const LK_API_SECRET = await getSecret('livekit_api_secret', 'LIVEKIT_API_SECRET');
      const LK_URL = process.env.LIVEKIT_URL || 'ws://<RELAY_IP>:7880';
      if (!LK_API_KEY || !LK_API_SECRET) return error(res, 'LIVEKIT_NOT_CONFIGURED', 'LiveKit credentials not configured', 500);

      const roomName = `conv-${conversationId}`;
      const identity = `user-${req.user.userId || req.user.id}`;
      const userName = req.user.name || req.user.email || identity;

      // ADR-0059 §4.9 (AMEND-3) — capacity pre-flights via LiveKit Twirp.
      // Joining an EXISTING call is always allowed (it doesn't grow the room
      // count); the cap only blocks a NEW room when N rooms are already live.
      const { maxConcurrent, maxParticipantsPerRoom } = getCallsLimits();
      const LK_TWIRP_HOST = livekitTwirpHost();
      const nowAdmin = Math.floor(Date.now() / 1000);
      const adminToken = jwt.sign(
        { iss: LK_API_KEY, nbf: nowAdmin, exp: nowAdmin + 60, video: { roomCreate: true, roomList: true } },
        LK_API_SECRET,
        { algorithm: 'HS256' },
      );
      const axios = (await import('axios')).default;

      // Pre-flight 1: count active rooms; reject with 429 if at cap and the
      // requested room isn't already among them.
      try {
        const listResponse = await axios.post(
          `${LK_TWIRP_HOST}/twirp/livekit.RoomService/ListRooms`,
          {},
          { headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, timeout: 5000 },
        );
        const rooms = Array.isArray(listResponse.data?.rooms) ? listResponse.data.rooms : [];
        // LiveKit reports every room it knows about; an empty room with
        // 0 participants still counts here. That's intentional — the cap
        // tracks room provisioning, not concurrent voice load.
        const roomExists = rooms.some(r => r?.name === roomName);
        if (!roomExists && rooms.length >= maxConcurrent) {
          apiLogger.warn({ conversationId, active: rooms.length, cap: maxConcurrent }, 'Call token refused: concurrent room cap reached');
          return res.status(429).json({
            success: false,
            error: CONCURRENT_CAP_ERROR_CODE,
            cap: maxConcurrent,
            message: `Concurrent room cap reached (${maxConcurrent}). Try again later.`,
          });
        }
      } catch (lkErr) {
        // LiveKit unreachable / Twirp failure: fail-open with a logged warning.
        // Blocking calls entirely on a control-plane glitch is worse than a
        // brief over-cap window — voice is already a soft dependency.
        apiLogger.warn({ err: lkErr.response?.data || lkErr.message, conversationId }, 'ListRooms pre-flight failed — proceeding without cap check');
      }

      // Pre-flight 2: ensure the room exists with the per-room participant
      // cap baked in. Swallow AlreadyExists — LiveKit returns it (HTTP 409 or
      // twirp `already_exists`) when the room is already provisioned, in
      // which case the original max_participants is what's enforced.
      try {
        await axios.post(
          `${LK_TWIRP_HOST}/twirp/livekit.RoomService/CreateRoom`,
          { name: roomName, max_participants: maxParticipantsPerRoom, empty_timeout: 300 },
          { headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, timeout: 5000 },
        );
      } catch (lkErr) {
        const twirpCode = lkErr.response?.data?.code;
        const msg = lkErr.response?.data?.msg || lkErr.message || '';
        const isAlreadyExists = twirpCode === 'already_exists' || /already exists/i.test(msg);
        if (!isAlreadyExists) {
          apiLogger.warn({ err: lkErr.response?.data || lkErr.message, conversationId }, 'CreateRoom pre-flight failed — proceeding (LiveKit will use its defaults)');
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: LK_API_KEY, sub: identity, name: userName, nbf: now, exp: now + 86400, jti: identity,
        video: { roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true },
        metadata: JSON.stringify({ conversationId, userId: req.user.userId || req.user.id }),
      };

      const token = jwt.sign(payload, LK_API_SECRET, { algorithm: 'HS256', header: { typ: 'JWT', alg: 'HS256' } });

      const participants = await dbAll(
        isPostgres()
          ? `SELECT cp.user_id, u.name, u.email FROM conversation_participants cp LEFT JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = $1 AND cp.user_id != $2`
          : `SELECT cp.user_id, u.name, u.email FROM conversation_participants cp LEFT JOIN users u ON u.id = cp.user_id WHERE cp.conversation_id = ? AND cp.user_id != ?`,
        [conversationId, req.user.userId || req.user.id]
      );

      apiLogger.info({ conversationId, identity, roomName }, 'LiveKit call token generated');
      return success(res, { token, url: LK_URL, room: roomName, identity, participants: participants.map(p => ({ id: p.user_id, name: p.name || p.email })) });
    } catch (err) {
      apiLogger.error({ err, conversationId: req.params.id }, 'Error generating call token');
      return error(res, 'CALL_TOKEN_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/call/recording/start - Start recording
  router.post('/conversations/:id/call/recording/start', requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!conversationId) return badRequest(res, 'Invalid conversation ID');

    try {
      const LK_API_KEY = await getSecret('livekit_api_key', 'LIVEKIT_API_KEY');
      const LK_API_SECRET = await getSecret('livekit_api_secret', 'LIVEKIT_API_SECRET');
      const LK_HOST = (process.env.LIVEKIT_URL || 'ws://<RELAY_IP>:7880').replace('ws://', 'http://').replace('wss://', 'https://');
      if (!LK_API_KEY || !LK_API_SECRET) return error(res, 'LIVEKIT_NOT_CONFIGURED', 'LiveKit credentials not configured', 500);

      const roomName = `conv-${conversationId}`;
      const now = Math.floor(Date.now() / 1000);
      const apiToken = jwt.sign({ iss: LK_API_KEY, nbf: now, exp: now + 600, video: { roomAdmin: true, room: roomName } }, LK_API_SECRET, { algorithm: 'HS256' });

      const axios = (await import('axios')).default;
      const egressResponse = await axios.post(
        `${LK_HOST}/twirp/livekit.Egress/StartRoomCompositeEgress`,
        { room_name: roomName, audio_only: true, file_outputs: [{ file_type: 'OGG', filepath: `/recordings/${roomName}-${Date.now()}.ogg` }] },
        { headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
      );

      const egressId = egressResponse.data?.egress_id;
      apiLogger.info({ conversationId, roomName, egressId }, 'Call recording started');
      return success(res, { egress_id: egressId, room: roomName, status: 'recording' });
    } catch (err) {
      apiLogger.error({ err: err.response?.data || err.message, conversationId: req.params.id }, 'Error starting recording');
      return error(res, 'RECORDING_START_ERROR', err.response?.data?.msg || err.message, 500);
    }
  });

  // POST /conversations/:id/call/recording/stop - Stop recording
  router.post('/conversations/:id/call/recording/stop', requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    const { egress_id } = req.body || {};
    if (!conversationId) return badRequest(res, 'Invalid conversation ID');
    if (!egress_id) return badRequest(res, 'egress_id required');

    try {
      const LK_API_KEY = await getSecret('livekit_api_key', 'LIVEKIT_API_KEY');
      const LK_API_SECRET = await getSecret('livekit_api_secret', 'LIVEKIT_API_SECRET');
      const LK_HOST = (process.env.LIVEKIT_URL || 'ws://<RELAY_IP>:7880').replace('ws://', 'http://').replace('wss://', 'https://');

      const now = Math.floor(Date.now() / 1000);
      const apiToken = jwt.sign({ iss: LK_API_KEY, nbf: now, exp: now + 600, video: { roomAdmin: true, room: `conv-${conversationId}` } }, LK_API_SECRET, { algorithm: 'HS256' });

      const axios = (await import('axios')).default;
      const stopResponse = await axios.post(
        `${LK_HOST}/twirp/livekit.Egress/StopEgress`, { egress_id },
        { headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
      );

      apiLogger.info({ conversationId, egress_id }, 'Call recording stopped');
      return success(res, { egress_id, status: 'stopped', file: stopResponse.data?.file_results?.[0]?.filename });
    } catch (err) {
      apiLogger.error({ err: err.response?.data || err.message, conversationId: req.params.id }, 'Error stopping recording');
      return error(res, 'RECORDING_STOP_ERROR', err.response?.data?.msg || err.message, 500);
    }
  });

  // POST /conversations/:id/call/transcribe - Transcribe a call recording
  router.post('/conversations/:id/call/transcribe', requireAuth, async (req, res) => {
    const conversationId = Number(req.params.id);
    const { file_path, duration, participants } = req.body || {};
    if (!conversationId) return badRequest(res, 'Invalid conversation ID');

    try {
      const fs = await import('fs');
      let audioPath = file_path;
      if (!audioPath) return error(res, 'NO_FILE', 'file_path required for transcription', 400);

      const OPENAI_KEY = await getSecret('openai_api_key', 'OPENAI_API_KEY');
      if (!OPENAI_KEY) return error(res, 'OPENAI_NOT_CONFIGURED', 'OpenAI API key not configured for transcription', 500);

      const FormData = (await import('form-data')).default;
      const axios = (await import('axios')).default;

      const formData = new FormData();
      formData.append('file', fs.createReadStream(audioPath));
      formData.append('model', 'whisper-1');
      formData.append('language', 'ru');
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'segment');

      const whisperResponse = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, ...formData.getHeaders() }, timeout: 120000, maxContentLength: 100 * 1024 * 1024,
      });

      const transcription = whisperResponse.data;
      const segments = transcription.segments || [];
      const participantNames = (participants || []).map(p => p.name || p.identity || 'Unknown');
      const segmentTexts = segments.map((s, i) => `[${_fmtTime(s.start)}-${_fmtTime(s.end)}] ${s.text.trim()}`).join('\n');

      let dialogue = [];
      if (segments.length > 0) {
        try {
          const diarizePrompt = `You are a call transcript analyzer. Given a list of audio segments with timestamps from a call recording, assign each segment to a speaker.\n\n${participantNames.length >= 2 ? `Known participants: ${participantNames.join(', ')}` : 'There are 2+ speakers in this call.'}\n\nSegments:\n${segmentTexts}\n\nReturn a JSON array where each element has:\n- "speaker": speaker name\n- "start": start time in seconds (number)\n- "end": end time in seconds (number)\n- "text": the text of this segment\n\nRules:\n- Detect speaker changes by context, tone shifts, question-answer patterns\n- If unsure, alternate speakers at natural conversation boundaries\n- Keep segments in chronological order\n- Return ONLY the JSON array, no markdown or explanation`;

          const gptResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o-mini', messages: [{ role: 'user', content: diarizePrompt }], temperature: 0.1, response_format: { type: 'json_object' },
          }, { headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 });

          const gptContent = gptResponse.data.choices?.[0]?.message?.content || '{}';
          const parsed = JSON.parse(gptContent);
          dialogue = Array.isArray(parsed) ? parsed : (parsed.segments || parsed.dialogue || parsed.data || []);
        } catch (gptErr) {
          apiLogger.warn({ err: gptErr.message }, 'GPT diarization failed, using raw segments');
          dialogue = segments.map((s, i) => ({ speaker: participantNames[i % Math.max(participantNames.length, 2)] || `Участник ${(i % 2) + 1}`, start: s.start, end: s.end, text: s.text.trim() }));
        }
      }

      const dialogueText = dialogue.map(d => `**${d.speaker}** [${_fmtTime(d.start)}]: ${d.text}`).join('\n\n');
      const callDuration = duration || transcription.duration || 0;
      const summaryContent = `📞 Звонок (${_fmtDuration(callDuration)})\n\n${dialogueText}`;

      const callMetadata = JSON.stringify({ type: 'call', duration: callDuration, participants: participantNames, dialogue, file_path: audioPath, transcribed_at: new Date().toISOString() });

      await dbRun(
        isPostgres()
          ? `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, metadata, created_at) VALUES ($1, $2, 'system', 'system', $3, 'call', $4, NOW())`
          : `INSERT INTO messages (conversation_id, sender_id, sender_type, role, content, content_type, metadata, created_at) VALUES (?, ?, 'system', 'system', ?, 'call', ?, datetime('now'))`,
        [conversationId, req.user.userId || req.user.id, summaryContent, callMetadata]
      );

      apiLogger.info({ conversationId, duration: callDuration, speakers: dialogue.length }, 'Call transcribed with diarization');
      return success(res, { text: transcription.text, duration: callDuration, dialogue, participants: participantNames });
    } catch (err) {
      apiLogger.error({ err: err.response?.data || err.message }, 'Transcription error');
      return error(res, 'TRANSCRIBE_ERROR', err.message, 500);
    }
  });
}
