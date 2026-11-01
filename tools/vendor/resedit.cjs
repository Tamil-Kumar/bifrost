"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../wb-cache/vendor-src/resedit-js/src/main/index.ts
var index_exports = {};
__export(index_exports, {
  Data: () => data_exports,
  Format: () => format_exports,
  Mui: () => mui_exports,
  NtExecutable: () => NtExecutable,
  NtExecutableResource: () => NtExecutableResource,
  Resource: () => resource_exports,
  generateExecutableWithSign: () => generateExecutableWithSign,
  version: () => version_default2
});
module.exports = __toCommonJS(index_exports);

// ../wb-cache/vendor-src/pe-library-js/src/main/format/index.ts
var format_exports = {};
__export(format_exports, {
  ArrayFormatBase: () => ArrayFormatBase_default,
  FormatBase: () => FormatBase,
  ImageDataDirectoryArray: () => ImageDataDirectoryArray,
  ImageDirectoryEntry: () => ImageDirectoryEntry_default,
  ImageDosHeader: () => ImageDosHeader,
  ImageFileHeader: () => ImageFileHeader,
  ImageNtHeaders: () => ImageNtHeaders,
  ImageOptionalHeader: () => ImageOptionalHeader,
  ImageOptionalHeader64: () => ImageOptionalHeader64,
  ImageSectionHeaderArray: () => ImageSectionHeaderArray,
  findImageSectionBlockByDirectoryEntry: () => findImageSectionBlockByDirectoryEntry,
  getImageDosHeader: () => getImageDosHeader,
  getImageNtHeadersByDosHeader: () => getImageNtHeadersByDosHeader,
  getImageSectionHeadersByNtHeaders: () => getImageSectionHeadersByNtHeaders
});

// ../wb-cache/vendor-src/pe-library-js/src/main/format/FormatBase.ts
var FormatBase = class {
  constructor(view) {
    this.view = view;
  }
  copyTo(bin, offset) {
    new Uint8Array(bin, offset, this.view.byteLength).set(
      new Uint8Array(
        this.view.buffer,
        this.view.byteOffset,
        this.view.byteLength
      )
    );
  }
  get byteLength() {
    return this.view.byteLength;
  }
};

// ../wb-cache/vendor-src/pe-library-js/src/main/format/ArrayFormatBase.ts
var ArrayFormatBase = class extends FormatBase {
  constructor(view) {
    super(view);
  }
  forEach(callback) {
    const len = this.length;
    const a = [];
    a.length = len;
    for (let i = 0; i < len; ++i) {
      a[i] = this.get(i);
    }
    for (let i = 0; i < len; ++i) {
      callback(a[i], i, this);
    }
  }
  _iterator() {
    return new class {
      constructor(base) {
        this.base = base;
        this.i = 0;
      }
      next() {
        if (this.i === this.base.length) {
          return {
            value: void 0,
            done: true
          };
        } else {
          return {
            value: this.base.get(this.i++),
            done: false
          };
        }
      }
    }(this);
  }
};
if (typeof Symbol !== "undefined") {
  ArrayFormatBase.prototype[Symbol.iterator] = // eslint-disable-next-line @typescript-eslint/unbound-method
  ArrayFormatBase.prototype._iterator;
}
var ArrayFormatBase_default = ArrayFormatBase;

// ../wb-cache/vendor-src/pe-library-js/src/main/format/ImageDataDirectoryArray.ts
var ImageDataDirectoryArray = class _ImageDataDirectoryArray extends ArrayFormatBase_default {
  constructor(view) {
    super(view);
    this.length = 16;
  }
  static {
    this.size = 128;
  }
  static {
    // 16 * 8
    this.itemSize = 8;
  }
  /** @note This does not clone binary data; the changes to the array will modify the specified buffer `bin` */
  static from(bin, offset = 0) {
    return new _ImageDataDirectoryArray(new DataView(bin, offset, 128));
  }
  get(index) {
    return {
      virtualAddress: this.view.getUint32(index * 8, true),
      size: this.view.getUint32(4 + index * 8, true)
    };
  }
  set(index, data) {
    this.view.setUint32(index * 8, data.virtualAddress, true);
    this.view.setUint32(4 + index * 8, data.size, true);
  }
  findIndexByVirtualAddress(virtualAddress) {
    for (let i = 0; i < 16; ++i) {
      const va = this.view.getUint32(i * 8, true);
      const vs = this.view.getUint32(4 + i * 8, true);
      if (virtualAddress >= va && virtualAddress < va + vs) {
        return i;
      }
    }
    return null;
  }
};

// ../wb-cache/vendor-src/pe-library-js/src/main/format/ImageDirectoryEntry.ts
var ImageDirectoryEntry = {
  Export: 0,
  Import: 1,
  Resource: 2,
  Exception: 3,
  Certificate: 4,
  Security: 4,
  // alias
  BaseRelocation: 5,
  Debug: 6,
  Architecture: 7,
  GlobalPointer: 8,
  Tls: 9,
  TLS: 9,
  // alias
  LoadConfig: 10,
  BoundImport: 11,
  Iat: 12,
  IAT: 12,
  // alias
  DelayImport: 13,
  ComDescriptor: 14,
  COMDescriptor: 14
  // alias
};
var ImageDirectoryEntry_default = ImageDirectoryEntry;

// ../wb-cache/vendor-src/pe-library-js/src/main/util/functions.ts
function cloneObject(object) {
  const r = {};
  Object.keys(object).forEach((key) => {
    r[key] = object[key];
  });
  return r;
}
function createDataView(bin, byteOffset, byteLength) {
  if ("buffer" in bin) {
    let newOffset = bin.byteOffset;
    let newLength = bin.byteLength;
    if (typeof byteOffset !== "undefined") {
      newOffset += byteOffset;
      newLength -= byteOffset;
    }
    if (typeof byteLength !== "undefined") {
      newLength = byteLength;
    }
    return new DataView(bin.buffer, newOffset, newLength);
  } else {
    return new DataView(bin, byteOffset, byteLength);
  }
}
function calculateCheckSumForPE(bin, storeToBinary) {
  const dosHeader = ImageDosHeader.from(bin);
  const view = new DataView(bin);
  const checkSumOffset = dosHeader.newHeaderAddress + 88;
  let result = 0;
  const limit = 4294967296;
  const update = (dword) => {
    result += dword;
    if (result >= limit) {
      result = result % limit + (result / limit | 0);
    }
  };
  const len = view.byteLength;
  const lenExtra = len % 4;
  const lenAlign = len - lenExtra;
  for (let i = 0; i < lenAlign; i += 4) {
    if (i !== checkSumOffset) {
      update(view.getUint32(i, true));
    }
  }
  if (lenExtra !== 0) {
    let extra = 0;
    for (let i = 0; i < lenExtra; i++) {
      extra |= view.getUint8(lenAlign + i) << (3 - i) * 8;
    }
    update(extra);
  }
  result = (result & 65535) + (result >>> 16);
  result += result >>> 16;
  result = (result & 65535) + len;
  if (storeToBinary) {
    view.setUint32(checkSumOffset, result, true);
  }
  return result;
}
function roundUp(val, align) {
  return Math.floor((val + align - 1) / align) * align;
}
function copyBuffer(dest, destOffset, src, srcOffset, length) {
  const ua8Dest = "buffer" in dest ? new Uint8Array(
    dest.buffer,
    dest.byteOffset + (destOffset || 0),
    length
  ) : new Uint8Array(dest, destOffset, length);
  const ua8Src = "buffer" in src ? new Uint8Array(
    src.buffer,
    src.byteOffset + (srcOffset || 0),
    length
  ) : new Uint8Array(src, srcOffset, length);
  ua8Dest.set(ua8Src);
}
function allocatePartialBinary(binBase, offset, length) {
  const b = new ArrayBuffer(length);
  copyBuffer(b, 0, binBase, offset, length);
  return b;
}
function cloneToArrayBuffer(binBase) {
  if ("buffer" in binBase) {
    const b = new ArrayBuffer(binBase.byteLength);
    new Uint8Array(b).set(
      new Uint8Array(
        binBase.buffer,
        binBase.byteOffset,
        binBase.byteLength
      )
    );
    return b;
  } else {
    const b = new ArrayBuffer(binBase.byteLength);
    new Uint8Array(b).set(new Uint8Array(binBase));
    return b;
  }
}
function getFixedString(view, offset, length) {
  let actualLen = 0;
  for (let i = 0; i < length; ++i) {
    if (view.getUint8(offset + i) === 0) {
      break;
    }
    ++actualLen;
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(
      view.buffer,
      view.byteOffset + offset,
      actualLen
    ).toString("utf8");
  } else if (typeof decodeURIComponent !== "undefined") {
    let s = "";
    for (let i = 0; i < actualLen; ++i) {
      const c = view.getUint8(offset + i);
      if (c < 16) {
        s += "%0" + c.toString(16);
      } else {
        s += "%" + c.toString(16);
      }
    }
    return decodeURIComponent(s);
  } else {
    let s = "";
    for (let i = 0; i < actualLen; ++i) {
      const c = view.getUint8(offset + i);
      s += String.fromCharCode(c);
    }
    return s;
  }
}
function setFixedString(view, offset, length, text) {
  if (typeof Buffer !== "undefined") {
    const u = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    u.set(new Uint8Array(length));
    u.set(Buffer.from(text, "utf8").subarray(0, length));
  } else if (typeof encodeURIComponent !== "undefined") {
    const s = encodeURIComponent(text);
    for (let i = 0, j = 0; i < length; ++i) {
      if (j >= s.length) {
        view.setUint8(i + offset, 0);
      } else {
        const c = s.charCodeAt(j);
        if (c === 37) {
          const n = parseInt(s.substr(j + 1, 2), 16);
          if (typeof n === "number" && !isNaN(n)) {
            view.setUint8(i + offset, n);
          } else {
            view.setUint8(i + offset, 0);
          }
          j += 3;
        } else {
          view.setUint8(i + offset, c);
        }
      }
    }
  } else {
    for (let i = 0, j = 0; i < length; ++i) {
      if (j >= text.length) {
        view.setUint8(i + offset, 0);
      } else {
        const c = text.charCodeAt(j);
        view.setUint8(i + offset, c & 255);
      }
    }
  }
}
function binaryToString(bin) {
  if (typeof TextDecoder !== "undefined") {
    const dec = new TextDecoder();
    return dec.decode(bin);
  } else if (typeof Buffer !== "undefined") {
    let b;
    if ("buffer" in bin) {
      b = Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength);
    } else {
      b = Buffer.from(bin);
    }
    return b.toString("utf8");
  } else {
    let view;
    if ("buffer" in bin) {
      view = new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
    } else {
      view = new Uint8Array(bin);
    }
    if (typeof decodeURIComponent !== "undefined") {
      let s = "";
      for (let i = 0; i < view.length; ++i) {
        const c = view[i];
        if (c < 16) {
          s += "%0" + c.toString(16);
        } else {
          s += "%" + c.toString(16);
        }
      }
      return decodeURIComponent(s);
    } else {
      let s = "";
      for (let i = 0; i < view.length; ++i) {
        const c = view[i];
        s += String.fromCharCode(c);
      }
      return s;
    }
  }
}
function stringToBinary(string) {
  if (typeof TextEncoder !== "undefined") {
    const enc = new TextEncoder();
    return cloneToArrayBuffer(enc.encode(string));
  } else if (typeof Buffer !== "undefined") {
    return cloneToArrayBuffer(Buffer.from(string, "utf8"));
  } else if (typeof encodeURIComponent !== "undefined") {
    const data = encodeURIComponent(string);
    let len = 0;
    for (let i = 0; i < data.length; ++len) {
      const c = data.charCodeAt(i);
      if (c === 37) {
        i += 3;
      } else {
        ++i;
      }
    }
    const bin = new ArrayBuffer(len);
    const view = new Uint8Array(bin);
    for (let i = 0, j = 0; i < data.length; ++j) {
      const c = data.charCodeAt(i);
      if (c === 37) {
        const n = parseInt(data.substring(i + 1, i + 3), 16);
        view[j] = n;
        i += 3;
      } else {
        view[j] = c;
        ++i;
      }
    }
    return bin;
  } else {
    const bin = new ArrayBuffer(string.length);
    new Uint8Array(bin).set(
      [].map.call(
        string,
        (c) => c.charCodeAt(0)
      )
    );
    return bin;
  }
}

// ../wb-cache/vendor-src/pe-library-js/src/main/format/ImageDosHeader.ts
var ImageDosHeader = class _ImageDosHeader extends FormatBase {
  static {
    this.size = 64;
  }
  static {
    this.DEFAULT_MAGIC = 23117;
  }
  // 'MZ'
  constructor(view) {
    super(view);
  }
  static from(bin, offset = 0) {
    return new _ImageDosHeader(createDataView(bin, offset, 64));
  }
  isValid() {
    return this.magic === _ImageDosHeader.DEFAULT_MAGIC;
  }
  get magic() {
    return this.view.getUint16(0, true);
  }
  set magic(val) {
    this.view.setUint16(0, val, true);
  }
  get lastPageSize() {
    return this.view.getUint16(2, true);
  }
  set lastPageSize(val) {
    this.view.setUint16(2, val, true);
  }
  get pages() {
    return this.view.getUint16(4, true);
  }
  set pages(val) {
    this.view.setUint16(4, val, true);
  }
  get relocations() {
    return this.view.getUint16(6, true);
  }
  set relocations(val) {
    this.view.setUint16(6, val, true);
  }
  get headerSizeInParagraph() {
    return this.view.getUint16(8, true);
  }
  set headerSizeInParagraph(val) {
    this.view.setUint16(8, val, true);
  }
  get minAllocParagraphs() {
    return this.view.getUint16(10, true);
  }
  set minAllocParagraphs(val) {
    this.view.setUint16(10, val, true);
  }
  get maxAllocParagraphs() {
    return this.view.getUint16(12, true);
  }
  set maxAllocParagraphs(val) {
    this.view.setUint16(12, val, true);
  }
  get initialSS() {
    return this.view.getUint16(14, true);
  }
  set initialSS(val) {
    this.view.setUint16(14, val, true);
  }
  get initialSP() {
    return this.view.getUint16(16, true);
  }
  set initialSP(val) {
    this.view.setUint16(16, val, true);
  }
  get checkSum() {
    return this.view.getUint16(18, true);
  }
  set checkSum(val) {
    this.view.setUint16(18, val, true);
  }
  get initialIP() {
    return this.view.getUint16(20, true);
  }
  set initialIP(val) {
    this.view.setUint16(20, val, true);
  }
  get initialCS() {
    return this.view.getUint16(22, true);
  }
  set initialCS(val) {
    this.view.setUint16(22, val, true);
  }
  get relocationTableAddress() {
    return this.view.getUint16(24, true);
  }
  set relocationTableAddress(val) {
    this.view.setUint16(24, val, true);
  }
  get overlayNum() {
    return this.view.getUint16(26, true);
  }
  set overlayNum(val) {
    this.view.setUint16(26, val, true);
  }
  // WORD e_res[4] (28,30,32,34)
  get oemId() {
    return this.view.getUint16(36, true);
  }
  set oemId(val) {
    this.view.setUint16(36, val, true);
  }
  get oemInfo() {
    return this.view.getUint16(38, true);
  }
  set oemInfo(val) {
    this.view.setUint16(38, val, true);
  }
  // WORD e_res2[10] (40,42,44,46,48,50,52,54,56,58)
  get newHeaderAddress() {
    return this.view.getUint32(60, true);
  }
  set newHeaderAddress(val) {
    this.view.setUint32(60, val, true);
  }
};

// ../wb-cache/vendor-src/pe-library-js/src/main/format/ImageFileHeader.ts
var ImageFileHeader = class _ImageFileHeader extends FormatBase {
  static {
    this.size = 20;
  }
  constructor(view) {
    super(view);
  }
  static from(bin, offset = 0) {
    return new _ImageFileHeader(new DataView(bin, offset, 20));
  }
  get machine() {
    return this.view.getUint16(0, true);
  }
  set machine(val) {
    this.view.setUint16(0, val, true);
  }
  get numberOfSections() {
    return this.view.getUint16(2, true);
  }
  set numberOfSections(val) {
    this.view.setUint16(2, val, true);
  }
  get timeDateStamp() {
    return this.view.getUint32(4, true);
  }
  set timeDateStamp(val) {
    this.view.setUint32(4, val, true);
  }
  get pointerToSymbolTable() {
    return this.view.getUint32(8, true);
  }
  set pointerToSymbolTable(val) {
    this.view.setUint32(8, val, true);
  }
  get numberOfSymbols() {
    return this.view.getUint32(12, true);
  }
  set numberOfSymbols(val) {
    this.view.setUint32(12, val, true);
  }
  get sizeOfOptionalHeader() {
    return this.view.getUint16(16, true);
  }
  set sizeOfOptionalHeader(val) {
    this.view.setUint16(16, val, true);
  }
  get characteristics() {
    return this.view.getUint16(18, true);
  }
  set characteristics(val) {
    this.view.setUint16(18, val, true);
  }
};

// ../wb-cache/vendor-src/pe-library-js/src/main/format/ImageOptionalHeader.ts
var ImageOptionalHeader = class _ImageOptionalHeader extends FormatBase {
  static {
    this.size = 96;
  }
  static {
    this.DEFAULT_MAGIC = 267;
  }
  constructor(view) {
    super(view);
  }
  static from(bin, offset = 0) {
    return new _ImageOptionalHeader(new DataView(bin, offset, 96));
  }
  get magic() {
    return this.view.getUint16(0, true);
  }
  set magic(val) {
    this.view.setUint16(0, val, true);
  }
  get majorLinkerVersion() {
    return this.view.getUint8(2);
  }
  set majorLinkerVersion(val) {
    this.view.setUint8(2, val);
  }
  get minorLinkerVersion() {
    return this.view.getUint8(3);
  }
  set minorLinkerVersion(val) {
    this.view.setUint8(3, val);
  }
  get sizeOfCode() {
    return this.view.getUint32(4, true);
  }
  set sizeOfCode(val) {
    this.view.setUint32(4, val, true);
  }
  get sizeOfInitializedData() {
    return this.view.getUint32(8, true);
  }
  set sizeOfInitializedData(val) {
    this.view.setUint32(8, val, true);
  }
  get sizeOfUninitializedData() {
    return this.view.getUint32(12, true);
  }
  set sizeOfUninitializedData(val) {
    this.view.setUint32(12, val, true);
  }
  get addressOfEntryPoint() {
    return this.view.getUint32(16, true);
  }
  set addressOfEntryPoint(val) {
    this.view.setUint32(16, val, true);
  }
  get baseOfCode() {
    return this.view.getUint32(20, true);
  }
  set baseOfCode(val) {
    this.view.setUint32(20, val, true);
  }
  get baseOfData() {
    return this.view.getUint32(24, true);
  }
  set baseOfData(val) {
    this.view.setUint32(24, val, true);
  }
  get imageBase() {
    return this.view.getUint32(28, true);
  }
  set imageBase(val) {
    this.view.setUint32(28, val, true);
  }
  get sectionAlignment() {
    return this.view.getUint32(32, true);
  }
  set sectionAlignment(val) {
    this.view.setUint32(32, val, true);
  }
  get fileAlignment() {
    return this.view.getUint32(36, true);
  }
  set fileAlignment(val) {
    this.view.setUint32(36, val, true);
  }
  get majorOperatingSystemVersion() {
    return this.view.getUint16(40, true);
  }
  set majorOperatingSystemVersion(val) {
    this.view.setUint16(40, val, true);
  }
  get minorOperatingSystemVersion() {
    return this.view.getUint16(42, true);
  }
  set minorOperatingSystemVersion(val) {
    this.view.setUint16(42, val, true);
  }
  get majorImageVersion() {
    return this.view.getUint16(44, true);
  }
  set majorImageVersion(val) {
    this.view.setUint16(44, val, true);
  }
  get minorImageVersion() {
    return this.view.getUint16(46, true);
  }
  set minorImageVersion(val) {
    this.view.setUint16(46, val, true);
  }
  get majorSubsystemVersion() {
    return this.view.getUint16(48, true);
  }
  set majorSubsystemVersion(val) {
    this.view.setUint16(48, val, true);
  }
  get minorSubsystemVersion() {
    return this.view.getUint16(50, true);
  }
  set minorSubsystemVersion(val) {
    this.view.setUint16(50, val, true);
  }
  get win32VersionValue() {
    return this.view.getUint32(52, true);
  }
  set win32VersionValue(val) {
    this.view.setUint32(52, val, true);
  }
  get sizeOfImage() {
    return this.view.getUint32(56, true);
  }
  set sizeOfImage(val) {
    this.view.setUint32(56, val, true);
  }
  get sizeOfHeaders() {
    return this.view.getUint32(60, true);
  }
  set sizeOfHeaders(val) {
    this.view.setUint32(60, val, true);
  }
  get checkSum() {
    return this.view.getUint32(64, true);
  }
  set checkSum(val) {
    this.view.setUint32(64, val, true);
  }
  get subsystem() {
    return this.view.getUint16(68, true);
  }
  set subsystem(val) {
    this.view.setUint16(68, val, true);
  }
  get dllCharacteristics() {
    return this.view.getUint16(70, true);
  }
  set dllCharacteristics(val) {
    this.view.setUint16(70, val, true);
  }
  get sizeOfStackReserve() {
    return this.view.getUint32(72, true);
  }
  set sizeOfStackReserve(val) {
    this.view.setUint32(72, val, true);
  }
  get sizeOfStackCommit() {
    return this.view.getUint32(76, true);
  }
  set sizeOfStackCommit(val) {
    this.view.setUint32(76, val, true);
  }
  get sizeOfHeapReserve() {
    return this.view.getUint32(80, true);
  }
  set sizeOfHeapReserve(val) {
    this.view.setUint32(80, val, true);
  }
  get sizeOfHeapCommit() {
    return this.view.getUint32(84, true);
  }
  set sizeOfHeapCommit(val) {
    this.view.setUint32(84, val, true);
  }
  get loaderFlags() {
    return this.view.getUint32(88, true);
  }
  set loaderFlags(val) {
    this.view.setUint32(88, val, true);
  }
  get numberOfRvaAndSizes() {
    return this.view.getUint32(92, true);
  }
  set numberOfRvaAndSizes(val) {
    this.view.setUint32(92, val, true);
  }
};

