import { ByteArray, Bytes, BigInt, store, json, ipfs, JSONValue, JSONValueKind } from "@graphprotocol/graph-ts";
import { All, Token, TokenContract, Owner, OwnerPerTokenContract } from "../generated/schema";
import { Transfer, EIP721 } from "../generated/EIP721metadata/EIP721";

let zeroAddress = "0x0000000000000000000000000000000000000000";

function supportsInterface(contract: EIP721, interfaceId: string, expected: boolean = true): boolean {
  const interfaceIdBytes = Bytes.fromByteArray(ByteArray.fromHexString(interfaceId));
  let supports = contract.try_supportsInterface(interfaceIdBytes);
  return !supports.reverted && supports.value == expected;
}

function setCharAt(str: string, index: i32, char: string): string {
  if (index > str.length - 1) return str;
  return str.substr(0, index) + char + str.substr(index + 1);
}

function normalize(strValue: string): string {
  if (strValue.length === 1 && strValue.charCodeAt(0) === 0) {
    return "";
  } else {
    for (let i = 0; i < strValue.length; i++) {
      if (strValue.charCodeAt(i) === 0) {
        strValue = setCharAt(strValue, i, "\ufffd"); // graph-node db does not support string with '\u0000'
      }
    }
    return strValue;
  }
}

