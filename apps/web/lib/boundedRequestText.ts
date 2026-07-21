export type BoundedRequestTextResult =
  | { status: "ok"; text: string; byteLength: number }
  | { status: "too_large" }
  | { status: "invalid" };

type RequestStream = Pick<Request, "body" | "headers">;

function announcedByteLength(headers: Headers): number | null {
  const value = headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function cancelStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await stream.cancel();
  } catch {
    // The response still fails closed when an already-errored stream rejects cancellation.
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The response still fails closed when an already-errored stream rejects cancellation.
  }
}

/**
 * Read a request stream without ever accumulating more than `maxBytes`.
 * Content-Length is an optional fast rejection only; every chunk is counted.
 */
export async function readBoundedRequestText(
  request: RequestStream,
  maxBytes: number,
): Promise<BoundedRequestTextResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }

  const { body } = request;
  const announced = announcedByteLength(request.headers);
  if (announced !== null && announced > maxBytes) {
    if (body) await cancelStream(body);
    return { status: "too_large" };
  }
  if (!body) return { status: "ok", text: "", byteLength: 0 };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.byteLength === 0) continue;
      if (byteLength + next.value.byteLength > maxBytes) {
        await cancelReader(reader);
        return { status: "too_large" };
      }
      byteLength += next.value.byteLength;
      // Copy the accepted view so a larger backing buffer cannot be retained.
      chunks.push(next.value.slice());
    }
  } catch {
    await cancelReader(reader);
    return { status: "invalid" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    status: "ok",
    text: new TextDecoder().decode(bytes),
    byteLength,
  };
}
