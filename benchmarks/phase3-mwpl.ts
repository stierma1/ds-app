import {
  AdaptiveHuffmanCode,
  HuffmanCode,
  HuTuckerCode,
  LengthLimitedHuffman,
} from "../src/index.ts";

const alphabet = Array.from({ length: 256 }, (_, index) => `s${index}`);
const frequencies = new Map<string, number>();
for (let index = 0; index < alphabet.length; index++) {
  frequencies.set(alphabet[index] as string, Math.max(1, Math.floor(1_000_000 / (index + 1))));
}

const text: string[] = [];
let state = 0x9e3779b9;
for (let index = 0; index < 100_000; index++) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  text.push(alphabet[state % alphabet.length] as string);
}

function milliseconds(run: () => void): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

interface StaticFactory {
  name: string;
  create(): { encode(symbols: Iterable<string>): string; decode(bits: string): string[] };
}

const factories: StaticFactory[] = [
  { name: "HuffmanCode", create: () => HuffmanCode.fromFrequencies(frequencies) },
  {
    name: "LengthLimitedHuffman L=12",
    create: () => LengthLimitedHuffman.fromFrequencies(frequencies, 12),
  },
  { name: "HuTuckerCode", create: () => HuTuckerCode.fromFrequencies(frequencies) },
];

const rows: Array<Record<string, string | number>> = [];
for (const factory of factories) {
  let bits = "";
  const buildMs = milliseconds(() => {
    factory.create();
  });
  const encodeMs = milliseconds(() => {
    const code = factory.create();
    bits = code.encode(text);
  });
  const decodeMs = milliseconds(() => {
    const code = factory.create();
    code.decode(bits);
  });
  rows.push({
    implementation: factory.name,
    "build ms": buildMs.toFixed(1),
    "encode ms": encodeMs.toFixed(1),
    "decode ms": decodeMs.toFixed(1),
    "bits/symbol": (bits.length / text.length).toFixed(2),
  });
}

console.log(`Static prefix codes, ${alphabet.length} symbols, ${text.length} encoded symbols`);
console.table(rows);

const adaptiveAlphabet = alphabet.slice(0, 64);
const adaptiveText = text.slice(0, 20_000).map((symbol) => {
  const index = Number(symbol.slice(1));
  return adaptiveAlphabet[index % adaptiveAlphabet.length] as string;
});
const adaptive = new AdaptiveHuffmanCode(adaptiveAlphabet);
let adaptiveBits = "";
const adaptiveMs = milliseconds(() => {
  for (const symbol of adaptiveText) {
    adaptiveBits += adaptive.encode([symbol]);
    adaptive.update(symbol);
  }
});
console.log(
  `AdaptiveHuffmanCode, ${adaptiveAlphabet.length} symbols, ${adaptiveText.length} updated symbols`,
);
console.table([
  {
    implementation: "AdaptiveHuffmanCode",
    "encode+update ms": adaptiveMs.toFixed(1),
    "bits/symbol": (adaptiveBits.length / adaptiveText.length).toFixed(2),
    valid: adaptive.validate(),
  },
]);
