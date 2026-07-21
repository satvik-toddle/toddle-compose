import { InternalController } from "./internal.controller";

describe("InternalController.headSeq", () => {
  it("returns the doc's current head seq (no extraction)", async () => {
    const getHeadSeq = jest.fn().mockResolvedValue(42);
    const controller = new InternalController(
      { getHeadSeq } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never
    );
    await expect(controller.headSeq("d1")).resolves.toEqual({ headSeq: 42 });
    expect(getHeadSeq).toHaveBeenCalledWith("d1");
  });
});