export function handleTransfer(event: Transfer): void {
  let tokenId = event.params.id;
  let id = event.address.toHex() + "_" + tokenId.toString();
  let contractId = event.address.toHex();
  let from = event.params.from.toHex();
  let to = event.params.to.toHex();

  let all = All.load("all");
  if (all == null) {
    all = new All("all");
    all.numOwners = BigInt.fromI32(0);
    all.numTokens = BigInt.fromI32(0);
    all.numTokenContracts = BigInt.fromI32(0);
  }

  let contract = EIP721.bind(event.address);
  let tokenContract = TokenContract.load(contractId);
  if (tokenContract == null) {
    // log.error('contract : {}',[event.address.toHexString()]);
    let supportsEIP165Identifier = supportsInterface(contract, "01ffc9a7");
    let supportsEIP721Identifier = supportsInterface(contract, "80ac58cd");
    let supportsNullIdentifierFalse = supportsInterface(contract, "00000000", false);
    let supportsEIP721 = supportsEIP165Identifier && supportsEIP721Identifier && supportsNullIdentifierFalse;

    let supportsEIP721Metadata = false;
    if (supportsEIP721) {
      supportsEIP721Metadata = supportsInterface(contract, "5b5e139f");
      // log.error('NEW CONTRACT eip721Metadata for {} : {}', [event.address.toHex(), supportsEIP721Metadata ? 'true' : 'false']);
    }
    if (supportsEIP721) {
      tokenContract = new TokenContract(contractId);
      tokenContract.doAllAddressesOwnTheirIdByDefault = false;
      tokenContract.supportsEIP721Metadata = supportsEIP721Metadata;
      tokenContract.numTokens = BigInt.fromI32(0);
      tokenContract.numOwners = BigInt.fromI32(0);
      let name = contract.try_name();
      if (!name.reverted) {
        tokenContract.name = normalize(name.value);
      }
      let symbol = contract.try_symbol();
      if (!symbol.reverted) {
        tokenContract.symbol = normalize(symbol.value);
      }
    } else {
      return;
    }
    all.numTokenContracts = all.numTokenContracts.plus(BigInt.fromI32(1));

    let doAllAddressesOwnTheirIdByDefault = contract.try_doAllAddressesOwnTheirIdByDefault();
    if (!doAllAddressesOwnTheirIdByDefault.reverted) {
      tokenContract.doAllAddressesOwnTheirIdByDefault = doAllAddressesOwnTheirIdByDefault.value; // only set it at creation
    } else {
      tokenContract.doAllAddressesOwnTheirIdByDefault = false;
    }
  }

  if (from != zeroAddress || to != zeroAddress) {
    // skip if from zero to zero

    if (from != zeroAddress) {
      // existing token
      let currentOwnerPerTokenContractId = contractId + "_" + from;
      let currentOwnerPerTokenContract = OwnerPerTokenContract.load(currentOwnerPerTokenContractId);
      if (currentOwnerPerTokenContract != null) {
        if (currentOwnerPerTokenContract.numTokens.equals(BigInt.fromI32(1))) {
          tokenContract.numOwners = tokenContract.numOwners.minus(BigInt.fromI32(1));
        }
        currentOwnerPerTokenContract.numTokens = currentOwnerPerTokenContract.numTokens.minus(BigInt.fromI32(1));
        currentOwnerPerTokenContract.save();
      }

      let currentOwner = Owner.load(from);
      if (currentOwner != null) {
        if (currentOwner.numTokens.equals(BigInt.fromI32(1))) {
          all.numOwners = all.numOwners.minus(BigInt.fromI32(1));
        }
        currentOwner.numTokens = currentOwner.numTokens.minus(BigInt.fromI32(1));
        currentOwner.save();
      }
    } // else minting

    if (to != zeroAddress) {
      // transfer
      let newOwner = Owner.load(to);
      if (newOwner == null) {
        newOwner = new Owner(to);
        newOwner.numTokens = BigInt.fromI32(0);
      }

      let eip721Token = Token.load(id);
      if (eip721Token == null) {
        eip721Token = new Token(id);
        eip721Token.contract = tokenContract.id;
        eip721Token.tokenID = tokenId;
        eip721Token.mintTime = event.block.timestamp;
        eip721Token.tokenURI = "";

        // BEGIN METADATA ADDITION
        eip721Token.name = "";
        eip721Token.description = "";
        eip721Token.image = "";
        eip721Token.metadata = "";

        if (tokenContract.supportsEIP721Metadata) {
          let metadataURI = contract.try_tokenURI(tokenId);
          if (!metadataURI.reverted) {
            eip721Token.tokenURI = normalize(metadataURI.value);

            let cid = eip721Token.tokenURI.substring(eip721Token.tokenURI.lastIndexOf("/") + 1);
            if (cid) {
              let jsonIpfs = ipfs.cat(cid);
              if (jsonIpfs) {
                let metadata = jsonIpfs.toString().trim();
                eip721Token.metadata = metadata;
                if (metadata.startsWith("{") && metadata.endsWith("}")) {
                  let jsonResult = json.try_fromBytes(jsonIpfs as Bytes);
                  if (jsonResult.isOk) {
                    let jsonObject = jsonResult.value.toObject();
                    if (jsonObject != null) {
                      const name = jsonObject.get("name");
                      const kindName = name ? name.kind : JSONValueKind.NULL;
                      if (kindName == JSONValueKind.STRING) {
                        eip721Token.name = name ? name.toString() : "";
                      }
                      const image = jsonObject.get("image");
                      const kindImage = image ? image.kind : JSONValueKind.NULL;
                      if (kindImage == JSONValueKind.STRING) {
                        eip721Token.image = image ? image.toString() : "";
                      }
                      const description = jsonObject.get("description");
                      const kindDescription = description ? description.kind : JSONValueKind.NULL;
                      if (kindDescription == JSONValueKind.STRING) {
                        eip721Token.description = description ? description.toString() : "";
                      }
                    }
                  }
                }
              }
            }
          }
        }
        // END METADATA ADDITION
      }

      all.numTokens = all.numTokens.plus(BigInt.fromI32(1));
      eip721Token.owner = newOwner.id;
      eip721Token.save();

      if (newOwner.numTokens.equals(BigInt.fromI32(0))) {
        all.numOwners = all.numOwners.plus(BigInt.fromI32(1));
      }
      newOwner.numTokens = newOwner.numTokens.plus(BigInt.fromI32(1));
      newOwner.save();

      let newOwnerPerTokenContractId = contractId + "_" + to;
      let newOwnerPerTokenContract = OwnerPerTokenContract.load(newOwnerPerTokenContractId);
      if (newOwnerPerTokenContract == null) {
        newOwnerPerTokenContract = new OwnerPerTokenContract(newOwnerPerTokenContractId);
        newOwnerPerTokenContract.owner = newOwner.id;
        newOwnerPerTokenContract.contract = tokenContract.id;
        newOwnerPerTokenContract.numTokens = BigInt.fromI32(0);
      }

      if (newOwnerPerTokenContract.numTokens.equals(BigInt.fromI32(0))) {
        tokenContract.numOwners = tokenContract.numOwners.plus(BigInt.fromI32(1));
      }
      newOwnerPerTokenContract.numTokens = newOwnerPerTokenContract.numTokens.plus(BigInt.fromI32(1));
      newOwnerPerTokenContract.save();

      tokenContract.numTokens = tokenContract.numTokens.plus(BigInt.fromI32(1));
    } else {
      // burn
      store.remove("Token", id);
      all.numTokens = all.numTokens.minus(BigInt.fromI32(1));
      tokenContract.numTokens = tokenContract.numTokens.minus(BigInt.fromI32(1));
    }
  }
  tokenContract.save();
  all.save();
}
