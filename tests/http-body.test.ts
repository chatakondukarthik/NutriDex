import { describe, expect, it } from "vitest";
import { readBodyWithLimit } from "@/lib/http/body";

/**
 * The import route must not trust `content-length`. These cases pin the
 * stream-level ceiling: a body over the limit is abandoned, not buffered.
 */
describe("readBodyWithLimit", () => {
  it("reads a body under the limit", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      body: new Blob([Buffer.from("hello")]),
    });

    const body = await readBodyWithLimit(request, 1024);

    expect(body?.toString("utf8")).toBe("hello");
  });

  it("returns null for a body over the limit", async () => {
    const request = new Request("http://localhost/", {
      method: "POST",
      body: new Blob([Buffer.alloc(2048, 1)]),
    });

    expect(await readBodyWithLimit(request, 1024)).toBeNull();
  });

  it("handles a request with no body", async () => {
    const request = new Request("http://localhost/", { method: "POST" });
    expect(await readBodyWithLimit(request, 1024)).toEqual(Buffer.alloc(0));
  });

  it("stops reading a chunked stream at the limit", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 4) controller.close();
        else controller.enqueue(new Uint8Array(512));
      },
    });

    const request = new Request("http://localhost/", {
      method: "POST",
      body: stream,
      // Node's fetch types require this for a streaming body.
      duplex: "half",
    } as RequestInit);

    expect(await readBodyWithLimit(request, 1024)).toBeNull();
    // Two chunks reach the limit; the reader is cancelled rather than
    // draining the rest of the stream.
    expect(pulled).toBeLessThan(4);
  });
});
