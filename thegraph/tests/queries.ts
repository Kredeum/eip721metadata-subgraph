#! npx ts-mocha

import { describe, it } from "mocha";
import { expect } from "chai";
import fetch from "node-fetch";

const endpoint = "https://api.thegraph.com/subgraphs/name/zapaz/eip721-rinkeby";

const _graphQL = async (_url: string, _query: string): Promise<any> => {
  let json = {};
  try {
    const resp = await fetch(_url, { method: "POST", body: JSON.stringify({ query: _query }) });
    json = await resp.json();
  } catch (e) {
    console.error("_graphQL ERROR", e, _url, json);
  }
  return json;
};

describe("Subgraph Queries", async function () {
  let nfts, nft;

  it("Should get one NFT", async function () {
    this.timeout(50000);

    nfts = await _graphQL(
      endpoint,
      `{
      tokens(first: 1, where: { metadata_not: "" }) {        id
        tokenURI
        name
        description
        image
        metadata
      }
    }`
    );
    console.log(nfts);
    expect(nfts?.tokens?.length).to.be.equal(1);
  });

  it("NFT should have metadata", async function () {
    nft = nfts.tokens[0];
    expect(nft.metadata.length).to.be.gte(2);
  });

  it("NFT should have name, description and image as in metadata", async function () {
    const metadata = JSON.parse(nft.metadata);
    expect(metadata.name).to.be.equal(nft.name);
    expect(metadata.image).to.be.equal(nft.image);
    expect(metadata.description).to.be.equal(nft.description);
  });
});
