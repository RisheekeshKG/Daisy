import { beforeEach, describe, expect, it } from "vitest";
import { getUserName, hasUserName, setUserName } from "./userName";

beforeEach(() => {
  localStorage.clear();
});

describe("userName", () => {
  it("has no name before onboarding", () => {
    expect(getUserName()).toBe("");
    expect(hasUserName()).toBe(false);
  });

  it("persists a name across reads", () => {
    setUserName("Alex");
    expect(getUserName()).toBe("Alex");
    expect(hasUserName()).toBe(true);
  });

  it("trims and collapses whitespace", () => {
    setUserName("   Alex   Smith  ");
    expect(getUserName()).toBe("Alex Smith");
  });

  it("truncates names longer than 40 characters", () => {
    const long = "A".repeat(60);
    setUserName(long);
    expect(getUserName().length).toBe(40);
  });

  it("a name of only whitespace leaves hasUserName false", () => {
    setUserName("   ");
    expect(hasUserName()).toBe(false);
  });
});
