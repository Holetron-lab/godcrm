import 'dart:typed_data';

/// Upsamples PCM audio from 8kHz to 16kHz using linear interpolation.
/// Required because Frame captures at 8kHz but Gemini expects 16kHz.
class AudioUpsampler {
  /// Upsample PCM16 (signed 16-bit samples) from 8kHz to 16kHz.
  /// Uses linear interpolation to double the sample rate.
  static Uint8List upsample8kTo16k(Uint8List input) {
    // Input: PCM16 at 8kHz (2 bytes per sample)
    final inputSamples = Int16List.view(input.buffer, input.offsetInBytes, input.lengthInBytes ~/ 2);
    final outputSamples = Int16List(inputSamples.length * 2);

    for (int i = 0; i < inputSamples.length - 1; i++) {
      final current = inputSamples[i];
      final next = inputSamples[i + 1];
      outputSamples[i * 2] = current;
      outputSamples[i * 2 + 1] = current + ((next - current) ~/ 2);
    }

    // Last sample: duplicate
    if (inputSamples.isNotEmpty) {
      outputSamples[outputSamples.length - 2] = inputSamples.last;
      outputSamples[outputSamples.length - 1] = inputSamples.last;
    }

    return Uint8List.view(outputSamples.buffer);
  }

  /// Convert 8-bit unsigned PCM (from Frame) to 16-bit signed PCM.
  /// Frame sends 8-bit unsigned PCM at 8kHz.
  /// Output: 16-bit signed PCM suitable for Gemini (after upsampling).
  static Uint8List pcm8Topcm16(Uint8List pcm8) {
    final pcm16 = Int16List(pcm8.length);
    for (int i = 0; i < pcm8.length; i++) {
      // Convert unsigned 8-bit (0-255) to signed 16-bit (-32768 to 32767)
      pcm16[i] = ((pcm8[i] - 128) * 256).clamp(-32768, 32767);
    }
    return Uint8List.view(pcm16.buffer);
  }

  /// Full pipeline: Frame 8-bit 8kHz → 16-bit 16kHz PCM for Gemini.
  static Uint8List frameToGemini(Uint8List frameAudio) {
    final pcm16 = pcm8Topcm16(frameAudio);
    return upsample8kTo16k(pcm16);
  }
}