// ../wb-cache/vendor-src/pe-library-js/src/main/format/ImageOptionalHeader64.ts
function getUint64LE(view, offset) {
  return view.getUint32(offset + 4, true) * 4294967296 + view.getUint32(offset, true);
}
function setUint64LE(view, offset, val) {
  view.setUint32(offset, val & 4294967295, true);
  view.setUint32(offset + 4, Math.floor(val / 4294967296), true);
}
function getUint64LEBigInt(view, offset) {
  if (typeof BigInt === "undefined") {
    throw new Error("BigInt not supported");
  }
  return BigInt(4294967296) * BigInt(view.getUint32(offset + 4, true)) + BigInt(view.getUint32(offset, true));
}
function setUint64LEBigInt(view, offset, val) {
  if (typeof BigInt === "undefined") {
    throw new Error("BigInt not supported");
  }
  view.setUint32(offset, Number(val & BigInt(4294967295)), true);
  view.setUint32(
    offset + 4,
    Math.floor(Number(val / BigInt(4294967296) & BigInt(4294967295))),
    true
  );
}
var ImageOptionalHeader64 = class _ImageOptionalHeader64 extends FormatBase {
  static {
    this.size = 112;
  }
  static {
    this.DEFAULT_MAGIC = 523;
  }
  constructor(view) {
    super(view);
  }
  static from(bin, offset = 0) {
    return new _ImageOptionalHeader64(new DataView(bin, offset, 112));
  }
  get magic() {
    return this.view.getUint16(0, true);
  }
  set magic(val) {
    this.view.setUint16(0, val, true);
  }
  get majorLinkerVersion() {
    return this.view.getUint8(2);
  }
  set majorLinkerVersion(val) {
    this.view.setUint8(2, val);
  }
  get minorLinkerVersion() {
    return this.view.getUint8(3);
  }
  set minorLinkerVersion(val) {
    this.view.setUint8(3, val);
  }
  get sizeOfCode() {
    return this.view.getUint32(4, true);
  }
  set sizeOfCode(val) {
    this.view.setUint32(4, val, true);
  }
  get sizeOfInitializedData() {
    return this.view.getUint32(8, true);
  }
  set sizeOfInitializedData(val) {
    this.view.setUint32(8, val, true);
  }
  get sizeOfUninitializedData() {
    return this.view.getUint32(12, true);
  }
  set sizeOfUninitializedData(val) {
    this.view.setUint32(12, val, true);
  }
  get addressOfEntryPoint() {
    return this.view.getUint32(16, true);
  }
  set addressOfEntryPoint(val) {
    this.view.setUint32(16, val, true);
  }
  get baseOfCode() {
    return this.view.getUint32(20, true);
  }
  set baseOfCode(val) {
    this.view.setUint32(20, val, true);
  }
  get imageBase() {
    return getUint64LE(this.view, 24);
  }
  set imageBase(val) {
    setUint64LE(this.view, 24, val);
  }
  get imageBaseBigInt() {
    return getUint64LEBigInt(this.view, 24);
  }
  set imageBaseBigInt(val) {
    setUint64LEBigInt(this.view, 24, val);
  }
  get sectionAlignment() {
    return this.view.getUint32(32, true);
  }
  set sectionAlignment(val) {
    this.view.setUint32(32, val, true);
  }
  get fileAlignment() {
    return this.view.getUint32(36, true);
  }
  set fileAlignment(val) {
    this.view.setUint32(36, val, true);
  }
  get majorOperatingSystemVersion() {
    return this.view.getUint16(40, true);
  }
  set majorOperatingSystemVersion(val) {
    this.view.setUint16(40, val, true);
  }
  get minorOperatingSystemVersion() {
    return this.view.getUint16(42, true);
  }
  set minorOperatingSystemVersion(val) {
    this.view.setUint16(42, val, true);
  }
  get majorImageVersion() {
    return this.view.getUint16(44, true);
  }
  set majorImageVersion(val) {
    this.view.setUint16(44, val, true);
  }
  get minorImageVersion() {
    return this.view.getUint16(46, true);
  }
  set minorImageVersion(val) {
    this.view.setUint16(46, val, true);
  }
  get majorSubsystemVersion() {
    return this.view.getUint16(48, true);
  }
  set majorSubsystemVersion(val) {
    this.view.setUint16(48, val, true);
  }
  get minorSubsystemVersion() {
    return this.view.getUint16(50, true);
  }
  set minorSubsystemVersion(val) {
    this.view.setUint16(50, val, true);
  }
  get win32VersionValue() {
    return this.view.getUint32(52, true);
  }
  set win32VersionValue(val) {
    this.view.setUint32(52, val, true);
  }
  get sizeOfImage() {
    return this.view.getUint32(56, true);
  }
  set sizeOfImage(val) {
    this.view.setUint32(56, val, true);
  }
  get sizeOfHeaders() {
    return this.view.getUint32(60, true);
  }
  set sizeOfHeaders(val) {
    this.view.setUint32(60, val, true);
  }
  get checkSum() {
    return this.view.getUint32(64, true);
  }
  set checkSum(val) {
    this.view.setUint32(64, val, true);
  }
  get subsystem() {
    return this.view.getUint16(68, true);
  }
  set subsystem(val) {
    this.view.setUint16(68, val, true);
  }
  get dllCharacteristics() {
    return this.view.getUint16(70, true);
  }
  set dllCharacteristics(val) {
    this.view.setUint16(70, val, true);
  }
  get sizeOfStackReserve() {
    return getUint64LE(this.view, 72);
  }
  set sizeOfStackReserve(val) {
    setUint64LE(this.view, 72, val);
  }
  get sizeOfStackReserveBigInt() {
    return getUint64LEBigInt(this.view, 72);
  }
  set sizeOfStackReserveBigInt(val) {
    setUint64LEBigInt(this.view, 72, val);
  }
  get sizeOfStackCommit() {
    return getUint64LE(this.view, 80);
  }
  set sizeOfStackCommit(val) {
    setUint64LE(this.view, 80, val);
  }
  get sizeOfStackCommitBigInt() {
    return getUint64LEBigInt(this.view, 80);
  }
  set sizeOfStackCommitBigInt(val) {
    setUint64LEBigInt(this.view, 80, val);
  }
  get sizeOfHeapReserve() {
    return getUint64LE(this.view, 88);
  }
  set sizeOfHeapReserve(val) {
    setUint64LE(this.view, 88, val);
  }
  get sizeOfHeapReserveBigInt() {
    return getUint64LEBigInt(this.view, 88);
  }
  set sizeOfHeapReserveBigInt(val) {
    setUint64LEBigInt(this.view, 88, val);
  }
  get sizeOfHeapCommit() {
    return getUint64LE(this.view, 96);
  }
  set sizeOfHeapCommit(val) {
    setUint64LE(this.view, 96, val);
  }
  get sizeOfHeapCommitBigInt() {
    return getUint64LEBigInt(this.view, 96);
  }
  set sizeOfHeapCommitBigInt(val) {
    setUint64LEBigInt(this.view, 96, val);
  }
  get loaderFlags() {
    return this.view.getUint32(104, true);
  }
  set loaderFlags(val) {
    this.view.setUint32(104, val, true);
  }
  get numberOfRvaAndSizes() {
    return this.view.getUint32(108, true);
  }
  set numberOfRvaAndSizes(val) {
    this.view.setUint32(108, val, true);
  }
};

// ../wb-cache/vendor-src/pe-library-js/src/main/format/ImageNtHeaders.ts
var ImageNtHeaders = class _ImageNtHeaders extends FormatBase {
  static {
    this.DEFAULT_SIGNATURE = 17744;
  }
  // 'PE\x00\x00'
  constructor(view) {
    super(view);
  }
  static from(bin, offset = 0) {
    const magic = createDataView(
      bin,
      offset + ImageFileHeader.size,
      6
    ).getUint16(4, true);
    let len = 4 + ImageFileHeader.size + ImageDataDirectoryArray.size;
    if (magic === ImageOptionalHeader64.DEFAULT_MAGIC) {
      len += ImageOptionalHeader64.size;
    } else {
      len += ImageOptionalHeader.size;
    }
    return new _ImageNtHeaders(createDataView(bin, offset, len));
  }
  isValid() {
    return this.signature === _ImageNtHeaders.DEFAULT_SIGNATURE;
  }
  is32bit() {
    return this.view.getUint16(ImageFileHeader.size + 4, true) === ImageOptionalHeader.DEFAULT_MAGIC;
  }
  get signature() {
    return this.view.getUint32(0, true);
  }
  set signature(val) {
    this.view.setUint32(0, val, true);
  }
  get fileHeader() {
    return ImageFileHeader.from(this.view.buffer, this.view.byteOffset + 4);
  }
  get optionalHeader() {
    const off = ImageFileHeader.size + 4;
    const magic = this.view.getUint16(off, true);
    if (magic === ImageOptionalHeader64.DEFAULT_MAGIC) {
      return ImageOptionalHeader64.from(
        this.view.buffer,
        this.view.byteOffset + off
      );
    } else {
      return ImageOptionalHeader.from(
        this.view.buffer,
        this.view.byteOffset + off
      );
    }
  }
  get optionalHeaderDataDirectory() {
    return ImageDataDirectoryArray.from(
      this.view.buffer,
      this.view.byteOffset + this.getDataDirectoryOffset()
    );
  }
  getDataDirectoryOffset() {
    let off = ImageFileHeader.size + 4;
    const magic = this.view.getUint16(off, true);
    if (magic === ImageOptionalHeader64.DEFAULT_MAGIC) {
      off += ImageOptionalHeader64.size;
    } else {
      off += ImageOptionalHeader.size;
    }
    return off;
  }
  getSectionHeaderOffset() {
    return this.getDataDirectoryOffset() + ImageDataDirectoryArray.size;
  }
};

// ../wb-cache/vendor-src/pe-library-js/src/main/format/ImageSectionHeaderArray.ts
var ImageSectionHeaderArray = class _ImageSectionHeaderArray extends ArrayFormatBase_default {
  constructor(view, length) {
    super(view);
    this.length = length;
  }
  static {
    this.itemSize = 40;
  }
  static from(bin, length, offset = 0) {
    const size = length * 40;
    return new _ImageSectionHeaderArray(
      new DataView(bin, offset, size),
      length
    );
  }
  get(index) {
    return {
      name: getFixedString(this.view, index * 40, 8),
      virtualSize: this.view.getUint32(8 + index * 40, true),
      virtualAddress: this.view.getUint32(12 + index * 40, true),
      sizeOfRawData: this.view.getUint32(16 + index * 40, true),
      pointerToRawData: this.view.getUint32(20 + index * 40, true),
      pointerToRelocations: this.view.getUint32(24 + index * 40, true),
      pointerToLineNumbers: this.view.getUint32(28 + index * 40, true),
      numberOfRelocations: this.view.getUint16(32 + index * 40, true),
      numberOfLineNumbers: this.view.getUint16(34 + index * 40, true),
      characteristics: this.view.getUint32(36 + index * 40, true)
    };
  }
  set(index, data) {
    setFixedString(this.view, index * 40, 8, data.name);
    this.view.setUint32(8 + index * 40, data.virtualSize, true);
    this.view.setUint32(12 + index * 40, data.virtualAddress, true);
    this.view.setUint32(16 + index * 40, data.sizeOfRawData, true);
    this.view.setUint32(20 + index * 40, data.pointerToRawData, true);
    this.view.setUint32(24 + index * 40, data.pointerToRelocations, true);
    this.view.setUint32(28 + index * 40, data.pointerToLineNumbers, true);
    this.view.setUint16(32 + index * 40, data.numberOfRelocations, true);
    this.view.setUint16(34 + index * 40, data.numberOfLineNumbers, true);
    this.view.setUint32(36 + index * 40, data.characteristics, true);
  }
};

// ../wb-cache/vendor-src/pe-library-js/src/main/format/index.ts
function getImageDosHeader(bin) {
  return ImageDosHeader.from(bin);
}
function getImageNtHeadersByDosHeader(bin, dosHeader) {
  return ImageNtHeaders.from(bin, dosHeader.newHeaderAddress);
}
function getImageSectionHeadersByNtHeaders(bin, dosHeader, ntHeaders) {
  return ImageSectionHeaderArray.from(
    bin,
    ntHeaders.fileHeader.numberOfSections,
    dosHeader.newHeaderAddress + ntHeaders.byteLength
  );
}
function findImageSectionBlockByDirectoryEntry(bin, dosHeader, ntHeaders, entryType) {
  const arr = ImageSectionHeaderArray.from(
    bin,
    ntHeaders.fileHeader.numberOfSections,
    dosHeader.newHeaderAddress + ntHeaders.byteLength
  );
  const len = arr.length;
  const rva = ntHeaders.optionalHeaderDataDirectory.get(entryType).virtualAddress;
  for (let i = 0; i < len; ++i) {
    const sec = arr.get(i);
    const vaEnd = sec.virtualAddress + sec.virtualSize;
    if (rva >= sec.virtualAddress && rva < vaEnd) {
      const ptr = sec.pointerToRawData;
      if (!ptr) {
        return null;
      }
      return bin.slice(ptr, ptr + sec.sizeOfRawData);
    }
    if (rva < sec.virtualAddress) {
      return null;
    }
  }
  return null;
}

// ../wb-cache/vendor-src/pe-library-js/src/main/util/generate.ts
var DOS_STUB_PROGRAM = new Uint8Array([
  14,
  31,
  186,
  14,
  0,
  180,
  9,
  205,
  33,
  184,
  1,
  76,
  205,
  33,
  68,
  79,
  83,
  32,
  109,
  111,
  100,
  101,
  32,
  110,
  111,
  116,
  32,
  115,
  117,
  112,
  112,
  111,
  114,
  116,
  101,
  100,
  46,
  13,
  13,
  10,
  36,
  0,
  0,
  0,
  0,
  0,
  0,
  0
]);
var DOS_STUB_SIZE = roundUp(
  ImageDosHeader.size + DOS_STUB_PROGRAM.length,
  128
);
var DEFAULT_FILE_ALIGNMENT = 512;
function fillDosStubData(bin) {
  const dos = ImageDosHeader.from(bin);
  dos.magic = ImageDosHeader.DEFAULT_MAGIC;
  dos.lastPageSize = DOS_STUB_SIZE % 512;
  dos.pages = Math.ceil(DOS_STUB_SIZE / 512);
  dos.relocations = 0;
  dos.headerSizeInParagraph = Math.ceil(ImageDosHeader.size / 16);
  dos.minAllocParagraphs = 0;
  dos.maxAllocParagraphs = 65535;
  dos.initialSS = 0;
  dos.initialSP = 128;
  dos.relocationTableAddress = ImageDosHeader.size;
  dos.newHeaderAddress = DOS_STUB_SIZE;
  copyBuffer(
    bin,
    ImageDosHeader.size,
    DOS_STUB_PROGRAM,
    0,
    DOS_STUB_PROGRAM.length
  );
}
function estimateNewHeaderSize(is32Bit) {
  return (
    // magic
    4 + ImageFileHeader.size + (is32Bit ? ImageOptionalHeader.size : ImageOptionalHeader64.size) + ImageDataDirectoryArray.size
  );
}
function fillPeHeaderEmptyData(bin, offset, totalBinSize, is32Bit, isDLL) {
  let _bin;
  let _offset;
  if ("buffer" in bin) {
    _bin = bin.buffer;
    _offset = bin.byteOffset + offset;
  } else {
    _bin = bin;
    _offset = offset;
  }
  new DataView(_bin, _offset).setUint32(
    0,
    ImageNtHeaders.DEFAULT_SIGNATURE,
    true
  );
  const fh = ImageFileHeader.from(_bin, _offset + 4);
  fh.machine = is32Bit ? 332 : 34404;
  fh.numberOfSections = 0;
  fh.timeDateStamp = 0;
  fh.pointerToSymbolTable = 0;
  fh.numberOfSymbols = 0;
  fh.sizeOfOptionalHeader = (is32Bit ? ImageOptionalHeader.size : ImageOptionalHeader64.size) + ImageDataDirectoryArray.size;
  fh.characteristics = isDLL ? 8450 : 258;
  const oh = (is32Bit ? ImageOptionalHeader : ImageOptionalHeader64).from(
    _bin,
    _offset + 4 + ImageFileHeader.size
  );
  oh.magic = is32Bit ? ImageOptionalHeader.DEFAULT_MAGIC : ImageOptionalHeader64.DEFAULT_MAGIC;
  oh.sizeOfCode = 0;
  oh.sizeOfInitializedData = 0;
  oh.sizeOfUninitializedData = 0;
  oh.addressOfEntryPoint = 0;
  oh.baseOfCode = 4096;
  oh.imageBase = is32Bit ? 16777216 : 6442450944;
  oh.sectionAlignment = 4096;
  oh.fileAlignment = DEFAULT_FILE_ALIGNMENT;
  oh.majorOperatingSystemVersion = 6;
  oh.minorOperatingSystemVersion = 0;
  oh.majorSubsystemVersion = 6;
  oh.minorSubsystemVersion = 0;
  oh.sizeOfHeaders = roundUp(totalBinSize, oh.fileAlignment);
  oh.subsystem = 2;
  oh.dllCharacteristics = (is32Bit ? 0 : 32) + // IMAGE_DLL_CHARACTERISTICS_HIGH_ENTROPY_VA
  64 + // IMAGE_DLLCHARACTERISTICS_DYNAMIC_BASE
  256;
  oh.sizeOfStackReserve = 1048576;
  oh.sizeOfStackCommit = 4096;
  oh.sizeOfHeapReserve = 1048576;
  oh.sizeOfHeapCommit = 4096;
  oh.numberOfRvaAndSizes = ImageDataDirectoryArray.size / ImageDataDirectoryArray.itemSize;
}
function makeEmptyNtExecutableBinary(is32Bit, isDLL) {
  const bufferSize = roundUp(
    DOS_STUB_SIZE + estimateNewHeaderSize(is32Bit),
    DEFAULT_FILE_ALIGNMENT
  );
  const bin = new ArrayBuffer(bufferSize);
  fillDosStubData(bin);
  fillPeHeaderEmptyData(bin, DOS_STUB_SIZE, bufferSize, is32Bit, isDLL);
  return bin;
}

// ../wb-cache/vendor-src/pe-library-js/src/main/NtExecutable.ts
var NtExecutable = class _NtExecutable {
  constructor(_headers, _sections, _ex) {
    this._headers = _headers;
    this._sections = _sections;
    this._ex = _ex;
    const dh = ImageDosHeader.from(_headers);
    const nh = ImageNtHeaders.from(_headers, dh.newHeaderAddress);
    this._dh = dh;
    this._nh = nh;
    this._dda = nh.optionalHeaderDataDirectory;
    _sections.sort((a, b) => {
      const ra = a.info.pointerToRawData;
      const rb = a.info.pointerToRawData;
      if (ra !== rb) {
        return ra - rb;
      }
      const va = a.info.virtualAddress;
      const vb = b.info.virtualAddress;
      if (va === vb) {
        return a.info.virtualSize - b.info.virtualSize;
      }
      return va - vb;
    });
  }
  /**
   * Creates an NtExecutable instance with an 'empty' executable binary.
   * @param is32Bit set true if the binary is for 32-bit (default: false)
   * @param isDLL set true if the binary is DLL (default: true)
   * @return NtExecutable instance
   */
  static createEmpty(is32Bit = false, isDLL = true) {
    return this.from(makeEmptyNtExecutableBinary(is32Bit, isDLL));
  }
  /**
   * Parse the binary and create NtExecutable instance.
   * An error will be thrown if the binary data is invalid
   * @param bin binary data
   * @param options additional option for parsing
   * @return NtExecutable instance
   */
  static from(bin, options) {
    const dh = ImageDosHeader.from(bin);
    const nh = ImageNtHeaders.from(bin, dh.newHeaderAddress);
    if (!dh.isValid() || !nh.isValid()) {
      throw new TypeError("Invalid binary format");
    }
    if (nh.fileHeader.numberOfSymbols > 0) {
      throw new Error("Binary with symbols is not supported now");
    }
    const fileAlignment = nh.optionalHeader.fileAlignment;
    const securityEntry = nh.optionalHeaderDataDirectory.get(
      ImageDirectoryEntry_default.Certificate
    );
    if (securityEntry.size > 0) {
      if (!options?.ignoreCert) {
        throw new Error(
          "Parsing signed executable binary is not allowed by default."
        );
      }
    }
    const secOff = dh.newHeaderAddress + nh.getSectionHeaderOffset();
    const secCount = nh.fileHeader.numberOfSections;
    const sections = [];
    const tempSectionHeaderBinary = allocatePartialBinary(
      bin,
      secOff,
      secCount * ImageSectionHeaderArray.itemSize
    );
    const secArray = ImageSectionHeaderArray.from(
      tempSectionHeaderBinary,
      secCount,
      0
    );
    let lastOffset = roundUp(
      secOff + secCount * ImageSectionHeaderArray.itemSize,
      fileAlignment
    );
    secArray.forEach((info) => {
      if (!info.pointerToRawData || !info.sizeOfRawData) {
        info.pointerToRawData = 0;
        info.sizeOfRawData = 0;
        sections.push({
          info,
          data: null
        });
      } else {
        const secBin = allocatePartialBinary(
          bin,
          info.pointerToRawData,
          info.sizeOfRawData
        );
        sections.push({
          info,
          data: secBin
        });
        const secEndOffset = roundUp(
          info.pointerToRawData + info.sizeOfRawData,
          fileAlignment
        );
        if (secEndOffset > lastOffset) {
          lastOffset = secEndOffset;
        }
      }
    });
    const headers = allocatePartialBinary(bin, 0, secOff);
    let exData = null;
    let lastExDataOffset = bin.byteLength;
    if (securityEntry.size > 0) {
      lastExDataOffset = securityEntry.virtualAddress;
    }
    if (lastOffset < lastExDataOffset) {
      exData = allocatePartialBinary(
        bin,
        lastOffset,
        lastExDataOffset - lastOffset
      );
    }
    return new _NtExecutable(headers, sections, exData);
  }
  /**
   * Returns whether the executable is for 32-bit architecture
   */
  is32bit() {
    return this._nh.is32bit();
  }
  getTotalHeaderSize() {
    return this._headers.byteLength;
  }
  get dosHeader() {
    return this._dh;
  }
  get newHeader() {
    return this._nh;
  }
  getRawHeader() {
    return this._headers;
  }
  getImageBase() {
    return this._nh.optionalHeader.imageBase;
  }
  getFileAlignment() {
    return this._nh.optionalHeader.fileAlignment;
  }
  getSectionAlignment() {
    return this._nh.optionalHeader.sectionAlignment;
  }
  /**
   * Return all sections. The returned array is sorted by raw address.
   */
  getAllSections() {
    return this._sections;
  }
  /**
   * Return the section data from ImageDirectoryEntry enum value.
   * @note
   * The returned instance is equal to the value in {@link getAllSections}'s return value.
   */
  getSectionByEntry(entry) {
    const dd = this._dda.get(entry);
    const r = this._sections.filter((sec) => {
      const vaEnd = sec.info.virtualAddress + sec.info.virtualSize;
      return dd.virtualAddress >= sec.info.virtualAddress && dd.virtualAddress < vaEnd;
    }).shift();
    return r !== void 0 ? r : null;
  }
  /**
   * Set the section data from ImageDirectoryEntry enum value.
   * If entry is found, then replaces the secion data. If not found, then adds the section data.
   *
   * NOTE: 'virtualAddress' and 'pointerToRawData' of section object is ignored
   * and calculated automatically. 'virtualSize' and 'sizeOfRawData' are used, but
   * if the 'section.data.byteLength' is larger than 'sizeOfRawData', then
   * these members are replaced.
   *
   * @param entry ImageDirectoryEntry enum value for the section
   * @param section the section data, or null to remove the section
   */
  setSectionByEntry(entry, section) {
    const sec = section ? { data: section.data, info: section.info } : null;
    const dd = this._dda.get(entry);
    const hasEntry = dd.size > 0;
    if (!sec) {
      if (!hasEntry) {
      } else {
        this._dda.set(entry, { size: 0, virtualAddress: 0 });
        const len = this._sections.length;
        for (let i = 0; i < len; ++i) {
          const sec2 = this._sections[i];
          const vaStart = sec2.info.virtualAddress;
          const vaLast = vaStart + sec2.info.virtualSize;
          if (dd.virtualAddress >= vaStart && dd.virtualAddress < vaLast) {
            this._sections.splice(i, 1);
            this._nh.fileHeader.numberOfSections = this._sections.length;
            break;
          }
        }
      }
    } else {
      const rawSize = !sec.data ? 0 : sec.data.byteLength;
      const fileAlign = this._nh.optionalHeader.fileAlignment;
      const secAlign = this._nh.optionalHeader.sectionAlignment;
      let alignedFileSize = !sec.data ? 0 : roundUp(rawSize, fileAlign);
      const alignedSecSize = !sec.data ? 0 : roundUp(sec.info.virtualSize, secAlign);
      if (sec.info.sizeOfRawData < alignedFileSize) {
        sec.info.sizeOfRawData = alignedFileSize;
      } else {
        alignedFileSize = sec.info.sizeOfRawData;
      }
      if (!hasEntry) {
        let virtAddr = 0;
        let rawAddr = roundUp(this._headers.byteLength, fileAlign);
        this._sections.forEach((secExist) => {
          if (secExist.info.pointerToRawData) {
            if (rawAddr <= secExist.info.pointerToRawData) {
              rawAddr = secExist.info.pointerToRawData + secExist.info.sizeOfRawData;
            }
          }
          if (virtAddr <= secExist.info.virtualAddress) {
            virtAddr = secExist.info.virtualAddress + secExist.info.virtualSize;
          }
        });
        if (!alignedFileSize) {
          rawAddr = 0;
        }
        if (!virtAddr) {
          virtAddr = this.newHeader.optionalHeader.baseOfCode;
        }
        virtAddr = roundUp(virtAddr, secAlign);
        sec.info.pointerToRawData = rawAddr;
        sec.info.virtualAddress = virtAddr;
        this._dda.set(entry, {
          size: rawSize,
          virtualAddress: virtAddr
        });
        this._sections.push(sec);
        this._nh.fileHeader.numberOfSections = this._sections.length;
        this._nh.optionalHeader.sizeOfImage = roundUp(
          virtAddr + alignedSecSize,
          this._nh.optionalHeader.sectionAlignment
        );
      } else {
        this.replaceSectionImpl(dd.virtualAddress, sec.info, sec.data);
      }
    }
  }
  /**
   * Returns the extra data in the executable, or `null` if nothing.
   * You can rewrite the returned buffer without using `setExtraData` if
   * the size of the new data is equal to the old data.
   */
  getExtraData() {
    return this._ex;
  }
  /**
   * Specifies the new extra data in the executable.
   * The specified buffer will be cloned and you can release it after calling this method.
   * @param bin buffer containing the new data
   * @note
   * The extra data will not be aligned by `NtExecutable`.
   */
  setExtraData(bin) {
    if (bin === null) {
      this._ex = null;
    } else {
      this._ex = cloneToArrayBuffer(bin);
    }
  }
  /**
   * Generates the executable binary data.
   */
  generate(paddingSize) {
    const dh = this._dh;
    const nh = this._nh;
    const secOff = dh.newHeaderAddress + nh.getSectionHeaderOffset();
    let size = secOff;
    size += this._sections.length * ImageSectionHeaderArray.itemSize;
    const align = nh.optionalHeader.fileAlignment;
    size = roundUp(size, align);
    this._sections.forEach((sec) => {
      if (!sec.info.pointerToRawData) {
        return;
      }
      const lastOff = sec.info.pointerToRawData + sec.info.sizeOfRawData;
      if (size < lastOff) {
        size = lastOff;
        size = roundUp(size, align);
      }
    });
    const lastPosition = size;
    if (this._ex !== null) {
      size += this._ex.byteLength;
    }
    if (typeof paddingSize === "number") {
      size += paddingSize;
    }
    const bin = new ArrayBuffer(size);
    const u8bin = new Uint8Array(bin);
    u8bin.set(new Uint8Array(this._headers, 0, secOff));
    ImageDataDirectoryArray.from(
      bin,
      dh.newHeaderAddress + nh.getDataDirectoryOffset()
    ).set(ImageDirectoryEntry_default.Certificate, {
      size: 0,
      virtualAddress: 0
    });
    const secArray = ImageSectionHeaderArray.from(
      bin,
      this._sections.length,
      secOff
    );
    this._sections.forEach((sec, i) => {
      if (!sec.data) {
        sec.info.pointerToRawData = 0;
        sec.info.sizeOfRawData = 0;
      }
      secArray.set(i, sec.info);
      if (!sec.data || !sec.info.pointerToRawData) {
        return;
      }
      u8bin.set(new Uint8Array(sec.data), sec.info.pointerToRawData);
    });
    if (this._ex !== null) {
      u8bin.set(new Uint8Array(this._ex), lastPosition);
    }
    if (nh.optionalHeader.checkSum !== 0) {
      calculateCheckSumForPE(bin, true);
    }
    return bin;
  }
  rearrangeSections(rawAddressStart, rawDiff, virtualAddressStart, virtualDiff) {
    if (!rawDiff && !virtualDiff) {
      return;
    }
    const nh = this._nh;
    const secAlign = nh.optionalHeader.sectionAlignment;
    const dirs = this._dda;
    const len = this._sections.length;
    let lastVirtAddress = 0;
    for (let i = 0; i < len; ++i) {
      const sec = this._sections[i];
      let virtAddr = sec.info.virtualAddress;
      if (virtualDiff && virtAddr >= virtualAddressStart) {
        const iDir = dirs.findIndexByVirtualAddress(virtAddr);
        virtAddr += virtualDiff;
        if (iDir !== null) {
          dirs.set(iDir, {
            virtualAddress: virtAddr,
            size: sec.info.virtualSize
          });
        }
        sec.info.virtualAddress = virtAddr;
      }
      const fileAddr = sec.info.pointerToRawData;
      if (rawDiff && fileAddr >= rawAddressStart) {
        sec.info.pointerToRawData = fileAddr + rawDiff;
      }
      lastVirtAddress = roundUp(
        sec.info.virtualAddress + sec.info.virtualSize,
        secAlign
      );
    }
    nh.optionalHeader.sizeOfImage = lastVirtAddress;
  }
  // NOTE: info.virtualSize must be valid
  replaceSectionImpl(virtualAddress, info, data) {
    const len = this._sections.length;
    for (let i = 0; i < len; ++i) {
      const s = this._sections[i];
      if (s.info.virtualAddress === virtualAddress) {
        const secAlign = this._nh.optionalHeader.sectionAlignment;
        const fileAddr = s.info.pointerToRawData;
        const oldFileAddr = fileAddr + s.info.sizeOfRawData;
        const oldVirtAddr = virtualAddress + roundUp(s.info.virtualSize, secAlign);
        s.info = cloneObject(info);
        s.info.virtualAddress = virtualAddress;
        s.info.pointerToRawData = fileAddr;
        s.data = data;
        const newFileAddr = fileAddr + info.sizeOfRawData;
        const newVirtAddr = virtualAddress + roundUp(info.virtualSize, secAlign);
        this.rearrangeSections(
          oldFileAddr,
          newFileAddr - oldFileAddr,
          oldVirtAddr,
          newVirtAddr - oldVirtAddr
        );
        {
          const dirs = this._dda;
          const iDir = dirs.findIndexByVirtualAddress(virtualAddress);
          if (iDir !== null) {
            dirs.set(iDir, {
              virtualAddress,
              size: info.virtualSize
            });
          }
        }
        break;
      }
    }
  }
};

