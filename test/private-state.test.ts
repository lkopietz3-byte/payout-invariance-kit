/**
 * Private `#fields` cannot be read from outside the class, so the default
 * comparison cannot see them (README, "Honest limits"). These tests pin that
 * documented behavior and the recipe that closes the gap, plus an end-to-end
 * check that a disguised built-in output cannot pass.
 */
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { assertPayoutInvariance } from "../src/index";
import type { PayoutMutationScenario } from "../src/index";

interface Offer {
  id: string;
  payout: number;
}
interface Input {
  offers: Offer[];
}

class Ranked {
  #top: string;
  constructor(top: string) {
    this.#top = top;
  }
  get top(): string {
    return this.#top;
  }
}

const base: Input = { offers: [{ id: "a", payout: 1 }, { id: "b", payout: 9 }] };
const flip: PayoutMutationScenario<Input> = {
  name: "a pays most",
  mutate: (input) => ({ offers: input.offers.map((offer) => (offer.id === "a" ? { ...offer, payout: 99 } : offer)) }),
};
const topByPayout = (input: Input): string => [...input.offers].sort((x, y) => y.payout - x.payout)[0]?.id ?? "";

describe("class instances whose state lives only in #private fields", () => {
  it("documented limit: a biased ranker that returns only private state passes the default comparison", () => {
    const biased = (input: Input): Ranked => new Ranked(topByPayout(input));
    expect(biased(base).top).toBe("b");
    expect(biased(flip.mutate(base)).top).toBe("a");
    expect(assertPayoutInvariance(biased, base, [flip]).passed).toBe(true);
  });

  it("an isEqual that compares the getters you care about catches the bias", () => {
    const biased = (input: Input): Ranked => new Ranked(topByPayout(input));
    const result = assertPayoutInvariance(biased, base, [flip], { isEqual: (a, b) => a.top === b.top });
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.scenario)).toEqual(["a pays most"]);
  });

  it("returning plain data instead also catches the bias", () => {
    const biased = (input: Input): { top: string } => ({ top: topByPayout(input) });
    expect(assertPayoutInvariance(biased, base, [flip]).passed).toBe(false);
  });
});

describe("a disguised built-in output cannot pass", () => {
  it("fails a ranker whose output is a Proxy around a Date from another realm", () => {
    const realm: object = createContext({});
    const biased = (input: Input): object => ({
      when: runInContext(`new Proxy(new Date(${input.offers[0]?.payout ?? 0}), {})`, realm) as object,
    });
    expect(assertPayoutInvariance(biased, base, [flip]).passed).toBe(false);
  });
});

describe("documented limit: one shared output object edited on every call", () => {
  it("a reused Error, DataView or boxed primitive with an extra property passes (kept by reference)", () => {
    const error = new Error("x");
    const reuseError = (input: Input): { top: Error } => {
      error.message = topByPayout(input);
      return { top: error };
    };
    const view = new DataView(new ArrayBuffer(1));
    const reuseView = (input: Input): { view: DataView } => {
      view.setUint8(0, topByPayout(input) === "a" ? 1 : 2);
      return { view };
    };
    const boxed = Object.assign(new String("top"), { id: "" });
    const reuseBoxed = (input: Input): { boxed: typeof boxed } => {
      boxed.id = topByPayout(input);
      return { boxed };
    };
    expect(assertPayoutInvariance(reuseError, base, [flip]).passed).toBe(true);
    expect(assertPayoutInvariance(reuseView, base, [flip]).passed).toBe(true);
    expect(assertPayoutInvariance(reuseBoxed, base, [flip]).passed).toBe(true);
    // A fresh object per call is compared by content and fails.
    expect(assertPayoutInvariance((input: Input) => ({ top: new Error(topByPayout(input)) }), base, [flip]).passed).toBe(false);
  });
});
