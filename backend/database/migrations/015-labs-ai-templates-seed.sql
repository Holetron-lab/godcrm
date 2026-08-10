-- Migration 015: Labs AI Templates Seed Data
-- Migrated from MindWorkflow AI Agents Catalog
-- Source: /home/dev2/workspace/mindworkflow-download/app/src/data/aiCatalog.ts
-- Created: 2026-01-24

-- ============================================================
-- Seed labs_ai_templates with MindWorkflow AI Agents
-- ============================================================

-- 1. Strategic Planner (text_to_text)
INSERT INTO labs_ai_templates (mindworkflow_id, name, category, description, system_prompt, user_prompt_example, inputs, settings, routing_config, created_at)
VALUES (
  'planner_llm',
  'Strategic Planner',
  'text_to_text',
  'Long-form reasoning model for planning multi-step creative pipelines.',
  'You are a senior creative strategist. Respond with numbered steps, each containing a goal, reasoning, and deliverable.',
  'Draft a 5 step plan for launching a snack food brand on social media.',
  '[
    {"name": "brief", "description": "Primary project description or goal statement"},
    {"name": "constraints", "description": "Hard limits such as budget or timeline", "requirement": "Optional but recommended"}
  ]'::jsonb,
  '{
    "model": "gpt-4.1-mini",
    "temperature": "0.4",
    "top_p": "0.9"
  }'::jsonb,
  '{
    "outputs": [{"id": "text", "type": "text", "enabled": true}],
    "maxLength": "8k tokens"
  }'::jsonb,
  NOW()
) ON CONFLICT (mindworkflow_id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  user_prompt_example = EXCLUDED.user_prompt_example,
  inputs = EXCLUDED.inputs,
  settings = EXCLUDED.settings,
  routing_config = EXCLUDED.routing_config;

-- 2. Tone Refiner (text_to_text)
INSERT INTO labs_ai_templates (mindworkflow_id, name, category, description, system_prompt, user_prompt_example, inputs, settings, routing_config, created_at)
VALUES (
  'tone_refiner',
  'Tone Refiner',
  'text_to_text',
  'Refines supplied copy to match a target brand voice.',
  'You are a copy editor tasked with adjusting tone without changing intent.',
  'Rewrite this paragraph to sound energetic and Gen-Z friendly.',
  '[
    {"name": "draft", "description": "Original text to rephrase"},
    {"name": "tone", "description": "Voice guidelines or adjectives"}
  ]'::jsonb,
  '{
    "model": "claude-3.5",
    "temperature": "0.3"
  }'::jsonb,
  '{
    "outputs": [{"id": "text", "type": "text", "enabled": true}],
    "maxLength": "4k tokens"
  }'::jsonb,
  NOW()
) ON CONFLICT (mindworkflow_id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  user_prompt_example = EXCLUDED.user_prompt_example,
  inputs = EXCLUDED.inputs,
  settings = EXCLUDED.settings,
  routing_config = EXCLUDED.routing_config;

-- 3. Visual Ideation Adapter (text_to_image)
INSERT INTO labs_ai_templates (mindworkflow_id, name, category, description, system_prompt, user_prompt_example, inputs, settings, routing_config, created_at)
VALUES (
  'midjourney_adapter',
  'Visual Ideation Adapter',
  'text_to_image',
  'Prepares prompts and references for image generation pipelines.',
  'Combine user prompt and structured references into a single Midjourney-style command. List modifiers last.',
  'Concept art of a neon-lit street vendor in rainy Tokyo.',
  '[
    {"name": "reference_image", "description": "Primary inspiration image URL", "requirement": "JPEG/PNG up to 2 MB"},
    {"name": "character_sheet", "description": "Character reference board", "requirement": "Optional"},
    {"name": "style", "description": "Target art direction keywords"}
  ]'::jsonb,
  '{
    "model": "mj-v6-raw",
    "resolution": "1024x1024",
    "seed": "auto"
  }'::jsonb,
  '{
    "outputs": [{"id": "image", "type": "image", "enabled": true}],
    "maxLength": "N/A"
  }'::jsonb,
  NOW()
) ON CONFLICT (mindworkflow_id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  user_prompt_example = EXCLUDED.user_prompt_example,
  inputs = EXCLUDED.inputs,
  settings = EXCLUDED.settings,
  routing_config = EXCLUDED.routing_config;

-- 4. Scene Captioning (image_to_text)
INSERT INTO labs_ai_templates (mindworkflow_id, name, category, description, system_prompt, user_prompt_example, inputs, settings, routing_config, created_at)
VALUES (
  'caption_model',
  'Scene Captioning',
  'image_to_text',
  'Generates descriptive captions for storyboard frames.',
  'Return vivid but production-ready descriptions mentioning characters, lighting, and props.',
  'Describe the uploaded storyboard frame in two sentences.',
  '[
    {"name": "frame", "description": "Story frame image", "requirement": "PNG up to 5 MB"}
  ]'::jsonb,
  '{
    "model": "gpt-4o-mini-vision",
    "temperature": "0.2"
  }'::jsonb,
  '{
    "outputs": [{"id": "text", "type": "text", "enabled": true}],
    "maxLength": "1k tokens"
  }'::jsonb,
  NOW()
) ON CONFLICT (mindworkflow_id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  user_prompt_example = EXCLUDED.user_prompt_example,
  inputs = EXCLUDED.inputs,
  settings = EXCLUDED.settings,
  routing_config = EXCLUDED.routing_config;

-- 5. Narration Voice (text_to_voice)
INSERT INTO labs_ai_templates (mindworkflow_id, name, category, description, system_prompt, user_prompt_example, inputs, settings, routing_config, created_at)
VALUES (
  'voiceover_tts',
  'Narration Voice',
  'text_to_voice',
  'Produces natural voiceover tracks from scripts.',
  'Render the line with studio quality, subtle pacing, and no background music.',
  'Generate a calm, confident narration for the supplied script.',
  '[
    {"name": "script", "description": "Narration script markdown"},
    {"name": "voice_reference", "description": "Optional timbre reference clip", "requirement": "MP3/WAV up to 30s"}
  ]'::jsonb,
  '{
    "model": "elevenlabs-pro",
    "sample_rate": "48kHz",
    "language": "en-US"
  }'::jsonb,
  '{
    "outputs": [{"id": "audio", "type": "voice", "enabled": true}],
    "maxLength": "1.5k tokens"
  }'::jsonb,
  NOW()
) ON CONFLICT (mindworkflow_id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  user_prompt_example = EXCLUDED.user_prompt_example,
  inputs = EXCLUDED.inputs,
  settings = EXCLUDED.settings,
  routing_config = EXCLUDED.routing_config;

-- 6. Interview Transcriber (voice_to_text)
INSERT INTO labs_ai_templates (mindworkflow_id, name, category, description, system_prompt, user_prompt_example, inputs, settings, routing_config, created_at)
VALUES (
  'speech_to_text',
  'Interview Transcriber',
  'voice_to_text',
  'High accuracy transcription tuned for production interviews.',
  'Return JSON with segments, timestamps, and speaker labels suitable for editing timelines.',
  'Transcribe the conversation and highlight key soundbites.',
  '[
    {"name": "recording", "description": "Interview audio", "requirement": "MP3/WAV up to 60 minutes"},
    {"name": "speaker_map", "description": "List of speaker names in order of appearance", "requirement": "Optional"}
  ]'::jsonb,
  '{
    "model": "whisper-large-v3",
    "diarization": "enabled"
  }'::jsonb,
  '{
    "outputs": [{"id": "text", "type": "text", "enabled": true}],
    "maxLength": "60 minutes audio"
  }'::jsonb,
  NOW()
) ON CONFLICT (mindworkflow_id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  system_prompt = EXCLUDED.system_prompt,
  user_prompt_example = EXCLUDED.user_prompt_example,
  inputs = EXCLUDED.inputs,
  settings = EXCLUDED.settings,
  routing_config = EXCLUDED.routing_config;

-- ============================================================
-- SQLite Compatibility Notes
-- ============================================================

-- For SQLite, the above queries need to be adapted:
-- 1. Replace JSONB with TEXT
-- 2. Replace NOW() with datetime('now')
-- 3. Replace ON CONFLICT with INSERT OR REPLACE
-- 4. Remove ::jsonb casting

-- The JavaScript migration file handles these differences automatically