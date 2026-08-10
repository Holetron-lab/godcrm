// 🟢 GREEN Phase: Migration for Labs AI Templates Seed Data
// Migration 015: Seed labs_ai_templates with MindWorkflow AI Agents
// Migrated from: /home/dev2/workspace/mindworkflow-download/app/src/data/aiCatalog.ts

import dotenv from 'dotenv';

// Load environment variables BEFORE importing connection
dotenv.config();

/**
 * Run migration to seed Labs AI Templates
 * @param {import('better-sqlite3').Database|import('pg').Pool} db - Database instance
 */
export async function runMigration(db) {
  console.log('📦 Running Migration 015: Labs AI Templates Seed...');
  
  // Import after dotenv is loaded
  const { isPostgres } = await import('../connection.js');

  if (isPostgres()) {
    // PostgreSQL version
    await runPostgresMigration(db);
  } else {
    // SQLite version
    await runSQLiteMigration(db);
  }

  console.log('✅ Migration 015 completed successfully!');
}

/**
 * PostgreSQL migration
 */
async function runPostgresMigration(db) {
  // ========================================
  // SEED: labs_ai_templates with MindWorkflow agents
  // ========================================
  
  const templates = [
    {
      mindworkflow_id: 'planner_llm',
      name: 'Strategic Planner',
      category: 'text_to_text',
      description: 'Long-form reasoning model for planning multi-step creative pipelines.',
      system_prompt: 'You are a senior creative strategist. Respond with numbered steps, each containing a goal, reasoning, and deliverable.',
      user_prompt_example: 'Draft a 5 step plan for launching a snack food brand on social media.',
      inputs: JSON.stringify([
        { name: 'brief', description: 'Primary project description or goal statement' },
        { name: 'constraints', description: 'Hard limits such as budget or timeline', requirement: 'Optional but recommended' }
      ]),
      settings: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: '0.4',
        top_p: '0.9'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'text', type: 'text', enabled: true }],
        maxLength: '8k tokens'
      })
    },
    {
      mindworkflow_id: 'tone_refiner',
      name: 'Tone Refiner',
      category: 'text_to_text',
      description: 'Refines supplied copy to match a target brand voice.',
      system_prompt: 'You are a copy editor tasked with adjusting tone without changing intent.',
      user_prompt_example: 'Rewrite this paragraph to sound energetic and Gen-Z friendly.',
      inputs: JSON.stringify([
        { name: 'draft', description: 'Original text to rephrase' },
        { name: 'tone', description: 'Voice guidelines or adjectives' }
      ]),
      settings: JSON.stringify({
        model: 'claude-3.5',
        temperature: '0.3'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'text', type: 'text', enabled: true }],
        maxLength: '4k tokens'
      })
    },
    {
      mindworkflow_id: 'midjourney_adapter',
      name: 'Visual Ideation Adapter',
      category: 'text_to_image',
      description: 'Prepares prompts and references for image generation pipelines.',
      system_prompt: 'Combine user prompt and structured references into a single Midjourney-style command. List modifiers last.',
      user_prompt_example: 'Concept art of a neon-lit street vendor in rainy Tokyo.',
      inputs: JSON.stringify([
        { name: 'reference_image', description: 'Primary inspiration image URL', requirement: 'JPEG/PNG up to 2 MB' },
        { name: 'character_sheet', description: 'Character reference board', requirement: 'Optional' },
        { name: 'style', description: 'Target art direction keywords' }
      ]),
      settings: JSON.stringify({
        model: 'mj-v6-raw',
        resolution: '1024x1024',
        seed: 'auto'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'image', type: 'image', enabled: true }],
        maxLength: 'N/A'
      })
    },
    {
      mindworkflow_id: 'caption_model',
      name: 'Scene Captioning',
      category: 'image_to_text',
      description: 'Generates descriptive captions for storyboard frames.',
      system_prompt: 'Return vivid but production-ready descriptions mentioning characters, lighting, and props.',
      user_prompt_example: 'Describe the uploaded storyboard frame in two sentences.',
      inputs: JSON.stringify([
        { name: 'frame', description: 'Story frame image', requirement: 'PNG up to 5 MB' }
      ]),
      settings: JSON.stringify({
        model: 'gpt-4o-mini-vision',
        temperature: '0.2'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'text', type: 'text', enabled: true }],
        maxLength: '1k tokens'
      })
    },
    {
      mindworkflow_id: 'voiceover_tts',
      name: 'Narration Voice',
      category: 'text_to_voice',
      description: 'Produces natural voiceover tracks from scripts.',
      system_prompt: 'Render the line with studio quality, subtle pacing, and no background music.',
      user_prompt_example: 'Generate a calm, confident narration for the supplied script.',
      inputs: JSON.stringify([
        { name: 'script', description: 'Narration script markdown' },
        { name: 'voice_reference', description: 'Optional timbre reference clip', requirement: 'MP3/WAV up to 30s' }
      ]),
      settings: JSON.stringify({
        model: 'elevenlabs-pro',
        sample_rate: '48kHz',
        language: 'en-US'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'audio', type: 'voice', enabled: true }],
        maxLength: '1.5k tokens'
      })
    },
    {
      mindworkflow_id: 'speech_to_text',
      name: 'Interview Transcriber',
      category: 'voice_to_text',
      description: 'High accuracy transcription tuned for production interviews.',
      system_prompt: 'Return JSON with segments, timestamps, and speaker labels suitable for editing timelines.',
      user_prompt_example: 'Transcribe the conversation and highlight key soundbites.',
      inputs: JSON.stringify([
        { name: 'recording', description: 'Interview audio', requirement: 'MP3/WAV up to 60 minutes' },
        { name: 'speaker_map', description: 'List of speaker names in order of appearance', requirement: 'Optional' }
      ]),
      settings: JSON.stringify({
        model: 'whisper-large-v3',
        diarization: 'enabled'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'text', type: 'text', enabled: true }],
        maxLength: '60 minutes audio'
      })
    }
  ];

  for (const template of templates) {
    try {
      await db.query(`
        INSERT INTO labs_ai_templates (
          mindworkflow_id, name, category, description, 
          system_prompt, user_prompt_example, inputs, 
          settings, routing_config, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, NOW())
        ON CONFLICT (mindworkflow_id) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          description = EXCLUDED.description,
          system_prompt = EXCLUDED.system_prompt,
          user_prompt_example = EXCLUDED.user_prompt_example,
          inputs = EXCLUDED.inputs,
          settings = EXCLUDED.settings,
          routing_config = EXCLUDED.routing_config
      `, [
        template.mindworkflow_id,
        template.name,
        template.category,
        template.description,
        template.system_prompt,
        template.user_prompt_example,
        template.inputs,
        template.settings,
        template.routing_config
      ]);
      
      console.log(`  ✅ Seeded AI template: ${template.name} (${template.mindworkflow_id})`);
    } catch (error) {
      console.error(`  ❌ Failed to seed template ${template.mindworkflow_id}:`, error.message);
    }
  }
}