// ../wb-cache/vendor-src/pe-library-js/src/main/NtExecutableResource.ts
function removeDuplicates(a) {
  return a.reduce((p, c) => {
    return p.indexOf(c) >= 0 ? p : p.concat(c);
  }, []);
}
function readString(view, offset) {
  const length = view.getUint16(offset, true);
  let r = "";
  offset += 2;
  for (let i = 0; i < length; ++i) {
    r += String.fromCharCode(view.getUint16(offset, true));
    offset += 2;
  }
  return r;
}
function readLanguageTable(view, typeEntry, name, languageTable, cb) {
  let off = languageTable;
  const nameEntry = {
    name,
    languageTable,
    characteristics: view.getUint32(off, true),
    dateTime: view.getUint32(off + 4, true),
    majorVersion: view.getUint16(off + 8, true),
    minorVersion: view.getUint16(off + 10, true)
  };
  const nameCount = view.getUint16(off + 12, true);
  const idCount = view.getUint16(off + 14, true);
  off += 16;
  for (let i = 0; i < nameCount; ++i) {
    const nameOffset = view.getUint32(off, true) & 2147483647;
    const dataOffset = view.getUint32(off + 4, true);
    if ((dataOffset & 2147483648) !== 0) {
      off += 8;
      continue;
    }
    const name2 = readString(view, nameOffset);
    cb(typeEntry, nameEntry, { lang: name2, dataOffset });
    off += 8;
  }
  for (let i = 0; i < idCount; ++i) {
    const id = view.getUint32(off, true) & 2147483647;
    const dataOffset = view.getUint32(off + 4, true);
    if ((dataOffset & 2147483648) !== 0) {
      off += 8;
      continue;
    }
    cb(typeEntry, nameEntry, { lang: id, dataOffset });
    off += 8;
  }
}
function readNameTable(view, type, nameTable, cb) {
  let off = nameTable;
  const typeEntry = {
    type,
    nameTable,
    characteristics: view.getUint32(off, true),
    dateTime: view.getUint32(off + 4, true),
    majorVersion: view.getUint16(off + 8, true),
    minorVersion: view.getUint16(off + 10, true)
  };
  const nameCount = view.getUint16(off + 12, true);
  const idCount = view.getUint16(off + 14, true);
  off += 16;
  for (let i = 0; i < nameCount; ++i) {
    const nameOffset = view.getUint32(off, true) & 2147483647;
    let nextTable = view.getUint32(off + 4, true);
    if (!(nextTable & 2147483648)) {
      off += 8;
      continue;
    }
    nextTable &= 2147483647;
    const name = readString(view, nameOffset);
    readLanguageTable(view, typeEntry, name, nextTable, cb);
    off += 8;
  }
  for (let i = 0; i < idCount; ++i) {
    const id = view.getUint32(off, true) & 2147483647;
    let nextTable = view.getUint32(off + 4, true);
    if (!(nextTable & 2147483648)) {
      off += 8;
      continue;
    }
    nextTable &= 2147483647;
    readLanguageTable(view, typeEntry, id, nextTable, cb);
    off += 8;
  }
}
function divideEntriesImplByID(r, names, entries) {
  const entriesByString = {};
  const entriesByNumber = {};
  entries.forEach((e) => {
    if (typeof e.lang === "string") {
      entriesByString[e.lang] = e;
      names.push(e.lang);
    } else {
      entriesByNumber[e.lang] = e;
    }
  });
  const strKeys = Object.keys(entriesByString);
  strKeys.sort().forEach((type) => {
    r.s.push(entriesByString[type]);
  });
  const numKeys = Object.keys(entriesByNumber);
  numKeys.map((k) => Number(k)).sort((a, b) => a - b).forEach((type) => {
    r.n.push(entriesByNumber[type]);
  });
  return 16 + 8 * (strKeys.length + numKeys.length);
}
function divideEntriesImplByName(r, names, entries) {
  const entriesByString = {};
  const entriesByNumber = {};
  entries.forEach((e) => {
    if (typeof e.id === "string") {
      const a = entriesByString[e.id] ?? (entriesByString[e.id] = []);
      names.push(e.id);
      a.push(e);
    } else {
      const a = entriesByNumber[e.id] ?? (entriesByNumber[e.id] = []);
      a.push(e);
    }
  });
  const sSum = Object.keys(entriesByString).sort().map((id) => {
    const o = {
      id,
      s: [],
      n: []
    };
    r.s.push(o);
    return divideEntriesImplByID(o, names, entriesByString[id]);
  }).reduce((p, c) => p + 8 + c, 0);
  const nSum = Object.keys(entriesByNumber).map((k) => Number(k)).sort((a, b) => a - b).map((id) => {
    const o = {
      id,
      s: [],
      n: []
    };
    r.n.push(o);
    return divideEntriesImplByID(o, names, entriesByNumber[id]);
  }).reduce((p, c) => p + 8 + c, 0);
  return 16 + sSum + nSum;
}
function divideEntriesImplByType(r, names, entries) {
  const entriesByString = {};
  const entriesByNumber = {};
  entries.forEach((e) => {
    if (typeof e.type === "string") {
      const a = entriesByString[e.type] ?? (entriesByString[e.type] = []);
      names.push(e.type);
      a.push(e);
    } else {
      const a = entriesByNumber[e.type] ?? (entriesByNumber[e.type] = []);
      a.push(e);
    }
  });
  const sSum = Object.keys(entriesByString).sort().map((type) => {
    const o = { type, s: [], n: [] };
    r.s.push(o);
    return divideEntriesImplByName(o, names, entriesByString[type]);
  }).reduce((p, c) => p + 8 + c, 0);
  const nSum = Object.keys(entriesByNumber).map((k) => Number(k)).sort((a, b) => a - b).map((type) => {
    const o = { type, s: [], n: [] };
    r.n.push(o);
    return divideEntriesImplByName(o, names, entriesByNumber[type]);
  }).reduce((p, c) => p + 8 + c, 0);
  return 16 + sSum + nSum;
}
function calculateStringLengthForWrite(text) {
  const length = text.length;
  return length > 65535 ? 65535 : length;
}
function getStringOffset(target, strings) {
  const l = strings.length;
  for (let i = 0; i < l; ++i) {
    const s = strings[i];
    if (s.text === target) {
      return s.offset;
    }
  }
  throw new Error("Unexpected");
}
function writeString(view, offset, text) {
  const length = calculateStringLengthForWrite(text);
  view.setUint16(offset, length, true);
  offset += 2;
  for (let i = 0; i < length; ++i) {
    view.setUint16(offset, text.charCodeAt(i), true);
    offset += 2;
  }
  return offset;
}
function writeLanguageTable(view, offset, strings, data) {
  view.setUint32(offset, 0, true);
  view.setUint32(offset + 4, 0, true);
  view.setUint32(offset + 8, 0, true);
  view.setUint16(offset + 12, data.s.length, true);
  view.setUint16(offset + 14, data.n.length, true);
  offset += 16;
  data.s.forEach((e) => {
    const strOff = getStringOffset(e.lang, strings);
    view.setUint32(offset, strOff, true);
    view.setUint32(offset + 4, e.offset, true);
    offset += 8;
  });
  data.n.forEach((e) => {
    view.setUint32(offset, e.lang, true);
    view.setUint32(offset + 4, e.offset, true);
    offset += 8;
  });
  return offset;
}
function writeNameTable(view, offset, leafOffset, strings, data) {
  view.setUint32(offset, 0, true);
  view.setUint32(offset + 4, 0, true);
  view.setUint32(offset + 8, 0, true);
  view.setUint16(offset + 12, data.s.length, true);
  view.setUint16(offset + 14, data.n.length, true);
  offset += 16;
  data.s.forEach((e) => {
    e.offset = leafOffset;
    leafOffset = writeLanguageTable(view, leafOffset, strings, e);
  });
  data.n.forEach((e) => {
    e.offset = leafOffset;
    leafOffset = writeLanguageTable(view, leafOffset, strings, e);
  });
  data.s.forEach((e) => {
    const strOff = getStringOffset(e.id, strings);
    view.setUint32(offset, strOff + 2147483648, true);
    view.setUint32(offset + 4, e.offset + 2147483648, true);
    offset += 8;
  });
  data.n.forEach((e) => {
    view.setUint32(offset, e.id, true);
    view.setUint32(offset + 4, e.offset + 2147483648, true);
    offset += 8;
  });
  return leafOffset;
}
function writeTypeTable(view, offset, strings, data) {
  view.setUint32(offset, 0, true);
  view.setUint32(offset + 4, 0, true);
  view.setUint32(offset + 8, 0, true);
  view.setUint16(offset + 12, data.s.length, true);
  view.setUint16(offset + 14, data.n.length, true);
  offset += 16;
  let nextTableOffset = offset + 8 * (data.s.length + data.n.length);
  data.s.forEach((e) => {
    e.offset = nextTableOffset;
    nextTableOffset += 16 + 8 * (e.s.length + e.n.length);
  });
  data.n.forEach((e) => {
    e.offset = nextTableOffset;
    nextTableOffset += 16 + 8 * (e.s.length + e.n.length);
  });
  data.s.forEach((e) => {
    const strOff = getStringOffset(e.type, strings);
    view.setUint32(offset, strOff + 2147483648, true);
    view.setUint32(offset + 4, e.offset + 2147483648, true);
    offset += 8;
    nextTableOffset = writeNameTable(
      view,
      e.offset,
      nextTableOffset,
      strings,
      e
    );
  });
  data.n.forEach((e) => {
    view.setUint32(offset, e.type, true);
    view.setUint32(offset + 4, e.offset + 2147483648, true);
    offset += 8;
    nextTableOffset = writeNameTable(
      view,
      e.offset,
      nextTableOffset,
      strings,
      e
    );
  });
  return nextTableOffset;
}
var NtExecutableResource = class _NtExecutableResource {
  constructor() {
    /** The timestamp for resource */
    this.dateTime = 0;
    /** The major version data for resource */
    this.majorVersion = 0;
    /** The minor version data for resource */
    this.minorVersion = 0;
    /** Resource entries */
    this.entries = [];
    /**
     * The section data header of resource data (used by outputResource method).
     * This instance will be null if the base executable does not contain resource data.
     * You can override this field before calling outputResource method.
     * (Note that the addresses and sizes are ignored for output)
     */
    this.sectionDataHeader = null;
    this.originalSize = 0;
  }
  parse(section, ignoreUnparsableData) {
    if (!section.data) {
      return;
    }
    const view = new DataView(section.data);
    this.dateTime = view.getUint32(4, true);
    this.majorVersion = view.getUint16(8, true);
    this.minorVersion = view.getUint16(10, true);
    const nameCount = view.getUint16(12, true);
    const idCount = view.getUint16(14, true);
    let off = 16;
    const res = [];
    const cb = (t, n, l) => {
      const off2 = view.getUint32(l.dataOffset, true) - section.info.virtualAddress;
      const size = view.getUint32(l.dataOffset + 4, true);
      const cp = view.getUint32(l.dataOffset + 8, true);
      if (off2 >= 0) {
        const bin = new Uint8Array(size);
        bin.set(new Uint8Array(section.data, off2, size));
        res.push({
          type: t.type,
          id: n.name,
          lang: l.lang,
          codepage: cp,
          bin: bin.buffer
        });
      } else {
        if (!ignoreUnparsableData) {
          throw new Error(
            "Cannot parse resource directory entry; RVA seems to be invalid."
          );
        }
        res.push({
          type: t.type,
          id: n.name,
          lang: l.lang,
          codepage: cp,
          bin: new ArrayBuffer(0),
          rva: l.dataOffset
        });
      }
    };
    for (let i = 0; i < nameCount; ++i) {
      const nameOffset = view.getUint32(off, true) & 2147483647;
      let nextTable = view.getUint32(off + 4, true);
      if (!(nextTable & 2147483648)) {
        off += 8;
        continue;
      }
      nextTable &= 2147483647;
      const name = readString(view, nameOffset);
      readNameTable(view, name, nextTable, cb);
      off += 8;
    }
    for (let i = 0; i < idCount; ++i) {
      const typeId = view.getUint32(off, true) & 2147483647;
      let nextTable = view.getUint32(off + 4, true);
      if (!(nextTable & 2147483648)) {
        off += 8;
        continue;
      }
      nextTable &= 2147483647;
      readNameTable(view, typeId, nextTable, cb);
      off += 8;
    }
    this.entries = res;
    this.originalSize = section.data.byteLength;
  }
  /**
   * Parses resource data for `NtExecutable`.
   * This function returns valid instance even if
   * the executable does not have resource data.
   * @param exe `NtExecutable` instance
   * @param ignoreUnparsableData (default: false) specify true if skipping 'unparsable' (e.g. unusual format) data.
   *   When true, the resource data may break on write operation.
   */
  static from(exe, ignoreUnparsableData = false) {
    const secs = [].concat(exe.getAllSections()).sort((a, b) => a.info.virtualAddress - b.info.virtualAddress);
    const entry = exe.getSectionByEntry(ImageDirectoryEntry_default.Resource);
    if (entry) {
      const reloc = exe.getSectionByEntry(
        ImageDirectoryEntry_default.BaseRelocation
      );
      for (let i = 0; i < secs.length; ++i) {
        const s = secs[i];
        if (s === entry) {
          for (let j = i + 1; j < secs.length; ++j) {
            if (!reloc || secs[j] !== reloc) {
              throw new Error(
                "After Resource section, sections except for relocation are not supported"
              );
            }
          }
          break;
        }
      }
    }
    const r = new _NtExecutableResource();
    r.sectionDataHeader = entry ? cloneObject(entry.info) : null;
    if (entry) {
      r.parse(entry, ignoreUnparsableData);
    }
    return r;
  }
  /**
   * Add or replace the resource entry.
   * This method replaces the entry only if there is an entry with `type`, `id` and `lang` equal.
   */
  replaceResourceEntry(entry) {
    for (let len = this.entries.length, i = 0; i < len; ++i) {
      const e = this.entries[i];
      if (e.type === entry.type && e.id === entry.id && e.lang === entry.lang) {
        this.entries[i] = entry;
        return;
      }
    }
    this.entries.push(entry);
  }
  /**
   * Returns all resource entries, which has specified type and id, as UTF-8 string data.
   * @param type Resource type
   * @param id Resource id
   * @returns an array of lang and value pair (tuple)
   */
  getResourceEntriesAsString(type, id) {
    return this.entries.filter((entry) => entry.type === type && entry.id === id).map((entry) => [entry.lang, binaryToString(entry.bin)]);
  }
  /**
   * Add or replace the resource entry with UTF-8 string data.
   * This method is a wrapper of {@link NtExecutableResource.replaceResourceEntry}.
   */
  replaceResourceEntryFromString(type, id, lang, value) {
    const entry = {
      type,
      id,
      lang,
      codepage: 1200,
      bin: stringToBinary(value)
    };
    this.replaceResourceEntry(entry);
  }
  /**
   * Removes resource entries which has specified type and id.
   */
  removeResourceEntry(type, id, lang) {
    this.entries = this.entries.filter(
      (entry) => !(entry.type === type && entry.id === id && (typeof lang === "undefined" || entry.lang === lang))
    );
  }
  /**
   * Generates resource data binary for NtExecutable (not for .res file)
   * @param virtualAddress The virtual address for the section
   * @param alignment File alignment value of executable
   * @param noGrow Set true to disallow growing resource section (throw errors if data exceeds)
   * @param allowShrink Set true to allow shrinking resource section (if the data size is less than original)
   */
  generateResourceData(virtualAddress, alignment, noGrow = false, allowShrink = false) {
    const r = {
      s: [],
      n: []
    };
    let strings = [];
    let size = divideEntriesImplByType(r, strings, this.entries);
    strings = removeDuplicates(strings);
    const stringsOffset = size;
    size += strings.reduce((prev, cur) => {
      return prev + 2 + calculateStringLengthForWrite(cur) * 2;
    }, 0);
    size = roundUp(size, 8);
    const descOffset = size;
    size = this.entries.reduce((p, e) => {
      e.offset = p;
      return p + 16;
    }, descOffset);
    const dataOffset = size;
    size = this.entries.reduce((p, e) => {
      return roundUp(p, 8) + e.bin.byteLength;
    }, dataOffset);
    let alignedSize = roundUp(size, alignment);
    const originalAlignedSize = roundUp(this.originalSize, alignment);
    if (noGrow) {
      if (alignedSize > originalAlignedSize) {
        throw new Error("New resource data is larger than original");
      }
    }
    if (!allowShrink) {
      if (alignedSize < originalAlignedSize) {
        alignedSize = originalAlignedSize;
      }
    }
    const bin = new ArrayBuffer(alignedSize);
    const view = new DataView(bin);
    let o = descOffset;
    let va = virtualAddress + dataOffset;
    this.entries.forEach((e) => {
      const len = e.bin.byteLength;
      if (typeof e.rva !== "undefined") {
        view.setUint32(o, e.rva, true);
      } else {
        va = roundUp(va, 8);
        view.setUint32(o, va, true);
        va += len;
      }
      view.setUint32(o + 4, len, true);
      view.setUint32(o + 8, e.codepage, true);
      view.setUint32(o + 12, 0, true);
      o += 16;
    });
    o = dataOffset;
    this.entries.forEach((e) => {
      const len = e.bin.byteLength;
      copyBuffer(bin, o, e.bin, 0, len);
      o += roundUp(len, 8);
    });
    const stringsData = [];
    o = stringsOffset;
    strings.forEach((s) => {
      stringsData.push({
        offset: o,
        text: s
      });
      o = writeString(view, o, s);
    });
    writeTypeTable(view, 0, stringsData, r);
    if (alignedSize > size) {
      const pad = "PADDINGX";
      for (let i = size, j = 0; i < alignedSize; ++i, ++j) {
        if (j === 8) {
          j = 0;
        }
        view.setUint8(i, pad.charCodeAt(j));
      }
    }
    return {
      bin,
      rawSize: size,
      dataOffset,
      descEntryOffset: descOffset,
      descEntryCount: this.entries.length
    };
  }
  /**
   * Writes holding resource data to specified NtExecutable instance.
   * @param exeDest An NtExecutable instance to write resource section to
   * @param noGrow Set true to disallow growing resource section (throw errors if data exceeds)
   * @param allowShrink Set true to allow shrinking resource section (if the data size is less than original)
   */
  outputResource(exeDest, noGrow = false, allowShrink = false) {
    const fileAlign = exeDest.getFileAlignment();
    let sectionData;
    if (this.sectionDataHeader) {
      sectionData = {
        data: null,
        info: cloneObject(this.sectionDataHeader)
      };
    } else {
      sectionData = {
        data: null,
        info: {
          name: ".rsrc",
          virtualSize: 0,
          virtualAddress: 0,
          sizeOfRawData: 0,
          pointerToRawData: 0,
          pointerToRelocations: 0,
          pointerToLineNumbers: 0,
          numberOfRelocations: 0,
          numberOfLineNumbers: 0,
          characteristics: 1073741888
          // read access and initialized data
        }
      };
    }
    const data = this.generateResourceData(
      0,
      fileAlign,
      noGrow,
      allowShrink
    );
    sectionData.data = data.bin;
    sectionData.info.sizeOfRawData = data.bin.byteLength;
    sectionData.info.virtualSize = data.rawSize;
    exeDest.setSectionByEntry(ImageDirectoryEntry_default.Resource, sectionData);
    const generatedSection = exeDest.getSectionByEntry(
      ImageDirectoryEntry_default.Resource
    );
    const view = new DataView(generatedSection.data);
    let o = data.descEntryOffset;
    let va = generatedSection.info.virtualAddress + data.dataOffset;
    for (let i = 0; i < data.descEntryCount; ++i) {
      const len = view.getUint32(o + 4, true);
      va = roundUp(va, 8);
      view.setUint32(o, va, true);
      va += len;
      o += 16;
    }
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/data/index.ts
var data_exports = {};
__export(data_exports, {
  IconFile: () => IconFile,
  IconItem: () => IconItem,
  RawIconItem: () => RawIconItem
});

// ../wb-cache/vendor-src/resedit-js/src/main/util/functions.ts
function cloneObject2(object) {
  const r = {};
  Object.keys(object).forEach((key) => {
    r[key] = object[key];
  });
  return r;
}
function createDataView2(bin, byteOffset, byteLength) {
  if ("buffer" in bin) {
    let newOffset = bin.byteOffset;
    let newLength = bin.byteLength;
    if (typeof byteOffset !== "undefined") {
      newOffset += byteOffset;
      newLength -= byteOffset;
    }
    if (typeof byteLength !== "undefined") {
      newLength = byteLength;
    }
    return new DataView(bin.buffer, newOffset, newLength);
  } else {
    return new DataView(bin, byteOffset, byteLength);
  }
}
function roundUp2(val, align) {
  return Math.floor((val + align - 1) / align) * align;
}
function copyBuffer2(dest, destOffset, src, srcOffset, length) {
  const ua8Dest = "buffer" in dest ? new Uint8Array(
    dest.buffer,
    dest.byteOffset + (destOffset || 0),
    length
  ) : new Uint8Array(dest, destOffset, length);
  const ua8Src = "buffer" in src ? new Uint8Array(
    src.buffer,
    src.byteOffset + (srcOffset || 0),
    length
  ) : new Uint8Array(src, srcOffset, length);
  ua8Dest.set(ua8Src);
}
function allocatePartialBinary2(binBase, offset, length) {
  const b = new ArrayBuffer(length);
  copyBuffer2(b, 0, binBase, offset, length);
  return b;
}
function cloneToArrayBuffer2(binBase) {
  if ("buffer" in binBase) {
    const b = new ArrayBuffer(binBase.byteLength);
    new Uint8Array(b).set(
      new Uint8Array(
        binBase.buffer,
        binBase.byteOffset,
        binBase.byteLength
      )
    );
    return b;
  } else {
    const b = new ArrayBuffer(binBase.byteLength);
    new Uint8Array(b).set(new Uint8Array(binBase));
    return b;
  }
}
function readInt32WithLastOffset(view, offset, last) {
  return offset + 4 <= last ? view.getInt32(offset, true) : 0;
}
function readUint8WithLastOffset(view, offset, last) {
  return offset < last ? view.getUint8(offset) : 0;
}
function readUint16WithLastOffset(view, offset, last) {
  return offset + 2 <= last ? view.getUint16(offset, true) : 0;
}
function readUint32WithLastOffset(view, offset, last) {
  return offset + 4 <= last ? view.getUint32(offset, true) : 0;
}

// ../wb-cache/vendor-src/resedit-js/src/main/data/IconItem.ts
function calcMaskSize(width, height) {
  const actualWidthBytes = roundUp2(Math.abs(width), 32) / 8;
  return actualWidthBytes * Math.abs(height);
}
var IconItem = class _IconItem {
  constructor(width, height, bin, byteOffset, byteLength) {
    const view = createDataView2(bin, byteOffset, byteLength);
    const totalSize = view.byteLength;
    let headerSize = view.getUint32(0, true);
    if (headerSize > totalSize) {
      headerSize = totalSize;
    }
    const sizeImage = readUint32WithLastOffset(view, 20, headerSize);
    const bi = {
      width: readInt32WithLastOffset(view, 4, headerSize),
      height: readInt32WithLastOffset(view, 8, headerSize),
      planes: readUint16WithLastOffset(view, 12, headerSize),
      bitCount: readUint16WithLastOffset(view, 14, headerSize),
      compression: readUint32WithLastOffset(view, 16, headerSize),
      sizeImage,
      xPelsPerMeter: readInt32WithLastOffset(view, 24, headerSize),
      yPelsPerMeter: readInt32WithLastOffset(view, 28, headerSize),
      colorUsed: readUint32WithLastOffset(view, 32, headerSize),
      colorImportant: readUint32WithLastOffset(view, 36, headerSize),
      colors: []
    };
    let offset = 40;
    let colors = bi.colorUsed;
    if (!colors) {
      switch (bi.bitCount) {
        case 1:
          colors = 2;
          break;
        case 4:
          colors = 16;
          break;
        case 8:
          colors = 256;
          break;
      }
    }
    for (let i = 0; i < colors; ++i) {
      bi.colors.push({
        b: readUint8WithLastOffset(view, offset, totalSize),
        g: readUint8WithLastOffset(view, offset + 1, totalSize),
        r: readUint8WithLastOffset(view, offset + 2, totalSize)
      });
      offset += 4;
    }
    this.width = width;
    this.height = height;
    this.bitmapInfo = bi;
    const widthBytes = roundUp2(bi.bitCount * Math.abs(bi.width), 32) / 8;
    const absActualHeight = Math.abs(bi.height) / 2;
    const size = bi.compression !== 0 && sizeImage !== 0 ? sizeImage : widthBytes * absActualHeight;
    if (size + offset > totalSize) {
      throw new Error(
        `Unexpected bitmap data in icon: bitmap size ${size} is larger than ${totalSize} - ${offset}`
      );
    }
    this._pixels = allocatePartialBinary2(view, offset, size);
    offset += size;
    const maskSize = calcMaskSize(bi.width, absActualHeight);
    if (maskSize + offset <= totalSize) {
      this.masks = allocatePartialBinary2(view, offset, maskSize);
    } else {
      this.masks = new ArrayBuffer(maskSize);
    }
  }
  /**
   * Bitmap pixel data.
   * @note
   * On set, if `bitmapInfo.sizeImage` is non-zero, `bitmapInfo.sizeImage` will be updated.
   */
  get pixels() {
    return this._pixels;
  }
  /**
   * Bitmap pixel data.
   * @note
   * On set, if `bitmapInfo.sizeImage` is non-zero, `bitmapInfo.sizeImage` will be updated.
   */
  set pixels(newValue) {
    this._pixels = newValue;
    if (this.bitmapInfo.sizeImage !== 0) {
      this.bitmapInfo.sizeImage = newValue.byteLength;
    }
  }
  static from(arg1, arg2, arg3, byteOffset, byteLength) {
    let width;
    let height;
    let bin;
    if (typeof arg3 === "object") {
      width = arg1;
      height = arg2;
      bin = arg3;
    } else {
      width = null;
      height = null;
      bin = arg1;
      byteOffset = arg2;
      byteLength = arg3;
    }
    return new _IconItem(width, height, bin, byteOffset, byteLength);
  }
  isIcon() {
    return true;
  }
  isRaw() {
    return false;
  }
  generate() {
    const bi = this.bitmapInfo;
    const absWidth = Math.abs(bi.width);
    const absWidthBytes = roundUp2(bi.bitCount * absWidth, 32) / 8;
    const absActualHeight = Math.abs(bi.height) / 2;
    const actualSizeImage = absWidthBytes * absActualHeight;
    const sizeMask = calcMaskSize(bi.width, absActualHeight);
    const colorCount = bi.colors.length;
    const totalSize = 40 + 4 * colorCount + actualSizeImage + sizeMask;
    const bin = new ArrayBuffer(totalSize);
    const view = new DataView(bin);
    view.setUint32(0, 40, true);
    view.setInt32(4, bi.width, true);
    view.setInt32(8, bi.height, true);
    view.setUint16(12, bi.planes, true);
    view.setUint16(14, bi.bitCount, true);
    view.setUint32(16, bi.compression, true);
    view.setUint32(20, bi.sizeImage, true);
    view.setInt32(24, bi.xPelsPerMeter, true);
    view.setInt32(28, bi.yPelsPerMeter, true);
    view.setUint32(32, bi.colorUsed, true);
    view.setUint32(
      36,
      bi.colorImportant > colorCount ? colorCount : bi.colorImportant,
      true
    );
    let offset = 40;
    bi.colors.forEach((c) => {
      view.setUint8(offset, c.b);
      view.setUint8(offset + 1, c.g);
      view.setUint8(offset + 2, c.r);
      offset += 4;
    });
    copyBuffer2(bin, offset, this.pixels, 0, actualSizeImage);
    copyBuffer2(bin, offset + actualSizeImage, this.masks, 0, sizeMask);
    return bin;
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/data/RawIconItem.ts
var RawIconItem = class _RawIconItem {
  constructor(bin, width, height, bitCount, byteOffset, byteLength) {
    this.width = width;
    this.height = height;
    this.bitCount = bitCount;
    if (typeof byteOffset !== "number") {
      byteOffset = 0;
      byteLength = bin.byteLength;
    } else if (typeof byteLength !== "number") {
      byteLength = bin.byteLength - byteOffset;
    }
    this.bin = allocatePartialBinary2(bin, byteOffset, byteLength);
  }
  static from(bin, width, height, bitCount, byteOffset, byteLength) {
    return new _RawIconItem(
      bin,
      width,
      height,
      bitCount,
      byteOffset,
      byteLength
    );
  }
  isIcon() {
    return false;
  }
  isRaw() {
    return true;
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/data/IconFile.ts
function generateEntryBinary(icons) {
  let count = icons.length;
  if (count > 65535) {
    count = 65535;
  }
  const tmpIcons = icons.map((item) => {
    if (item.data.isIcon()) {
      return {
        item,
        bin: item.data.generate(),
        offset: 0
      };
    } else {
      return {
        item,
        bin: item.data.bin,
        offset: 0
      };
    }
  });
  const size = tmpIcons.reduce(
    (p, icon) => {
      icon.offset = p;
      return p + icon.bin.byteLength;
    },
    6 + 16 * count
  );
  const bin = new ArrayBuffer(size);
  const view = new DataView(bin);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, count, true);
  let offset = 6;
  tmpIcons.forEach((icon) => {
    const item = icon.item;
    let width;
    let height;
    let colors;
    let planes;
    let bitCount;
    if (item.data.isIcon()) {
      const bi = item.data.bitmapInfo;
      width = typeof item.width !== "undefined" ? item.width : Math.abs(bi.width);
      height = typeof item.height !== "undefined" ? item.height : Math.abs(bi.height / 2);
      colors = typeof item.colors !== "undefined" ? item.colors : bi.colorUsed || bi.colors.length;
      planes = typeof item.planes !== "undefined" ? item.planes : bi.planes;
      bitCount = typeof item.bitCount !== "undefined" ? item.bitCount : bi.bitCount;
    } else {
      width = typeof item.width !== "undefined" ? item.width : Math.abs(item.data.width);
      height = typeof item.height !== "undefined" ? item.height : Math.abs(item.data.height);
      colors = typeof item.colors !== "undefined" ? item.colors : 0;
      planes = typeof item.planes !== "undefined" ? item.planes : 1;
      bitCount = typeof item.bitCount !== "undefined" ? item.bitCount : item.data.bitCount;
    }
    const dataSize = icon.bin.byteLength;
    view.setUint8(offset, width >= 256 ? 0 : width);
    view.setUint8(offset + 1, height >= 256 ? 0 : height);
    view.setUint8(offset + 2, colors >= 256 ? 0 : colors);
    view.setUint8(offset + 3, 0);
    view.setUint16(offset + 4, planes, true);
    view.setUint16(offset + 6, bitCount, true);
    view.setUint32(offset + 8, dataSize, true);
    view.setUint32(offset + 12, icon.offset, true);
    offset += 16;
    copyBuffer2(bin, icon.offset, icon.bin, 0, dataSize);
  });
  return bin;
}
var IconFile = class _IconFile {
  constructor(bin) {
    if (!bin) {
      this.icons = [];
      return;
    }
    const view = createDataView2(bin);
    const totalSize = view.byteLength;
    const icons = [];
    if (view.getUint16(2, true) === 1) {
      const count = view.getUint16(4, true);
      let offset = 6;
      for (let i = 0; i < count; ++i) {
        const dataSize = readUint32WithLastOffset(
          view,
          offset + 8,
          totalSize
        );
        const dataOffset = readUint32WithLastOffset(
          view,
          offset + 12,
          totalSize
        );
        const width = readUint8WithLastOffset(view, offset, totalSize);
        const height = readUint8WithLastOffset(
          view,
          offset + 1,
          totalSize
        );
        const bitCount = readUint8WithLastOffset(
          view,
          offset + 6,
          totalSize
        );
        let data;
        if (view.getUint32(dataOffset, true) === 40) {
          data = IconItem.from(
            width,
            height,
            bin,
            dataOffset,
            dataSize
          );
        } else {
          data = RawIconItem.from(
            bin,
            width || 256,
            height || 256,
            bitCount,
            dataOffset,
            dataSize
          );
        }
        icons.push({
          width,
          height,
          colors: readUint8WithLastOffset(
            view,
            offset + 2,
            totalSize
          ),
          planes: readUint16WithLastOffset(
            view,
            offset + 4,
            totalSize
          ),
          bitCount,
          data
        });
        offset += 16;
      }
    }
    this.icons = icons;
  }
  static from(bin) {
    return new _IconFile(bin);
  }
  generate() {
    return generateEntryBinary(this.icons);
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/mui/index.ts
var mui_exports = {};
__export(mui_exports, {
  MuiResourceInfo: () => MuiResourceInfo,
  createChecksumBinary: () => createChecksumBinary,
  langIdToLanguageTag: () => langIdToLanguageTag,
  langIdToLanguageTagMap: () => langIdToLanguageTagMap,
  makeLocalizedMuiResourceFromNeutralMuiResource: () => makeLocalizedMuiResourceFromNeutralMuiResource,
  makeMuiResourcesFromSingleExecutable: () => makeMuiResourcesFromSingleExecutable,
  makeMuiResourcesFromSingleExecutableAuto: () => makeMuiResourcesFromSingleExecutableAuto
});

// ../wb-cache/vendor-src/resedit-js/src/main/mui/MuiResourceInfo.ts
function isValidMuiResourceEntry(resourceEntry) {
  const view = new DataView(resourceEntry.bin);
  if (view.getUint32(0, true) !== 4274912973) {
    return false;
  }
  const len = view.getUint32(4, true);
  if (len !== resourceEntry.bin.byteLength) {
    return false;
  }
  const version = view.getUint32(8, true);
  if (version !== 65536) {
    return false;
  }
  const fileType = view.getUint32(16, true);
  if ((fileType & 15) !== 1 && (fileType & 15) !== 2) {
    return false;
  }
  return true;
}
function parseMuiResourceData(resourceEntry) {
  const view = new DataView(resourceEntry.bin);
  const len = view.getUint32(4, true);
  const fileTypeNum = readUint32WithLastOffset(view, 16, len) & 240;
  const fileType = fileTypeNum === 16 ? "system" : "application";
  const isLn = (fileTypeNum & 15) !== 2;
  const systemAttributes = readUint32WithLastOffset(view, 20, len);
  const ultimateFallbackLocationNum = readUint32WithLastOffset(view, 24, len);
  const ultimateFallbackLocation = ultimateFallbackLocationNum === 2 ? "external" : "internal";
  const checksumMain = new Uint8Array(
    allocatePartialBinary2(resourceEntry.bin, 28, 16)
  );
  const checksumService = new Uint8Array(
    allocatePartialBinary2(resourceEntry.bin, 44, 16)
  );
  const mainNameTypesOffset = readUint32WithLastOffset(view, 84, len);
  const mainNameTypesLength = readUint32WithLastOffset(view, 88, len);
  const mainIDTypesOffset = readUint32WithLastOffset(view, 92, len);
  const mainIDTypesLength = readUint32WithLastOffset(view, 96, len);
  const muiNameTypesOffset = readUint32WithLastOffset(view, 100, len);
  const muiNameTypesLength = readUint32WithLastOffset(view, 104, len);
  const muiIDTypesOffset = readUint32WithLastOffset(view, 108, len);
  const muiIDTypesLength = readUint32WithLastOffset(view, 112, len);
  const languageOffset = readUint32WithLastOffset(view, 116, len);
  const languageLength = readUint32WithLastOffset(view, 120, len);
  const ultimateFallbackLanguageOffset = readUint32WithLastOffset(
    view,
    124,
    len
  );
  const ultimateFallbackLanguageLength = readUint32WithLastOffset(
    view,
    128,
    len
  );
  let o;
  let e;
  let s = "";
  const mainTypes = [];
  for (o = mainNameTypesOffset, e = mainNameTypesOffset + mainNameTypesLength; o < e; o += 2) {
    const char = readUint16WithLastOffset(view, o, len);
    if (char === 0) {
      if (o > mainNameTypesOffset && s === "") {
        break;
      }
      mainTypes.push(s);
      s = "";
    } else {
      s += String.fromCharCode(char);
    }
  }
  if (s !== "") {
    mainTypes.push(s);
  }
  for (o = mainIDTypesOffset, e = mainIDTypesOffset + mainIDTypesLength; o < e; o += 4) {
    const t = readUint32WithLastOffset(view, o, len);
    if (t > 0) {
      mainTypes.push(t);
    }
  }
  const muiTypes = [];
  for (s = "", o = muiNameTypesOffset, e = muiNameTypesOffset + muiNameTypesLength; o < e; o += 2) {
    const char = readUint16WithLastOffset(view, o, len);
    if (char === 0) {
      if (o > muiNameTypesOffset && s === "") {
        break;
      }
      muiTypes.push(s);
      s = "";
    } else {
      s += String.fromCharCode(char);
    }
  }
  if (s !== "") {
    muiTypes.push(s);
  }
  for (o = muiIDTypesOffset, e = muiIDTypesOffset + muiIDTypesLength; o < e; o += 4) {
    const t = readUint32WithLastOffset(view, o, len);
    if (t > 0) {
      muiTypes.push(t);
    }
  }
  for (s = "", o = languageOffset, e = languageOffset + languageLength; o < e; o += 2) {
    const char = readUint16WithLastOffset(view, o, len);
    if (char === 0) {
      break;
    }
    s += String.fromCharCode(char);
  }
  const language = s;
  for (s = "", o = ultimateFallbackLanguageOffset, e = ultimateFallbackLanguageOffset + ultimateFallbackLanguageLength; o < e; o += 2) {
    const char = readUint16WithLastOffset(view, o, len);
    if (char === 0) {
      break;
    }
    s += String.fromCharCode(char);
  }
  const ultimateFallbackLanguage = s;
  return {
    resLang: resourceEntry.lang,
    isLn,
    fileType,
    systemAttributes,
    checksumMain,
    checksumService,
    language,
    ultimateFallbackLanguage,
    ultimateFallbackLocation,
    mainTypes,
    muiTypes
  };
}
function generateMuiResourceData(data) {
  let binaryLength = 136;
  let mainNameTypesOffset = 0;
  let mainNameTypesLength = 0;
  let mainIDTypesOffset = 0;
  let mainIDTypesLength = 0;
  let muiNameTypesOffset = 0;
  let muiNameTypesLength = 0;
  let muiIDTypesOffset = 0;
  let muiIDTypesLength = 0;
  let languageOffset = 0;
  let languageLength = 0;
  let ultimateFallbackLanguageOffset = 0;
  let ultimateFallbackLanguageLength = 0;
  data.mainTypes.forEach((type) => {
    if (typeof type === "number") {
      mainIDTypesLength += 4;
    } else {
      mainNameTypesLength += (type.length + 1) * 2;
    }
  });
  if (mainNameTypesLength > 0) {
    mainNameTypesLength += 6;
  }
  data.muiTypes.forEach((type) => {
    if (typeof type === "number") {
      muiIDTypesLength += 4;
    } else {
      muiNameTypesLength += (type.length + 1) * 2;
    }
  });
  if (muiNameTypesLength > 0) {
    muiNameTypesLength += 6;
  }
  if (data.isLn) {
    if (data.ultimateFallbackLocation === "external") {
      ultimateFallbackLanguageLength = (data.ultimateFallbackLanguage.length + 1) * 2;
    }
  } else {
    languageLength = (data.language.length + 1) * 2;
  }
  if (mainNameTypesLength > 0) {
    mainNameTypesOffset = binaryLength;
    binaryLength += roundUp2(mainNameTypesLength, 8);
  }
  if (mainIDTypesLength > 0) {
    mainIDTypesOffset = binaryLength;
    binaryLength += roundUp2(mainIDTypesLength, 8);
  }
  if (muiNameTypesLength > 0) {
    muiNameTypesOffset = binaryLength;
    binaryLength += roundUp2(muiNameTypesLength, 8);
  }
  if (muiIDTypesLength > 0) {
    muiIDTypesOffset = binaryLength;
    binaryLength += roundUp2(muiIDTypesLength, 8);
  }
  if (languageLength > 0) {
    languageOffset = binaryLength;
    binaryLength += roundUp2(languageLength, 8);
  }
  if (ultimateFallbackLanguageLength > 0) {
    ultimateFallbackLanguageOffset = binaryLength;
    binaryLength += roundUp2(ultimateFallbackLanguageLength, 8);
  }
  const bin = new ArrayBuffer(binaryLength);
  const view = new DataView(bin);
  view.setUint32(0, 4274912973, true);
  view.setUint32(4, binaryLength, true);
  view.setUint32(8, 65536, true);
  view.setUint32(
    16,
    ((data.fileType === "system" ? 1 : 2) << 4) + (data.isLn ? 1 : 2),
    true
  );
  view.setUint32(20, data.systemAttributes, true);
  view.setUint32(
    24,
    data.isLn ? data.ultimateFallbackLocation === "internal" ? 1 : 2 : 0,
    true
  );
  copyBuffer2(
    bin,
    28,
    data.checksumMain,
    0,
    data.checksumMain.length < 16 ? data.checksumMain.length : 16
  );
  copyBuffer2(
    bin,
    44,
    data.checksumService,
    0,
    data.checksumService.length < 16 ? data.checksumService.length : 16
  );
  view.setUint32(84, mainNameTypesOffset, true);
  view.setUint32(88, mainNameTypesLength, true);
  view.setUint32(92, mainIDTypesOffset, true);
  view.setUint32(96, mainIDTypesLength, true);
  view.setUint32(100, muiNameTypesOffset, true);
  view.setUint32(104, muiNameTypesLength, true);
  view.setUint32(108, muiIDTypesOffset, true);
  view.setUint32(112, muiIDTypesLength, true);
  view.setUint32(116, languageOffset, true);
  view.setUint32(120, languageLength, true);
  view.setUint32(124, ultimateFallbackLanguageOffset, true);
  view.setUint32(128, ultimateFallbackLanguageLength, true);
  let offset = 136;
  if (mainNameTypesLength > 0) {
    data.mainTypes.forEach((type) => {
      if (typeof type !== "number") {
        for (let i = 0; i < type.length; ++i) {
          view.setUint16(offset, type.charCodeAt(i), true);
          offset += 2;
        }
        offset += 2;
      }
    });
    offset += 6;
    offset = roundUp2(offset, 8);
  }
  if (mainIDTypesLength > 0) {
    data.mainTypes.forEach((type) => {
      if (typeof type === "number") {
        view.setUint32(offset, type, true);
        offset += 4;
      }
    });
    offset = roundUp2(offset, 8);
  }
  if (muiNameTypesLength > 0) {
    data.muiTypes.forEach((type) => {
      if (typeof type !== "number") {
        for (let i = 0; i < type.length; ++i) {
          view.setUint16(offset, type.charCodeAt(i), true);
          offset += 2;
        }
        offset += 2;
      }
    });
    offset += 6;
    offset = roundUp2(offset, 8);
  }
  if (muiIDTypesLength > 0) {
    data.muiTypes.forEach((type) => {
      if (typeof type === "number") {
        view.setUint32(offset, type, true);
        offset += 4;
      }
    });
    offset = roundUp2(offset, 8);
  }
  if (languageLength > 0) {
    for (let i = 0; i < data.language.length; ++i) {
      view.setUint16(offset, data.language.charCodeAt(i), true);
      offset += 2;
    }
    offset += 2;
    offset = roundUp2(offset, 8);
  }
  if (ultimateFallbackLanguageLength > 0) {
    for (let i = 0; i < data.ultimateFallbackLanguage.length; ++i) {
      view.setUint16(
        offset,
        data.ultimateFallbackLanguage.charCodeAt(i),
        true
      );
      offset += 2;
    }
    offset += 2;
    offset = roundUp2(offset, 8);
  }
  return {
    type: "MUI",
    id: 1,
    lang: data.resLang,
    codepage: 1200,
    bin
  };
}
var MuiResourceInfo = class _MuiResourceInfo {
  constructor(_data) {
    this.data = _data;
  }
  /**
   * Parses an executable with resource.
   * @param executableResource `NtExecutableResource` instance for the LN or MUI executable (retrieved/created via `NtExecutableResource.from`)
   * @returns `MuiResourceInfo` instance to treat the MUI resource
   */
  static from(executableResource) {
    let muiResourceData = null;
    try {
      executableResource.entries.forEach((entry) => {
        if (muiResourceData != null) {
          return;
        }
        if (entry.type === "MUI" && isValidMuiResourceEntry(entry)) {
          muiResourceData = parseMuiResourceData(entry);
        }
      });
    } catch {
    }
    return new _MuiResourceInfo(muiResourceData);
  }
  /**
   * Creates the new `MuiResourceInfo` instance with empty data.
   * This is useful for creating MUI resource data by scratch.
   */
  static createEmpty() {
    return new _MuiResourceInfo(null);
  }
  /**
   * Generates resource data from current data.
   * Non-null returned values can be stored to `NtExecutableResource.entries`.
   */
  generateEntry() {
    return this.data == null ? null : generateMuiResourceData(this.data);
  }
  /**
   * Replace an MUI entry for `NtExecutableResource` with containing resource data (generated by {@linkcode generateEntry}).
   * All MUI entries are replaced; if `generateEntry` returns null entry, or the resource data for specified MUI executable is not found,
   * MUI entries for the executable will be removed.
   * @param targetExecutableResource `NtExecutableResource` instance
   */
  replaceMuiEntryForExecutables(targetExecutableResource) {
    const generated = this.generateEntry();
    {
      let found = false;
      for (let i = targetExecutableResource.entries.length - 1; i >= 0; --i) {
        const entry = targetExecutableResource.entries[i];
        if (entry.type === "MUI") {
          if (found || generated == null) {
            targetExecutableResource.entries.splice(i, 1);
          } else {
            targetExecutableResource.entries[i] = generated;
          }
          found = true;
        }
      }
      if (!found && generated != null) {
        targetExecutableResource.entries.unshift(generated);
      }
    }
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/resource/VersionInfo.ts
function readStringToNullChar(view, offset, last) {
  let r = "";
  while (offset + 2 <= last) {
    const c = view.getUint16(offset, true);
    if (!c) {
      break;
    }
    r += String.fromCharCode(c);
    offset += 2;
  }
  return r;
}
function writeStringWithNullChar(view, offset, value) {
  for (let i = 0; i < value.length; ++i) {
    view.setUint16(offset, value.charCodeAt(i), true);
    offset += 2;
  }
  view.setUint16(offset, 0, true);
  return offset + 2;
}
function createFixedInfo() {
  return {
    fileVersionMS: 0,
    fileVersionLS: 0,
    productVersionMS: 0,
    productVersionLS: 0,
    fileFlagsMask: 0,
    fileFlags: 0,
    fileOS: 0,
    // Unknown
    fileType: 0,
    // Unknown
    fileSubtype: 0,
    fileDateMS: 0,
    fileDateLS: 0
  };
}
function parseStringTable(view, offset, last) {
  const tableLen = view.getUint16(offset, true);
  const valueLen = view.getUint16(offset + 2, true);
  if (offset + tableLen < last) {
    last = offset + tableLen;
  }
  const tableName = readStringToNullChar(view, offset + 6, last);
  offset += roundUp2(6 + 2 * (tableName.length + 1), 4);
  const langAndCp = parseInt(tableName, 16);
  if (isNaN(langAndCp)) {
    throw new Error("Invalid StringTable data format");
  }
  offset += roundUp2(valueLen, 4);
  const r = {
    lang: Math.floor(langAndCp / 65536),
    codepage: langAndCp & 65535,
    values: {}
  };
  while (offset < last) {
    const childDataLen = view.getUint16(offset, true);
    const childValueLen = view.getUint16(offset + 2, true);
    const valueType = view.getUint16(offset + 4, true);
    if (valueType !== 1) {
      if (valueType !== 0 || childValueLen !== 2) {
        offset += roundUp2(childDataLen, 4);
        continue;
      }
    }
    let childDataLast = offset + childDataLen;
    if (childDataLast > last) {
      childDataLast = last;
    }
    const name = readStringToNullChar(view, offset + 6, childDataLast);
    offset = roundUp2(offset + 6 + 2 * (name.length + 1), 4);
    if (valueType === 0) {
      const valueData = view.getUint16(offset, true);
      if (valueData === 0) {
        r.values[name] = "";
      }
      offset = roundUp2(offset + 2, 4);
    } else {
      let childValueLast = offset + childValueLen * 2;
      if (childValueLast > childDataLast) {
        childValueLast = childDataLast;
      }
      const value = readStringToNullChar(view, offset, childValueLast);
      offset = roundUp2(childValueLast, 4);
      r.values[name] = value;
    }
  }
  return [last, r];
}
function parseStringFileInfo(view, offset, last) {
  const valueLen = view.getUint16(offset + 2, true);
  offset += 36;
  offset += roundUp2(valueLen, 4);
  const r = [];
  while (offset < last) {
    const childData = parseStringTable(view, offset, last);
    const table = childData[1];
    const a = r.filter(
      (e) => e.lang === table.lang && e.codepage === table.codepage
    );
    if (a.length === 0) {
      r.push(table);
    } else {
      for (const key in table.values) {
        const value = table.values[key];
        if (value != null) {
          a[0].values[key] = value;
        }
      }
    }
    offset = roundUp2(childData[0], 4);
  }
  return r;
}
function parseVarFileInfo(view, offset, last) {
  const valueLen = view.getUint16(offset + 2, true);
  offset += 32;
  offset += roundUp2(valueLen, 4);
  const r = [];
  while (offset < last) {
    const childDataLen = view.getUint16(offset, true);
    const childValueLen = view.getUint16(offset + 2, true);
    if (view.getUint16(offset + 4, true) !== 0) {
      offset += roundUp2(childDataLen, 4);
      continue;
    }
    let childDataLast = offset + childDataLen;
    if (childDataLast > last) {
      childDataLast = last;
    }
    const name = readStringToNullChar(view, offset + 6, childDataLast);
    offset = roundUp2(offset + 6 + 2 * (name.length + 1), 4);
    if (name !== "Translation" || childValueLen % 4 !== 0) {
      offset = roundUp2(childDataLast, 4);
      continue;
    }
    for (let child = 0; child < childValueLen; child += 4) {
      if (offset + 4 > childDataLast) {
        break;
      }
      const lang = view.getUint16(offset, true);
      const codepage = view.getUint16(offset + 2, true);
      offset += 4;
      if (r.filter((e) => e.lang === lang && e.codepage === codepage).length === 0) {
        r.push({ lang, codepage });
      }
    }
    offset = roundUp2(childDataLast, 4);
  }
  return r;
}
function parseVersionEntry(view, entry) {
  const totalLen = view.getUint16(0, true);
  let dataLen = view.getUint16(2, true);
  if (view.getUint16(4, true) !== 0) {
    throw new Error("Invalid version data format");
  }
  if (totalLen < dataLen + 40) {
    throw new Error("Invalid version data format");
  }
  if (readStringToNullChar(view, 6, totalLen) !== "VS_VERSION_INFO") {
    throw new Error("Invalid version data format");
  }
  const d = {
    lang: entry.lang,
    fixedInfo: createFixedInfo(),
    strings: [],
    translations: [],
    unknowns: []
  };
  let offset = 38;
  if (dataLen) {
    dataLen += 40;
    const sig = readUint32WithLastOffset(view, 40, dataLen);
    const sVer = readUint32WithLastOffset(view, 44, dataLen);
    if (sig === 4277077181 && sVer <= 65536) {
      d.fixedInfo = {
        fileVersionMS: readUint32WithLastOffset(view, 48, dataLen),
        fileVersionLS: readUint32WithLastOffset(view, 52, dataLen),
        productVersionMS: readUint32WithLastOffset(view, 56, dataLen),
        productVersionLS: readUint32WithLastOffset(view, 60, dataLen),
        fileFlagsMask: readUint32WithLastOffset(view, 64, dataLen),
        fileFlags: readUint32WithLastOffset(view, 68, dataLen),
        fileOS: readUint32WithLastOffset(view, 72, dataLen),
        fileType: readUint32WithLastOffset(view, 76, dataLen),
        fileSubtype: readUint32WithLastOffset(view, 80, dataLen),
        fileDateMS: readUint32WithLastOffset(view, 84, dataLen),
        fileDateLS: readUint32WithLastOffset(view, 88, dataLen)
      };
    }
    offset = dataLen;
  }
  offset = roundUp2(offset, 4);
  while (offset < totalLen) {
    const childLen = view.getUint16(offset, true);
    let childLast = offset + childLen;
    if (childLast > totalLen) {
      childLast = totalLen;
    }
    const name = readStringToNullChar(view, offset + 6, childLast);
    switch (name) {
      case "StringFileInfo":
        d.strings = d.strings.concat(
          parseStringFileInfo(view, offset, childLast)
        );
        break;
      case "VarFileInfo":
        d.translations = d.translations.concat(
          parseVarFileInfo(view, offset, childLast)
        );
        break;
      default:
        d.unknowns.push({
          name,
          entireBin: allocatePartialBinary2(view, offset, childLen)
        });
        break;
    }
    offset += roundUp2(childLen, 4);
  }
  return d;
}
function generateStringTable(table) {
  let size = 24;
  const keys = Object.keys(table.values);
  size = keys.reduce((prev, key) => {
    const value = table.values[key];
    if (value == null) {
      return prev;
    }
    const childHeaderSize = roundUp2(6 + 2 * (key.length + 1), 4);
    const newSize = roundUp2(
      prev + childHeaderSize + 2 * (value.length + 1),
      4
    );
    return newSize > 65532 ? prev : newSize;
  }, size);
  const bin = new ArrayBuffer(size);
  const view = new DataView(bin);
  view.setUint16(0, size, true);
  view.setUint16(2, 0, true);
  view.setUint16(4, 1, true);
  let langAndCp = ((table.lang & 65535) * 65536 + (table.codepage & 65535)).toString(16).toLowerCase();
  if (langAndCp.length < 8) {
    const l = 8 - langAndCp.length;
    langAndCp = "00000000".substr(0, l) + langAndCp;
  }
  let offset = roundUp2(writeStringWithNullChar(view, 6, langAndCp), 4);
  keys.forEach((key) => {
    const value = table.values[key];
    if (value == null) {
      return;
    }
    const childHeaderSize = roundUp2(6 + 2 * (key.length + 1), 4);
    const newSize = childHeaderSize + 2 * (value.length + 1);
    if (offset + newSize <= 65532) {
      view.setUint16(offset, newSize, true);
      if (value.length === 0) {
        view.setUint16(offset + 2, 2, true);
        view.setUint16(offset + 4, 0, true);
      } else {
        view.setUint16(offset + 2, value.length + 1, true);
        view.setUint16(offset + 4, 1, true);
      }
      offset = roundUp2(writeStringWithNullChar(view, offset + 6, key), 4);
      offset = roundUp2(writeStringWithNullChar(view, offset, value), 4);
    }
  });
  return bin;
}
function generateStringTableInfo(tables) {
  let size = 36;
  const tableBins = tables.map((table) => generateStringTable(table));
  size += tableBins.reduce((p, c) => p + c.byteLength, 0);
  const bin = new ArrayBuffer(size);
  const view = new DataView(bin);
  view.setUint16(0, size, true);
  view.setUint16(2, 0, true);
  view.setUint16(4, 1, true);
  let offset = roundUp2(writeStringWithNullChar(view, 6, "StringFileInfo"), 4);
  tableBins.forEach((table) => {
    const len = table.byteLength;
    copyBuffer2(bin, offset, table, 0, len);
    offset += len;
  });
  return bin;
}
function generateVarFileInfo(translations) {
  let size = 32;
  const translationsValueSize = translations.length * 4;
  size += 32 + translationsValueSize;
  const bin = new ArrayBuffer(size);
  const view = new DataView(bin);
  view.setUint16(0, size, true);
  view.setUint16(2, 0, true);
  view.setUint16(4, 1, true);
  let offset = roundUp2(writeStringWithNullChar(view, 6, "VarFileInfo"), 4);
  view.setUint16(offset, 32 + translationsValueSize, true);
  view.setUint16(offset + 2, translationsValueSize, true);
  view.setUint16(offset + 4, 0, true);
  offset = roundUp2(
    writeStringWithNullChar(view, offset + 6, "Translation"),
    4
  );
  translations.forEach((translation) => {
    view.setUint16(offset, translation.lang, true);
    view.setUint16(offset + 2, translation.codepage, true);
    offset += 4;
  });
  return bin;
}
function generateVersionEntryBinary(entry) {
  let size = 92;
  const stringTableInfoBin = generateStringTableInfo(entry.strings);
  const stringTableInfoLen = stringTableInfoBin.byteLength;
  size += stringTableInfoLen;
  const varFileInfoBin = generateVarFileInfo(entry.translations);
  const varFileInfoLen = varFileInfoBin.byteLength;
  size += varFileInfoLen;
  size = entry.unknowns.reduce(
    (p, data) => p + roundUp2(data.entireBin.byteLength, 4),
    size
  );
  const bin = new ArrayBuffer(size);
  const view = new DataView(bin);
  view.setUint16(0, size, true);
  view.setUint16(2, 52, true);
  view.setUint16(4, 0, true);
  let offset = roundUp2(
    writeStringWithNullChar(view, 6, "VS_VERSION_INFO"),
    4
  );
  view.setUint32(offset, 4277077181, true);
  view.setUint32(offset + 4, 65536, true);
  view.setUint32(offset + 8, entry.fixedInfo.fileVersionMS, true);
  view.setUint32(offset + 12, entry.fixedInfo.fileVersionLS, true);
  view.setUint32(offset + 16, entry.fixedInfo.productVersionMS, true);
  view.setUint32(offset + 20, entry.fixedInfo.productVersionLS, true);
  view.setUint32(offset + 24, entry.fixedInfo.fileFlagsMask, true);
  view.setUint32(offset + 28, entry.fixedInfo.fileFlags, true);
  view.setUint32(offset + 32, entry.fixedInfo.fileOS, true);
  view.setUint32(offset + 36, entry.fixedInfo.fileType, true);
  view.setUint32(offset + 40, entry.fixedInfo.fileSubtype, true);
  view.setUint32(offset + 44, entry.fixedInfo.fileDateMS, true);
  view.setUint32(offset + 48, entry.fixedInfo.fileDateLS, true);
  offset += 52;
  copyBuffer2(bin, offset, stringTableInfoBin, 0, stringTableInfoLen);
  offset += stringTableInfoLen;
  copyBuffer2(bin, offset, varFileInfoBin, 0, varFileInfoLen);
  offset += varFileInfoLen;
  entry.unknowns.forEach((e) => {
    const len = e.entireBin.byteLength;
    copyBuffer2(bin, offset, e.entireBin, 0, len);
    offset += roundUp2(len, 4);
  });
  return bin;
}
function clampInt(val, min, max) {
  if (isNaN(val) || val < min) {
    return min;
  } else if (val >= max) {
    return max;
  }
  return Math.floor(val);
}
function parseVersionArguments(arg1, arg2, arg3, arg4, arg5) {
  let major;
  let minor;
  let micro;
  let revision;
  let lang;
  if (typeof arg1 === "string" && (typeof arg2 === "undefined" || typeof arg2 === "number") && typeof arg3 === "undefined") {
    [major, minor, micro, revision] = arg1.split(".").map((token) => clampInt(Number(token), 0, 65535)).concat(0, 0, 0);
    lang = arg2;
  } else {
    major = clampInt(Number(arg1), 0, 65535);
    minor = clampInt(Number(arg2), 0, 65535);
    micro = clampInt(
      typeof arg3 === "undefined" ? 0 : Number(arg3),
      0,
      65535
    );
    revision = clampInt(
      typeof arg4 === "undefined" ? 0 : Number(arg4),
      0,
      65535
    );
    lang = arg5;
  }
  return [major, minor, micro, revision, lang];
}
var VersionInfo = class _VersionInfo {
  constructor(entry) {
    if (!entry) {
      this.data = {
        lang: 0,
        // MAKELANGID(LANG_NEUTRAL, SUBLANG_NEUTRAL)
        fixedInfo: createFixedInfo(),
        strings: [],
        translations: [],
        unknowns: []
      };
    } else {
      const view = new DataView(entry.bin);
      this.data = parseVersionEntry(view, entry);
    }
  }
  /** Returns new `VersionInfo` instance with empty data. */
  static createEmpty() {
    return new _VersionInfo();
  }
  static create(arg1, fixedInfo, strings) {
    let lang;
    if (typeof arg1 === "object") {
      lang = arg1.lang;
      fixedInfo = arg1.fixedInfo;
      strings = arg1.strings;
    } else {
      lang = arg1;
    }
    const vi = new _VersionInfo();
    vi.data.lang = lang;
    for (const _fixedInfoKey in fixedInfo) {
      const fixedInfoKey = _fixedInfoKey;
      if (fixedInfoKey in fixedInfo) {
        const value = fixedInfo[fixedInfoKey];
        if (value != null) {
          vi.data.fixedInfo[fixedInfoKey] = value;
        }
      }
    }
    vi.data.strings = strings.map(
      ({ lang: lang2, codepage, values }) => ({
        lang: lang2,
        codepage,
        values: cloneObject2(values)
      })
    );
    vi.data.translations = strings.map(
      ({ lang: lang2, codepage }) => ({ lang: lang2, codepage })
    );
    return vi;
  }
  /** Pick up all version-info entries */
  static fromEntries(entries) {
    return entries.filter((e) => e.type === 16).map((e) => new _VersionInfo(e));
  }
  /** A language value for this resource entry. */
  get lang() {
    return this.data.lang;
  }
  set lang(value) {
    this.data.lang = value;
  }
  /**
   * The property of fixed version info, containing file version, product version, etc.
   * (data: `VS_FIXEDFILEINFO`)
   *
   * Although this property is read-only, you can rewrite
   * each child fields directly to apply data.
   */
  get fixedInfo() {
    return this.data.fixedInfo;
  }
  /**
   * Returns all languages that the executable supports. (data: `VarFileInfo`)
   *
   * Usually the returned array is equal to the one returned by `getAllLanguagesForStringValues`,
   * but some resource-generating tools doesn't generate same values.
   */
  getAvailableLanguages() {
    return this.data.translations.slice(0);
  }
  /**
   * Replaces all languages that the executable supports.
   */
  replaceAvailableLanguages(languages) {
    this.data.translations = languages.slice(0);
  }
  /**
   * Returns all string values for the specified language. (data: values in lang-charset block of `StringFileInfo`)
   */
  getStringValues(language) {
    const a = this.data.strings.filter(
      (e) => e.lang === language.lang && e.codepage === language.codepage
    ).map((e) => e.values);
    return a.length > 0 ? a[0] : {};
  }
  /**
   * Returns all languages used by string values. (data: lang-charset name of `StringFileInfo`)
   *
   * Usually the returned array is equal to the one returned by `getAvailableLanguages`,
   * but some resource-generating tools doesn't generate same values.
   */
  getAllLanguagesForStringValues() {
    return this.data.strings.map(
      ({ codepage, lang }) => ({ codepage, lang })
    );
  }
  /**
   * Add or replace the string values.
   * @param language language info
   * @param values string values (key-value pairs)
   * @param addToAvailableLanguage set `true` to add `language` into available languages
   *     if not existing in `getAvailableLanguages()` (default: `true`)
   */
  setStringValues(language, values, addToAvailableLanguage = true) {
    const a = this.data.strings.filter(
      (e) => e.lang === language.lang && e.codepage === language.codepage
    );
    let table;
    if (a.length === 0) {
      table = {
        lang: language.lang,
        codepage: language.codepage,
        values: {}
      };
      this.data.strings.push(table);
    } else {
      table = a[0];
    }
    for (const key in values) {
      const value = values[key];
      if (value != null) {
        table.values[key] = value;
      }
    }
    if (addToAvailableLanguage) {
      const t = this.data.translations.filter(
        (e) => e.lang === language.lang && e.codepage === language.codepage
      );
      if (t.length === 0) {
        this.data.translations.push({
          lang: language.lang,
          codepage: language.codepage
        });
      }
    }
  }
  /**
   * Add or replace the string value.
   * @param language language info
   * @param key the key name of string value
   * @param value the string value
   * @param addToAvailableLanguage set `true` to add `language` into available languages
   *     if not existing in `getAvailableLanguages()` (default: `true`)
   */
  setStringValue(language, key, value, addToAvailableLanguage = true) {
    this.setStringValues(
      language,
      { [key]: value },
      addToAvailableLanguage
    );
  }
  /**
   * Remove all string values for specified language.
   * @param language language info
   * @param removeFromAvailableLanguage set `true` to remove `language` from available languages
   *     if existing in `getAvailableLanguages()` (default: `true`)
   */
  removeAllStringValues(language, removeFromAvailableLanguage = true) {
    const strings = this.data.strings;
    const len = strings.length;
    for (let i = 0; i < len; ++i) {
      const e = strings[i];
      if (e != null && e.lang === language.lang && e.codepage === language.codepage) {
        strings.splice(i, 1);
        if (removeFromAvailableLanguage) {
          const translations = this.data.translations;
          for (let j = 0; j < translations.length; j++) {
            const t = translations[j];
            if (t != null && t.lang === language.lang && t.codepage === language.codepage) {
              translations.splice(j, 1);
              break;
            }
          }
        }
        break;
      }
    }
  }
  /**
   * Remove specified string value for specified language.
   * @param language language info
   * @param key the key name of string value to be removed
   * @param removeFromAvailableLanguage set `true` to remove `language` from available languages
   *     if no more string values exist for `language` (default: `true`)
   */
  removeStringValue(language, key, removeFromAvailableLanguage = true) {
    const strings = this.data.strings;
    const len = strings.length;
    for (let i = 0; i < len; ++i) {
      const e = strings[i];
      if (e != null && e.lang === language.lang && e.codepage === language.codepage) {
        try {
          delete e.values[key];
        } catch (_ex) {
        }
        if (removeFromAvailableLanguage && Object.keys(e.values).length === 0) {
          strings.splice(i, 1);
          const translations = this.data.translations;
          for (let j = 0; j < translations.length; j++) {
            const t = translations[j];
            if (t != null && t.lang === language.lang && t.codepage === language.codepage) {
              translations.splice(j, 1);
              break;
            }
          }
        }
        break;
      }
    }
  }
  /**
   * Creates `Type.ResourceEntry` object for this instance.
   * Usually `outputToResourceEntries` is suitable for generating resource data
   * into executables, but you can use this method if necessary.
   */
  generateResource() {
    const bin = generateVersionEntryBinary(this.data);
    return {
      type: 16,
      id: 1,
      lang: this.lang,
      codepage: 1200,
      bin
    };
  }
  /**
   * Generates version info resource data (using `generateResource()`) and emits into `entries` array.
   * If version info resource already exists in `entries`, this method replaces it with the new one.
   * @param entries resource entry array for output
   */
  outputToResourceEntries(entries) {
    const res = this.generateResource();
    const len = entries.length;
    for (let i = 0; i < len; ++i) {
      const e = entries[i];
      if (e != null && e.type === 16 && e.id === res.id && e.lang === res.lang) {
        entries[i] = res;
        return;
      }
    }
    entries.push(res);
  }
  // utility methods
  getDefaultVersionLang(propName) {
    const num = Number(this.lang);
    if (this.lang !== "" && !isNaN(num)) {
      return num;
    }
    const a = this.data.strings.filter((e) => propName in e.values && e.values[propName] != null).map((e) => e.lang);
    if (a.length === 1) {
      return a[0];
    }
    return 1033;
  }
  setFileVersion(arg1, arg2, arg3, arg4, arg5) {
    this.setFileVersionImpl(
      ...parseVersionArguments(arg1, arg2, arg3, arg4, arg5)
    );
  }
  setFileVersionImpl(major, minor, micro, revision, lang) {
    lang = typeof lang !== "undefined" ? lang : this.getDefaultVersionLang("FileVersion");
    this.fixedInfo.fileVersionMS = major << 16 | minor;
    this.fixedInfo.fileVersionLS = micro << 16 | revision;
    this.setStringValue(
      { lang, codepage: 1200 },
      "FileVersion",
      `${major}.${minor}.${micro}.${revision}`,
      true
    );
  }
  setProductVersion(arg1, arg2, arg3, arg4, arg5) {
    this.setProductVersionImpl(
      ...parseVersionArguments(arg1, arg2, arg3, arg4, arg5)
    );
  }
  setProductVersionImpl(major, minor, micro, revision, lang) {
    lang = typeof lang !== "undefined" ? lang : this.getDefaultVersionLang("ProductVersion");
    this.fixedInfo.productVersionMS = major << 16 | minor;
    this.fixedInfo.productVersionLS = micro << 16 | revision;
    this.setStringValue(
      { lang, codepage: 1200 },
      "ProductVersion",
      `${major}.${minor}.${micro}.${revision}`,
      true
    );
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/mui/muiUtils.ts
var langIdToLanguageTagMap = {
  // List is from https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-lcid/63d3d639-7fd2-4afb-abbe-0d5b5551eef8
  1: "ar",
  2: "bg",
  3: "ca",
  4: "zh-Hans",
  5: "cs",
  6: "da",
  7: "de",
  8: "el",
  9: "en",
  10: "es",
  11: "fi",
  12: "fr",
  13: "he",
  14: "hu",
  15: "is",
  16: "it",
  17: "ja",
  18: "ko",
  19: "nl",
  20: "no",
  21: "pl",
  22: "pt",
  23: "rm",
  24: "ro",
  25: "ru",
  26: "hr",
  27: "sk",
  28: "sq",
  29: "sv",
  30: "th",
  31: "tr",
  32: "ur",
  33: "id",
  34: "uk",
  35: "be",
  36: "sl",
  37: "et",
  38: "lv",
  39: "lt",
  40: "tg",
  41: "fa",
  42: "vi",
  43: "hy",
  44: "az",
  45: "eu",
  46: "hsb",
  47: "mk",
  48: "st",
  49: "ts",
  50: "tn",
  51: "ve",
  52: "xh",
  53: "zu",
  54: "af",
  55: "ka",
  56: "fo",
  57: "hi",
  58: "mt",
  59: "se",
  60: "ga",
  61: "yi",
  62: "ms",
  63: "kk",
  64: "ky",
  65: "sw",
  66: "tk",
  67: "uz",
  68: "tt",
  69: "bn",
  70: "pa",
  71: "gu",
  72: "or",
  73: "ta",
  74: "te",
  75: "kn",
  76: "ml",
  77: "as",
  78: "mr",
  79: "sa",
  80: "mn",
  81: "bo",
  82: "cy",
  83: "km",
  84: "lo",
  85: "my",
  86: "gl",
  87: "kok",
  88: "mni",
  89: "sd",
  90: "syr",
  91: "si",
  92: "chr",
  93: "iu",
  94: "am",
  95: "tzm",
  96: "ks",
  97: "ne",
  98: "fy",
  99: "ps",
  100: "fil",
  101: "dv",
  102: "bin",
  103: "ff",
  104: "ha",
  105: "ibb",
  106: "yo",
  107: "quz",
  108: "nso",
  109: "ba",
  110: "lb",
  111: "kl",
  112: "ig",
  113: "kr",
  114: "om",
  115: "ti",
  116: "gn",
  117: "haw",
  118: "la",
  119: "so",
  120: "ii",
  121: "pap",
  122: "arn",
  124: "moh",
  126: "br",
  128: "ug",
  129: "mi",
  130: "oc",
  131: "co",
  132: "gsw",
  133: "sah",
  134: "qut",
  135: "rw",
  136: "wo",
  140: "prs",
  145: "gd",
  146: "ku",
  147: "quc",
  1025: "ar-SA",
  1026: "bg-BG",
  1027: "ca-ES",
  1028: "zh-TW",
  1029: "cs-CZ",
  1030: "da-DK",
  1031: "de-DE",
  1032: "el-GR",
  1033: "en-US",
  1034: "es-ES_tradnl",
  1035: "fi-FI",
  1036: "fr-FR",
  1037: "he-IL",
  1038: "hu-HU",
  1039: "is-IS",
  1040: "it-IT",
  1041: "ja-JP",
  1042: "ko-KR",
  1043: "nl-NL",
  1044: "nb-NO",
  1045: "pl-PL",
  1046: "pt-BR",
  1047: "rm-CH",
  1048: "ro-RO",
  1049: "ru-RU",
  1050: "hr-HR",
  1051: "sk-SK",
  1052: "sq-AL",
  1053: "sv-SE",
  1054: "th-TH",
  1055: "tr-TR",
  1056: "ur-PK",
  1057: "id-ID",
  1058: "uk-UA",
  1059: "be-BY",
  1060: "sl-SI",
  1061: "et-EE",
  1062: "lv-LV",
  1063: "lt-LT",
  1064: "tg-Cyrl-TJ",
  1065: "fa-IR",
  1066: "vi-VN",
  1067: "hy-AM",
  1068: "az-Latn-AZ",
  1069: "eu-ES",
  1070: "hsb-DE",
  1071: "mk-MK",
  1072: "st-ZA",
  1073: "ts-ZA",
  1074: "tn-ZA",
  1075: "ve-ZA",
  1076: "xh-ZA",
  1077: "zu-ZA",
  1078: "af-ZA",
  1079: "ka-GE",
  1080: "fo-FO",
  1081: "hi-IN",
  1082: "mt-MT",
  1083: "se-NO",
  1085: "yi-001",
  1086: "ms-MY",
  1087: "kk-KZ",
  1088: "ky-KG",
  1089: "sw-KE",
  1090: "tk-TM",
  1091: "uz-Latn-UZ",
  1092: "tt-RU",
  1093: "bn-IN",
  1094: "pa-IN",
  1095: "gu-IN",
  1096: "or-IN",
  1097: "ta-IN",
  1098: "te-IN",
  1099: "kn-IN",
  1100: "ml-IN",
  1101: "as-IN",
  1102: "mr-IN",
  1103: "sa-IN",
  1104: "mn-MN",
  1105: "bo-CN",
  1106: "cy-GB",
  1107: "km-KH",
  1108: "lo-LA",
  1109: "my-MM",
  1110: "gl-ES",
  1111: "kok-IN",
  1112: "mni-IN",
  1113: "sd-Deva-IN",
  1114: "syr-SY",
  1115: "si-LK",
  1116: "chr-Cher-US",
  1117: "iu-Cans-CA",
  1118: "am-ET",
  1119: "tzm-Arab-MA",
  1120: "ks-Arab",
  1121: "ne-NP",
  1122: "fy-NL",
  1123: "ps-AF",
  1124: "fil-PH",
  1125: "dv-MV",
  1126: "bin-NG",
  1128: "ha-Latn-NG",
  1129: "ibb-NG",
  1130: "yo-NG",
  1131: "quz-BO",
  1132: "nso-ZA",
  1133: "ba-RU",
  1134: "lb-LU",
  1135: "kl-GL",
  1136: "ig-NG",
  1137: "kr-Latn-NG",
  1138: "om-ET",
  1139: "ti-ET",
  1140: "gn-PY",
  1141: "haw-US",
  1142: "la-VA",
  1143: "so-SO",
  1144: "ii-CN",
  1145: "pap-029",
  1146: "arn-CL",
  1148: "moh-CA",
  1150: "br-FR",
  1152: "ug-CN",
  1153: "mi-NZ",
  1154: "oc-FR",
  1155: "co-FR",
  1156: "gsw-FR",
  1157: "sah-RU",
  1158: "qut-GT",
  1159: "rw-RW",
  1160: "wo-SN",
  1164: "prs-AF",
  1165: "plt-MG",
  1166: "zh-yue-HK",
  1167: "tdd-Tale-CN",
  1168: "khb-Talu-CN",
  1169: "gd-GB",
  1170: "ku-Arab-IQ",
  1171: "quc-CO",
  1281: "qps-ploc",
  1534: "qps-ploca",
  2049: "ar-IQ",
  2051: "ca-ES-valencia",
  2052: "zh-CN",
  2055: "de-CH",
  2057: "en-GB",
  2058: "es-MX",
  2060: "fr-BE",
  2064: "it-CH",
  2065: "ja-Ploc-JP",
  2067: "nl-BE",
  2068: "nn-NO",
  2070: "pt-PT",
  2072: "ro-MD",
  2073: "ru-MD",
  2074: "sr-Latn-CS",
  2077: "sv-FI",
  2080: "ur-IN",
  2092: "az-Cyrl-AZ",
  2094: "dsb-DE",
  2098: "tn-BW",
  2107: "se-SE",
  2108: "ga-IE",
  2110: "ms-BN",
  2111: "kk-Latn-KZ",
  2115: "uz-Cyrl-UZ",
  2117: "bn-BD",
  2118: "pa-Arab-PK",
  2121: "ta-LK",
  2128: "mn-Mong-CN",
  2129: "bo-BT",
  2137: "sd-Arab-PK",
  2141: "iu-Latn-CA",
  2143: "tzm-Latn-DZ",
  2144: "ks-Deva-IN",
  2145: "ne-IN",
  2151: "ff-Latn-SN",
  2155: "quz-EC",
  2163: "ti-ER",
  2559: "qps-plocm",
  3073: "ar-EG",
  3076: "zh-HK",
  3079: "de-AT",
  3081: "en-AU",
  3082: "es-ES",
  3084: "fr-CA",
  3098: "sr-Cyrl-CS",
  3131: "se-FI",
  3152: "mn-Mong-MN",
  3153: "dz-BT",
  3167: "tmz-MA",
  3179: "quz-PE",
  4097: "ar-LY",
  4100: "zh-SG",
  4103: "de-LU",
  4105: "en-CA",
  4106: "es-GT",
  4108: "fr-CH",
  4122: "hr-BA",
  4155: "smj-NO",
  4191: "tzm-Tfng-MA",
  5121: "ar-DZ",
  5124: "zh-MO",
  5127: "de-LI",
  5129: "en-NZ",
  5130: "es-CR",
  5132: "fr-LU",
  5146: "bs-Latn-BA",
  5179: "smj-SE",
  6145: "ar-MA",
  6153: "en-IE",
  6154: "es-PA",
  6156: "fr-MC",
  6170: "sr-Latn-BA",
  6203: "sma-NO",
  7169: "ar-TN",
  7177: "en-ZA",
  7178: "es-DO",
  7180: "fr-029",
  7194: "sr-Cyrl-BA",
  7227: "sma-SE",
  8193: "ar-OM",
  8201: "en-JM",
  8202: "es-VE",
  8204: "fr-RE",
  8218: "bs-Cyrl-BA",
  8251: "sms-FI",
  9217: "ar-YE",
  9225: "en-029",
  9226: "es-CO",
  9228: "fr-CD",
  9242: "sr-Latn-RS",
  9275: "smn-FI",
  10241: "ar-SY",
  10249: "en-BZ",
  10250: "es-PE",
  10252: "fr-SN",
  10266: "sr-Cyrl-RS",
  11265: "ar-JO",
  11273: "en-TT",
  11274: "es-AR",
  11276: "fr-CM",
  11290: "sr-Latn-ME",
  12289: "ar-LB",
  12297: "en-ZW",
  12298: "es-EC",
  12300: "fr-CI",
  12314: "sr-Cyrl-ME",
  13313: "ar-KW",
  13321: "en-PH",
  13322: "es-CL",
  13324: "fr-ML",
  14337: "ar-AE",
  14345: "en-ID",
  14346: "es-UY",
  14348: "fr-MA",
  15361: "ar-BH",
  15369: "en-HK",
  15370: "es-PY",
  15372: "fr-HT",
  16385: "ar-QA",
  16393: "en-IN",
  16394: "es-BO",
  17409: "ar-Ploc-SA",
  17417: "en-MY",
  17418: "es-SV",
  18433: "ar-145",
  18441: "en-SG",
  18442: "es-HN",
  19465: "en-AE",
  19466: "es-NI",
  20489: "en-BH",
  20490: "es-PR",
  21513: "en-EG",
  21514: "es-US",
  22537: "en-JO",
  22538: "es-419",
  23561: "en-KW",
  23562: "es-CU",
  24585: "en-TR",
  25609: "en-YE",
  25626: "bs-Cyrl",
  26650: "bs-Latn",
  27674: "sr-Cyrl",
  28698: "sr-Latn",
  28731: "smn",
  29740: "az-Cyrl",
  29755: "sms",
  30724: "zh",
  30740: "nn",
  30746: "bs",
  30764: "az-Latn",
  30779: "sma",
  30783: "kk-Cyrl",
  30787: "uz-Cyrl",
  30800: "mn-Cyrl",
  30813: "iu-Cans",
  30815: "tzm-Tfng",
  31748: "zh-Hant",
  31764: "nb",
  31770: "sr",
  31784: "tg-Cyrl",
  31790: "dsb",
  31803: "smj",
  31807: "kk-Latn",
  31811: "uz-Latn",
  31814: "pa-Arab",
  31824: "mn-Mong",
  31833: "sd-Arab",
  31836: "chr-Cher",
  31837: "iu-Latn",
  31839: "tzm-Latn",
  31847: "ff-Latn",
  31848: "ha-Latn",
  31890: "ku-Arab",
  58380: "fr-015"
};
function langIdToLanguageTag(langId) {
  return langIdToLanguageTagMap[langId] || `#${langId}`;
}
function createChecksumBinary() {
  const r = new Uint8Array(16);
  for (let i = 0; i < 16; ++i) {
    r[i] = Math.floor(Math.random() * 256);
  }
  return r;
}
function cloneResourceEntry(entry) {
  return {
    type: entry.type,
    id: entry.id,
    lang: entry.lang,
    codepage: entry.codepage,
    bin: cloneToArrayBuffer2(entry.bin)
  };
}
function cloneResourceEntryWithLangIdAndReplaceVersionData(entry, langId) {
  if (entry.type !== 16) {
    const e = cloneResourceEntry(entry);
    e.lang = langId;
    return e;
  }
  const versionInfoBase = VersionInfo.fromEntries([entry])[0];
  const versionTranslation = versionInfoBase.getAllLanguagesForStringValues()[0];
  if (versionTranslation == null) {
    const e = cloneResourceEntry(entry);
    e.lang = langId;
    return e;
  }
  const stringValues = versionInfoBase.getStringValues(versionTranslation);
  const newVersionInfo = VersionInfo.create(
    langId,
    versionInfoBase.fixedInfo,
    [
      {
        lang: langId,
        codepage: 1200,
        values: stringValues
      }
    ]
  );
  return newVersionInfo.generateResource();
}
function makeLocalizedMuiResourceFromNeutralMuiResource(neutralMuiResource, langTag) {
  const result = MuiResourceInfo.createEmpty();
  if (neutralMuiResource.data != null) {
    result.data = {
      resLang: neutralMuiResource.data.resLang,
      isLn: false,
      fileType: neutralMuiResource.data.fileType,
      systemAttributes: neutralMuiResource.data.systemAttributes,
      checksumMain: new Uint8Array(neutralMuiResource.data.checksumMain),
      checksumService: new Uint8Array(
        neutralMuiResource.data.checksumService
      ),
      language: langTag,
      ultimateFallbackLanguage: "",
      ultimateFallbackLocation: "external",
      mainTypes: neutralMuiResource.data.muiTypes.slice(),
      muiTypes: []
    };
  }
  return result;
}
function makeMuiResourcesFromSingleExecutable(baseExecutableResource, neutralResources, localizedResources, defaultLangId, is32bit = false, fallbackLangIdIfLocalizedNotExist = defaultLangId) {
  if (localizedResources.length === 0) {
    throw new Error("No localized resource type is specified");
  }
  if (!(defaultLangId in langIdToLanguageTagMap)) {
    throw new Error("Invalid or unknown defaultLangId value");
  }
  [3, 5, 6, 16].forEach((type) => {
    if (neutralResources.indexOf(type) >= 0) {
      if (localizedResources.indexOf(type) < 0) {
        localizedResources = localizedResources.concat(type);
      }
      if (type === 3) {
        if (neutralResources.indexOf(14) < 0) {
          neutralResources = neutralResources.concat(14);
        }
        if (localizedResources.indexOf(14) < 0) {
          localizedResources = localizedResources.concat(14);
        }
      }
    }
  });
  if (neutralResources.indexOf("MUI") < 0) {
    neutralResources = neutralResources.concat("MUI");
  }
  if (localizedResources.indexOf("MUI") < 0) {
    localizedResources = localizedResources.concat("MUI");
  }
  const resourcesPerLangId = [];
  baseExecutableResource.entries.forEach((entry) => {
    if (localizedResources.some((type) => entry.type === type)) {
      if (typeof entry.lang === "number") {
        let found = false;
        for (let i = 0, l = resourcesPerLangId.length; i < l; ++i) {
          const data = resourcesPerLangId[i];
          if (data[0] === entry.lang) {
            data[1].push(
              cloneResourceEntryWithLangIdAndReplaceVersionData(
                entry,
                entry.lang
              )
            );
            found = true;
            break;
          }
        }
        if (!found) {
          resourcesPerLangId.push([
            entry.lang,
            [
              cloneResourceEntryWithLangIdAndReplaceVersionData(
                entry,
                entry.lang
              )
            ]
          ]);
        }
      }
    }
  });
  let defaultEntries;
  resourcesPerLangId.forEach(([langId, entries]) => {
    if (langId === fallbackLangIdIfLocalizedNotExist) {
      defaultEntries = entries;
    }
  });
  if (defaultEntries != null) {
    resourcesPerLangId.forEach(([langId, entries]) => {
      if (langId === fallbackLangIdIfLocalizedNotExist) {
        return;
      }
      const existingTypes = entries.map((entry) => entry.type);
      defaultEntries.forEach((entry) => {
        if (existingTypes.some((type) => entry.type === type)) {
          return;
        }
        const newEntry = cloneResourceEntryWithLangIdAndReplaceVersionData(
          entry,
          langId
        );
        entries.push(newEntry);
      });
    });
  }
  const checksumMain = createChecksumBinary();
  const checksumService = createChecksumBinary();
  const lnMuiResourceInfo = MuiResourceInfo.createEmpty();
  lnMuiResourceInfo.data = {
    resLang: 1033,
    isLn: true,
    fileType: "application",
    systemAttributes: 0,
    checksumMain,
    checksumService,
    language: "",
    ultimateFallbackLanguage: langIdToLanguageTag(defaultLangId),
    ultimateFallbackLocation: "external",
    mainTypes: neutralResources.slice(),
    muiTypes: localizedResources.slice()
  };
  const generated = lnMuiResourceInfo.generateEntry();
  {
    const droppedLocalizedResources = {};
    for (let i = baseExecutableResource.entries.length - 1; i >= 0; --i) {
      let entry = baseExecutableResource.entries[i];
      if (entry.type === 16 && typeof entry.lang === "number") {
        entry = baseExecutableResource.entries[i] = cloneResourceEntryWithLangIdAndReplaceVersionData(
          entry,
          entry.lang
        );
      }
      if (entry.type === "MUI") {
        baseExecutableResource.entries.splice(i, 1);
      } else {
        if (!neutralResources.some((type) => type === entry.type)) {
          baseExecutableResource.entries.splice(i, 1);
        } else if (localizedResources.some((type) => type === entry.type)) {
          const key = typeof entry.type === "number" ? `n${entry.type}` : `s${entry.type}`;
          const a = droppedLocalizedResources[key] || (droppedLocalizedResources[key] = []);
          a.push(entry);
          baseExecutableResource.entries.splice(i, 1);
        }
      }
    }
    Object.keys(droppedLocalizedResources).forEach((key) => {
      const a = droppedLocalizedResources[key];
      if (a.length > 0) {
        let foundEntry = a[0];
        for (let i = 0, l = a.length; i < l; ++i) {
          const entry = a[i];
          if (entry.lang === defaultLangId) {
            foundEntry = entry;
          }
        }
        baseExecutableResource.entries.push(foundEntry);
      }
    });
    if (generated != null) {
      baseExecutableResource.entries.unshift(generated);
    }
  }
  const muiExecutables = resourcesPerLangId.map(
    ([langId, resources]) => {
      const executable = NtExecutable.createEmpty(is32bit);
      const res = NtExecutableResource.from(executable);
      res.entries = resources;
      const langTag = langIdToLanguageTag(langId);
      const mui = MuiResourceInfo.createEmpty();
      mui.data = {
        resLang: 1033,
        isLn: false,
        fileType: "application",
        systemAttributes: 0,
        checksumMain,
        checksumService,
        language: langTag,
        ultimateFallbackLanguage: "",
        ultimateFallbackLocation: "external",
        mainTypes: localizedResources.slice(),
        muiTypes: []
      };
      const resource = mui.generateEntry();
      if (resource != null) {
        res.entries.unshift(resource);
      }
      res.outputResource(executable);
      return [langTag, executable];
    }
  );
  return {
    baseExecutableResource,
    muiExecutables
  };
}
var defaultLocalizedTypes = [
  [4, false],
  // RT_MENU
  [5, false],
  // RT_DIALOG
  [6, false],
  // RT_STRING
  [9, false],
  // RT_ACCELERATOR
  [16, true]
  // RT_VERSION
];
function makeMuiResourcesFromSingleExecutableAuto(baseExecutableResource, defaultLangId, is32bit = false, fallbackLangIdIfLocalizedNotExist = defaultLangId) {
  const addedResourceTypes = {};
  const neutralResources = ["MUI"];
  const localizedResources = ["MUI"];
  baseExecutableResource.entries.forEach((entry) => {
    const addedTypeName = typeof entry.type === "number" ? `d${entry.type}` : `s${entry.type}`;
    if (addedResourceTypes[addedTypeName]) {
      return;
    }
    addedResourceTypes[addedTypeName] = true;
    let found = false;
    defaultLocalizedTypes.forEach(([type, alsoInNeutral]) => {
      if (entry.type === type) {
        found = true;
        localizedResources.push(type);
        if (alsoInNeutral) {
          neutralResources.push(type);
        }
      }
    });
    if (!found) {
      neutralResources.push(entry.type);
    }
  });
  return makeMuiResourcesFromSingleExecutable(
    baseExecutableResource,
    neutralResources,
    localizedResources,
    defaultLangId,
    is32bit,
    fallbackLangIdIfLocalizedNotExist
  );
}

// ../wb-cache/vendor-src/resedit-js/src/main/resource/index.ts
var resource_exports = {};
__export(resource_exports, {
  IconGroupEntry: () => IconGroupEntry,
  StringTable: () => StringTable,
  VersionFileDriverSubtype: () => VersionFileDriverSubtype,
  VersionFileFlags: () => VersionFileFlags_default,
  VersionFileFontSubtype: () => VersionFileFontSubtype,
  VersionFileOS: () => VersionFileOS_default,
  VersionFileType: () => VersionFileType_default,
  VersionInfo: () => VersionInfo
});

// ../wb-cache/vendor-src/resedit-js/src/main/resource/IconGroupEntry.ts
function generateEntryBinary2(icons) {
  let count = icons.length;
  if (count > 65535) {
    count = 65535;
  }
  const size = 6 + 14 * icons.length;
  const bin = new ArrayBuffer(size);
  const view = new DataView(bin);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, count, true);
  let offset = 6;
  icons.forEach((icon) => {
    view.setUint8(offset, icon.width >= 256 ? 0 : icon.width);
    view.setUint8(offset + 1, icon.height >= 256 ? 0 : icon.height);
    view.setUint8(offset + 2, icon.colors >= 256 ? 0 : icon.colors);
    view.setUint8(offset + 3, 0);
    view.setUint16(offset + 4, icon.planes, true);
    view.setUint16(offset + 6, icon.bitCount, true);
    view.setUint32(offset + 8, icon.dataSize, true);
    view.setUint16(offset + 12, icon.iconID, true);
    offset += 14;
  });
  return bin;
}
function findUnusedIconID(entries, lang, isCursor) {
  const type = isCursor ? 1 : 3;
  const filteredIDs = entries.filter(
    (e) => e.type === type && e.lang === lang && typeof e.id === "number"
  ).map((e) => e.id).sort((a, b) => a - b);
  let idCurrent = 1;
  for (const id of filteredIDs) {
    if (idCurrent < id) {
      return {
        id: idCurrent,
        last: false
      };
    } else if (idCurrent === id) {
      ++idCurrent;
    }
  }
  return {
    id: idCurrent,
    last: true
  };
}
var IconGroupEntry = class _IconGroupEntry {
  constructor(groupEntry) {
    const view = new DataView(groupEntry.bin);
    const totalSize = view.byteLength;
    const icons = [];
    if (view.getUint16(2, true) === 1) {
      const count = view.getUint16(4, true);
      let offset = 6;
      for (let i = 0; i < count; ++i) {
        icons.push({
          width: readUint8WithLastOffset(view, offset, totalSize),
          height: readUint8WithLastOffset(
            view,
            offset + 1,
            totalSize
          ),
          colors: readUint8WithLastOffset(
            view,
            offset + 2,
            totalSize
          ),
          planes: readUint16WithLastOffset(
            view,
            offset + 4,
            totalSize
          ),
          bitCount: readUint16WithLastOffset(
            view,
            offset + 6,
            totalSize
          ),
          dataSize: readUint32WithLastOffset(
            view,
            offset + 8,
            totalSize
          ),
          iconID: readUint16WithLastOffset(
            view,
            offset + 12,
            totalSize
          )
        });
        offset += 14;
      }
    }
    this.id = groupEntry.id;
    this.lang = groupEntry.lang;
    this.icons = icons;
  }
  static fromEntries(entries) {
    return entries.filter((e) => e.type === 14).map((e) => new _IconGroupEntry(e));
  }
  generateEntry() {
    const bin = generateEntryBinary2(this.icons);
    return {
      type: 14,
      id: this.id,
      lang: this.lang,
      codepage: 0,
      bin
    };
  }
  /**
   * Return an array of `IconItem` / `RawIconItem`, which are in the group of this `IconGroupEntry` instance,
   * from specified resource entries.
   */
  getIconItemsFromEntries(entries) {
    return entries.map((e) => {
      if (e.type !== 3 || e.lang !== this.lang) {
        return null;
      }
      const c = this.icons.filter((icon) => e.id === icon.iconID).shift();
      if (!c) {
        return null;
      }
      return {
        entry: e,
        icon: c
      };
    }).filter((item) => !!item).map((item) => {
      const bin = item.entry.bin;
      const view = new DataView(bin);
      if (view.getUint32(0, true) === 40) {
        return IconItem.from(bin);
      } else {
        const c = item.icon;
        return RawIconItem.from(bin, c.width, c.height, c.bitCount);
      }
    });
  }
  /**
   * Add or replace icon resource entries with specified icon data.
   * The IDs of individual icon resources (`RT_ICON`) are calculated automatically.
   * @param destEntries base (destination) resource entries.
   * @param iconGroupID the icon ID for the new resource data.
   *     If the icon-group resource of the ID and 'lang' value already exists,
   *     the resource data is replaced; otherwise the resource data is appended.
   * @param lang the language for specified icons (0 for neutral, 0x409 for en-US)
   * @param icons the icons to replace
   */
  static replaceIconsForResource(destEntries, iconGroupID, lang, icons) {
    let entry = destEntries.filter(
      (e) => e.type === 14 && e.id === iconGroupID && e.lang === lang
    ).shift();
    const tmpIconArray = icons.map((icon) => {
      if (icon.isIcon()) {
        let { width, height } = icon;
        if (width === null) {
          width = icon.bitmapInfo.width;
        }
        if (height === null) {
          height = icon.bitmapInfo.height;
          if (icon.masks !== null) {
            height = Math.floor(height / 2);
          }
        }
        return {
          base: icon,
          bm: {
            width,
            height,
            planes: icon.bitmapInfo.planes,
            bitCount: icon.bitmapInfo.bitCount
          },
          bin: icon.generate(),
          id: 0
        };
      } else {
        return {
          base: icon,
          bm: {
            width: icon.width,
            height: icon.height,
            planes: 1,
            bitCount: icon.bitCount
          },
          bin: icon.bin,
          id: 0
        };
      }
    });
    if (entry) {
      for (let i = destEntries.length - 1; i >= 0; --i) {
        const e = destEntries[i];
        if (e != null && e.type === 3) {
          if (!isIconUsed(e, destEntries, entry)) {
            destEntries.splice(i, 1);
          }
        }
      }
    } else {
      entry = {
        type: 14,
        id: iconGroupID,
        lang,
        codepage: 0,
        // set later
        bin: null
      };
      destEntries.push(entry);
    }
    let idInfo;
    tmpIconArray.forEach((icon) => {
      if (!idInfo?.last) {
        idInfo = findUnusedIconID(destEntries, lang, false);
      } else {
        ++idInfo.id;
      }
      destEntries.push({
        type: 3,
        // RT_ICON
        id: idInfo.id,
        lang,
        codepage: 0,
        bin: icon.bin
      });
      icon.id = idInfo.id;
    });
    const binEntry = generateEntryBinary2(
      tmpIconArray.map((icon) => {
        let width = Math.abs(icon.bm.width);
        if (width >= 256) {
          width = 0;
        }
        let height = Math.abs(icon.bm.height);
        if (height >= 256) {
          height = 0;
        }
        let colors = 0;
        if (icon.base.isIcon()) {
          const bmBase = icon.base.bitmapInfo;
          colors = bmBase.colorUsed || bmBase.colors.length;
          if (!colors) {
            switch (bmBase.bitCount) {
              case 1:
                colors = 2;
                break;
              case 4:
                colors = 16;
                break;
            }
          }
          if (colors >= 256) {
            colors = 0;
          }
        }
        return {
          width,
          height,
          colors,
          planes: icon.bm.planes,
          bitCount: icon.bm.bitCount,
          dataSize: icon.bin.byteLength,
          iconID: icon.id
        };
      })
    );
    entry.bin = binEntry;
    function isIconUsed(icon, allEntries, excludeGroup) {
      return allEntries.some((e) => {
        if (e.type !== 14 || e.id === excludeGroup.id && e.lang === excludeGroup.lang) {
          return false;
        }
        const g = new _IconGroupEntry(e);
        return g.icons.some((c) => {
          return c.iconID === icon.id;
        });
      });
    }
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/resource/StringTableItem.ts
var StringTableItem = class _StringTableItem {
  constructor() {
    this.length = 16;
    this._a = [];
    this._a.length = 16;
    for (let i = 0; i < 16; ++i) {
      this._a[i] = "";
    }
  }
  static fromEntry(bin, offset, byteLength) {
    const view = new DataView(bin, offset, byteLength);
    const ret = new _StringTableItem();
    let o = 0;
    for (let i = 0; i < 16; ++i) {
      const len = view.getUint16(o, true);
      o += 2;
      let s = "";
      for (let j = 0; j < len; ++j) {
        s += String.fromCharCode(view.getUint16(o, true));
        o += 2;
      }
      ret._a[i] = s;
    }
    return ret;
  }
  get(index) {
    const value = this._a[index];
    return value != null && value !== "" ? value : null;
  }
  getAll() {
    return this._a.map((s) => s || null);
  }
  set(index, val) {
    this._a[index] = `${val ?? ""}`.substr(0, 4097);
  }
  calcByteLength() {
    let len = 0;
    for (let i = 0; i < 16; ++i) {
      const item = this._a[i];
      len += 2;
      if (item != null) {
        len += 2 * item.length;
      }
    }
    return Math.floor((len + 15) / 16) * 16;
  }
  generate(bin, offset) {
    const out = new DataView(bin, offset);
    let len = 0;
    for (let i = 0; i < 16; ++i) {
      const s = this._a[i];
      const l = s == null ? 0 : s.length > 4097 ? 4097 : s.length;
      out.setUint16(len, l, true);
      len += 2;
      if (s != null) {
        for (let j = 0; j < l; ++j) {
          out.setUint16(len, s.charCodeAt(j), true);
          len += 2;
        }
      }
    }
    return Math.floor((len + 15) / 16) * 16;
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/resource/StringTable.ts
var StringTable = class _StringTable {
  constructor() {
    this.lang = 0;
    this.items = [];
  }
  /** Create StringTable instance from resource entries, with specified language. */
  static fromEntries(lang, entries) {
    const r = new _StringTable();
    entries.forEach((e) => {
      if (e.type !== 6 || e.lang !== lang || typeof e.id !== "number" || e.id <= 0) {
        return;
      }
      r.items[e.id - 1] = StringTableItem.fromEntry(
        e.bin,
        0,
        e.bin.byteLength
      );
    });
    r.lang = lang;
    return r;
  }
  /** Return all string entries. */
  getAllStrings() {
    return this.items.map((e, i) => {
      return e.getAll().map(
        (x, j) => x !== null && x !== "" ? { id: (i << 4) + j, text: x } : null
      ).filter((x) => !!x);
    }).reduce((p, c) => p.concat(c), []);
  }
  /** Return the string data for ID value, which can be used for Win32API LoadString. */
  getById(id) {
    if (id < 0) {
      return null;
    }
    const entryIndex = id >> 4;
    const entryPos = id & 15;
    const e = this.items[entryIndex];
    return e?.get(entryPos) ?? null;
  }
  /**
   * Set/overwide the string data for ID value, which can be used for Win32API LoadString.
   * @param id data ID
   * @param text string data (entry will be removed if null or empty string is specified)
   */
  setById(id, text) {
    if (id < 0) {
      return;
    }
    const entryIndex = id >> 4;
    const entryPos = id & 15;
    let e = this.items[entryIndex];
    if (!e) {
      this.items[entryIndex] = e = new StringTableItem();
    }
    e.set(entryPos, text);
  }
  /** Generates an array of Entry for resource processings */
  generateEntries() {
    return this.items.map((e, i) => {
      const len = e.calcByteLength();
      const bin = new ArrayBuffer(len);
      e.generate(bin, 0);
      return {
        type: 6,
        id: i + 1,
        lang: this.lang,
        codepage: 1200,
        bin
      };
    }).filter((e) => !!e);
  }
  /**
   * Replace all string entries for NtExecutableResource with containing resource data.
   * The only entries of same language are replaced.
   */
  replaceStringEntriesForExecutable(res) {
    const entries = this.generateEntries();
    const dest = res.entries;
    for (let i = 0; i < dest.length; ++i) {
      const e = dest[i];
      if (e != null && e.type === 6 && e.lang === this.lang) {
        for (let j = dest.length - 1; j >= i; --j) {
          const e2 = dest[j];
          if (e2 != null && e2.type === 6 && e2.lang === this.lang) {
            dest.splice(j, 1);
          }
        }
        const f = dest.splice.bind(dest, i, 0);
        f(...entries);
        return;
      }
    }
    for (let i = 0; i < dest.length; ++i) {
      const e = dest[i];
      if (e != null && e.type === 6 && e.lang < this.lang) {
        const f = dest.splice.bind(dest, i + 1, 0);
        f(...entries);
        return;
      }
    }
    for (let i = dest.length - 1; i >= 0; --i) {
      const e = dest[i];
      if (e != null && e.type === 6) {
        const f = dest.splice.bind(dest, i + 1, 0);
        f(...entries);
        return;
      }
    }
    dest.push(...entries);
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/resource/VersionFileFlags.ts
var VersionFileFlags = {
  Debug: 1,
  Prerelease: 2,
  Patched: 4,
  PrivateBuild: 8,
  InfoInferred: 16,
  SpecialBuild: 32
};
var VersionFileFlags_default = VersionFileFlags;

// ../wb-cache/vendor-src/resedit-js/src/main/resource/VersionFileOS.ts
var VersionFileOS = {
  Unknown: 0,
  _Windows16: 1,
  _PM16: 2,
  _PM32: 3,
  _Windows32: 4,
  DOS: 65536,
  OS2_16: 131072,
  OS2_32: 196608,
  NT: 262144,
  DOS_Windows16: 65537,
  DOS_Windows32: 65540,
  NT_Windows32: 262148,
  OS2_16_PM16: 131074,
  OS2_32_PM32: 196611
};
var VersionFileOS_default = VersionFileOS;

// ../wb-cache/vendor-src/resedit-js/src/main/resource/VersionFileSubtypes.ts
var VersionFileDriverSubtype = {
  Unknown: 0,
  Printer: 1,
  Keyboard: 2,
  Language: 3,
  Display: 4,
  Mouse: 5,
  Network: 6,
  System: 7,
  Installable: 8,
  Sound: 9,
  Comm: 10,
  VersionedPrinter: 12
};
var VersionFileFontSubtype = {
  Unknown: 0,
  Raster: 1,
  Vector: 2,
  TrueType: 3
};

// ../wb-cache/vendor-src/resedit-js/src/main/resource/VersionFileType.ts
var VersionFileType = {
  Unknown: 0,
  App: 1,
  DLL: 2,
  Driver: 3,
  Font: 4,
  VxD: 5,
  StaticLibrary: 7
};
var VersionFileType_default = VersionFileType;

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/DERObject.ts
var RawDERObject = class {
  constructor(data) {
    this.data = data;
  }
  toDER() {
    return [].slice.call(this.data);
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/derUtil.ts
function makeDERLength(length) {
  if (length < 128) {
    return [length];
  }
  const r = [];
  while (true) {
    r.push(length & 255);
    if (length < 256) {
      break;
    }
    length >>= 8;
  }
  r.push(128 + r.length);
  return r.reverse();
}
function makeDERBMPString(text) {
  const r = [].map.call(
    text,
    (c) => c.charCodeAt(0)
  );
  const ua = new Uint8Array(r.length * 2);
  const dv = new DataView(ua.buffer);
  r.forEach((v, i) => {
    dv.setUint16(i * 2, v, false);
  });
  return [30].concat(makeDERLength(ua.length)).concat(
    // convert Uint8Array to number[] (not using spread operator)
    [].slice.call(ua)
  );
}
function makeDEROctetString(bin) {
  if (!(bin instanceof Array)) {
    bin = [].slice.call(bin);
  }
  return [4].concat(makeDERLength(bin.length)).concat(bin);
}
function makeDERTaggedData(tag, body) {
  return [160 + tag].concat(makeDERLength(body.length)).concat(body);
}
function makeDERSequence(body) {
  return [48].concat(makeDERLength(body.length)).concat(body);
}
function arrayToDERSet(items) {
  const r = items.reduce(
    (prev, item) => prev.concat(item instanceof Array ? item : item.toDER()),
    []
  );
  return [49].concat(makeDERLength(r.length)).concat(r);
}

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/ObjectIdentifier.ts
var ObjectIdentifier = class {
  constructor(value) {
    if (typeof value === "string") {
      this.value = value.split(/\./g).map((s) => Number(s));
    } else {
      this.value = value;
    }
  }
  toDER() {
    const id = this.value;
    const r = [];
    if (id.length < 2) {
      throw new Error("Unexpected 'value' field");
    }
    r.push(id[0] * 40 + id[1]);
    for (let i = 2; i < id.length; ++i) {
      let val = id[i];
      let isFirst = true;
      const insertPos = r.length;
      while (true) {
        let v = val & 127;
        if (!isFirst) {
          v += 128;
        }
        r.splice(insertPos, 0, v);
        if (val < 128) {
          break;
        }
        isFirst = false;
        val = Math.floor(val / 128);
      }
    }
    return [6].concat(makeDERLength(r.length)).concat(r);
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/KnownOids.ts
var OID_SHA1_NO_SIGN = new ObjectIdentifier([1, 3, 14, 3, 2, 26]);
var OID_SHA256_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 1]);
var OID_SHA384_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 2]);
var OID_SHA512_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 3]);
var OID_SHA224_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 4]);
var OID_SHA512_224_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 5]);
var OID_SHA512_256_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 6]);
var OID_SHA3_224_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 7]);
var OID_SHA3_256_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 8]);
var OID_SHA3_384_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 9]);
var OID_SHA3_512_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 10]);
var OID_SHAKE128_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 11]);
var OID_SHAKE256_NO_SIGN = new ObjectIdentifier([2, 16, 840, 1, 101, 3, 4, 2, 12]);
var OID_RSA = new ObjectIdentifier([1, 2, 840, 113549, 1, 1, 1]);
var OID_DSA = new ObjectIdentifier([1, 2, 840, 10040, 4, 1]);
var OID_SIGNED_DATA = new ObjectIdentifier([1, 2, 840, 113549, 1, 7, 2]);
var OID_CONTENT_TYPE = new ObjectIdentifier([1, 2, 840, 113549, 1, 9, 3]);
var OID_MESSAGE_DIGEST = new ObjectIdentifier([1, 2, 840, 113549, 1, 9, 4]);
var OID_SPC_STATEMENT_TYPE_OBJID = new ObjectIdentifier([1, 3, 6, 1, 4, 1, 311, 2, 1, 11]);
var OID_SPC_SP_OPUS_INFO_OBJID = new ObjectIdentifier([1, 3, 6, 1, 4, 1, 311, 2, 1, 12]);
var OID_SPC_INDIVIDUAL_SP_KEY_PURPOSE_OBJID = new ObjectIdentifier([1, 3, 6, 1, 4, 1, 311, 2, 1, 21]);
var OID_RFC3161_COUNTER_SIGNATURE = new ObjectIdentifier([1, 3, 6, 1, 4, 1, 311, 3, 3, 1]);

