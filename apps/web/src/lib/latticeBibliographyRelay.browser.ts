import { expect, it, vi } from "vitest";

import { initializeEmbedMode } from "../embedMode";
import {
  LATTICE_BIBLIOGRAPHY_TOOL_RESULT,
  startLatticeBibliographyRelay,
  SYNARA_BIBLIOGRAPHY_TOOL_REQUEST,
} from "../latticeBibliographyRelay";

it("relays cite from a fresh named embed through the host and submits the citation key", async () => {
  // Vitest runs browser tests in a real iframe. Exercise the handshake and
  // postMessage boundary, not just a pre-populated legacy storage slot.
  const originalUrl = window.location.href;
  const originalName = window.name;
  const storageKeys = [
    "synara.poc.embed-mode:chrome",
    "synara.poc.embed-auth-token:chrome",
    "synara.poc.embed-auth-token",
  ];
  const originalStorage = storageKeys.map((key) => sessionStorage.getItem(key));
  const hostOrigin = window.location.origin;
  const workspaceRoot = "/workspace/Native VLM";
  const request = {
    id: "citation-roundtrip",
    action: "cite",
    params: { query: "2401.06209" },
    expiresAt: Date.now() + 5_000,
  };
  const hostRequests: unknown[] = [];
  const onRequest = (event: MessageEvent) => {
    if (event.source !== window || event.data?.type !== SYNARA_BIBLIOGRAPHY_TOOL_REQUEST) return;
    hostRequests.push(event.data);
  };
  // A listener's realm determines MessageEvent.source. Install the responder
  // in the parent realm rather than faking a MessageEvent in the child.
  const parentResponder = (window.parent as Window & typeof globalThis).Function(
    "child",
    "origin",
    "result",
    `
    return function(event) {
      if (event.source === child && event.data?.type === 'synara:bibliography-tool-request') {
        child.postMessage(result, origin);
      }
    };
  `,
  )(window, hostOrigin, {
    type: LATTICE_BIBLIOGRAPHY_TOOL_RESULT,
    version: 1,
    id: request.id,
    ok: true,
    result: { citationKey: "tong2024eyes" },
  }) as (event: MessageEvent) => void;
  window.parent.addEventListener("message", onRequest);
  window.parent.addEventListener("message", parentResponder);
  let polled = false;
  const submissions: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/bibliography-tools/result")) {
      submissions.push({ url, init: init! });
      return new Response(null, { status: 204 });
    }
    if (!polled) {
      polled = true;
      return Response.json(request);
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Stopped", "AbortError")),
        { once: true },
      );
    });
  });
  let stop: (() => void) | undefined;
  try {
    sessionStorage.removeItem("synara.poc.embed-auth-token");
    const url = new URL(originalUrl);
    url.searchParams.set("embed", "1");
    url.searchParams.set("workspaceRoot", workspaceRoot);
    url.searchParams.set("hostOrigin", hostOrigin);
    url.searchParams.set("surface", "chrome");
    url.hash = "lattice-auth=fresh-chrome-token";
    history.replaceState(history.state, "", url);
    initializeEmbedMode();
    expect(window.name).toBe("synara-embed-chrome");
    expect(window.location.hash).toBe("");
    stop = startLatticeBibliographyRelay();
    await vi.waitFor(() => expect(submissions).toHaveLength(1), { timeout: 2_000 });
    expect(hostRequests).toEqual([
      {
        type: SYNARA_BIBLIOGRAPHY_TOOL_REQUEST,
        version: 1,
        ...request,
        workspaceRoot,
      },
    ]);
    expect(submissions[0]?.init.headers).toEqual({
      Authorization: "Bearer fresh-chrome-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(submissions[0]?.init.body))).toEqual({
      id: request.id,
      result: { ok: true, result: { citationKey: "tong2024eyes" } },
    });
  } finally {
    stop?.();
    fetchMock.mockRestore();
    window.parent.removeEventListener("message", onRequest);
    window.parent.removeEventListener("message", parentResponder);
    history.replaceState(history.state, "", originalUrl);
    window.name = originalName;
    storageKeys.forEach((key, index) => {
      const value = originalStorage[index];
      if (value == null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    });
  }
});
