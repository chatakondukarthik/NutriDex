import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * A minimal, strict ZIP reader and writer.
 *
 * The archive is the user's backup: it must open in Finder, Explorer and
 * `unzip` years from now, so it is a real ZIP rather than a bespoke
 * container. Node ships `zlib.crc32`, `deflateRawSync` and `inflateRawSync`,
 * so this needs no dependency and no native build (SUP-02).
 *
 * The reader is the security boundary. An imported archive is untrusted
 * input, so it rejects:
 *   - path traversal and absolute names (`../x`, `/etc/passwd`, `C:\x`);
 *   - duplicate names (the second silently overwrites the first otherwise);
 *   - encryption, multi-disk and ZIP64 (we never write them);
 *   - more than `maxEntries` entries, or more than `maxTotalBytes`
 *     uncompressed, or a single entry larger than `maxEntryBytes`;
 *   - a decompression ratio that says "zip bomb";
 *   - a CRC mismatch (corruption, not just malformation).
 *
 * Compression is applied only when it actually helps. Images and the SQLite
 * snapshot are already compressed, so they are stored.
 */

export type ZipLimits = {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  /** Uncompressed:compressed ceiling for a single entry. */
  maxRatio: number;
  /** Below this size a ratio is meaningless (headers dominate). */
  ratioFloorBytes: number;
};

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxRatio: 400,
  ratioFloorBytes: 1024 * 1024,
};

export type ZipEntryInput = {
  name: string;
  data: Buffer;
  /** Default: deflate text, store anything already compressed. */
  compress?: boolean;
};

export type ZipReadOptions = {
  /**
   * Return true to skip inflating and verifying an entry. The importer uses
   * this for `snapshot.sqlite`, which it never reads: a 64 MB upload must not
   * be able to force a 200 MB allocation for a file that is ignored anyway.
   * Skipped entries are absent from the returned map.
   */
  skip?: (name: string) => boolean;
};

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const FLAG_ENCRYPTED = 0x0001;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

/**
 * Reject a name that could escape the extraction directory or confuse a
 * reader. Both the writer and the reader call this, so we cannot produce an
 * archive we would refuse to open.
 */
export function assertSafeEntryName(name: string): void {
  if (!name || name.length > 512) throw new ZipError("Archive entry has an invalid name.");
  if (name.startsWith("/") || name.startsWith("\\")) {
    throw new ZipError(`Archive entry "${name}" is absolute.`);
  }
  if (/^[A-Za-z]:/.test(name)) throw new ZipError(`Archive entry "${name}" is absolute.`);
  if (name.includes("\\")) throw new ZipError(`Archive entry "${name}" uses a backslash.`);
  if (name.includes("\0")) throw new ZipError("Archive entry name contains a null byte.");
  // Control characters are legal in ZIP but never in our own layout, and a
  // terminal/log renderer should not have to deal with them.
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new ZipError(`Archive entry "${name}" contains control characters.`);
  }
  const segments = name.split("/");
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    throw new ZipError(`Archive entry "${name}" escapes the archive root.`);
  }
  if (segments.some((segment) => segment === "")) {
    // Trailing slash is a directory entry, which we never write.
    throw new ZipError(`Archive entry "${name}" has an empty path segment.`);
  }
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  return { time: time & MAX_U16, date: day & MAX_U16 };
}

function isProbablyCompressed(name: string): boolean {
  return /\.(png|jpe?g|webp|gif|avif|heic|zip|gz|sqlite|db)$/i.test(name);
}

