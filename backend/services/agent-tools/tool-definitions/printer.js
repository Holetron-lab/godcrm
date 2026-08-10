/**
 * 3D Printer tool definitions (Klipper/Moonraker + PrusaSlicer).
 */

export const PRINTER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'printer_status',
      description: 'Get 3D printer status: state, temperatures, print progress, fan speed, position.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_files',
      description: 'List GCode files stored on the 3D printer.',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: 'File root directory. Default: "gcodes"' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_start',
      description: 'Start printing a GCode file that is already on the printer.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Filename of the GCode file to print (from printer_files list)' }
        },
        required: ['filename']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_pause',
      description: 'Pause the current print job.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_resume',
      description: 'Resume a paused print job.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_cancel',
      description: 'Cancel the current print job.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_upload',
      description: 'Upload a GCode file from the server to the 3D printer.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the GCode file on the server' },
          filename: { type: 'string', description: 'Optional: rename the file on the printer' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_temperatures',
      description: 'Set hotend and/or bed temperature on the 3D printer.',
      parameters: {
        type: 'object',
        properties: {
          hotend: { type: 'number', description: 'Hotend target temperature in °C (0 to turn off)' },
          bed: { type: 'number', description: 'Bed target temperature in °C (0 to turn off)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_gcode',
      description: 'Send a raw GCode command to the 3D printer (e.g. G28 for homing, M104 S200 for hotend).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'GCode command string (e.g. "G28", "M104 S200", "BED_MESH_CALIBRATE")' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_slice',
      description: 'Slice an STL file to GCode using PrusaSlicer. Returns path to the generated GCode file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the STL file on the server' },
          layer_height: { type: 'number', description: 'Layer height in mm. Default: 0.2' },
          infill: { type: 'number', description: 'Infill density percentage 0-100. Default: 15' },
          supports: { type: 'boolean', description: 'Enable support material. Default: false' },
          filament: { type: 'string', enum: ['PLA', 'ABS', 'PETG'], description: 'Filament type for temperature presets. Default: PLA' },
          brim: { type: 'boolean', description: 'Add brim for bed adhesion. Default: false' }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'printer_slice_and_print',
      description: 'Slice an STL file, upload GCode to printer, and optionally start printing. All-in-one command.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the STL file on the server' },
          layer_height: { type: 'number', description: 'Layer height in mm. Default: 0.2' },
          infill: { type: 'number', description: 'Infill density percentage 0-100. Default: 15' },
          supports: { type: 'boolean', description: 'Enable support material. Default: false' },
          filament: { type: 'string', enum: ['PLA', 'ABS', 'PETG'], description: 'Filament type. Default: PLA' },
          brim: { type: 'boolean', description: 'Add brim. Default: false' },
          auto_start: { type: 'boolean', description: 'Automatically start printing after upload. Default: false' }
        },
        required: ['file_path']
      }
    }
  }
];