// ../wb-cache/vendor-src/resedit-js/src/main/sign/certUtil.ts
function toUint8Array(bin) {
  if ("buffer" in bin) {
    return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
  } else {
    return new Uint8Array(bin);
  }
}
function calculateDERLength(data, offset) {
  let actualLength = 0;
  const value = data[offset];
  if (value == null) {
    throw new Error('Invalid "offset" value');
  } else if (value < 128) {
    actualLength = value;
    ++offset;
  } else if (value === 128) {
    throw new Error("Not supported certificate data (variable length)");
  } else {
    let c = value & 127;
    ++offset;
    while (c--) {
      if (offset >= data.length) {
        throw new Error(
          "Invalid certificate data (invalid sequence length)"
        );
      }
      actualLength <<= 8;
      actualLength |= data[offset];
      ++offset;
    }
  }
  return [actualLength, offset];
}
function skipField(data, offsetOfDataHead) {
  const [len, off] = calculateDERLength(data, offsetOfDataHead + 1);
  return off + len;
}
function pickCertificatesIfDERHasSignedData(ub, offset) {
  if (ub.length < offset + 2) {
    return null;
  }
  if (ub[offset] !== 48) {
    return null;
  }
  let tempLength;
  [tempLength, offset] = calculateDERLength(ub, offset + 1);
  if (tempLength > ub.length - offset) {
    throw new Error("Invalid certificate data (insufficient data length)");
  }
  if (ub[offset] !== 6) {
    return null;
  }
  const signedDataOid = OID_SIGNED_DATA.toDER();
  for (let i = 0; i < signedDataOid.length; ++i) {
    if (ub[offset + i] !== signedDataOid[i]) {
      return null;
    }
  }
  offset += signedDataOid.length;
  if (ub[offset] !== 160) {
    throw new Error("Invalid certificate data (no content in contentInfo)");
  }
  [tempLength, offset] = calculateDERLength(ub, offset + 1);
  if (offset + tempLength > ub.length) {
    throw new Error(
      "Invalid certificate data (invalid length for content)"
    );
  }
  if (ub[offset] !== 48) {
    throw new Error("Invalid certificate data (unexpected signedData)");
  }
  [tempLength, offset] = calculateDERLength(ub, offset + 1);
  if (offset + tempLength > ub.length) {
    throw new Error(
      "Invalid certificate data (invalid length for signedData)"
    );
  }
  if (ub[offset] !== 2 || ub[offset + 1] !== 1 || ub[offset + 2] !== 1) {
    throw new Error(
      "Invalid certificate data (unexpected signedData.version)"
    );
  }
  offset += 3;
  if (ub[offset] !== 49) {
    throw new Error(
      "Invalid certificate data (no signedData.digestAlgorithms)"
    );
  }
  [tempLength, offset] = calculateDERLength(ub, offset + 1);
  if (offset + tempLength > ub.length) {
    throw new Error(
      "Invalid certificate data (invalid length for signedData.digestAlgorithms)"
    );
  }
  offset += tempLength;
  if (ub[offset] !== 48) {
    throw new Error("Invalid certificate data (no signedData.contentInfo)");
  }
  [tempLength, offset] = calculateDERLength(ub, offset + 1);
  if (offset + tempLength > ub.length) {
    throw new Error(
      "Invalid certificate data (invalid length for signedData.contentInfo)"
    );
  }
  offset += tempLength;
  if (ub[offset] !== 160) {
    throw new Error(
      "Invalid certificate data (no signedData.certificates)"
    );
  }
  const [certsLength, newOffset] = calculateDERLength(ub, offset + 1);
  if (newOffset + certsLength > ub.length) {
    throw new Error(
      "Invalid certificate data (invalid length for signedData.certificates)"
    );
  }
  return ub.subarray(offset, newOffset + certsLength);
}
function pickIssuerAndSerialNumberDERFromCert(bin) {
  if (Array.isArray(bin)) {
    if (bin.length === 0) {
      throw new Error("No data is specified.");
    }
    return pickIssuerAndSerialNumberDERFromCert(bin[0]);
  }
  const ub = toUint8Array(bin);
  if (ub.length < 2) {
    throw new Error("Invalid certificate data");
  }
  if (ub[0] !== 48) {
    throw new Error(
      "Not supported certificate data (non-`Certificate`-format data)"
    );
  }
  const certsBin = pickCertificatesIfDERHasSignedData(ub, 0);
  if (certsBin) {
    const [tempLength2, eaten2] = calculateDERLength(certsBin, 1);
    if (eaten2 + tempLength2 > certsBin.length) {
      throw new Error(
        "Invalid certificate data (invalid length for signedData.certificates)"
      );
    }
    if (certsBin[eaten2] !== 48) {
      throw new Error(
        "Invalid certificate data (no signedData.certificates[0])"
      );
    }
    const [certLength, tempOffset] = calculateDERLength(
      certsBin,
      eaten2 + 1
    );
    if (tempOffset + certLength > certsBin.length) {
      throw new Error(
        "Invalid certificate data (invalid length for signedData.certificates[0])"
      );
    }
    return pickIssuerAndSerialNumberDERFromCert(
      certsBin.subarray(eaten2, tempOffset + certLength)
    );
  }
  let tempLength;
  let eaten;
  [tempLength, eaten] = calculateDERLength(ub, 1);
  if (tempLength > ub.length - eaten) {
    throw new Error("Invalid certificate data (insufficient data length)");
  }
  if (ub[eaten] !== 48) {
    throw new Error("Invalid certificate data (missing tbsCertificate)");
  }
  let tbsCertificateLen;
  [tbsCertificateLen, eaten] = calculateDERLength(ub, eaten + 1);
  if (tbsCertificateLen > ub.length - eaten) {
    throw new Error(
      "Invalid certificate data (invalid tbsCertificate length)"
    );
  }
  const tbsOffsetLast = eaten + tbsCertificateLen;
  if (ub[eaten] === 160) {
    eaten = skipField(ub, eaten);
    if (eaten >= tbsOffsetLast) {
      throw new Error(
        "Invalid certificate data (insufficient tbsCertificate data: after version)"
      );
    }
  }
  if (ub[eaten] !== 2) {
    throw new Error("Invalid certificate data (invalid serialNumber)");
  }
  const offsetAfterSerialNumber = skipField(ub, eaten);
  if (eaten >= tbsOffsetLast) {
    throw new Error(
      "Invalid certificate data (insufficient tbsCertificate data: after serialNumber)"
    );
  }
  const serialNumberDER = [].slice.call(
    ub,
    eaten,
    offsetAfterSerialNumber
  );
  eaten = offsetAfterSerialNumber;
  if (ub[eaten] !== 48) {
    throw new Error(
      "Invalid certificate data (invalid algorithmIdentifier)"
    );
  }
  eaten = skipField(ub, eaten);
  if (eaten >= tbsOffsetLast) {
    throw new Error(
      "Invalid certificate data (insufficient tbsCertificate data: after serialNumber)"
    );
  }
  if (ub[eaten] !== 48) {
    throw new Error("Invalid certificate data (invalid issuer)");
  }
  const offsetAfterIssuer = skipField(ub, eaten);
  if (offsetAfterIssuer > tbsOffsetLast) {
    throw new Error(
      "Invalid certificate data (insufficient tbsCertificate data: issuer)"
    );
  }
  return [
    // return entire issuer sequence
    [].slice.call(
      ub,
      eaten,
      offsetAfterIssuer
    ),
    serialNumberDER
  ];
}
function certBinToCertificatesDER(bin) {
  if (Array.isArray(bin)) {
    return bin.map(certBinToCertificatesDER).reduce((prev, cur) => prev.concat(cur), []);
  }
  const ub = toUint8Array(bin);
  const certsBin = pickCertificatesIfDERHasSignedData(ub, 0);
  if (certsBin) {
    const [tempLength, eaten] = calculateDERLength(certsBin, 1);
    if (eaten + tempLength > certsBin.length) {
      throw new Error(
        "Invalid certificate data (invalid length for signedData.certificates)"
      );
    }
    const offsetLast = eaten + tempLength;
    const rawData = [];
    for (let offset = eaten; offset < offsetLast; ) {
      if (certsBin[offset] !== 48) {
        throw new Error(
          "Invalid certificate data (no signedData.certificates[*])"
        );
      }
      const [certLength, tempOffset] = calculateDERLength(
        certsBin,
        offset + 1
      );
      if (tempOffset + certLength > certsBin.length) {
        throw new Error(
          "Invalid certificate data (invalid length for signedData.certificates[*])"
        );
      }
      rawData.push(
        new RawDERObject(
          certsBin.subarray(offset, tempOffset + certLength)
        )
      );
      offset = tempOffset + certLength;
    }
    return rawData;
  } else {
    return [new RawDERObject(ub)];
  }
}

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/AlgorithmIdentifier.ts
var AlgorithmIdentifier = class {
  constructor(algorithm) {
    this.algorithm = algorithm;
  }
  toDER() {
    const r = this.algorithm.toDER();
    return makeDERSequence(
      r.concat(
        // parameters is not used now
        [5, 0]
      )
    );
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/Attribute.ts
var Attribute = class {
  constructor(attrType, attrValues) {
    this.attrType = attrType;
    this.attrValues = attrValues;
  }
  toDER() {
    return makeDERSequence(
      this.attrType.toDER().concat(arrayToDERSet(this.attrValues))
    );
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/ContentInfo.ts
var ContentInfo = class {
  constructor(contentType, content) {
    this.contentType = contentType;
    this.content = content;
  }
  toDER() {
    return makeDERSequence(
      this.contentType.toDER().concat(makeDERTaggedData(0, this.content.toDER()))
    );
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/CertificateDataRoot.ts
var CertificateDataRoot = class extends ContentInfo {
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/DigestInfo.ts
var DigestInfo = class {
  constructor(digestAlgorithm, digest) {
    this.digestAlgorithm = digestAlgorithm;
    this.digest = digest;
  }
  toDER() {
    const digest = this.digest;
    let digestArray;
    if ("buffer" in digest) {
      digestArray = new Uint8Array(
        digest.buffer,
        digest.byteOffset,
        digest.byteLength
      );
    } else {
      digestArray = new Uint8Array(digest);
    }
    const derData = this.digestAlgorithm.toDER().concat(makeDEROctetString(digestArray));
    return makeDERSequence(derData);
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/IssuerAndSerialNumber.ts
var IssuerAndSerialNumber = class {
  constructor(issuer, serialNumber) {
    this.issuer = issuer;
    this.serialNumber = serialNumber;
  }
  toDER() {
    return makeDERSequence(
      this.issuer.toDER().concat(this.serialNumber.toDER())
    );
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/SignedData.ts
var SignedData = class {
  constructor(version, digestAlgorithms, contentInfo, signerInfos, certificates, crls) {
    this.version = version;
    this.digestAlgorithms = digestAlgorithms;
    this.contentInfo = contentInfo;
    this.signerInfos = signerInfos;
    this.certificates = certificates;
    this.crls = crls;
  }
  toDER() {
    let r = [2, 1, this.version & 255].concat(arrayToDERSet(this.digestAlgorithms)).concat(this.contentInfo.toDER());
    if (this.certificates && this.certificates.length > 0) {
      const allCertsDER = arrayToDERSet(this.certificates);
      allCertsDER[0] = 160;
      r = r.concat(allCertsDER);
    }
    if (this.crls) {
      r = r.concat(makeDERTaggedData(1, arrayToDERSet(this.crls)));
    }
    r = r.concat(arrayToDERSet(this.signerInfos));
    return makeDERSequence(r);
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/SignerInfo.ts
var SignerInfo = class {
  constructor(version, issuerAndSerialNumber, digestAlgorithm, digestEncryptionAlgorithm, encryptedDigest, authenticatedAttributes, unauthenticatedAttributes) {
    this.version = version;
    this.issuerAndSerialNumber = issuerAndSerialNumber;
    this.digestAlgorithm = digestAlgorithm;
    this.digestEncryptionAlgorithm = digestEncryptionAlgorithm;
    this.encryptedDigest = encryptedDigest;
    this.authenticatedAttributes = authenticatedAttributes;
    this.unauthenticatedAttributes = unauthenticatedAttributes;
  }
  toDER() {
    let r = [2, 1, this.version & 255].concat(this.issuerAndSerialNumber.toDER()).concat(this.digestAlgorithm.toDER());
    if (this.authenticatedAttributes && this.authenticatedAttributes.length > 0) {
      const a = arrayToDERSet(this.authenticatedAttributes);
      a[0] = 160;
      r = r.concat(a);
    }
    r = r.concat(this.digestEncryptionAlgorithm.toDER()).concat(makeDEROctetString(this.encryptedDigest));
    if (this.unauthenticatedAttributes && this.unauthenticatedAttributes.length > 0) {
      const u = arrayToDERSet(this.unauthenticatedAttributes);
      u[0] = 161;
      r = r.concat(u);
    }
    return makeDERSequence(r);
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/SpcIndirectDataContent.ts
var SPC_INDIRECT_DATA_OBJID = new ObjectIdentifier([1, 3, 6, 1, 4, 1, 311, 2, 1, 4]);
var SpcAttributeTypeAndOptionalValue = class {
  constructor(type, value) {
    this.type = type;
    this.value = value;
  }
  toDER() {
    return makeDERSequence(this.type.toDER().concat(this.value.toDER()));
  }
};
var SpcIndirectDataContent = class {
  constructor(data, messageDigest) {
    this.data = data;
    this.messageDigest = messageDigest;
  }
  toDER() {
    return makeDERSequence(this.toDERWithoutHeader());
  }
  // this is used for calculating 'messageDigest'
  toDERWithoutHeader() {
    return this.data.toDER().concat(this.messageDigest.toDER());
  }
};
var SpcIndirectDataContentInfo = class extends ContentInfo {
  constructor(content) {
    super(SPC_INDIRECT_DATA_OBJID, content);
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/SpcLink.ts
var SpcLink = class {
  constructor(tag, value) {
    this.tag = tag;
    this.value = value;
  }
  toDER() {
    const v = this.value.toDER();
    if (this.tag === 2) {
      return makeDERTaggedData(this.tag, v);
    } else {
      v[0] = 128 + this.tag;
      return v;
    }
  }
};
var SpcLinkFile = class extends SpcLink {
  constructor(file) {
    const v = makeDERBMPString(file);
    v[0] = 128;
    super(2, new RawDERObject(v));
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/data/SpcPeImageData.ts
var SPC_PE_IMAGE_DATA_OBJID = new ObjectIdentifier([1, 3, 6, 1, 4, 1, 311, 2, 1, 15]);
var SpcPeImageFlags = {
  IncludeResources: 0,
  IncludeDebugInfo: 1,
  IncludeImportAddressTable: 2
};
var SpcPeImageData = class {
  constructor(flags, file) {
    this.flags = flags;
    this.file = file;
  }
  toDER() {
    return makeDERSequence(
      [3, 1, this.flags & 255].concat(
        // undocumented -- SpcLink must be tagged
        makeDERTaggedData(0, this.file.toDER())
      )
    );
  }
};
var SpcPeImageAttributeTypeAndOptionalValue = class extends SpcAttributeTypeAndOptionalValue {
  constructor(value) {
    super(SPC_PE_IMAGE_DATA_OBJID, value);
  }
};

// ../wb-cache/vendor-src/resedit-js/src/main/sign/timestamp.ts
function createTimestampRequest(data, algorithmIdentifier) {
  return new Uint8Array(
    makeDERSequence(
      // version
      [2, 1, 1].concat(
        makeDERSequence(
          algorithmIdentifier.toDER().concat(makeDEROctetString(toUint8Array(data)))
        )
      ).concat([1, 1, 255])
    )
  ).buffer;
}
function pickSignedDataFromTimestampResponse(data) {
  const ub = toUint8Array(data);
  if (ub.length < 2 || ub[0] !== 48) {
    throw new Error("Invalid or unexpected timestamp response");
  }
  let len;
  let offset;
  [len, offset] = calculateDERLength(ub, 1);
  if (len > ub.length - offset) {
    throw new Error(
      "Invalid or unexpected timestamp response (insufficient buffer)"
    );
  }
  const dataLast = offset + len;
  if (ub[offset] !== 48) {
    throw new Error(
      "Invalid or unexpected timestamp response (no PKIStatusInfo)"
    );
  }
  [len, offset] = calculateDERLength(ub, offset + 1);
  if (offset >= dataLast) {
    throw new Error(
      "Invalid or unexpected timestamp response (invalid length for PKIStatusInfo)"
    );
  }
  const timeStampTokenOffset = offset + len;
  if (ub[offset] !== 2 || ub[offset + 1] !== 1) {
    throw new Error(
      "Invalid or unexpected timestamp response (invalid PKIStatusInfo.status)"
    );
  }
  const status = ub[offset + 2];
  switch (status) {
    case 0:
    // granted
    case 1:
      break;
    case 2:
    // rejection
    case 3:
    // waiting
    case 4:
    // revocationWarning
    case 5: {
      let msg = `Timestamp response has error status ${status}`;
      if (offset + 3 < timeStampTokenOffset && ub[offset + 3] === 48) {
        [len, offset] = calculateDERLength(ub, offset + 4);
        if (offset + len <= timeStampTokenOffset && ub[offset] === 12) {
          [len, offset] = calculateDERLength(ub, offset + 1);
          if (offset + len <= timeStampTokenOffset) {
            const statusString = (
              // pick UTF8String body
              [].slice.call(
                ub,
                offset,
                offset + len
              ).map((val) => {
                if (val >= 32 && val <= 126) {
                  return String.fromCharCode(val);
                } else {
                  let s = val.toString(16);
                  if (s.length === 1) {
                    s = "0" + s;
                  }
                  return "%" + s;
                }
              }).join("")
            );
            msg += ", text = " + decodeURIComponent(statusString);
          }
        }
      }
      throw new Error(msg);
    }
    default:
      throw new Error(
        `Unexpected PKIStatusInfo.status: ${status ?? "(unknown)"}`
      );
  }
  if (timeStampTokenOffset + 1 >= dataLast || ub[timeStampTokenOffset] !== 48) {
    throw new Error(
      "Invalid or unexpected timestamp response (no TimeStampToken)"
    );
  }
  [len, offset] = calculateDERLength(ub, timeStampTokenOffset + 1);
  if (offset + len > dataLast) {
    throw new Error(
      "Invalid or unexpected timestamp response (insufficient data for TimeStampToken)"
    );
  }
  const signedDataOid = OID_SIGNED_DATA.toDER();
  if (ub[offset] !== 6) {
    throw new Error(
      "Invalid or unexpected timestamp response (no contentType in TimeStampToken)"
    );
  }
  for (let i = 0; i < signedDataOid.length; ++i) {
    if (ub[offset + i] !== signedDataOid[i]) {
      throw new Error(
        "Invalid or unexpected timestamp response (unexpected TimeStampToken.contentType octet)"
      );
    }
  }
  offset += signedDataOid.length;
  if (ub[offset] !== 160) {
    throw new Error(
      "Invalid or unexpected timestamp response (no content in TimeStampToken)"
    );
  }
  [len, offset] = calculateDERLength(ub, offset + 1);
  if (offset + len > dataLast) {
    throw new Error(
      "Invalid or unexpected timestamp response (invalid length for TimeStampToken.content)"
    );
  }
  return allocatePartialBinary2(ub, offset, len);
}

// ../wb-cache/vendor-src/resedit-js/src/main/sign/index.ts
function makeSimpleIterator(data) {
  let done = false;
  return {
    next() {
      if (done) {
        return {
          done: true,
          value: void 0
        };
      } else {
        done = true;
        return {
          done: false,
          value: data
        };
      }
    }
  };
}
function validateSignerObject(signer) {
  if (!signer.encryptData && !signer.signData) {
    throw new Error(
      "Signer object must implement either `encryptData` or `signData`."
    );
  }
}
function calculateExecutableDigest(executable, signer, alignment) {
  function* inner() {
    const checkSumOffset = executable.dosHeader.newHeaderAddress + 88;
    const certificateTableOffset = executable.dosHeader.newHeaderAddress + executable.newHeader.getDataDirectoryOffset() + format_exports.ImageDataDirectoryArray.itemSize * format_exports.ImageDirectoryEntry.Certificate;
    const rawHeader = executable.getRawHeader();
    const targetSections = executable.getAllSections();
    const sectionCount = targetSections.length;
    const sectionStartOffset = rawHeader.byteLength;
    const sectionEndOffset = roundUp2(
      sectionStartOffset + sectionCount * format_exports.ImageSectionHeaderArray.itemSize,
      executable.getFileAlignment()
    );
    const sectionHeadersSize = sectionEndOffset - sectionStartOffset;
    const secHeader = new ArrayBuffer(sectionHeadersSize);
    {
      const secArray = format_exports.ImageSectionHeaderArray.from(
        secHeader,
        sectionCount
      );
      targetSections.forEach((sec, i) => {
        secArray.set(i, sec.info);
      });
    }
    yield allocatePartialBinary2(rawHeader, 0, checkSumOffset);
    yield allocatePartialBinary2(
      rawHeader,
      checkSumOffset + 4,
      certificateTableOffset - (checkSumOffset + 4)
    );
    {
      const off = certificateTableOffset + format_exports.ImageDataDirectoryArray.itemSize;
      yield allocatePartialBinary2(
        executable.getRawHeader(),
        off,
        executable.getTotalHeaderSize() - off
      );
    }
    yield secHeader;
    for (const section of targetSections) {
      if (section.data) {
        yield section.data;
      }
    }
    const exData = executable.getExtraData();
    if (exData !== null) {
      yield exData;
      const alignedLength = roundUp2(exData.byteLength, alignment);
      const diff = alignedLength - exData.byteLength;
      if (diff !== 0) {
        yield new Uint8Array(diff).buffer;
      }
    }
  }
  return signer.digestData(inner());
}
function getAlgorithmIdentifierObject(type) {
  if (typeof type !== "string") {
    return new AlgorithmIdentifier(new ObjectIdentifier(type));
  }
  switch (type) {
    case "sha1":
    case "SHA1":
      return new AlgorithmIdentifier(OID_SHA1_NO_SIGN);
    case "sha256":
    case "SHA256":
      return new AlgorithmIdentifier(OID_SHA256_NO_SIGN);
    case "sha384":
    case "SHA384":
      return new AlgorithmIdentifier(OID_SHA384_NO_SIGN);
    case "sha512":
    case "SHA512":
      return new AlgorithmIdentifier(OID_SHA512_NO_SIGN);
    case "sha224":
    case "SHA224":
      return new AlgorithmIdentifier(OID_SHA224_NO_SIGN);
    case "sha512-224":
    case "SHA512-224":
      return new AlgorithmIdentifier(OID_SHA512_224_NO_SIGN);
    case "sha512-256":
    case "SHA512-256":
      return new AlgorithmIdentifier(OID_SHA512_256_NO_SIGN);
    case "sha3-224":
    case "SHA3-224":
      return new AlgorithmIdentifier(OID_SHA3_224_NO_SIGN);
    case "sha3-256":
    case "SHA3-256":
      return new AlgorithmIdentifier(OID_SHA3_256_NO_SIGN);
    case "sha3-384":
    case "SHA3-384":
      return new AlgorithmIdentifier(OID_SHA3_384_NO_SIGN);
    case "sha3-512":
    case "SHA3-512":
      return new AlgorithmIdentifier(OID_SHA3_512_NO_SIGN);
    case "shake128":
    case "SHAKE128":
      return new AlgorithmIdentifier(OID_SHAKE128_NO_SIGN);
    case "shake256":
    case "SHAKE256":
      return new AlgorithmIdentifier(OID_SHAKE256_NO_SIGN);
    default:
      throw new Error("Invalid or unsupported digest algorithm");
  }
}
function doSign(signer, digestAlgorithm, dataIterator) {
  if (signer.signData) {
    return signer.signData(dataIterator);
  } else {
    return signer.digestData(dataIterator).then((digestAttributes) => {
      const digestInfoBin = new Uint8Array(
        new DigestInfo(digestAlgorithm, digestAttributes).toDER()
      ).buffer;
      return signer.encryptData(makeSimpleIterator(digestInfoBin));
    });
  }
}
function generateExecutableWithSign(executable, signer, alignment) {
  validateSignerObject(signer);
  let certAlignment;
  if (typeof alignment === "number") {
    if (alignment <= 0) {
      throw new Error("Invalid alignment value");
    }
    certAlignment = alignment;
  } else {
    certAlignment = executable.getFileAlignment();
  }
  const digestAlgorithm = getAlgorithmIdentifierObject(
    signer.getDigestAlgorithm()
  );
  let digestEncryptionAlgorithm;
  const a = signer.getEncryptionAlgorithm();
  if (typeof a !== "string") {
    digestEncryptionAlgorithm = new AlgorithmIdentifier(
      new ObjectIdentifier(a)
    );
  } else {
    switch (a) {
      case "rsa":
      case "RSA":
        digestEncryptionAlgorithm = new AlgorithmIdentifier(
          OID_RSA
        );
        break;
      case "dsa":
      case "DSA":
        digestEncryptionAlgorithm = new AlgorithmIdentifier(
          OID_DSA
        );
        break;
      default:
        throw new Error(
          "Invalid or unsupported digest encryption algorithm"
        );
    }
  }
  const cert = signer.getCertificateData ? signer.getCertificateData() : signer.getPublicKeyData();
  const [issuer, serialNumber] = pickIssuerAndSerialNumberDERFromCert(cert);
  return (
    // calculate digest
    calculateExecutableDigest(executable, signer, certAlignment).then((digest) => {
      const content = new SpcIndirectDataContent(
        new SpcPeImageAttributeTypeAndOptionalValue(
          new SpcPeImageData(
            SpcPeImageFlags.IncludeResources,
            new SpcLinkFile("")
          )
        ),
        new DigestInfo(digestAlgorithm, digest)
      );
      return signer.digestData(
        makeSimpleIterator(
          new Uint8Array(content.toDERWithoutHeader()).buffer
        )
      ).then((contentDigest) => {
        const attributes = [
          new Attribute(
            OID_SPC_SP_OPUS_INFO_OBJID,
            // (SpcSpOpusInfo) null sequence
            [new RawDERObject([48, 0])]
          ),
          new Attribute(OID_CONTENT_TYPE, [
            SPC_INDIRECT_DATA_OBJID
          ]),
          new Attribute(
            OID_SPC_STATEMENT_TYPE_OBJID,
            [
              new RawDERObject(
                makeDERSequence(
                  OID_SPC_INDIVIDUAL_SP_KEY_PURPOSE_OBJID.toDER()
                )
              )
            ]
          ),
          new Attribute(OID_MESSAGE_DIGEST, [
            new RawDERObject(
              makeDEROctetString(
                toUint8Array(contentDigest)
              )
            )
          ])
        ];
        const attrBin = new Uint8Array(
          arrayToDERSet(attributes)
        ).buffer;
        return doSign(
          signer,
          digestAlgorithm,
          makeSimpleIterator(attrBin)
        ).then(
          (signed) => {
            return [content, attributes, signed];
          }
        );
      });
    }).then(
      ([content, attributes, signed]) => {
        const signerInfo = new SignerInfo(
          // version
          1,
          // issuerAndSerialNumber
          new IssuerAndSerialNumber(
            new RawDERObject(issuer),
            new RawDERObject(serialNumber)
          ),
          // digestAlgorithm
          digestAlgorithm,
          // digestEncryptionAlgorithm
          digestEncryptionAlgorithm,
          // encryptedDigest
          toUint8Array(signed),
          // authenticatedAttributes
          attributes
        );
        if (!signer.timestampData) {
          return [content, signerInfo];
        }
        return signer.digestData(
          makeSimpleIterator(cloneToArrayBuffer2(signed))
        ).then((digestEncryptedBase) => {
          const digestEncrypted = createTimestampRequest(
            digestEncryptedBase,
            digestAlgorithm
          );
          return signer.timestampData(
            digestEncrypted
          ).then(
            (timestamp) => {
              const timestampSignedData = pickSignedDataFromTimestampResponse(
                timestamp
              );
              signerInfo.unauthenticatedAttributes = [
                new Attribute(
                  OID_RFC3161_COUNTER_SIGNATURE,
                  [
                    new ContentInfo(
                      OID_SIGNED_DATA,
                      new RawDERObject(
                        toUint8Array(
                          timestampSignedData
                        )
                      )
                    )
                  ]
                )
              ];
              return [content, signerInfo];
            }
          );
        });
      }
    ).then(([content, signerInfo]) => {
      const root = new CertificateDataRoot(
        OID_SIGNED_DATA,
        new SignedData(
          // version
          1,
          // digestAlgorithms
          [digestAlgorithm],
          // contentInfo
          new SpcIndirectDataContentInfo(content),
          // signerInfos
          [signerInfo],
          // certificates
          certBinToCertificatesDER(cert)
        )
      );
      const certBin = new Uint8Array(root.toDER());
      const resultBin = new ArrayBuffer(8 + certBin.length);
      const resultView = new DataView(resultBin);
      resultView.setUint32(0, certBin.length + 8, true);
      resultView.setUint16(4, 512, true);
      resultView.setUint16(6, 2, true);
      copyBuffer2(resultBin, 8, certBin, 0, certBin.byteLength);
      return resultBin;
    }).then((certBin) => {
      const alignedSize = roundUp2(certBin.byteLength, certAlignment);
      let paddingSize = alignedSize;
      const exData = executable.getExtraData();
      if (exData !== null) {
        const diffSize = roundUp2(exData.byteLength, certAlignment) - exData.byteLength;
        paddingSize += diffSize;
      }
      const newBin = executable.generate(paddingSize);
      const certOffset = newBin.byteLength - alignedSize;
      const dirArray = format_exports.ImageDataDirectoryArray.from(
        newBin,
        executable.dosHeader.newHeaderAddress + executable.newHeader.getDataDirectoryOffset()
      );
      dirArray.set(format_exports.ImageDirectoryEntry.Certificate, {
        size: alignedSize,
        virtualAddress: certOffset
      });
      calculateCheckSumForPE(newBin, true);
      copyBuffer2(newBin, certOffset, certBin, 0, certBin.byteLength);
      return newBin;
    })
  );
}

// ../wb-cache/vendor-src/resedit-js/src/main/version.ts
var version_default2 = "3.1.0";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Data,
  Format,
  Mui,
  NtExecutable,
  NtExecutableResource,
  Resource,
  generateExecutableWithSign,
  version
});
