#! npx ts-mocha

import { describe, it } from "mocha";
import { expect } from "chai";
import fetch from "node-fetch";

describe("Subgraph Tests", async function () {
  it("Should be OK", async function () {
    expect(true).to.be.true;
  });
});
