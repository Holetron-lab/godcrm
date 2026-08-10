/**
 * Printer Tool Handlers — 3D printer control via Moonraker API
 *
 * Handles: printer_status, printer_files, printer_start, printer_pause,
 *          printer_cancel, printer_upload, printer_temperatures, printer_slice
 *
 * Communicates with Klipper/Moonraker via reverse SSH tunnel on localhost:7125
 */

import { aiLogger } from '../../utils/logger.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MOONRAKER_URL = 'http://localhost:7125';
const SLICER_PROFILE = path.join(__dirname, 'printer', 'slicer-profile.ini');
const SLICE_OUTPUT_DIR = '/tmp/printer-sliced';

/**
 * Helper: call Moonraker API
 */
async function moonraker(endpoint, options = {}) {
  const url = `${MOONRAKER_URL}${endpoint}`;
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moonraker ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Helper: POST JSON to Moonraker
 */
async function moonrakerPost(endpoint, body) {
  return moonraker(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const printerToolHandlers = {
  /**
   * Get printer status: state, temperatures, print progress
   */
  async printer_status() {
    try {
      const objects = [
        'heater_bed',
        'extruder',
        'print_stats',
        'display_status',
        'toolhead',
        'fan',
      ].join('&');

      const query = objects.split('&').map(o => `${o}`).join('&');
      const data = await moonraker(`/printer/objects/query?${objects.split('&').map(o => o).join('&')}`);
      const s = data.result.status;

      const result = {
        state: s.print_stats?.state || 'unknown',
        message: s.print_stats?.message || '',
        filename: s.print_stats?.filename || null,
        progress: s.display_status?.progress != null
          ? Math.round(s.display_status.progress * 100)
          : null,
        print_duration_min: s.print_stats?.print_duration
          ? Math.round(s.print_stats.print_duration / 60)
          : 0,
        hotend: {
          temperature: s.extruder?.temperature,
          target: s.extruder?.target,
        },
        bed: {
          temperature: s.heater_bed?.temperature,
          target: s.heater_bed?.target,
        },
        fan_speed: s.fan?.speed != null ? Math.round(s.fan.speed * 100) : null,
        position: s.toolhead?.position || null,
      };

      return result;
    } catch (err) {
      aiLogger.error({ err }, 'printer_status error');
      return { error: err.message };
    }
  },

  /**
   * List files on printer (gcodes)
   */
  async printer_files({ root = 'gcodes' } = {}) {
    try {
      const data = await moonraker(`/server/files/list?root=${root}`);
      const files = data.result.map(f => ({
        path: f.path,
        size_mb: Math.round(f.size / 1024 / 1024 * 10) / 10,
        modified: new Date(f.modified * 1000).toISOString().slice(0, 16),
      }));
      return { files, total: files.length };
    } catch (err) {
      aiLogger.error({ err }, 'printer_files error');
      return { error: err.message };
    }
  },

  /**
   * Start printing a file
   */
  async printer_start({ filename }) {
    if (!filename) return { error: 'filename is required' };
    try {
      await moonrakerPost('/printer/print/start', { filename });
      return { success: true, message: `Started printing: ${filename}` };
    } catch (err) {
      aiLogger.error({ err, filename }, 'printer_start error');
      return { error: err.message };
    }
  },

  /**
   * Pause current print
   */
  async printer_pause() {
    try {
      await moonrakerPost('/printer/print/pause', {});
      return { success: true, message: 'Print paused' };
    } catch (err) {
      aiLogger.error({ err }, 'printer_pause error');
      return { error: err.message };
    }
  },

  /**
   * Resume paused print
   */
  async printer_resume() {
    try {
      await moonrakerPost('/printer/print/resume', {});
      return { success: true, message: 'Print resumed' };
    } catch (err) {
      aiLogger.error({ err }, 'printer_resume error');
      return { error: err.message };
    }
  },

  /**
   * Cancel current print
   */
  async printer_cancel() {
    try {
      await moonrakerPost('/printer/print/cancel', {});
      return { success: true, message: 'Print cancelled' };
    } catch (err) {
      aiLogger.error({ err }, 'printer_cancel error');
      return { error: err.message };
    }
  },

  /**
   * Upload a gcode file to the printer
   */
  async printer_upload({ file_path, filename }) {
    if (!file_path) return { error: 'file_path is required (path to gcode file on server)' };
    try {
      const fileData = await fs.readFile(file_path);
      const uploadName = filename || path.basename(file_path);

      const formData = new FormData();
      formData.append('file', new Blob([fileData]), uploadName);

      const res = await fetch(`${MOONRAKER_URL}/server/files/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed ${res.status}: ${text}`);
      }

      const result = await res.json();
      return {
        success: true,
        filename: result.result?.item?.path || uploadName,
        size_mb: Math.round(fileData.length / 1024 / 1024 * 10) / 10,
      };
    } catch (err) {
      aiLogger.error({ err, file_path }, 'printer_upload error');
      return { error: err.message };
    }
  },

  /**
   * Set printer temperatures (hotend and/or bed)
   */
  async printer_temperatures({ hotend, bed }) {
    try {
      const results = [];

      if (hotend != null) {
        await moonrakerPost('/printer/gcode/script', {
          script: `M104 S${hotend}`,
        });
        results.push(`Hotend target: ${hotend}°C`);
      }

      if (bed != null) {
        await moonrakerPost('/printer/gcode/script', {
          script: `M140 S${bed}`,
        });
        results.push(`Bed target: ${bed}°C`);
      }

      if (results.length === 0) {
        return { error: 'Specify hotend and/or bed temperature' };
      }

      return { success: true, message: results.join(', ') };
    } catch (err) {
      aiLogger.error({ err }, 'printer_temperatures error');
      return { error: err.message };
    }
  },

  /**
   * Send raw GCode command to printer
   */
  async printer_gcode({ command }) {
    if (!command) return { error: 'command is required (e.g. "G28", "M104 S200")' };
    try {
      await moonrakerPost('/printer/gcode/script', { script: command });
      return { success: true, message: `Executed: ${command}` };
    } catch (err) {
      aiLogger.error({ err, command }, 'printer_gcode error');
      return { error: err.message };
    }
  },

  /**
   * Slice STL file to GCode using PrusaSlicer CLI
   */
  async printer_slice({
    file_path,
    layer_height = 0.2,
    infill = 15,
    supports = false,
    filament = 'PLA',
    brim = false,
  }) {
    if (!file_path) return { error: 'file_path is required (path to STL file on server)' };

    try {
      // Ensure output directory exists
      await fs.mkdir(SLICE_OUTPUT_DIR, { recursive: true });

      const basename = path.basename(file_path, path.extname(file_path));
      const outputFile = path.join(SLICE_OUTPUT_DIR, `${basename}.gcode`);

      // Build PrusaSlicer CLI args
      const args = [
        '--export-gcode',
        '--load', SLICER_PROFILE,
        '--layer-height', String(layer_height),
        '--fill-density', `${infill}%`,
        '--nozzle-diameter', '0.4',
        '--filament-diameter', '1.75',
        '--bed-shape', '0x0,246x0,246x258,0x258',
        '--gcode-flavor', 'klipper',
        '--center', '123,129',
        '-o', outputFile,
      ];

      // Filament temperatures
      const filamentTemps = {
        PLA: { temp: 210, bed: 60 },
        ABS: { temp: 245, bed: 100 },
        PETG: { temp: 235, bed: 80 },
      };
      const temps = filamentTemps[filament.toUpperCase()] || filamentTemps.PLA;
      args.push('--temperature', String(temps.temp));
      args.push('--first-layer-temperature', String(temps.temp + 5));
      args.push('--bed-temperature', String(temps.bed));
      args.push('--first-layer-bed-temperature', String(temps.bed + 5));

      // Start/end gcode
      args.push('--start-gcode', `PRINT_START EXTRUDER=${temps.temp} BED=${temps.bed}`);
      args.push('--end-gcode', 'PRINT_END');

      if (supports) {
        args.push('--support-material');
        args.push('--support-material-auto');
      }

      if (brim) {
        args.push('--brim-width', '5');
      }

      args.push(file_path);

      aiLogger.info({ args: args.join(' ') }, 'Slicing STL with PrusaSlicer');

      const { stdout, stderr } = await execFileAsync('prusa-slicer', args, {
        timeout: 300000, // 5 min max
      });

      // Check output exists
      const stats = await fs.stat(outputFile);

      return {
        success: true,
        gcode_path: outputFile,
        gcode_size_mb: Math.round(stats.size / 1024 / 1024 * 10) / 10,
        settings: {
          layer_height,
          infill: `${infill}%`,
          supports,
          filament,
          brim,
        },
        slicer_output: (stderr || stdout || '').slice(-500),
      };
    } catch (err) {
      aiLogger.error({ err, file_path }, 'printer_slice error');
      return { error: err.message };
    }
  },

  /**
   * Slice and upload: convenience combo of slice + upload + optionally start
   */
  async printer_slice_and_print({
    file_path,
    layer_height = 0.2,
    infill = 15,
    supports = false,
    filament = 'PLA',
    brim = false,
    auto_start = false,
  }) {
    // Step 1: Slice
    const sliceResult = await printerToolHandlers.printer_slice({
      file_path, layer_height, infill, supports, filament, brim,
    });
    if (sliceResult.error) return sliceResult;

    // Step 2: Upload
    const uploadResult = await printerToolHandlers.printer_upload({
      file_path: sliceResult.gcode_path,
    });
    if (uploadResult.error) return uploadResult;

    // Step 3: Optionally start
    if (auto_start) {
      const startResult = await printerToolHandlers.printer_start({
        filename: uploadResult.filename,
      });
      if (startResult.error) return startResult;
    }

    return {
      success: true,
      sliced: sliceResult.settings,
      gcode_size_mb: sliceResult.gcode_size_mb,
      uploaded_as: uploadResult.filename,
      printing: auto_start,
    };
  },
};
