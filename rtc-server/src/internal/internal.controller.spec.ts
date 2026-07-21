import { ServiceUnavailableException } from "@nestjs/common";
import { InternalController } from "./internal.controller";

function makeController(codaExtract?: { extractHtml: jest.Mock }) {
  const getHeadSeq = jest.fn().mockResolvedValue(42);
  const controller = new InternalController(
    { getHeadSeq } as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    codaExtract as never
  );
  return { controller, getHeadSeq };
}

describe("InternalController.headSeq", () => {
  it("returns the doc's current head seq (no extraction)", async () => {
    const { controller, getHeadSeq } = makeController();
    await expect(controller.headSeq("d1")).resolves.toEqual({ headSeq: 42 });
    expect(getHeadSeq).toHaveBeenCalledWith("d1");
  });
});

describe("InternalController.codaHtml", () => {
  it("passes a genuinely-empty result straight through (200, isEmpty)", async () => {
    const empty = { docId: "d1", html: "", headSeq: 0, isEmpty: true };
    const extractHtml = jest.fn().mockResolvedValue(empty);
    const { controller } = makeController({ extractHtml });
    await expect(controller.codaHtml("d1")).resolves.toEqual(empty);
  });

  it("surfaces an extraction failure as a 503 (never a 200 with empty content)", async () => {
    const extractHtml = jest
      .fn()
      .mockRejectedValue(new Error("coda extraction timed out"));
    const { controller } = makeController({ extractHtml });
    await expect(controller.codaHtml("d1")).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });
});
