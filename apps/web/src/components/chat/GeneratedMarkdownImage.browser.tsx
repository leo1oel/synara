// FILE: GeneratedMarkdownImage.browser.tsx
// Purpose: Browser regressions for the generated-image hover actions.
// Layer: Focused component interaction tests

import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { GeneratedMarkdownImage } from "./GeneratedMarkdownImage";

const { toastAdd } = vi.hoisted(() => ({ toastAdd: vi.fn() }));

vi.mock("../ui/toast", () => ({ toastManager: { add: toastAdd } }));

const READY_IMAGE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='160'%3E%3Crect width='240' height='160' fill='gray'/%3E%3C/svg%3E";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  toastAdd.mockReset();
  document.body.innerHTML = "";
});

describe("GeneratedMarkdownImage", () => {
  it("expands when the visible Expand affordance is clicked", async () => {
    const onImageExpand = vi.fn();
    const screen = await render(
      <GeneratedMarkdownImage
        src="./generated-figure.png"
        alt="Generated figure"
        cwd="/tmp/project"
        onImageExpand={onImageExpand}
      />,
    );

    try {
      await vi.waitFor(() =>
        expect(
          document.querySelector<HTMLImageElement>(".chat-generated-image__img"),
        ).not.toBeNull(),
      );
      const image = document.querySelector<HTMLImageElement>(".chat-generated-image__img");
      if (image) {
        image.src = READY_IMAGE_DATA_URL;
      }
      await vi.waitFor(() =>
        expect(document.querySelector(".chat-generated-image")?.getAttribute("data-status")).toBe(
          "ready",
        ),
      );

      await page.getByText("Expand", { exact: true }).click();

      expect(onImageExpand).toHaveBeenCalledOnce();
      expect(onImageExpand).toHaveBeenCalledWith({
        images: [
          {
            src: expect.stringContaining(
              "/api/local-image?path=.%2Fgenerated-figure.png&cwd=%2Ftmp%2Fproject",
            ),
            name: "generated-figure.png",
          },
        ],
        index: 0,
      });
    } finally {
      await screen.unmount();
    }
  });

  it("downloads and confirms when the visible Download affordance is clicked", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("image bytes", {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated-image-download");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const screen = await render(
      <GeneratedMarkdownImage
        src="./generated-figure.png"
        alt="Generated figure"
        cwd="/tmp/project"
      />,
    );

    try {
      await vi.waitFor(() =>
        expect(
          document.querySelector<HTMLImageElement>(".chat-generated-image__img"),
        ).not.toBeNull(),
      );
      const image = document.querySelector<HTMLImageElement>(".chat-generated-image__img");
      if (image) {
        image.src = READY_IMAGE_DATA_URL;
      }
      await vi.waitFor(() =>
        expect(document.querySelector(".chat-generated-image")?.getAttribute("data-status")).toBe(
          "ready",
        ),
      );

      await page.getByText("Download", { exact: true }).click();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/local-image?path=.%2Fgenerated-figure.png&cwd=%2Ftmp%2Fproject&download=1",
        ),
      );
      await vi.waitFor(() =>
        expect(toastAdd).toHaveBeenCalledWith({
          type: "success",
          title: "Downloaded generated-figure.png",
        }),
      );
    } finally {
      await screen.unmount();
    }
  });
});
