/**
 * Image & 3D generation tool definitions (Replicate + Gemini).
 */

export const IMAGE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'replicate_image_generate',
      description: 'Generate or edit images using Replicate AI models (FLUX Kontext, Seedream, Ideogram, Recraft, etc). '
        + 'Can take an input image for editing or generate from scratch. '
        + 'Fast path: returns saved CRM images directly when the model completes within ~25s (most short prompts). '
        + 'Slow path: returns {async:true, prediction_id, kind:"image"} — poll via replicate_check_prediction({prediction_id, kind:"image", space_id}) until status="succeeded". '
        + 'Available models: flux-kontext-pro, flux-kontext-max, seedream-4.5, seedream-5-lite, nano-banana-pro, flux-2-pro, ideogram-v3-balanced, recraft-v4',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Model key to use',
            enum: ['flux-kontext-pro', 'flux-kontext-max', 'seedream-4.5', 'seedream-5-lite', 'nano-banana-pro', 'flux-2-pro', 'ideogram-v3-balanced', 'recraft-v4']
          },
          prompt: {
            type: 'string',
            description: 'Text prompt describing what to generate or how to edit the image'
          },
          image_url: {
            type: 'string',
            description: 'URL of the input image to edit (CRM relative URL or full HTTP URL). Not needed for generation-only models.'
          },
          reference_urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of reference image URLs for style/content guidance'
          },
          num_images: {
            type: 'number',
            description: 'Number of images to generate (1-4, default: 1)'
          },
          space_id: {
            type: 'number',
            description: 'Space ID to save generated images to (default: 35)'
          }
        },
        required: ['model', 'prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replicate_3d_generate',
      description: 'Start a 3D model (GLB/OBJ mesh) generation from a reference image using Replicate AI models. '
        + 'Currently supports Hunyuan3D 2.0 by Tencent. Takes a single image and produces a textured 3D mesh file. '
        + 'ASYNC: returns prediction_id immediately because generation takes 2-5 minutes (longer than MCP client timeout). '
        + 'Poll the result via `replicate_check_prediction({prediction_id, kind:"3d", space_id, format})` every 10-30 seconds until status=succeeded.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Model key to use (default: hunyuan3d-2)',
            enum: ['hunyuan3d-2']
          },
          image_url: {
            type: 'string',
            description: 'URL of the reference image to convert to 3D (CRM relative URL or full HTTP URL)'
          },
          steps: {
            type: 'number',
            description: 'Number of inference steps (default: 30, higher = better quality but slower)'
          },
          guidance_scale: {
            type: 'number',
            description: 'Guidance scale for generation (default: 5.5)'
          },
          octree_resolution: {
            type: 'number',
            description: 'Mesh resolution: 256 (fast/low) or 512 (slow/high detail). Default: 256'
          },
          remove_background: {
            type: 'boolean',
            description: 'Auto-remove background from input image (default: true)'
          },
          output_format: {
            type: 'string',
            description: 'Output mesh format (default: glb)',
            enum: ['glb', 'obj']
          },
          space_id: {
            type: 'number',
            description: 'Space ID to save generated model to (default: 35)'
          }
        },
        required: ['image_url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replicate_check_prediction',
      description: 'Poll a Replicate prediction once and, when finished, materialise its output into CRM file storage. '
        + 'Pair with replicate_3d_generate (kind="3d") to drive long-running 3D generations from MCP without exceeding the client timeout. '
        + 'Returns status="starting"|"processing" while running, status="succeeded" with file metadata when done, status="failed" with error.',
      parameters: {
        type: 'object',
        properties: {
          prediction_id: {
            type: 'string',
            description: 'The prediction_id returned by replicate_3d_generate (or any other replicate_* starter)',
          },
          kind: {
            type: 'string',
            enum: ['3d', 'image'],
            description: 'Output kind to materialise on success. "3d" expects a single mesh URL, "image" expects an array of image URLs. Default: 3d',
          },
          space_id: {
            type: 'number',
            description: 'Space ID to save the materialised file(s) to (default: 35)',
          },
          format: {
            type: 'string',
            enum: ['glb', 'obj'],
            description: 'For kind="3d", the mesh file extension to use when saving (default: glb)',
          },
        },
        required: ['prediction_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'gemini_image_generate',
      description: 'Generate or edit images using Google Gemini API. Supports multi-modal input (images + text). '
        + 'Available models: gemini-2.0-flash (fast, free tier), gemini-2.5-flash (newer), gemini-2.5-pro (best quality)',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Gemini model key (default: gemini-2.0-flash)',
            enum: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro']
          },
          prompt: {
            type: 'string',
            description: 'Text prompt describing what to generate or edit'
          },
          image_urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of input image URLs (CRM relative URLs or full HTTP URLs) for editing/reference'
          },
          space_id: {
            type: 'number',
            description: 'Space ID to save generated images to (default: 35)'
          }
        },
        required: ['prompt']
      }
    }
  }
];
