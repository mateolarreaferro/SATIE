/**
 * Multi-channel WAV encoder.
 *
 * - 1-2 channels: standard WAVE format (PCM)
 * - 3+ channels: WAVE_FORMAT_EXTENSIBLE (required for ambisonic files)
 *
 * Supports 16-bit and 24-bit PCM output.
 */

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

// KSDATAFORMAT_SUBTYPE_PCM GUID: 00000001-0000-0010-8000-00aa00389b71
const PCM_SUBTYPE_GUID = new Uint8Array([
  0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x10, 0x00,
  0x80, 0x00, 0x00, 0xaa,
  0x00, 0x38, 0x9b, 0x71,
]);

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Encode an AudioBuffer to a WAV Blob.
 *
 * @param buffer - The AudioBuffer to encode
 * @param bitDepth - 16 or 24 bit PCM (default: 16)
 * @returns A Blob containing the WAV file
 */
export function encodeWAV(buffer: AudioBuffer, bitDepth: 16 | 24 = 16): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const useExtensible = numChannels > 2;
  const fmtChunkSize = useExtensible ? 40 : 16;
  const headerSize = 12 + (8 + fmtChunkSize) + 8; // RIFF header + fmt chunk + data chunk header
  const fileSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(fileSize);
  const view = new DataView(arrayBuffer);
  let offset = 0;

  // RIFF header
  writeString(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, fileSize - 8, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;

  // fmt chunk
  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, fmtChunkSize, true); offset += 4;

  if (useExtensible) {
    view.setUint16(offset, WAVE_FORMAT_EXTENSIBLE, true); offset += 2;
  } else {
    view.setUint16(offset, WAVE_FORMAT_PCM, true); offset += 2;
  }

  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, bitDepth, true); offset += 2;

  if (useExtensible) {
    // cbSize: size of extension (22 bytes)
    view.setUint16(offset, 22, true); offset += 2;
    // wValidBitsPerSample
    view.setUint16(offset, bitDepth, true); offset += 2;
    // dwChannelMask: 0 for ambisonic (speaker-order-independent)
    view.setUint32(offset, 0, true); offset += 4;
    // SubFormat GUID (PCM)
    for (let i = 0; i < 16; i++) {
      view.setUint8(offset + i, PCM_SUBTYPE_GUID[i]);
    }
    offset += 16;
  }

  // data chunk
  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;

  // Interleave channel data
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  if (bitDepth === 16) {
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = clampSample(channels[ch][i]);
        const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, value, true);
        offset += 2;
      }
    }
  } else {
    // 24-bit — use unsigned right shift to fix sign extension for negative samples
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = clampSample(channels[ch][i]);
        const value = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        const u = value & 0xffffff; // mask to 24 bits, handles negative correctly
        view.setUint8(offset, u & 0xff);
        view.setUint8(offset + 1, (u >>> 8) & 0xff);
        view.setUint8(offset + 2, (u >>> 16) & 0xff);
        offset += 3;
      }
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Trigger a file download in the browser.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
