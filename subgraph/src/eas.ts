import { Attested as AttestedEvent } from "../generated/EAS/EAS"
import { EAS } from "../generated/EAS/EAS"
import { Belief } from "../generated/schema"
import { BigInt, ethereum, log } from "@graphprotocol/graph-ts"

// Your belief schema UID on Base Sepolia
const BELIEF_SCHEMA_UID = "0x69bcd982f49a139ab468090c647465c104c637ddac748063b143bc2435de064f"

export function handleAttested(event: AttestedEvent): void {
  // Only process attestations using our belief schema
  if (event.params.schemaUID.toHexString() != BELIEF_SCHEMA_UID) {
    return
  }

  let beliefId = event.params.uid
  let belief = Belief.load(beliefId)
  
  if (belief == null) {
    belief = new Belief(beliefId)
    belief.totalStaked = BigInt.fromI32(0)
    belief.stakerCount = 0
    belief.createdAt = event.block.timestamp
    belief.lastStakedAt = event.block.timestamp
    belief.attester = event.params.attester
  }
  
  // Fetch the full attestation data from EAS contract
  let easContract = EAS.bind(event.address)
  let attestationResult = easContract.try_getAttestation(event.params.uid)
  
  if (attestationResult.reverted) {
    log.error("Failed to get attestation for UID: {}", [beliefId.toHexString()])
    belief.beliefText = ""
  } else {
    let attestation = attestationResult.value
    let data = attestation.data
    
    log.info("Attestation data length: {}", [data.length.toString()])
    
    // Try decoding - schema is "string belief"
    let decoded = ethereum.decode('string', data)
    
    if (decoded != null) {
      belief.beliefText = decoded.toString()
      log.info("Successfully decoded belief text: {}", [belief.beliefText])
    } else {
      log.warning("Failed to decode attestation data for UID: {}", [beliefId.toHexString()])
      belief.beliefText = ""
    }
  }
  
  belief.save()
}
