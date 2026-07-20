import type { AccelerationSignal, UserCorrection, WorkBlock } from "../../domain/src/models";

const EXTERNAL_CHAT_BLOCK_NAMESPACE = "weekform:external-chat-work-block:v1\0";
const SAFE_CHAT_CORRECTION_FIELDS = new Set<UserCorrection["field"]>([
  "category",
  "mode",
  "planned_status",
  "blocker_flag",
  "verification",
  "start_time",
  "end_time",
]);

function rightRotate(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Seeds(): { constants: Uint32Array; initial: Uint32Array } {
  const constants = new Uint32Array(64);
  const initial = new Uint32Array(8);
  let candidate = 2;
  let found = 0;
  const isPrime = (number: number) => {
    for (let divisor = 2; divisor * divisor <= number; divisor += 1) {
      if (number % divisor === 0) return false;
    }
    return true;
  };
  while (found < 64) {
    if (isPrime(candidate)) {
      if (found < 8) initial[found] = Math.floor((Math.sqrt(candidate) % 1) * 2 ** 32);
      constants[found] = Math.floor((Math.cbrt(candidate) % 1) * 2 ** 32);
      found += 1;
    }
    candidate += 1;
  }
  return { constants, initial };
}

const SHA256_SEEDS = sha256Seeds();

/** Synchronous SHA-256 for the shared browser, Tauri, and Node execution path. */
function sha256(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32), false);

  const hash = SHA256_SEEDS.initial.slice();
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const a = schedule[index - 15];
      const b = schedule[index - 2];
      const s0 = rightRotate(a, 7) ^ rightRotate(a, 18) ^ (a >>> 3);
      const s1 = rightRotate(b, 17) ^ rightRotate(b, 19) ^ (b >>> 10);
      schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + SHA256_SEEDS.constants[index] + schedule[index]) >>> 0;
      const sigma0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map((part) => part.toString(16).padStart(8, "0")).join("");
}

function hasChatProvenanceId(value: string): boolean {
  return value.startsWith("chat-")
    || value.startsWith("chat_review-")
    || value.startsWith("imported-chat-");
}

/** True only when local provenance identifies the block as Chat-derived. */
export function isChatDerivedWorkBlock(
  block: Pick<WorkBlock, "work_block_id" | "derived_from">,
): boolean {
  return hasChatProvenanceId(block.work_block_id)
    || (Array.isArray(block.derived_from) && block.derived_from.some(hasChatProvenanceId));
}

function opaqueChatBlockId(localBlockId: string): string {
  return `wfb-${sha256(`${EXTERNAL_CHAT_BLOCK_NAMESPACE}${localBlockId}`)}`;
}

/** Stable external id. Non-Chat blocks retain their existing id exactly. */
export function externalWorkBlockId(
  block: Pick<WorkBlock, "work_block_id" | "derived_from">,
): string {
  return isChatDerivedWorkBlock(block)
    ? opaqueChatBlockId(block.work_block_id)
    : block.work_block_id;
}

/**
 * Project a local block across an AI or private-Web boundary. Chat provenance,
 * provider-derived labels, canonical hashes, evidence, and notes stay local.
 */
export function externalSafeWorkBlock(block: WorkBlock): WorkBlock {
  if (!isChatDerivedWorkBlock(block)) return block;
  return {
    ...block,
    work_block_id: externalWorkBlockId(block),
    project_name: block.estimated_capacity_pct <= 0
      ? "Directed Chat request"
      : block.category === "Meetings / stakeholder syncs"
        ? "Chat call"
        : "Chat workload",
    stakeholder_group: "Workplace chat",
    derived_from: [],
    evidence: ["Content-free workplace Chat evidence"],
    notes: null,
  };
}

function correctionBlock(
  correction: UserCorrection,
  blocksByLocalId: ReadonlyMap<string, WorkBlock>,
): WorkBlock | null {
  return blocksByLocalId.get(correction.work_block_id) ?? null;
}

/** Apply the same Chat boundary to correction context sent with a prompt. */
export function externalSafeCorrections(
  corrections: readonly UserCorrection[],
  blocks: readonly WorkBlock[],
): UserCorrection[] {
  const blocksByLocalId = new Map(blocks.map((block) => [block.work_block_id, block]));
  return corrections.map((correction) => {
    const block = correctionBlock(correction, blocksByLocalId);
    const chatDerived = block
      ? isChatDerivedWorkBlock(block)
      : hasChatProvenanceId(correction.work_block_id);
    if (!chatDerived) return correction;
    const safeValue = SAFE_CHAT_CORRECTION_FIELDS.has(correction.field)
      ? null
      : "Chat-derived value omitted";
    return {
      ...correction,
      work_block_id: block
        ? externalWorkBlockId(block)
        : opaqueChatBlockId(correction.work_block_id),
      ...(safeValue === null
        ? {}
        : { old_value: safeValue, new_value: safeValue }),
      reason: "User corrected a Chat-derived work block.",
    };
  });
}

function redactChatProviderIdentity(value: string): string {
  return value
    .replace(/chat-(?:call-)?(?:slack|google_chat|webex|teams)-[a-z0-9._:-]+/gi, "workplace Chat evidence")
    .replace(/canonical-chat-hash-[a-z0-9._:-]+/gi, "content-free Chat evidence")
    .replace(/\b(?:google[ _]chat|microsoft teams|slack|webex|teams)\b/gi, "workplace Chat");
}

/** Remove provider-derived labels from a deterministic signal before AI synthesis. */
export function externalSafeAccelerationSignal(
  signal: AccelerationSignal,
  blocks: readonly WorkBlock[],
): AccelerationSignal {
  const chatBlockIds = new Set(
    blocks.filter(isChatDerivedWorkBlock).map((block) => block.work_block_id),
  );
  const chatDerived = signal.derived_from.some(
    (sourceId) => chatBlockIds.has(sourceId) || hasChatProvenanceId(sourceId),
  );
  if (!chatDerived) return signal;
  return {
    ...signal,
    title: redactChatProviderIdentity(signal.title),
    detail: redactChatProviderIdentity(signal.detail),
    evidence: signal.evidence.map((entry) => (
      entry.startsWith("Most of it sits in ")
        ? "The repeated work includes content-free Chat-derived blocks"
        : redactChatProviderIdentity(entry)
    )),
  };
}

/** Build a fail-closed external-id lookup; duplicate ids are deliberately unresolved. */
function localIdsByExternalId(blocks: readonly WorkBlock[]): Map<string, string | null> {
  const lookup = new Map<string, string | null>();
  for (const block of blocks) {
    const externalId = externalWorkBlockId(block);
    lookup.set(externalId, lookup.has(externalId) ? null : block.work_block_id);
  }
  return lookup;
}

export function resolveExternalWorkBlockIds(
  blocks: readonly WorkBlock[],
  externalIds: readonly string[],
): string[] {
  const lookup = localIdsByExternalId(blocks);
  return externalIds.flatMap((externalId) => {
    const localId = lookup.get(externalId);
    return localId ? [localId] : [];
  });
}

export function findWorkBlockByExternalId(
  blocks: readonly WorkBlock[],
  externalId: string,
): WorkBlock | null {
  const localId = localIdsByExternalId(blocks).get(externalId);
  return localId ? blocks.find((block) => block.work_block_id === localId) ?? null : null;
}
