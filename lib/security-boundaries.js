'use strict';

const path = require('path');
const { ipKeyGenerator } = require('express-rate-limit');

const UPLOAD_TYPES = {
  '.jpg':  { contentType: 'image/jpeg', mimes: ['image/jpeg'], magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { contentType: 'image/jpeg', mimes: ['image/jpeg'], magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.png':  { contentType: 'image/png', mimes: ['image/png'], magic: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.gif':  { contentType: 'image/gif', mimes: ['image/gif'], magic: b => /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii')) },
  '.webp': { contentType: 'image/webp', mimes: ['image/webp'], magic: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  '.pdf':  { contentType: 'application/pdf', mimes: ['application/pdf'], magic: b => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  '.mp4':  { contentType: 'video/mp4', mimes: ['video/mp4', 'application/mp4'], magic: hasFtyp },
  '.mov':  { contentType: 'video/quicktime', mimes: ['video/quicktime', 'video/mp4'], magic: hasFtyp },
  '.webm': { contentType: 'video/webm', mimes: ['video/webm'], magic: b => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  '.ogg':  { contentType: 'audio/ogg', mimes: ['audio/ogg', 'video/ogg', 'application/ogg'], magic: b => b.subarray(0, 4).toString('ascii') === 'OggS' },
  '.mp3':  { contentType: 'audio/mpeg', mimes: ['audio/mpeg', 'audio/mp3'], magic: b => b.subarray(0, 3).toString('ascii') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  '.wav':  { contentType: 'audio/wav', mimes: ['audio/wav', 'audio/x-wav'], magic: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE' },
  '.m4a':  { contentType: 'audio/mp4', mimes: ['audio/mp4', 'audio/m4a', 'audio/x-m4a'], magic: hasFtyp },
  '.aac':  { contentType: 'audio/aac', mimes: ['audio/aac', 'audio/x-aac'], magic: b => b[0] === 0xff && (b[1] === 0xf1 || b[1] === 0xf9) },
};

function hasFtyp(buffer) {
  return buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

function uploadTypeFor(file) {
  const extension = path.extname(String(file?.originalname || '')).toLowerCase();
  const type = UPLOAD_TYPES[extension];
  if (!type) throw new Error('Unsupported upload extension');
  if (!type.mimes.includes(String(file?.mimetype || '').toLowerCase())) {
    throw new Error('Upload MIME does not match extension');
  }
  return { extension, ...type };
}

function validateUpload(file) {
  const type = uploadTypeFor(file);
  if (!Buffer.isBuffer(file?.buffer) || !type.magic(file.buffer)) {
    throw new Error('Upload content does not match declared file type');
  }
  return { extension: type.extension, contentType: type.contentType };
}

function ipv4Number(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inIpv4Range(value, base, prefix) {
  const baseValue = ipv4Number(base);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isPrivateIp(ip) {
  const normalized = String(ip || '').toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice(7));
  if (normalized.includes(':')) {
    return normalized === '::' || normalized === '::1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
  }
  const value = ipv4Number(normalized);
  if (value === null) return true;
  return [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ].some(([base, prefix]) => inIpv4Range(value, base, prefix));
}

async function assertSafeExternalUrl(value, lookup) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid external URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported URL protocol');
  if (url.username || url.password) throw new Error('URL credentials are not allowed');
  if (url.port) throw new Error('Non-default URL port is not allowed');
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('Private hostname is not allowed');

  const addresses = await lookup(url.hostname, { all: true });
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('Hostname did not resolve');
  if (addresses.some(({ address }) => isPrivateIp(address))) throw new Error('Private address is not allowed');
  return url;
}

async function readTextLimited(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('Remote response is too large');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Remote response is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function rateLimitKey(request) {
  return ipKeyGenerator(request.ip);
}

module.exports = {
  assertSafeExternalUrl,
  isPrivateIp,
  rateLimitKey,
  readTextLimited,
  uploadTypeFor,
  validateUpload,
};
