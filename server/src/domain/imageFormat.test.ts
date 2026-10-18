import assert from "node:assert/strict";
import { test } from "node:test";
import { sniffImageFormat } from "./imageFormat.js";

const pad = (head: number[] | Buffer) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);
const ftyp = (brand: string) => pad(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp" + brand, "ascii")]));

test("formats are read from the bytes, not the upload label", () => {
  assert.equal(sniffImageFormat(pad([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageFormat(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImageFormat(pad(Buffer.from("RIFF\0\0\0\0WEBP", "ascii"))), "image/webp");
  assert.equal(sniffImageFormat(ftyp("heic")), "image/heic");
  assert.equal(sniffImageFormat(ftyp("mif1")), "image/heif");
  assert.equal(sniffImageFormat(pad(Buffer.from("not an image", "ascii"))), null);
  assert.equal(sniffImageFormat(Buffer.from([0xff])), null);
});