/**
 * SQLite migration
 */
async function runSQLiteMigration(db) {
  // ========================================
  // SEED: labs_ai_templates with MindWorkflow agents
  // ========================================
  
  const templates = [
    {
      mindworkflow_id: 'planner_llm',
      name: 'Strategic Planner',
      category: 'text_to_text',
      description: 'Long-form reasoning model for planning multi-step creative pipelines.',
      system_prompt: 'You are a senior creative strategist. Respond with numbered steps, each containing a goal, reasoning, and deliverable.',
      user_prompt_example: 'Draft a 5 step plan for launching a snack food brand on social media.',
      inputs: JSON.stringify([
        { name: 'brief', description: 'Primary project description or goal statement' },
        { name: 'constraints', description: 'Hard limits such as budget or timeline', requirement: 'Optional but recommended' }
      ]),
      settings: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: '0.4',
        top_p: '0.9'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'text', type: 'text', enabled: true }],
        maxLength: '8k tokens'
      })
    },
    {
      mindworkflow_id: 'tone_refiner',
      name: 'Tone Refiner',
      category: 'text_to_text',
      description: 'Refines supplied copy to match a target brand voice.',
      system_prompt: 'You are a copy editor tasked with adjusting tone without changing intent.',
      user_prompt_example: 'Rewrite this paragraph to sound energetic and Gen-Z friendly.',
      inputs: JSON.stringify([
        { name: 'draft', description: 'Original text to rephrase' },
        { name: 'tone', description: 'Voice guidelines or adjectives' }
      ]),
      settings: JSON.stringify({
        model: 'claude-3.5',
        temperature: '0.3'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'text', type: 'text', enabled: true }],
        maxLength: '4k tokens'
      })
    },
    {
      mindworkflow_id: 'midjourney_adapter',
      name: 'Visual Ideation Adapter',
      category: 'text_to_image',
      description: 'Prepares prompts and references for image generation pipelines.',
      system_prompt: 'Combine user prompt and structured references into a single Midjourney-style command. List modifiers last.',
      user_prompt_example: 'Concept art of a neon-lit street vendor in rainy Tokyo.',
      inputs: JSON.stringify([
        { name: 'reference_image', description: 'Primary inspiration image URL', requirement: 'JPEG/PNG up to 2 MB' },
        { name: 'character_sheet', description: 'Character reference board', requirement: 'Optional' },
        { name: 'style', description: 'Target art direction keywords' }
      ]),
      settings: JSON.stringify({
        model: 'mj-v6-raw',
        resolution: '1024x1024',
        seed: 'auto'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'image', type: 'image', enabled: true }],
        maxLength: 'N/A'
      })
    },
    {
      mindworkflow_id: 'caption_model',
      name: 'Scene Captioning',
      category: 'image_to_text',
      description: 'Generates descriptive captions for storyboard frames.',
      system_prompt: 'Return vivid but production-ready descriptions mentioning characters, lighting, and props.',
      user_prompt_example: 'Describe the uploaded storyboard frame in two sentences.',
      inputs: JSON.stringify([
        { name: 'frame', description: 'Story frame image', requirement: 'PNG up to 5 MB' }
      ]),
      settings: JSON.stringify({
        model: 'gpt-4o-mini-vision',
        temperature: '0.2'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'text', type: 'text', enabled: true }],
        maxLength: '1k tokens'
      })
    },
    {
      mindworkflow_id: 'voiceover_tts',
      name: 'Narration Voice',
      category: 'text_to_voice',
      description: 'Produces natural voiceover tracks from scripts.',
      system_prompt: 'Render the line with studio quality, subtle pacing, and no background music.',
      user_prompt_example: 'Generate a calm, confident narration for the supplied script.',
      inputs: JSON.stringify([
        { name: 'script', description: 'Narration script markdown' },
        { name: 'voice_reference', description: 'Optional timbre reference clip', requirement: 'MP3/WAV up to 30s' }
      ]),
      settings: JSON.stringify({
        model: 'elevenlabs-pro',
        sample_rate: '48kHz',
        language: 'en-US'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'audio', type: 'voice', enabled: true }],
        maxLength: '1.5k tokens'
      })
    },
    {
      mindworkflow_id: 'speech_to_text',
      name: 'Interview Transcriber',
      category: 'voice_to_text',
      description: 'High accuracy transcription tuned for production interviews.',
      system_prompt: 'Return JSON with segments, timestamps, and speaker labels suitable for editing timelines.',
      user_prompt_example: 'Transcribe the conversation and highlight key soundbites.',
      inputs: JSON.stringify([
        { name: 'recording', description: 'Interview audio', requirement: 'MP3/WAV up to 60 minutes' },
        { name: 'speaker_map', description: 'List of speaker names in order of appearance', requirement: 'Optional' }
      ]),
      settings: JSON.stringify({
        model: 'whisper-large-v3',
        diarization: 'enabled'
      }),
      routing_config: JSON.stringify({
        outputs: [{ id: 'text', type: 'text', enabled: true }],
        maxLength: '60 minutes audio'
      })
    }
  ];

  for (const template of templates) {
    try {
      // SQLite doesn't support ON CONFLICT with complex updates, so we'll use INSERT OR REPLACE
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO labs_ai_templates (
          mindworkflow_id, name, category, description, 
          system_prompt, user_prompt_example, inputs, 
          settings, routing_config, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      
      stmt.run(
        template.mindworkflow_id,
        template.name,
        template.category,
        template.description,
        template.system_prompt,
        template.user_prompt_example,
        template.inputs,
        template.settings,
        template.routing_config
      );
      
      console.log(`  ✅ Seeded AI template: ${template.name} (${template.mindworkflow_id})`);
    } catch (error) {
      console.error(`  ❌ Failed to seed template ${template.mindworkflow_id}:`, error.message);
    }
  }
}

// Run migration if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const { getAdapter, isPostgres, getDb } = await import('../connection.js');
  if (isPostgres()) {
    const adapter = await getAdapter();
    await runMigration(adapter);
  } else {
    const db = getDb();
    await runMigration(db);
  }
}