export function writeZip(entries: ZipEntryInput[], now: Date = new Date()): Buffer {
  if (entries.length > ZIP_LIMITS.maxEntries) {
    throw new ZipError(`Refusing to write more than ${ZIP_LIMITS.maxEntries} entries.`);
  }

  const { time, date } = dosDateTime(now);
  const seen = new Set<string>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  let total = 0;

  for (const entry of entries) {
    assertSafeEntryName(entry.name);
    if (seen.has(entry.name)) throw new ZipError(`Duplicate archive entry "${entry.name}".`);
    seen.add(entry.name);

    if (entry.data.length > ZIP_LIMITS.maxEntryBytes) {
      throw new ZipError(`Archive entry "${entry.name}" is too large.`);
    }
    total += entry.data.length;
    if (total > ZIP_LIMITS.maxTotalBytes) {
      throw new ZipError("Archive is too large to build.");
    }

    const shouldCompress = entry.compress ?? !isProbablyCompressed(entry.name);
    const deflated = shouldCompress ? deflateRawSync(entry.data, { level: 6 }) : entry.data;
    const useDeflate = shouldCompress && deflated.length < entry.data.length;
    const payload = useDeflate ? deflated : entry.data;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const checksum = crc32(entry.data) >>> 0;

    if (entry.data.length > MAX_U32 || payload.length > MAX_U32 || offset > MAX_U32) {
      throw new ZipError("Archive exceeds the 4 GB ZIP limit.");
    }

    const nameBytes = Buffer.from(entry.name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    localParts.push(local, nameBytes, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(0x031e, 4); // made by: UNIX, 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    // Owner-only regular file: `unzip` restores this on POSIX.
    central.writeUInt32LE((0o100600 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + payload.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  if (centralBuffer.length > MAX_U32) throw new ZipError("Archive central directory is too large.");

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

type CentralEntry = {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function findEocd(buffer: Buffer): number {
  // The comment field is at most 65535 bytes, so the record starts within
  // that window of the end.
  const start = Math.max(0, buffer.length - (22 + MAX_U16));
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError("That file is not a ZIP archive.");
}

export function readZip(
  buffer: Buffer,
  limits: ZipLimits = ZIP_LIMITS,
  options: ZipReadOptions = {},
): Map<string, Buffer> {
  if (buffer.length < 22) throw new ZipError("That file is not a ZIP archive.");
  const eocd = findEocd(buffer);

  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new ZipError("Multi-disk archives are not supported.");
  }
  if (totalEntries === MAX_U16 || centralSize === MAX_U32 || centralOffset === MAX_U32) {
    throw new ZipError("ZIP64 archives are not supported.");
  }
  if (totalEntries > limits.maxEntries) {
    throw new ZipError(`Archive has more than ${limits.maxEntries} entries.`);
  }
  if (centralOffset + centralSize > buffer.length) {
    throw new ZipError("Archive central directory is truncated.");
  }

  const central: CentralEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIG) {
      throw new ZipError("Archive central directory is malformed.");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);

    if (compressedSize === MAX_U32 || uncompressedSize === MAX_U32 || localOffset === MAX_U32) {
      throw new ZipError("ZIP64 archives are not supported.");
    }
    if (flags & FLAG_ENCRYPTED) throw new ZipError("Encrypted ZIP entries are not supported.");
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
      throw new ZipError(`Unsupported ZIP compression method ${method}.`);
    }

    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw new ZipError("Archive entry name is truncated.");
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    assertSafeEntryName(name);

    if (options.skip?.(name)) {
      // Still advance the cursor; only the payload work is skipped.
      cursor = nameEnd + extraLength + commentLength;
      continue;
    }

    central.push({
      name,
      method,
      flags,
      crc: checksum,
      compressedSize,
      uncompressedSize,
      localOffset,
    });

    cursor = nameEnd + extraLength + commentLength;
  }

  const files = new Map<string, Buffer>();
  let totalBytes = 0;

  for (const entry of central) {
    if (files.has(entry.name)) throw new ZipError(`Duplicate archive entry "${entry.name}".`);
    if (entry.uncompressedSize > limits.maxEntryBytes) {
      throw new ZipError(`Archive entry "${entry.name}" is too large.`);
    }
    totalBytes += entry.uncompressedSize;
    if (totalBytes > limits.maxTotalBytes) {
      throw new ZipError("Archive expands to more data than this app will read.");
    }
    if (
      entry.uncompressedSize > limits.ratioFloorBytes &&
      entry.compressedSize > 0 &&
      entry.uncompressedSize / entry.compressedSize > limits.maxRatio
    ) {
      throw new ZipError(`Archive entry "${entry.name}" looks like a zip bomb.`);
    }

    const local = entry.localOffset;
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL_SIG) {
      throw new ZipError(`Archive entry "${entry.name}" has no local header.`);
    }
    // The local header's name and extra lengths are what locate the data.
    // The name and method must agree with the central directory: otherwise
    // `unzip` and this reader disagree about what the file is.
    const localNameLength = buffer.readUInt16LE(local + 26);
    const localExtraLength = buffer.readUInt16LE(local + 28);
    const localNameEnd = local + 30 + localNameLength;
    if (localNameEnd > buffer.length) {
      throw new ZipError(`Archive entry "${entry.name}" is truncated.`);
    }
    const localName = buffer.subarray(local + 30, localNameEnd).toString("utf8");
    if (localName !== entry.name) {
      throw new ZipError(`Archive entry "${entry.name}" has a mismatched local name.`);
    }
    if (buffer.readUInt16LE(local + 8) !== entry.method) {
      throw new ZipError(`Archive entry "${entry.name}" has a mismatched local method.`);
    }

    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buffer.length) {
      throw new ZipError(`Archive entry "${entry.name}" is truncated.`);
    }

    const payload = buffer.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (entry.method === METHOD_STORE) {
      data = Buffer.from(payload);
    } else {
      try {
        data = inflateRawSync(payload, { maxOutputLength: limits.maxEntryBytes });
      } catch {
        throw new ZipError(`Archive entry "${entry.name}" could not be decompressed.`);
      }
    }

    if (data.length !== entry.uncompressedSize) {
      throw new ZipError(`Archive entry "${entry.name}" has the wrong size.`);
    }
    if ((crc32(data) >>> 0) !== entry.crc) {
      throw new ZipError(`Archive entry "${entry.name}" is corrupt (checksum mismatch).`);
    }

    files.set(entry.name, data);
  }

  return files;
}
